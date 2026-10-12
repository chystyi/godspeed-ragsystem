-- Gaps that remain when a signed-in user calls the database directly (with their own token and
-- the public key) instead of going through the API.
--   * a chunk could be any size, a content hash any length;
--   * messages were not limited in number;
--   * two parallel inserts at the edge of a cap could both pass the count;
--   * an edit written straight to the table left the document marked "indexed" for old chunks;
--   * the checks of title, content and tags were weaker than those of the API.

-- 1. Sizes -----------------------------------------------------------------------------------
-- The chunker produces at most 1000 characters; the margin allows other settings.
alter table public.document_chunks
  add constraint document_chunks_content_length check (char_length(content) <= 2000);
alter table public.documents
  add constraint documents_content_hash_length check (char_length(content_hash) <= 128);

-- 2. The same rules as the API: text is not blank, tags are tidy -----------------------------------
alter table public.documents
  add constraint documents_title_not_blank check (btrim(title) <> ''),
  add constraint documents_content_not_blank check (btrim(content) <> '');
alter table public.conversations
  add constraint conversations_title_not_blank check (btrim(title) <> '');

create or replace function public.tags_are_valid(p_tags text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select cardinality(p_tags) <= 20
     and not exists (
       select 1 from unnest(p_tags) as tag
        where char_length(tag) not between 1 and 40
           or tag <> lower(btrim(tag))
     )
     and cardinality(p_tags) = (select count(distinct tag) from unnest(p_tags) as tag);
$$;

-- 3. Caps that hold under parallel writes ------------------------------------------------------
-- A transaction-scoped lock per user and table makes the count and the insert one step.
create or replace function public.enforce_row_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cap integer := tg_argv[0]::integer;
  existing integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into existing using new.user_id;
  if existing >= cap then
    raise exception '% limit of % reached', tg_table_name, cap using errcode = 'P0004';
  end if;
  return new;
end;
$$;

-- Messages: at most 200 per conversation (100 exchanges) and 2000 per user.
create or replace function public.enforce_message_limits()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('messages:' || new.user_id::text, 0));
  if (select count(*) from public.messages where conversation_id = new.conversation_id) >= 200 then
    raise exception 'conversation is full (200 messages)' using errcode = 'P0004';
  end if;
  if (select count(*) from public.messages where user_id = new.user_id) >= 2000 then
    raise exception 'messages limit of 2000 reached' using errcode = 'P0004';
  end if;
  return new;
end;
$$;

create trigger messages_limits
  before insert on public.messages
  for each row execute function public.enforce_message_limits();

-- 4. An edit makes the index out of date, however it was written ----------------------------------
create or replace function public.mark_edited_document_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.indexing_status := 'pending';
  return new;
end;
$$;

create trigger documents_edit_marks_pending
  before update on public.documents
  for each row
  when (old.title is distinct from new.title or old.content is distinct from new.content)
  execute function public.mark_edited_document_pending();
