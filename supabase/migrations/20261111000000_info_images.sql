-- 其他資訊的圖片（商品照、截圖）。
-- bucket 設成公開讀：網址裡有行程 id 和亂數檔名，猜不到，也不用為每張圖簽網址；上傳、改、刪只有那個行程的成員／管理員可以。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('info-images', 'info-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anyone reads info images" on storage.objects;
drop policy if exists "editors add info images" on storage.objects;
drop policy if exists "editors replace info images" on storage.objects;
drop policy if exists "editors delete info images" on storage.objects;

create policy "anyone reads info images" on storage.objects
  for select using (bucket_id = 'info-images');
-- 路徑固定是 <trip_id>/<檔名>，第一層資料夾就是行程
create policy "editors add info images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'info-images' and public.is_editor(public.try_uuid((storage.foldername(name))[1])));
create policy "editors replace info images" on storage.objects
  for update to authenticated
  using (bucket_id = 'info-images' and public.is_editor(public.try_uuid((storage.foldername(name))[1])));
create policy "editors delete info images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'info-images' and public.is_editor(public.try_uuid((storage.foldername(name))[1])));
