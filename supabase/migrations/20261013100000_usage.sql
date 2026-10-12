-- Token usage per user, day, kind (chat or embedding) and model, for the usage view.
-- One row per combination, counted up by a function: the table stays small however much is
-- used, and nobody can write numbers into it directly.
create table public.usage_daily (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null default current_date,
  kind text not null check (kind in ('chat', 'embedding')),
  model text not null check (char_length(model) between 1 and 200),
  requests integer not null default 0 check (requests >= 0),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  primary key (user_id, day, kind, model)
);

alter table public.usage_daily enable row level security;
create policy usage_select_own on public.usage_daily
  for select to authenticated using (user_id = auth.uid());
revoke all on public.usage_daily from anon, authenticated;
grant select on public.usage_daily to authenticated;

create function public.record_usage(
  p_kind text,
  p_model text,
  p_prompt_tokens bigint,
  p_completion_tokens bigint
)
returns void
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
  if p_kind not in ('chat', 'embedding')
     or char_length(p_model) not between 1 and 200
     or p_prompt_tokens not between 0 and 10000000
     or p_completion_tokens not between 0 and 10000000 then
    raise exception 'invalid usage' using errcode = '22023';
  end if;

  -- Bound the number of rows one user can create (days x kinds x models).
  perform pg_advisory_xact_lock(hashtextextended('usage:' || v_user::text, 0));
  if not exists (
       select 1 from public.usage_daily
        where user_id = v_user and day = current_date and kind = p_kind and model = p_model)
     and (select count(*) from public.usage_daily where user_id = v_user) >= 3000 then
    raise exception 'usage rows limit reached' using errcode = 'P0004';
  end if;

  insert into public.usage_daily as u (user_id, day, kind, model, requests, prompt_tokens, completion_tokens)
  values (v_user, current_date, p_kind, p_model, 1, p_prompt_tokens, p_completion_tokens)
  on conflict (user_id, day, kind, model) do update
    set requests = u.requests + 1,
        prompt_tokens = u.prompt_tokens + excluded.prompt_tokens,
        completion_tokens = u.completion_tokens + excluded.completion_tokens;
end;
$$;

revoke execute on function public.record_usage(text, text, bigint, bigint) from public, anon;
grant execute on function public.record_usage(text, text, bigint, bigint) to authenticated;
