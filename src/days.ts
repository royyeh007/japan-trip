import { addDays, dateOf } from "./data";
import { supabase } from "./supabase";

/**
 * One empty "everyone together" day for every date from start to end that does not have one yet,
 * so a new trip (or a trip whose dates were extended) shows its dates right away. Returns how many were added.
 */
export async function fillTripDays(tripId: string, start: string, end: string, place: string, existingShared: string[] = []) {
  if (!supabase || !start || !end || end < start) return 0;
  const have = new Set(existingShared);
  const rows = [];
  for (let d = start, n = 1; d <= end && n <= 120; d = addDays(d, 1), n++) {
    if (have.has(d)) continue;
    const { d: dd, w } = dateOf(d);
    rows.push({ trip_id: tripId, date_id: d, fam: null, d: dd, w, city: place.trim() || "待定", title: `第 ${n} 天`, hotel: "", items: [] });
  }
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("days").upsert(rows, { onConflict: "trip_id,date_id,fam", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}
