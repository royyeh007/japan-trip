import { isLeg } from "./data";
import type { Day, Item, Leg, Stop } from "./data";
import { toMinutes } from "./now";
import { supabase } from "./supabase";

/** Same row of `days` (same date and same fam set)? */
export const sameDayRow = (a: Day, b: Day) => a.id === b.id && JSON.stringify(a.fam ?? null) === JSON.stringify(b.fam ?? null);

/** Index of this stop in a (possibly re-read) item list: by time+name, then by name alone. */
export function findStop(items: Item[], key: { t: string; n: string }) {
  let idx = items.findIndex((it) => !isLeg(it) && it.t === key.t && it.n === key.n);
  if (idx < 0) idx = items.findIndex((it) => !isLeg(it) && it.n === key.n);
  return idx;
}

/**
 * Change one day's items with a re-read first, so an edit never overwrites what someone else changed while the sheet was open.
 * `mutate` gets the fresh items and returns the new list (or null to abort). Returns an error message or null.
 */
export async function editDayItems(tripId: string, day: Day, mutate: (items: Item[]) => Item[] | null): Promise<string | null> {
  if (!supabase) return "Supabase 還沒設定";
  let sel = supabase.from("days").select("items").eq("trip_id", tripId).eq("date_id", day.id);
  sel = day.fam ? sel.contains("fam", day.fam) : sel.is("fam", null);
  const { data: fresh, error: readErr } = await sel.maybeSingle();
  if (readErr || !fresh) return readErr?.message ?? "這一天已經不存在了";
  const next = mutate(fresh.items as Item[]);
  if (!next) return "這個地點已經被改掉了，重新打開再試";
  let q = supabase.from("days").update({ items: next, updated_at: new Date().toISOString() }).eq("trip_id", tripId).eq("date_id", day.id);
  q = day.fam ? q.contains("fam", day.fam) : q.is("fam", null);
  const { error } = await q;
  return error ? error.message : null;
}

/** Stops in time order, each keeping the leg(s) that lead into it. Unsortable times → unchanged. */
export function sortByTime(items: Item[]): Item[] {
  const units: { legs: Leg[]; stop: Stop }[] = [];
  let legs: Leg[] = [];
  for (const it of items) { if (isLeg(it)) legs.push(it); else { units.push({ legs, stop: it }); legs = []; } }
  if (units.some((u) => isNaN(toMinutes(u.stop.t)))) return items;
  const sorted = [...units].sort((a, b) => toMinutes(a.stop.t) - toMinutes(b.stop.t));
  return [...sorted.flatMap((u) => [...u.legs, u.stop]), ...legs];
}

/** Remove a stop together with the leg that led into it (or, for the first stop, the leg out of it). */
export function removeStopAt(items: Item[], idx: number): Item[] {
  const out = [...items];
  if (idx > 0 && isLeg(out[idx - 1])) out.splice(idx - 1, 2);
  else if (idx + 1 < out.length && isLeg(out[idx + 1])) out.splice(idx, 2);
  else out.splice(idx, 1);
  return out;
}
