// 型別和小工具。行程內容本身在 Supabase 資料庫（本機的 seed/trip.ts 用 `make seed` 推上去）。
export type Kind = "food" | "sight" | "hotel" | "shop" | "move";
export type Status = "ok" | "todo" | "tbd";
export type Mode = "taxi" | "walk" | "train" | "bus" | "charter" | "shuttle" | "flight";
/** A note someone added to a stop from the detail sheet. */
export interface Memo { by: string; name: string; text: string; at: string }
export interface Stop { t: string; n: string; q: string; k: Kind; st?: Status; who?: string; s?: string; info?: string[]; book?: string[]; rec?: string[]; tips?: string[]; addr?: string; tel?: string; memo?: Memo[] }
export interface Leg { leg: Mode; txt: string; st?: Status }
export type Item = Stop | Leg;
/** One date's itinerary. `fam` missing = everyone's shared day; otherwise only those families have this version. */
export interface Day { id: string; d: string; w: string; city: string; title: string; hotel: string; items: Item[]; fam?: FamilyId[] | null }
export const isoOf = (d: string) => { const [m, day] = d.split("/").map(Number); return `${m === 12 ? 2026 : 2027}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`; };
export const isLeg = (i: Item): i is Leg => "leg" in i;

export type FamilyId = "lily" | "yanzhi" | "claire" | "iris";
export const FAMILY_IDS: FamilyId[] = ["lily", "yanzhi", "claire", "iris"];
export interface Family { id: FamilyId; name: string; label: string; flights: string[] }
export const FAMILY_LABELS: Record<FamilyId, string> = { lily: "Lily 家", yanzhi: "Yenchih 家", claire: "Claire 家", iris: "Iris 家" };

export const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
/** Any day in Dec 2026 or Jan 2027, as "dMMDD". */
export const DATE_ID_RE = /^d(12|01)(0[1-9]|[12]\d|3[01])$/;
/** "2026-12-25" -> "d1225" */
export const dateIdOfIso = (iso: string) => `d${iso.slice(5, 7)}${iso.slice(8, 10)}`;
/** "d1226" -> { d: "12/26", w: "六" } */
export function dateOf(dateId: string) {
  const m = Number(dateId.slice(1, 3)), day = Number(dateId.slice(3, 5));
  const d = `${m}/${day}`;
  return { d, w: WEEKDAY[new Date(isoOf(d) + "T00:00:00").getDay()] };
}

/** Does this family have an itinerary for this day? */
export const hasDay = (d: Day, f: FamilyId) => !d.fam || d.fam.includes(f);

/** The days this family sees, one per date, in trip order: its own version of a date wins over a shared one. */
export function daysFor(days: Day[], f: FamilyId): Day[] {
  const byDate = new Map<string, Day>();
  // preference: the family's own row > a joint row shared with other families > the everyone row
  const rank = (d: Day) => (!d.fam ? 0 : d.fam.length === 1 ? 2 : 1);
  for (const d of days) {
    if (!hasDay(d, f)) continue;
    const cur = byDate.get(d.id);
    if (!cur || rank(d) > rank(cur)) byDate.set(d.id, d);
  }
  return [...byDate.values()].sort((a, b) => isoOf(a.d).localeCompare(isoOf(b.d)));
}

/** A member's role in the app. */
export interface Member { user_id: string; email: string | null; family_id: FamilyId; role: "member" | "admin"; name: string | null }

export type TodoItem = [string, string, string, boolean?];
export type Contact = [string, string];
/** Rows of the todos / contacts tables. `fam` null = everyone's. */
export interface TodoRow { id: string; fam: FamilyId[] | null; due: string; text: string; done: boolean; sort: number; created_at: string }
export interface ContactRow { id: string; fam: FamilyId[] | null; name: string; value: string; sort: number; created_at: string }
/** Can this member change the item (shared, their own family's, or admin)? */
export const canEdit = (fam: FamilyId[] | null | undefined, m: Member | null) => !!m && (!fam || fam.includes(m.family_id) || m.role === "admin");

/** What the AI produces from an upload or a chat, waiting for the admin to approve. */
export interface Proposal {
  family_id: FamilyId;
  flights: string[];
  days: (Day & { scope: "family" | "shared" })[];
  joins: { date_id: string; with: FamilyId; from: string | null }[];
  summary: string;
  notes: string[];
}
export interface Upload { id: string; family_id: FamilyId; uploaded_by: string; kind: string; path: string | null; status: "pending" | "approved" | "rejected" | "failed"; parsed: Proposal | null; error: string | null; created_at: string }

/** Phone numbers and emails that appear in a set of days' stops, deduped, with the stop they belong to. */
export function contactsFromDays(days: Day[]): { name: string; value: string; d: string }[] {
  const out: { name: string; value: string; d: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, value: string, d: string) => { const v = value.trim(); if (v && !seen.has(v)) { seen.add(v); out.push({ name, value: v, d }); } };
  for (const day of days) {
    for (const it of day.items) {
      if (isLeg(it)) continue;
      const name = it.n.replace(/^(早餐|午餐|晚餐|下午茶|點心|元旦餐|宵夜)[：:]\s*/, "");
      if (it.tel) push(name, it.tel, day.d);
      for (const line of [...(it.book ?? []), ...(it.info ?? []), ...(it.tips ?? [])]) {
        const m = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        if (m) push(name, m[0], day.d);
      }
    }
  }
  return out;
}

/** "其他資訊" page content (seed/info.json → extras.info). */
export type InfoBlock =
  | { type: "p"; text: string }
  | { type: "list"; h?: string; items: string[] }
  | { type: "table"; h?: string; cols: string[]; rows: string[][] }
  | { type: "flow"; h?: string; steps: { t: string; d: string }[]; branch?: { after: number; options: { tone: "ok" | "bad" | "neutral"; label: string; t: string; d: string }[] } }
  | { type: "sources"; items: { t: string; u: string }[] };
export interface InfoTab { id: string; title: string; updated: string; blocks: InfoBlock[] }
