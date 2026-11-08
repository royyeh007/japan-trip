// 型別和小工具。行程內容本身在 Supabase 資料庫（本機的 seed/trip.ts 用 `make seed` 推上去）。
export type Kind = "food" | "sight" | "hotel" | "shop" | "move";
export type Status = "ok" | "todo" | "tbd";
export type Mode = "taxi" | "walk" | "train" | "bus" | "charter" | "shuttle" | "flight";
/** A note someone added to a stop from the detail sheet. */
export interface Memo { by: string; name: string; text: string; at: string }
export interface Stop { t: string; n: string; q: string; k: Kind; st?: Status; who?: string; s?: string; info?: string[]; book?: string[]; rec?: string[]; tips?: string[]; addr?: string; tel?: string; memo?: Memo[] }
export interface Leg { leg: Mode; txt: string; st?: Status }
export type Item = Stop | Leg;
/** One date's itinerary. `id` is the date (YYYY-MM-DD). `fam` missing = everyone's shared day; otherwise only those families have this version. */
export interface Day { id: string; d: string; w: string; city: string; title: string; hotel: string; items: Item[]; fam?: FamilyId[] | null }
export const isLeg = (i: Item): i is Leg => "leg" in i;

/** Family ids are short slugs chosen per trip (e.g. "lily", "f3a9c1"). */
export type FamilyId = string;
export interface Family { id: FamilyId; name: string; label: string; flights: string[] }
export const labelOf = (families: Family[], id: FamilyId) => families.find((f) => f.id === id)?.label ?? id;

export const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** "2026-12-26" + 3 → "2026-12-29" */
export const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** "2026-12-26" -> { d: "12/26", w: "六" } */
export function dateOf(iso: string) {
  const dt = new Date(iso + "T00:00:00Z");
  return { d: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`, w: WEEKDAY[dt.getUTCDay()] };
}
/** "2026-12-26" → "2026.12.26" */
export const dotDate = (iso: string) => iso.replace(/-0?/g, ".");
export const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);

export interface DateRange { start: string; end: string }
/** A flight line only says "12/26": pick the year that lands closest to (ideally inside) the trip's dates. */
export function resolveDate(month: number, day: number, range?: DateRange | null): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!range) return `${new Date().getUTCFullYear()}-${pad(month)}-${pad(day)}`;
  const y0 = Number(range.start.slice(0, 4)), y1 = Number(range.end.slice(0, 4));
  let best = "", bestDist = Infinity;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    const iso = `${y}-${pad(month)}-${pad(day)}`;
    const dist = iso < range.start ? daysBetween(iso, range.start) : iso > range.end ? daysBetween(range.end, iso) : 0;
    if (dist < bestDist) { best = iso; bestDist = dist; }
  }
  return best;
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
  return [...byDate.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- trips & people ----------
/** admin 管理員、member 成員（改自己家和大家一起的）、viewer 觀察員（只能看，不能用聊天機器人） */
export type Role = "member" | "admin" | "viewer";
export const ROLE_LABEL: Record<Role, string> = { admin: "管理員", member: "成員", viewer: "觀察員" };
export const isViewer = (m: { role: Role } | null | undefined) => m?.role === "viewer";
export interface TripSettings { day_places?: Record<string, string[]> }
export interface Trip { id: string; name: string; start_date: string; end_date: string; place: string; tz: string; settings: TripSettings; created_by?: string | null; created_at?: string }
/** One row of `members` (this person in one trip). */
export interface Member { trip_id: string; user_id: string; email: string | null; family_id: FamilyId; role: Role; name: string | null; last_opened_at?: string | null }
/** A trip this person belongs to, with their membership row. */
export interface Membership extends Member { trip: Trip }

export const tripRange = (t: Trip): DateRange => ({ start: t.start_date, end: t.end_date });
/** Every date the site may show for this trip (families add days before/after): start − 14 .. end + 14. */
export function tripDates(t: Trip): string[] {
  const out: string[] = [];
  for (let d = addDays(t.start_date, -14); d <= addDays(t.end_date, 14); d = addDays(d, 1)) out.push(d);
  return out;
}
export const tripLength = (t: Trip) => daysBetween(t.start_date, t.end_date) + 1;
export const COMMON_TZ = ["Asia/Tokyo", "Asia/Taipei", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Bangkok", "Asia/Singapore", "Asia/Kolkata", "Asia/Dubai", "Europe/London", "Europe/Paris", "Europe/Rome", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Vancouver", "Australia/Sydney", "Pacific/Auckland", "Pacific/Honolulu"];

export type TodoItem = [string, string, string, boolean?];
export type Contact = [string, string];
/** Rows of the todos / contacts tables. `fam` null = everyone's. */
export interface TodoRow { id: string; fam: FamilyId[] | null; due: string; text: string; done: boolean; sort: number; created_at: string }
export interface ContactRow { id: string; fam: FamilyId[] | null; name: string; value: string; sort: number; created_at: string }
/** Can this member change the item (shared, their own family's, or admin)? */
export const canEdit = (fam: FamilyId[] | null | undefined, m: Member | null) => !!m && m.role !== "viewer" && (!fam || fam.includes(m.family_id) || m.role === "admin");

/** What the AI produces from an upload or a chat, waiting for the person to confirm. */
export interface Proposal {
  family_id: FamilyId;
  flights: string[];
  days: (Day & { scope: "family" | "shared" })[];
  joins: { date_id: string; with: FamilyId; from: string | null }[];
  summary: string;
  notes: string[];
}
export interface Upload { id: string; family_id: FamilyId; uploaded_by: string; kind: string; path: string | null; status: "pending" | "approved" | "rejected" | "failed"; parsed: Proposal | null; error: string | null; created_at: string }
export interface InviteRow { code: string; role: Role; family_id: string | null; uses: number; max_uses: number; note: string | null; expires_at: string | null; created_at: string }

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

/** "其他資訊" page content (extras.info). */
export type InfoBlock =
  | { type: "p"; text: string }
  | { type: "list"; h?: string; items: string[] }
  | { type: "table"; h?: string; cols: string[]; rows: string[][] }
  | { type: "flow"; h?: string; steps: { t: string; d: string }[]; branch?: { after: number; options: { tone: "ok" | "bad" | "neutral"; label: string; t: string; d: string }[] } }
  | { type: "sources"; items: { t: string; u: string }[] };
export interface InfoTab { id: string; title: string; updated: string; blocks: InfoBlock[] }
