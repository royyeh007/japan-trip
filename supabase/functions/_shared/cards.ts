// 信用卡推薦的規則：網頁（每一站的小標籤、信用卡頁）和聊天機器人都從這裡算，改一處兩邊同步。
// 純資料與純函式，沒有任何執行環境相依，前端（Vite）和 Edge Function（Deno）都直接 import。
//
// 卡片庫（card_catalog）一張卡一列：發卡國 country、海外手續費 fx_fee（%）和一組回饋 rates。每筆 rate 是「在哪裡（where）、
// 買什麼（kind）可以拿到的總回饋 %（rate，已含基本回饋；點數卡換算成約略的 %）」，可以有到期日 until 和條件 cond。
// where：home＝在發卡國國內、overseas＝出國（任何國家）、jp／kr＝只有那個國家才有的加碼。
// 推薦時：卡的發卡國 ≠ 行程目的地才算「出國」，才收手續費、才適用 overseas；取「適用這一站的最高回饋 − 手續費」。

export type StopKind = "food" | "sight" | "hotel" | "shop" | "move";
/** 國家代號：發卡國和行程目的地共用。other＝其他國家（對所有卡都算出國）。 */
export type Country = "jp" | "kr" | "tw" | "us" | "uk" | "other";
export type RateWhere = "jp" | "kr" | "overseas" | "home";
export type RateKind = "all" | StopKind;
export interface CardRate { where: RateWhere; kind: RateKind; rate: number; note?: string; until?: string; cond?: string }
export interface Card {
  id: string; name: string; short: string; bank: string; country: Country; network: string[];
  fx_fee: number; rates: CardRate[]; cap: string; conditions: string; source: string;
  checked_at: string | null; created_by?: string | null; updated_by_name?: string | null; updated_at?: string;
}

export const COUNTRY_NAME: Record<Country, string> = { us: "美國", uk: "英國", tw: "台灣", jp: "日本", kr: "韓國", other: "其他" };
/** 卡片庫排序：美國、英國優先，再台灣。 */
export const COUNTRY_ORDER: Country[] = ["us", "uk", "tw", "jp", "kr", "other"];
export const WHERE_NAME: Record<RateWhere, string> = { overseas: "出國", home: "發卡國內", jp: "只有日本", kr: "只有韓國" };
export const RATE_KIND_NAME: Record<RateKind, string> = { all: "一般消費", food: "餐廳", sight: "景點門票", hotel: "住宿", shop: "購物", move: "交通" };
export const NETWORK_NAME: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "AmEx", jcb: "JCB", discover: "Discover", unionpay: "銀聯" };
export const NETWORKS = ["visa", "mastercard", "amex", "jcb", "discover", "unionpay"];

/** 從行程的「去哪裡」猜目的地國家：日本→jp、韓國→kr、台灣→tw、美國→us、英國→uk、其他→other。 */
export function countryOf(place: string | null | undefined): Country {
  const p = (place ?? "").toLowerCase();
  if (/日本|japan|東京|大阪|京都|北海道|沖繩|福岡|名古屋|tokyo|osaka|kyoto|okinawa/.test(p)) return "jp";
  if (/韓國|korea|首爾|釜山|seoul|busan/.test(p)) return "kr";
  if (/台灣|台北|台中|台南|高雄|花蓮|宜蘭|taiwan|taipei/.test(p)) return "tw";
  if (/美國|usa|u\.s\.|america|紐約|洛杉磯|舊金山|new york|los angeles|san francisco|hawaii|夏威夷|seattle|西雅圖/.test(p)) return "us";
  if (/英國|uk|britain|england|london|倫敦|scotland|愛丁堡|edinburgh/.test(p)) return "uk";
  return "other";
}

/** 這張卡在這個目的地算出國嗎？（發卡國不是目的地就是） */
export const isAbroad = (card: Card, dest: Country) => (card.country ?? "tw") !== dest;
const applies = (r: CardRate, abroad: boolean, dest: Country, kind: RateKind) =>
  (r.kind === "all" || r.kind === kind) && (r.where === "home" ? !abroad : r.where === "overseas" ? abroad : r.where === dest);

export interface Pick {
  card: Card;
  /** 這一站適用的最高回饋；沒有就是 null（只剩手續費） */
  rate: CardRate | null;
  /** 回饋 − 手續費（在發卡國國內不收海外手續費） */
  net: number;
  fee: number;
  /** 那個回饋標示的到期日已經過了（銀行多半會續辦，但要再確認） */
  stale: boolean;
}

/** 把一組卡依「這一站」排序：類型（"all"＝只看一般消費）、目的地、日期。第一個就是推薦。到期的優惠照算但標 stale，同分時排後面。 */
export function rank(cards: Card[], kind: RateKind, dest: Country, date?: string): Pick[] {
  const picks = cards.map((card): Pick => {
    const abroad = isAbroad(card, dest);
    const fee = abroad ? Number(card.fx_fee) || 0 : 0;
    const ok = (card.rates ?? []).filter((r) => applies(r, abroad, dest, kind)).sort((a, b) => b.rate - a.rate);
    const best = ok[0] ?? null;
    return { card, rate: best, net: round((best?.rate ?? 0) - fee), fee, stale: !!(best?.until && date && best.until < date) };
  });
  return picks.sort((a, b) => b.net - a.net || Number(a.stale) - Number(b.stale) || Number(!!a.rate?.cond) - Number(!!b.rate?.cond) || a.fee - b.fee || a.card.name.localeCompare(b.card.name, "zh-Hant"));
}

const round = (n: number) => Math.round(n * 100) / 100;
/** 3 → "3%"，1.25 → "1.25%"，-1.5 → "−1.5%" */
export const pct = (n: number) => `${n < 0 ? "−" : ""}${String(round(Math.abs(n)))}%`;

/** 一句話說為什麼：「回饋 3%（切趣旅行）− 手續費 1.5% ＝ 淨 1.5%」 */
export function explain(p: Pick): string {
  if (!p.rate) return p.fee ? `沒有適用的回饋，手續費 ${pct(p.fee)}` : "沒有適用的回饋";
  const note = p.rate.note ? `（${p.rate.note}）` : "";
  return p.fee ? `回饋 ${pct(p.rate.rate)}${note} − 手續費 ${pct(p.fee)} ＝ 淨 ${pct(p.net)}` : `回饋 ${pct(p.rate.rate)}${note}`;
}

export const STOP_KINDS: StopKind[] = ["food", "hotel", "shop", "sight", "move"];
/** 每種消費在當地刷卡的小提醒（推薦卡旁邊顯示）。 */
export const KIND_TIP: Record<StopKind, string> = {
  food: "日本小店常只收現金；能刷卡時用這張，結帳選日圓。",
  hotel: "在訂房網站預付的，以當時刷的卡為準；現場付款才用這張。",
  shop: "退稅時用同一張卡結帳；機器問幣別一律選日圓（JPY），不選台幣。",
  sight: "門票、神社常收現金；能刷卡時用這張。",
  move: "售票機多半收現金或 IC 卡；手機 Suica／PASMO 加值可以用這張。",
};

/** 給聊天機器人的一行摘要：每種消費推薦哪張、淨回饋多少。 */
export function summary(cards: Card[], dest: Country, date?: string): string {
  if (!cards.length) return "";
  return STOP_KINDS.map((k) => { const p = rank(cards, k, dest, date)[0]; return `${RATE_KIND_NAME[k]}→${p.card.short || p.card.name} 淨${pct(p.net)}`; }).join("；");
}
