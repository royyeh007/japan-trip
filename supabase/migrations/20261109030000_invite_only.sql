-- 只給被邀請的人用：要先用邀請碼加入至少一個行程，才能建立新行程。
-- 陌生人用 Google 登入後什麼都不能做（看不到任何行程、不能建行程、不能用聊天機器人）。
create or replace function public.create_trip(p_name text, p_start date, p_end date, p_place text, p_family_label text, p_my_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  e text := public.auth_email();
  t uuid;
  fid text := 'f' || substr(md5(gen_random_uuid()::text), 1, 6);
  flabel text := coalesce(nullif(trim(p_family_label), ''), '我們家');
begin
  if uid is null then raise exception '請先登入'; end if;
  if not exists (select 1 from public.members where user_id = uid) then
    raise exception '要先用邀請碼加入一個行程，之後才能建立自己的行程';
  end if;
  if p_name is null or trim(p_name) = '' then raise exception '行程要有名字'; end if;
  if p_start is null or p_end is null then raise exception '要填開始和結束日期'; end if;
  if p_end < p_start then raise exception '結束日期不能比開始早'; end if;
  insert into public.trips (name, start_date, end_date, place, created_by)
    values (trim(p_name), p_start, p_end, coalesce(trim(p_place), ''), uid) returning id into t;
  insert into public.families (trip_id, id, name, label, sort) values (t, fid, flabel, flabel, 0);
  insert into public.members (trip_id, user_id, email, family_id, name, role, last_opened_at)
    values (t, uid, nullif(e, ''), fid, nullif(trim(coalesce(p_my_name, '')), ''), 'admin', now());
  return t;
end
$$;
