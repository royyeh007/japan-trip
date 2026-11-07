// 把本機的 seed/trip.ts 推進 Supabase：families、days、extras、admin 成員、填寫表單、第一個邀請連結。
// 用法：make seed（需要 .env.local 裡的 VITE_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、ADMIN_EMAIL）
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

must("families", await sb.from("families").upsert(trip.FAMILIES.map((f, i) => ({ id: f.id, name: f.name, label: f.label, flights: f.flights ?? [], sort: i }))));
must(`days（${trip.DAYS.length} 列）`, await sb.from("days").upsert(
  trip.DAYS.map((d) => ({ date_id: d.id, fam: d.fam ?? null, d: d.d, w: d.w, city: d.city, title: d.title, hotel: d.hotel, items: d.items, updated_at: new Date().toISOString() })),
  { onConflict: "date_id,fam" },
));
must("extras", await sb.from("extras").upsert([{ key: "notes", data: { shared: trip.SHARED_NOTE ?? "" } }]));
must(`todos（${(trip.TODO ?? []).length} 筆，大家一起）`, await sb.from("todos").upsert(
  (trip.TODO ?? []).map(([key, due, text, done], i) => ({ key, fam: null, due, text, done: !!done, sort: i })), { onConflict: "key" }));
// 聯絡資料不再 seed：網頁會從行程裡有電話、email 的地點自動帶出；contacts 表只放大家自己加的。

// 管理員用自己的邀請連結進入（role = admin）；一般成員用另一個
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
async function ensureInvite(role, note, maxUses) {
  const { data } = await sb.from("invites").select("code").eq("role", role).order("created_at").limit(1);
  if (data?.[0]?.code) return data[0].code;
  const code = newCode();
  must(`邀請碼（${role}）`, await sb.from("invites").insert({ code, role, note, max_uses: maxUses }));
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
