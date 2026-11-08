// 把本機的 seed/trip.ts 推進 Supabase 的某一個行程：trips、families、days、extras、todos、填寫表單、邀請連結。
// 用法：make seed（需要 .env.local 裡的 VITE_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、TRIP_ID）
//   seed/trip.ts 可以 export TRIP = { id, name, start_date, end_date, place, tz }；沒有就用 .env.local 的 TRIP_ID 找既有的行程。
//   days 的 id 可以是完整日期（2026-12-26）或舊的 dMMDD；dMMDD 會照行程的年份換成完整日期。
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function loadEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
}
const env = { ...loadEnv(".env.local"), ...process.env };
const url = env.VITE_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("缺 VITE_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（放在 .env.local）"); process.exit(1); }
if (!existsSync("seed/trip.ts")) { console.error("找不到 seed/trip.ts（照 seed/trip.example.ts 的格式建一個）"); process.exit(1); }

execFileSync("node_modules/.bin/esbuild", ["seed/trip.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=seed/.build/trip.mjs", "--log-level=warning"], { stdio: "inherit" });
const trip = await import(pathToFileURL("seed/.build/trip.mjs").href);
const sb = createClient(url, key, { auth: { persistSession: false } });
const must = (label, { error }) => { if (error) { console.error(`${label} 失敗：${error.message}`); process.exit(1); } console.log(`✓ ${label}`); };

// ---- which trip ----
const tripId = trip.TRIP?.id ?? env.TRIP_ID;
if (!tripId) { console.error("缺行程 id：在 seed/trip.ts export TRIP = { id, name, start_date, end_date, place }，或在 .env.local 設 TRIP_ID"); process.exit(1); }
if (trip.TRIP) {
  must(`trips（${trip.TRIP.name}）`, await sb.from("trips").upsert({ id: tripId, name: trip.TRIP.name, start_date: trip.TRIP.start_date, end_date: trip.TRIP.end_date, place: trip.TRIP.place ?? "", tz: trip.TRIP.tz ?? "Asia/Tokyo" }));
}
const { data: tripRow, error: tErr } = await sb.from("trips").select("id, name, start_date, end_date").eq("id", tripId).maybeSingle();
if (tErr || !tripRow) { console.error(`找不到行程 ${tripId}${tErr ? `：${tErr.message}` : ""}`); process.exit(1); }
console.log(`→ 行程：${tripRow.name}（${tripRow.start_date} – ${tripRow.end_date}）`);

// "d1226" → "2026-12-26"：年份挑最接近行程日期的那一年
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n) => String(n).padStart(2, "0");
function toIso(id) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(id)) return id;
  const m = id.match(/^d(\d{2})(\d{2})$/);
  if (!m) throw new Error(`看不懂日期 id：${id}`);
  const y0 = Number(tripRow.start_date.slice(0, 4)), y1 = Number(tripRow.end_date.slice(0, 4));
  let best = "", bestDist = Infinity;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    const iso = `${y}-${m[1]}-${m[2]}`;
    const t = (s) => new Date(s + "T00:00:00Z").getTime();
    const dist = iso < tripRow.start_date ? t(tripRow.start_date) - t(iso) : iso > tripRow.end_date ? t(iso) - t(tripRow.end_date) : 0;
    if (dist < bestDist) { best = iso; bestDist = dist; }
  }
  return best;
}
const dateOf = (iso) => { const dt = new Date(iso + "T00:00:00Z"); return { d: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`, w: WEEKDAY[dt.getUTCDay()] }; };

must("families", await sb.from("families").upsert(trip.FAMILIES.map((f, i) => ({ trip_id: tripId, id: f.id, name: f.name, label: f.label, flights: f.flights ?? [], sort: i })), { onConflict: "trip_id,id" }));
must(`days（${trip.DAYS.length} 列）`, await sb.from("days").upsert(
  trip.DAYS.map((d) => { const iso = toIso(d.id); const { d: dd, w } = dateOf(iso); return { trip_id: tripId, date_id: iso, fam: d.fam ?? null, d: dd, w, city: d.city, title: d.title, hotel: d.hotel, items: d.items, updated_at: new Date().toISOString() }; }),
  { onConflict: "trip_id,date_id,fam" },
));
const extras = [{ trip_id: tripId, key: "notes", data: { shared: trip.SHARED_NOTE ?? "" } }];
if (existsSync("seed/info.json")) extras.push({ trip_id: tripId, key: "info", data: JSON.parse(readFileSync("seed/info.json", "utf8")) });
must("extras", await sb.from("extras").upsert(extras, { onConflict: "trip_id,key" }));
must(`todos（${(trip.TODO ?? []).length} 筆，大家一起）`, await sb.from("todos").upsert(
  (trip.TODO ?? []).map(([key, due, text, done], i) => ({ trip_id: tripId, key, fam: null, due, text, done: !!done, sort: i })), { onConflict: "trip_id,key" }));
// 聯絡資料不再 seed：網頁會從行程裡有電話、email 的地點自動帶出；contacts 表只放大家自己加的。
if (process.argv.includes("--fix-dates")) {
  // 舊資料庫裡還有 dMMDD 的列：換成完整日期
  const { data: old } = await sb.from("days").select("id, date_id").eq("trip_id", tripId).like("date_id", "d____");
  for (const r of old ?? []) { const iso = toIso(r.date_id); must(`${r.date_id} → ${iso}`, await sb.from("days").update({ date_id: iso, ...dateOf(iso) }).eq("id", r.id)); }
}

// 邀請連結：管理員一個（自己用）、成員一個
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
async function ensureInvite(role, note, maxUses) {
  const { data } = await sb.from("invites").select("code").eq("trip_id", tripId).eq("role", role).order("created_at").limit(1);
  if (data?.[0]?.code) return data[0].code;
  const code = newCode();
  must(`邀請碼（${role}）`, await sb.from("invites").insert({ trip_id: tripId, code, role, note, max_uses: maxUses }));
  return code;
}

if (existsSync("seed/assets/trip-form.xlsx")) {
  must("填寫表單 → assets/trip-form.xlsx", await sb.storage.from("assets").upload("trip-form.xlsx", readFileSync("seed/assets/trip-form.xlsx"), {
    upsert: true, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
}

const site = (env.SITE_URL || "https://<你的網址>/").replace(/\/?$/, "/");
const adminCode = await ensureInvite("admin", "管理員（自己用）", 3);
const memberCode = await ensureInvite("member", "家人", 50);
console.log(`\n管理員連結（自己用，可用 3 次）：${site}#invite=${adminCode}`);
console.log(`家人邀請連結（可用 50 次）：${site}#invite=${memberCode}`);
console.log(`本機測試：http://localhost:5173/#invite=${memberCode}`);
