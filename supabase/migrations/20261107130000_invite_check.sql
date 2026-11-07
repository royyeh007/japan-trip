-- 登入頁在導去 Google 之前先確認邀請碼有效。只回 true/false，不洩漏其他資料。
create or replace function public.invite_valid(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invites
    where code = p_code
      and (expires_at is null or expires_at > now())
      and uses < max_uses
  )
$$;
revoke all on function public.invite_valid(text) from public;
grant execute on function public.invite_valid(text) to anon, authenticated;
