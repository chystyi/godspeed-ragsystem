-- Messages need a stable order: the question and its answer are written in one statement and
-- share the same created_at, so a sequence number defines the order.
alter table public.messages add column seq bigint generated always as identity;

create index messages_conversation_seq_idx on public.messages (conversation_id, seq);
drop index public.messages_conversation_created_idx;

-- Store a question and its answer together, or neither (a failed model call saves nothing).
-- Also names a new conversation after its first question. Runs with the caller's rights.
create or replace function public.append_exchange(
  p_conversation_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_sources jsonb,
  p_new_title text default null
)
returns setof public.messages
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- RLS hides other users' conversations, so this is also the ownership check.
  if not exists (select 1 from public.conversations where id = p_conversation_id) then
    raise exception 'conversation % not found', p_conversation_id using errcode = 'P0002';
  end if;

  return query
  with inserted as (
    insert into public.messages (conversation_id, user_id, role, content, sources)
    values
      (p_conversation_id, (select auth.uid()), 'user', p_user_content, null),
      (p_conversation_id, (select auth.uid()), 'assistant', p_assistant_content, p_sources)
    returning *
  )
  select * from inserted order by seq;

  -- Any update moves updated_at (trigger), which sorts the conversation list.
  update public.conversations
     set title = coalesce(p_new_title, title)
   where id = p_conversation_id;
end;
$$;

revoke execute on function public.append_exchange(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.append_exchange(uuid, text, text, jsonb, text) to authenticated;
