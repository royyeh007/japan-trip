// 範例：seed/trip.ts 長這樣（真正的 trip.ts 不進 git）。
import type { Day, Family } from "../src/data";

// 這份資料屬於哪個行程。id 固定一個 UUID 就能重複 `make seed` 更新；沒寫的話會用 .env.local 的 TRIP_ID 找既有的行程。
export const TRIP = { id: "6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c", name: "日本跨年行程", start_date: "2026-12-26", end_date: "2027-01-02", place: "日本・東京、長野、輕井澤、草津", tz: "Asia/Tokyo" };

export const FAMILIES: Family[] = [
  { id: "lily", name: "Lily", label: "Lily 家", flights: ["去 BR192 12/26 松山 07:15 → 羽田 T3 11:00"] },
  { id: "yanzhi", name: "Yenchih", label: "Yenchih 家", flights: [] },
  { id: "claire", name: "Claire", label: "Claire 家", flights: [] },
  { id: "iris", name: "Iris", label: "Iris 家", flights: [] },
];
export const SHARED_NOTE = "12/28–1/1 全員 14 人";

// 日期 id 用完整日期；舊的 "d1226" 寫法也還能用（seed 會換成完整日期）。
export const DAYS: Day[] = [
  { id: "2026-12-26", fam: ["lily"], d: "12/26", w: "六", city: "東京", title: "抵達東京", hotel: "Conrad Tokyo", items: [
    { t: "11:00", n: "抵達羽田 T3", q: "羽田空港第3ターミナル", k: "move" },
    { leg: "train", txt: "京急直通 → 新橋，約 30 分鐘" },
    { t: "12:40", n: "Conrad 寄放行李", q: "コンラッド東京", k: "hotel" },
  ]},
  { id: "2026-12-28", d: "12/28", w: "一", city: "長野", title: "新幹線到長野", hotel: "長野都會酒店", items: [] },
];
export const TODO: [string, string, string, boolean?][] = [["vjw", "12/12 前", "Visit Japan Web 全家填好"]];
export const CONTACTS: [string, string][] = [["季之庭 訂房專線", "+81-279-89-9320"]];
