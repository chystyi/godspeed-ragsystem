-- Writes that cost money or protect an invariant now go through functions only.
--
-- Until now a signed-in user could also write straight to the tables with their own token and
-- the public key: insert any number of chunks with made-up vectors (they would crowd other
-- users' results out of the approximate index scan), set their documents' bookkeeping columns,
-- or store unlimited data, bypassing every limit of the API. Two overlapping edits of one
-- document could also leave the old text in the search index.

-- ---------------------------------------------------------------------------------------------
-- 1. Size limits that hold however a row is written
-- ---------------------------------------------------------------------------------------------
create or replace function public.tags_are_valid(p_tags text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select cardinality(p_tags) <= 20
     and not exists (select 1 from unnest(p_tags) as tag where char_length(tag) not between 1 and 40);
$$;

alter table public.documents
  add constraint documents_tags_valid check (public.tags_are_valid(tags));
alter table public.messages
  add constraint messages_content_length check (char_length(content) <= 50000);
alter table public.messages
  add constraint messages_sources_size check (sources is null or octet_length(sources::text) <= 100000);

-- ---------------------------------------------------------------------------------------------
-- 2. Per-user caps (the lists of the API show at most 200 entries)
-- ---------------------------------------------------------------------------------------------
create or replace function public.enforce_row_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cap integer := tg_argv[0]::integer;
  existing integer;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into existing using new.user_id;
  if existing >= cap then
    raise exception '% limit of % reached', tg_table_name, cap using errcode = 'P0004';
  end if;
  return new;
end;
$$;

create trigger documents_row_limit
  before insert on public.documents
  for each row execute function public.enforce_row_limit(200);
create trigger conversations_row_limit
  before insert on public.conversations
  for each row execute function public.enforce_row_limit(200);

-- ---------------------------------------------------------------------------------------------
-- 3. No direct writes to derived or append-only data; only user-editable columns elsewhere
-- ---------------------------------------------------------------------------------------------
revoke insert, update, delete on public.document_chunks from authenticated;
drop policy chunks_insert_own on public.document_chunks;
drop policy chunks_delete_own on public.document_chunks;

revoke insert on public.messages from authenticated;
drop policy messages_insert_own on public.messages;

revoke insert, update on public.documents from authenticated;
grant insert (title, content, tags), update (title, content, tags) on public.documents to authenticated;

revoke insert, update on public.conversations from authenticated;
grant insert (title), update (title) on public.conversations to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. The functions that do the writing. They run with elevated rights (SECURITY DEFINER), so
--    each one checks the caller itself: the signed-in user must own what is touched.
-- ---------------------------------------------------------------------------------------------

-- Replace all chunks of a document and mark it indexed. `p_content_digest` is the sha256 (hex) of
-- title || U+0001 || content as the caller saw it; if the document has changed since, the
-- result is stale and is refused (P0003), so an older embedding run can never overwrite newer text.
drop function public.replace_document_chunks(uuid, text, text, jsonb);

create function public.replace_document_chunks(
  p_document_id uuid,
  p_embedding_model text,
  p_content_hash text,
  p_content_digest text,
  p_chunks jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_title text;
  v_content text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- The row lock serialises overlapping indexing runs of the same document.
  select title, content into v_title, v_content
    from public.documents
   where id = p_document_id and user_id = v_user
     for update;
  if not found then
    raise exception 'document % not found', p_document_id using errcode = 'P0002';
  end if;

  if encode(sha256(convert_to(v_title || E'\u0001' || v_content, 'UTF8')), 'hex')
       is distinct from p_content_digest then
    raise exception 'document % changed while it was being indexed', p_document_id using errcode = 'P0003';
  end if;

  if jsonb_typeof(p_chunks) is distinct from 'array'
     or jsonb_array_length(p_chunks) > 500
     or char_length(p_embedding_model) > 200 then
    raise exception 'invalid chunk list' using errcode = '22023';
  end if;

  delete from public.document_chunks where document_id = p_document_id;

  insert into public.document_chunks
    (document_id, user_id, chunk_index, content, token_count, embedding, embedding_model)
  select
    p_document_id,
    v_user,
    (c ->> 'index')::integer,
    c ->> 'content',
    (c ->> 'tokenCount')::integer,
    (c ->> 'embedding')::extensions.vector,
    p_embedding_model
  from jsonb_array_elements(p_chunks) as c;

  update public.documents
     set indexing_status = 'indexed',
         indexing_error = null,
         indexed_at = now(),
         content_hash = p_content_hash
   where id = p_document_id;
end;
$$;

-- Record that indexing failed. Ignored when the document has changed since: the failure belongs
-- to an old version and says nothing about the current one.
create function public.mark_indexing_failed(
  p_document_id uuid,
  p_error text,
  p_content_digest text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_title text;
  v_content text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select title, content into v_title, v_content
    from public.documents
   where id = p_document_id and user_id = v_user
     for update;
  if not found then
    raise exception 'document % not found', p_document_id using errcode = 'P0002';
  end if;

  if encode(sha256(convert_to(v_title || E'\u0001' || v_content, 'UTF8')), 'hex')
       is distinct from p_content_digest then
    return;
  end if;

  update public.documents
     set indexing_status = 'failed',
         indexing_error = left(p_error, 300)
   where id = p_document_id;
end;
$$;

-- Store a question and its answer together, or neither; also names a new conversation.
create or replace function public.append_exchange(
  p_conversation_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_sources jsonb,
  p_new_title text default null
)
returns setof public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if not exists (select 1 from public.conversations where id = p_conversation_id and user_id = v_user) then
    raise exception 'conversation % not found', p_conversation_id using errcode = 'P0002';
  end if;

  if char_length(p_user_content) > 4000
     or char_length(p_assistant_content) > 50000
     or (p_sources is not null and jsonb_typeof(p_sources) is distinct from 'array') then
    raise exception 'invalid exchange' using errcode = '22023';
  end if;

  return query
  with inserted as (
    insert into public.messages (conversation_id, user_id, role, content, sources)
    values
      (p_conversation_id, v_user, 'user', p_user_content, null),
      (p_conversation_id, v_user, 'assistant', p_assistant_content, p_sources)
    returning *
  )
  select * from inserted order by seq;

  update public.conversations
     set title = coalesce(left(p_new_title, 200), title)
   where id = p_conversation_id and user_id = v_user;
end;
$$;

revoke execute on function public.replace_document_chunks(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.mark_indexing_failed(uuid, text, text) from public, anon;
revoke execute on function public.append_exchange(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.replace_document_chunks(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.mark_indexing_failed(uuid, text, text) to authenticated;
grant execute on function public.append_exchange(uuid, text, text, jsonb, text) to authenticated;
