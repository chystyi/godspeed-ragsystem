-- Keep search complete after documents were edited.
--
-- HNSW keeps deleted rows in its graph until VACUUM runs. Re-indexing a document deletes and
-- re-inserts its chunks, so these dead entries pile up, and a plain index scan (which only
-- looks at the 40 nearest candidates) can come back with fewer results than exist — or none.
-- Iterative scan (pgvector 0.8) keeps scanning until enough visible rows are found;
-- `strict_order` also guarantees the order by distance.
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
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
begin
  perform set_config('hnsw.iterative_scan', 'strict_order', true);

  return query
  select
    c.id,
    c.document_id,
    d.title,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding)
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = (select auth.uid())
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
end;
$$;
