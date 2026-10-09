-- A short preview for document lists, so listing never has to load whole documents.
alter table public.documents
  add column preview text generated always as (left(content, 200)) stored;
