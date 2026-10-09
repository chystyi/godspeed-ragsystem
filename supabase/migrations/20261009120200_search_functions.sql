-- Retrieval and indexing as database functions. Both run with the caller's rights
-- (security invoker), so row level security applies inside them as well.

-- Nearest chunks to a query embedding, by cosine similarity (1 = identical direction).
create or replace function public.match_chunks(
  query_embedding extensions.vector (1536),
  match_count integer default 5,
  min_similarity double precision default 0.0
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  chunk_index integer,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    d.title,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = (select auth.uid())
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

-- Atomically replace all chunks of a document and mark it indexed.
-- p_chunks: [{ "index": 0, "content": "...", "tokenCount": 123, "embedding": [..1536 floats..] }]
create or replace function public.replace_document_chunks(
  p_document_id uuid,
  p_embedding_model text,
  p_content_hash text,
  p_chunks jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  -- RLS hides other users' documents, so this is also the ownership check.
  if not exists (select 1 from public.documents where id = p_document_id) then
    raise exception 'document % not found', p_document_id using errcode = 'P0002';
  end if;

  delete from public.document_chunks where document_id = p_document_id;

  insert into public.document_chunks
    (document_id, user_id, chunk_index, content, token_count, embedding, embedding_model)
  select
    p_document_id,
    (select auth.uid()),
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

-- Functions are executable by signed-in users only.
revoke execute on function public.match_chunks(extensions.vector, integer, double precision)
  from public, anon;
revoke execute on function public.replace_document_chunks(uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.match_chunks(extensions.vector, integer, double precision)
  to authenticated;
grant execute on function public.replace_document_chunks(uuid, text, text, jsonb)
  to authenticated;
