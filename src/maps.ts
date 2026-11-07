import type { Day, Leg, Mode, Stop } from "./data";
import { isLeg } from "./data";

const E = encodeURIComponent;

export const MODE: Record<Mode, { travel: string | null; label: string }> = {
  taxi: { travel: "driving", label: "計程車" },
  walk: { travel: "walking", label: "走路" },
  train: { travel: "transit", label: "電車" },
  bus: { travel: "transit", label: "巴士" },
  charter: { travel: "driving", label: "包車" },
  shuttle: { travel: "driving", label: "接駁車" },
  flight: { travel: null, label: "飛機" },
};

export const placeURL = (q: string) => `https://www.google.com/maps/search/?api=1&query=${E(q)}`;

export const dirURL = (from: string, to: string, travel: string | null) =>
  `https://www.google.com/maps/dir/?api=1&origin=${E(from)}&destination=${E(to)}${travel ? `&travelmode=${travel}` : ""}`;

/** Whole-day route: every distinct consecutive stop, Google allows ~10 points. */
export function dayRouteURL(day: Day) {
  const qs: string[] = [];
  for (const it of day.items) if (!isLeg(it) && qs[qs.length - 1] !== it.q) qs.push(it.q);
  return "https://www.google.com/maps/dir/" + qs.slice(0, 10).map(E).join("/");
}

export interface LinkedLeg extends Leg { from?: string; to?: string }

/** For each leg, find the stops on either side so it can link to directions. */
export function linkLegs(day: Day) {
  const legs = new Map<number, LinkedLeg>();
  const arrive = new Map<number, LinkedLeg>();
  day.items.forEach((it, i) => {
    if (!isLeg(it)) return;
    let p = i - 1;
    while (p >= 0 && isLeg(day.items[p])) p--;
    let n = i + 1;
    while (n < day.items.length && isLeg(day.items[n])) n++;
    const prev = day.items[p] as Stop | undefined;
    const next = day.items[n] as Stop | undefined;
    const linked: LinkedLeg = { ...it, from: prev?.q, to: next?.q };
    legs.set(i, linked);
    if (next) arrive.set(n, linked);
  });
  return { legs, arrive };
}
