// 「其他資訊」的「✦ 幫我整理」：把使用者貼的一段文字整理成好讀的 Markdown 頁。
// 省錢的設計：用 Haiku、不掛上網工具、不帶整份行程、輸出上限固定；每個行程每天最多 N 次（ai_calls 表計數）。
//   一次大約就是貼進來的字數 + 整理後的字數，比聊天一次（帶整份行程、常常上網搜）便宜一個量級以上。
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { anthropic, FORMAT_MODEL } from "../_shared/claude.ts";

const DAILY_LIMIT = Number(Deno.env.get("INFO_FORMAT_DAILY_LIMIT") ?? 10);
const MAX_CHARS = 8000;
// Haiku 5.5 牌價（美金／百萬 token，2026-11 官方定價頁，10 萬 token 以內）：輸入 0.1、快取寫入 5 分鐘 0.125／1 小時 0.2、快取讀取 0.01、輸出 0.5
const PRICE = { input: 0.1, cache_5m: 0.125, cache_1h: 0.2, read: 0.01, output: 0.5 };

const SYSTEM = `你是旅遊網站「其他資訊」頁的排版小幫手。使用者會貼一段文字（官網、新聞、LINE 訊息、自己的筆記），請把它整理成一頁好讀的 Markdown。
- 第一行是「# 標題」（10 個字內；使用者有給標題就沿用）。
- 只整理原文裡有的資訊：不要加入原文沒有的事實、不要猜、不要上網。原文有矛盾或看不懂的地方放在最後的「## 待確認」。
- 步驟用「1. 」編號清單；並列的東西用「- 」；要比較多個東西（價格、時間、品牌、方案）用表格；重要提醒用粗體。
- 原文的數字、時間、金額、地址、電話、網址一字不改地保留。
- 刪掉廣告、重複、客套話。用台灣用語的繁體中文；原文是日文或英文就翻成中文，店名、商品名保留原文並附中文。
- 只輸出 Markdown，不要前言、不要說明你做了什麼。`;

/** The instant this calendar day started in the trip's timezone (so the daily cap resets at local midnight). */
function startOfToday(tz: string): string {
  const ymd = new Date().toLocaleDateString("sv-SE", { timeZone: tz }); // YYYY-MM-DD
  const guess = new Date(ymd + "T00:00:00Z");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime())).toISOString();
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({})) as { trip_id?: string; text?: string; title?: string };
  const { admin, trip, uid } = await requireMember(req, body, { editor: true });
  const text = (body.text ?? "").trim();
  const title = (body.title ?? "").trim().slice(0, 60);
  if (text.length < 20) throw new HttpError(400, "先貼一段文字再按整理（至少 20 個字）");
  if (text.length > MAX_CHARS) throw new HttpError(400, `一次最多 ${MAX_CHARS} 個字，請分成幾段整理`);

  const tz = trip.tz || "Asia/Tokyo";
  const { count, error: cErr } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("trip_id", trip.id).eq("kind", "format-info").gte("created_at", startOfToday(tz));
  if (cErr) throw new HttpError(500, `讀不到使用紀錄：${cErr.message}`);
  const used = count ?? 0;
  if (used >= DAILY_LIMIT) throw new HttpError(429, `這個行程今天的「幫我整理」已經用了 ${DAILY_LIMIT} 次，明天再試，或直接手寫`);

  const res = await anthropic().messages.create({
    model: FORMAT_MODEL,
    max_tokens: 3000,
    system: SYSTEM,
    messages: [{ role: "user", content: `${title ? `標題（使用者填的，請沿用）：${title}\n` : ""}原文：\n${text}` }],
  });
  if (res.stop_reason === "refusal") throw new HttpError(400, "這段內容不方便整理");
  let md = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (res.stop_reason === "max_tokens") md += "\n\n（內容太長，後面被截掉了；請分段整理）";
  // first "# …" line → title, the rest is the page body
  const m = md.match(/^#\s+(.+)\n?/);
  const outTitle = (m?.[1] ?? title).trim().slice(0, 60);
  const outBody = (m ? md.slice(m[0].length) : md).trim();

  const u = res.usage as unknown as Record<string, number | undefined>;
  const n = (v: number | undefined) => v ?? 0;
  const usd = (n(u.input_tokens) * PRICE.input + n(u.cache_creation_input_tokens) * PRICE.cache_5m + n(u.cache_read_input_tokens) * PRICE.read + n(u.output_tokens) * PRICE.output) / 1e6;
  const usage = { model: res.model, input: n(u.input_tokens), output: n(u.output_tokens), chars: text.length, usd: Math.round(usd * 10000) / 10000 };
  console.log("format-info usage", JSON.stringify(usage));
  await admin.from("ai_calls").insert({ trip_id: trip.id, user_id: uid, kind: "format-info", usage });

  return json({ title: outTitle, body: outBody, remaining: Math.max(0, DAILY_LIMIT - used - 1) });
}));
