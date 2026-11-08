// 看 AI 聊天花了多少：每天加總＋最近的訊息（用 .env.local 的 service role key）。
//   node seed/usage.mjs [最近幾則，預設 15]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n = Number(process.argv[2] ?? 15);
const [{ data: rows }, { data: members }] = await Promise.all([
  db.from("chat_messages").select("user_id, content, usage, status, created_at").eq("role", "assistant").order("created_at", { ascending: false }).limit(2000),
  db.from("members").select("user_id, name, family_id"),
]);
const who = Object.fromEntries((members ?? []).map((m) => [m.user_id, `${m.name ?? ""}（${m.family_id}）`]));
const tw = (iso) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
const days = {};
for (const r of rows ?? []) {
  const u = r.usage; if (!u) continue;
  const d = tw(r.created_at).split(" ")[0];
  const a = (days[d] ??= { msgs: 0, usd: 0, cold: 0, lookups: 0, read: 0, write: 0, out: 0 });
  a.msgs++; a.usd += u.usd ?? 0; a.read += u.cache_read ?? 0; a.write += (u.cache_write_1h ?? 0) + (u.cache_write_5m ?? 0); a.out += u.output ?? 0;
  if ((u.cache_write_1h ?? 0) > 10000) a.cold++;
  if (u.searches) a.lookups++;
}
console.log("每天：");
for (const [d, a] of Object.entries(days)) console.log(`  ${d}  ${a.msgs} 則  ≈ US$${a.usd.toFixed(3)}   冷快取（整份行程重寫）${a.cold} 次、網頁搜尋 ${a.lookups} 次   token 讀快取 ${a.read.toLocaleString()}／寫 ${a.write.toLocaleString()}／輸出 ${a.out.toLocaleString()}`);
console.log(`\n最近 ${n} 則：`);
for (const r of (rows ?? []).slice(0, n)) {
  const u = r.usage ?? {};
  const flags = [u.cache_write_1h > 10000 ? "冷快取" : "", u.searches ? `搜尋 ${u.searches}` : "", u.tool_errors?.length ? `工具錯誤 ${u.tool_errors.join(",")}` : "", r.status === "error" ? "失敗" : ""].filter(Boolean).join("、");
  console.log(`  ${tw(r.created_at)}  ${who[r.user_id] ?? r.user_id.slice(0, 8)}  US$${(u.usd ?? 0).toFixed(3)}  呼叫 ${u.calls ?? "-"} 次${flags ? `（${flags}）` : ""}  ${(r.content ?? "").replace(/\n/g, " ").slice(0, 40)}`);
}
const noUsage = (rows ?? []).filter((r) => !r.usage).length;
if (noUsage) console.log(`\n（${noUsage} 則是加用量紀錄前的回覆，沒有數字）`);
