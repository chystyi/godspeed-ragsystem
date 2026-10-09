-- Knowledge base schema: documents, their embedded chunks, conversations and messages.
-- Every row belongs to one user; isolation is enforced twice: row level security (next
-- migration) and composite foreign keys that make cross-user references impossible.

create extension if not exists vector with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  content text not null check (char_length(content) <= 200000),
  tags text[] not null default '{}',
  -- Saving a document must never fail because the embedding provider is down:
  -- the document is stored first, indexing is tracked separately and can be retried.
  indexing_status text not null default 'pending'
    check (indexing_status in ('pending', 'indexed', 'failed')),
  indexing_error text,
  -- Hash of title + content at indexing time; unchanged content is not embedded again.
  content_hash text,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the composite foreign keys below.
  unique (id, user_id)
);

create index documents_user_updated_idx on public.documents (user_id, updated_at desc);

-- Only user-visible edits move updated_at, not the bookkeeping done by indexing.
create trigger documents_set_updated_at
  before update on public.documents
  for each row
  when (old.title is distinct from new.title
     or old.content is distinct from new.content
     or old.tags is distinct from new.tags)
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------
-- document_chunks: the retrieval index
-- ---------------------------------------------------------------------------------
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null default auth.uid(),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  token_count integer check (token_count >= 0),
  -- Fixed size: AI_EMBEDDING_DIMENSIONS must be 1536. The AI layer requests exactly this
  -- size from the provider and rejects other sizes, so a model swap cannot corrupt the index.
  embedding extensions.vector (1536) not null,
  -- Which model produced the vector; vectors of different models are not comparable.
  embedding_model text not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  -- A chunk can only belong to a document of the same user.
  foreign key (document_id, user_id)
    references public.documents (id, user_id) on delete cascade
);

create index document_chunks_user_idx on public.document_chunks (user_id);
-- Approximate nearest neighbour search by cosine distance.
create index document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------------
-- conversations and messages
-- ---------------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index conversations_user_updated_idx on public.conversations (user_id, updated_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row
  execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null default auth.uid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Citations for assistant answers: [{ documentId, chunkId, title, similarity }].
  sources jsonb,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id)
    references public.conversations (id, user_id) on delete cascade
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
