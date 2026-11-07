// 「行程提案」的格式：上傳解析和聊天機器人都產生這個，存進 uploads.parsed，等 admin 審核。
import { z } from "npm:zod@4";

export const DATE_IDS = ["d1226", "d1227", "d1228", "d1229", "d1230", "d1231", "d0101", "d0102"] as const;
export const FAMILY_IDS = ["lily", "yanzhi", "claire", "iris"] as const;
export const KINDS = ["food", "sight", "hotel", "shop", "move"] as const;
export const MODES = ["taxi", "walk", "train", "bus", "charter", "shuttle", "flight"] as const;
export const STATUSES = ["ok", "todo", "tbd"] as const;

// 結構化輸出要求每個欄位都出現，所以「沒有」用 null 或空陣列表示，之後 normalize() 再拿掉。
const StopZ = z.object({
  type: z.literal("stop"),
  t: z.string().describe("預計到達時間，24 小時制 H:MM，例如 13:00、8:45"),
  n: z.string().describe("地點或活動名稱，餐廳前面加「午餐：」「晚餐：」"),
  q: z.string().describe("在 Google 地圖搜尋這個地方用的字，日文店名最準；不知道就用名稱"),
  k: z.enum(KINDS).describe("food 餐廳／sight 景點／hotel 住宿／shop 購物／move 交通（機場、車站這種）"),
  st: z.enum(STATUSES).nullable().describe("訂位狀態 ok 已訂／todo 要訂／tbd 待定；不用訂就 null"),
  who: z.string().nullable().describe("只有部分人參加時寫誰，例如「4 位女生」，否則 null"),
  s: z.string().nullable().describe("一句話的補充說明，沒有就 null"),
  info: z.array(z.string()).describe("營業時間、價格這類資訊，一條一項"),
  book: z.array(z.string()).describe("訂位資訊：訂了幾人幾點、訂位編號、訂位名，一條一項"),
  rec: z.array(z.string()).describe("推薦餐點或必看的東西"),
  tips: z.array(z.string()).describe("提醒"),
  addr: z.string().nullable(),
  tel: z.string().nullable(),
});
const LegZ = z.object({
  type: z.literal("leg"),
  leg: z.enum(MODES).describe("taxi 計程車／walk 走路／train 電車／bus 巴士／charter 包車／shuttle 接駁車／flight 飛機"),
  txt: z.string().describe("交通說明：幾分鐘、多少錢、哪一線"),
  st: z.enum(STATUSES).nullable().describe("這段交通要不要訂（包車、新幹線）"),
});
export const DayZ = z.object({
  date_id: z.enum(DATE_IDS).describe("d1226 = 12/26 … d0102 = 1/2"),
  scope: z.enum(["family", "shared"]).describe("family = 這一家自己的那一天；shared = 12/28–1/1 大家一起的日子"),
  city: z.string().describe("那天主要在哪個城市，例如 東京、長野、輕井澤、草津、成田"),
  title: z.string().describe("那天的標題，例如「抵達東京・築地・濱離宮」"),
  hotel: z.string().describe("那晚住的飯店；回台灣或不知道就空字串"),
  items: z.array(z.union([StopZ, LegZ])).describe("照時間順序，地點之間放交通"),
});
export const ProposalZ = z.object({
  family_id: z.enum(FAMILY_IDS).describe("這份行程是哪一家的"),
  flights: z.array(z.string()).describe("去回航班，例如「去 BR192 12/26 松山 07:15 → 羽田 T3 11:00」；沒提到就空陣列"),
  days: z.array(DayZ).describe("完整的每一天。改一天就要給那一天完整的內容（不是只給改的部分）"),
  joins: z.array(z.object({
    date_id: z.enum(DATE_IDS),
    with: z.enum(FAMILY_IDS).describe("跟哪一家一起"),
    from: z.string().nullable().describe("從幾點開始一起（H:MM）；整天都一起就 null"),
  })).describe("某天是跟別家一起走的，列在這裡而不是重抄那家的行程"),
  summary: z.string().describe("一兩句話說明這份提案改了什麼，給審核的人看"),
  notes: z.array(z.string()).describe("看不懂、不確定、資料矛盾的地方，一條一項"),
});
export type Proposal = z.infer<typeof ProposalZ>;

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
function dateOf(dateId: string) {
  const m = Number(dateId.slice(1, 3)), day = Number(dateId.slice(3, 5));
  const iso = `${m === 12 ? 2026 : 2027}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { d: `${m}/${day}`, w: WEEKDAY[new Date(iso + "T00:00:00").getDay()] };
}

/** Convert the strict AI shape into the app's Day shape (no nulls, no empty arrays, d/w filled in). */
export function normalize(p: Proposal) {
  const clean = (o: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "type" || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      out[k] = v;
    }
    return out;
  };
  return {
    family_id: p.family_id,
    flights: p.flights,
    days: p.days.map((day) => ({
      id: day.date_id,
      ...dateOf(day.date_id),
      city: day.city,
      title: day.title,
      hotel: day.hotel,
      scope: day.scope,
      items: day.items.map((it) => clean(it as Record<string, unknown>)),
    })),
    joins: p.joins,
    summary: p.summary,
    notes: p.notes,
  };
}

export const FORMAT_GUIDE = `行程格式說明：
- 一天 = date_id（d1226、d1227、d1228、d1229、d1230、d1231、d0101、d0102）+ city + title + hotel + items。
- items 照時間順序：每個地點是 type=stop；兩個地點中間的交通是 type=leg。
- stop 的 k：餐廳 food、景點 sight、住宿 hotel、購物 shop、機場車站等交通節點 move。
- leg 的 leg：計程車 taxi、走路 walk、電車 train、巴士 bus、包車 charter、接駁車 shuttle、飛機 flight。
- 訂位狀態 st：已訂 ok、要訂 todo、待定 tbd、不用訂 null。
- 時間用 24 小時制 H:MM（8:30、13:00）。清單欄位（book、rec、tips、info）一條一項，表單裡用「；」分開的要拆開。
- q 是 Google 地圖的搜尋字，能用日文店名最好。
- 12/28–1/1 是四家一起的日子（scope=shared）；12/26、12/27、1/2 各家自己走（scope=family）。
- 如果某天是「跟某家一起」，放進 joins（有「從幾點開始」就填 from），不要重抄那家的行程。
- 家庭 id：lily=Lily 家、yanzhi=Yenchih 家、claire=Claire 家、iris=Iris 家。`;
