-- Row level security: a user can only see and change their own rows.
-- `(select auth.uid())` is evaluated once per query instead of once per row.

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Anonymous visitors get nothing at all (RLS would already return no rows; this also
-- removes the privilege, so a missing policy can never expose data to them).
revoke all on public.documents, public.document_chunks, public.conversations, public.messages
  from anon;

-- documents -------------------------------------------------------------------------
create policy documents_select_own on public.documents
  for select to authenticated using (user_id = (select auth.uid()));
create policy documents_insert_own on public.documents
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy documents_update_own on public.documents
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy documents_delete_own on public.documents
  for delete to authenticated using (user_id = (select auth.uid()));

-- document_chunks: replaced as a whole by replace_document_chunks(), never edited -----
create policy chunks_select_own on public.document_chunks
  for select to authenticated using (user_id = (select auth.uid()));
create policy chunks_insert_own on public.document_chunks
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy chunks_delete_own on public.document_chunks
  for delete to authenticated using (user_id = (select auth.uid()));

-- conversations ---------------------------------------------------------------------
create policy conversations_select_own on public.conversations
  for select to authenticated using (user_id = (select auth.uid()));
create policy conversations_insert_own on public.conversations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy conversations_update_own on public.conversations
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy conversations_delete_own on public.conversations
  for delete to authenticated using (user_id = (select auth.uid()));

-- messages: append-only for users (removed together with their conversation) ----------
create policy messages_select_own on public.messages
  for select to authenticated using (user_id = (select auth.uid()));
create policy messages_insert_own on public.messages
  for insert to authenticated with check (user_id = (select auth.uid()));
