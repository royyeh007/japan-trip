// 「信用卡」頁的「✦ 幫我查這張卡」：給一個卡名，Sonnet 上網查這張卡目前的海外交易手續費和各類消費的回饋，
// 整理成卡片庫的格式回傳；網頁把它填進表單，使用者看過再儲存（不直接寫資料庫）。
// 省錢：一張卡最多 4 次搜尋、固定輸出格式、每個行程每天最多 N 次（ai_calls 表計數，kind = card-lookup）。
import { betaZodTool } from "npm:@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "npm:zod@4";
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { anthropic, CHAT_MODEL } from "../_shared/claude.ts";
import { COUNTRY_NAME, countryOf } from "../_shared/cards.ts";
import type { Country } from "../_shared/cards.ts";

const DAILY_LIMIT = Number(Deno.env.get("CARD_LOOKUP_DAILY_LIMIT") ?? 10);
// Sonnet 5.5 牌價（美金／百萬 token）：輸入 2、輸出 10、快取讀 0.1；網頁搜尋每次 0.01
const PRICE = { input: 2, cache_write: 2.5, read: 0.1, output: 10, search: 0.01 };

const CardZ = z.object({
  name: z.string().describe("卡的正式名稱（英文卡保留英文）"),
  short: z.string().max(10).describe("標籤用短名，≤10 字，例：CSP、Venture X、CUBE"),
  bank: z.string().describe("發卡銀行"),
  country: z.enum(["us", "uk", "tw", "jp", "kr", "other"]).describe("發卡國"),
  network: z.array(z.enum(["visa", "mastercard", "amex", "jcb", "discover", "unionpay"])),
  fx_fee: z.number().min(0).max(10).describe("海外交易手續費 %（foreign transaction fee / non-sterling fee）；沒有就 0"),
  rates: z.array(z.object({
    where: z.enum(["overseas", "home", "jp", "kr"]).describe("overseas＝出國消費；home＝發卡國國內；jp／kr＝只有那一國才有的加碼"),
    kind: z.enum(["all", "food", "hotel", "shop", "sight", "move"]).describe("all＝其他一般消費；food 餐廳；hotel 住宿；shop 購物；sight 景點門票；move 交通（火車、計程車、交通卡加值）"),
    rate: z.number().min(0).max(50).describe("那個情況可以拿到的「總」回饋 %（已含基本回饋）。點數卡換成 %：Chase UR 1.25¢（CSP）／1.5¢（CSR）、Amex MR 1.5¢、Capital One 1.5¢、Citi TY 1.5¢、Bilt 1.5¢、航空哩程 1.3¢、Hyatt 1.7¢、Marriott 0.8¢、Hilton 0.5¢；英國 Avios 1p、英國 MR 0.5p、Virgin 1p"),
    note: z.string().optional().describe("一句話：怎麼算的，例「3x UR，以 1.25¢/點計」或「切成趣旅行方案」"),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("優惠到期日 YYYY-MM-DD；長期有效就不填"),
    cond: z.string().optional().describe("條件：要登錄、要切方案、上限、只限實體店…"),
  })).min(1),
  cap: z.string().describe("回饋上限一句話；沒有寫「無上限」"),
  conditions: z.string().describe("最重要的條件或限制一句話（年費、哪些加碼只限國內、Amex 接受度…）"),
  source: z.string().describe("最主要的來源網址（優先銀行官網）"),
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().describe("給使用者看的一句話：哪裡不確定、最近有沒有改版"),
});
type CardOut = z.infer<typeof CardZ>;

function startOfToday(tz: string): string {
  const ymd = new Date().toLocaleDateString("sv-SE", { timeZone: tz });
  const guess = new Date(ymd + "T00:00:00Z");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime())).toISOString();
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({})) as { trip_id?: string; name?: string; country?: string };
  const { admin, trip, uid } = await requireMember(req, body, { editor: true });
  const name = (body.name ?? "").trim().slice(0, 80);
  if (name.length < 2) throw new HttpError(400, "先填卡片名稱");
  const hint = (["us", "uk", "tw", "jp", "kr", "other"] as Country[]).includes(body.country as Country) ? (body.country as Country) : null;

  const tz = trip.tz || "Asia/Tokyo";
  const { count, error: cErr } = await admin.from("ai_calls").select("id", { count: "exact", head: true })
    .eq("trip_id", trip.id).eq("kind", "card-lookup").gte("created_at", startOfToday(tz));
  if (cErr) throw new HttpError(500, `讀不到使用紀錄：${cErr.message}`);
  const used = count ?? 0;
  if (used >= DAILY_LIMIT) throw new HttpError(429, `這個行程今天已經查了 ${DAILY_LIMIT} 張卡，明天再試，或自己填`);

  const dest = countryOf(trip.place);
  const today = new Date().toISOString().slice(0, 10);
  let saved: CardOut | null = null;
  const save = betaZodTool({
    name: "save_card",
    description: "查完之後用這個工具交出整理好的卡片資料（只呼叫一次）。",
    inputSchema: CardZ,
    run: async (input) => { saved = input; return "ok"; },
  });
  const webSearch = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 4 };
  const system = `你是信用卡資料整理員。今天是 ${today}。使用者會給一張信用卡的名字${hint ? `（發卡國可能是${COUNTRY_NAME[hint]}）` : ""}，請上網查它「現在」的條款，整理成卡片庫格式，用 save_card 交出。
查的重點（這張卡會用在${COUNTRY_NAME[dest]}旅行）：
1. 海外交易手續費 %（美國卡常見 0 或 3；英國卡 0 或 2.99；台灣卡 1.5）。
2. 出國消費各類別的總回饋 %：一般、餐廳、住宿、購物、交通。點數卡用上面 schema 寫的換算值換成 %，note 裡寫怎麼算。
3. 哪些加碼只限發卡國國內（例如美國卡的超市、加油加碼；台灣卡的國內通路）就不要算進出國的回饋，放在 conditions 提一句。
4. 要登錄、要切方案、有上限、有到期日的，寫進 cond／until／cap。
5. 優先用銀行官網，再用可靠的信用卡網站（The Points Guy、NerdWallet、MoneySavingExpert、Head for Points、卡優、懶人卡）核對。最多搜尋 4 次。
不要編數字：查不到的欄位就不填（rates 至少要有一筆一般消費），並在 note 說明哪裡不確定。文字用台灣用語的繁體中文，卡名、點數計畫名保留原文。查完直接呼叫 save_card，不用再多說話。`;

  const client = anthropic();
  const calls: Record<string, unknown>[] = [];
  for await (const m of client.beta.messages.toolRunner({
    model: CHAT_MODEL,
    max_tokens: 4000,
    max_iterations: 6,
    output_config: { effort: "medium" },
    system,
    tools: [webSearch, save],
    messages: [{ role: "user", content: `信用卡：${name}` }],
  })) {
    calls.push(m.usage as unknown as Record<string, unknown>);
    if (saved) break;
  }
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  let usd = 0, searches = 0;
  for (const u of calls) {
    searches += n((u.server_tool_use as Record<string, unknown> | undefined)?.web_search_requests);
    usd += (n(u.input_tokens) * PRICE.input + n(u.cache_creation_input_tokens) * PRICE.cache_write + n(u.cache_read_input_tokens) * PRICE.read + n(u.output_tokens) * PRICE.output) / 1e6;
  }
  usd += searches * PRICE.search;
  const usage = { model: CHAT_MODEL, calls: calls.length, searches, name, usd: Math.round(usd * 10000) / 10000 };
  console.log("card-lookup usage", JSON.stringify(usage));
  await admin.from("ai_calls").insert({ trip_id: trip.id, user_id: uid, kind: "card-lookup", usage });

  if (!saved) throw new HttpError(502, "查不到這張卡的資料，請自己填（或換個更完整的卡名再試）");
  const card = saved as CardOut;
  return json({ card: { ...card, checked_at: today }, remaining: Math.max(0, DAILY_LIMIT - used - 1) });
}));
