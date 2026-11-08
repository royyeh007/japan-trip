import { supabase } from "./supabase";

/** The fill-in form lives in the private `assets` bucket; members get a short-lived signed download link. */
export async function openForm(tripName = "行程") {
  if (!supabase) return;
  const { data, error } = await supabase.storage.from("assets").createSignedUrl("trip-form.xlsx", 600, { download: `${tripName}_填寫表單.xlsx` });
  if (error || !data) { alert(`表單暫時抓不到：${error?.message ?? ""}`); return; }
  location.assign(data.signedUrl);
}
