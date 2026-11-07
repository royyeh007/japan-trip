// 範例：seed/trip.ts 長這樣（真正的 trip.ts 不進 git）。
import type { Day, Family } from "../src/data";

export const FAMILIES: Family[] = [
  { id: "lily", name: "Lily", label: "Lily 家", flights: ["去 BR192 12/26 松山 07:15 → 羽田 T3 11:00"] },
  { id: "yanzhi", name: "研芝", label: "研芝家", flights: [] },
  { id: "claire", name: "Claire", label: "Claire 家", flights: [] },
  { id: "iris", name: "Iris", label: "Iris 家", flights: [] },
];
export const SHARED_NOTE = "12/28–1/1 全員 14 人";

export const DAYS: Day[] = [
  { id: "d1226", fam: ["lily"], d: "12/26", w: "六", city: "東京", title: "抵達東京", hotel: "Conrad Tokyo", items: [
    { t: "11:00", n: "抵達羽田 T3", q: "羽田空港第3ターミナル", k: "move" },
    { leg: "train", txt: "京急直通 → 新橋，約 30 分鐘" },
    { t: "12:40", n: "Conrad 寄放行李", q: "コンラッド東京", k: "hotel" },
  ]},
  { id: "d1228", d: "12/28", w: "一", city: "長野", title: "新幹線到長野", hotel: "長野都會酒店", items: [] },
];
export const TODO: [string, string, string, boolean?][] = [["vjw", "12/12 前", "Visit Japan Web 全家填好"]];
export const CONTACTS: [string, string][] = [["季之庭 訂房專線", "+81-279-89-9320"]];
