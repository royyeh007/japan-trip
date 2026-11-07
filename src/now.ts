import { useEffect, useState, useSyncExternalStore } from "react";

export interface Now { date: string; minutes: number; hhmm: string }

/** "13:05" / "8:45" -> minutes since midnight; NaN if it is not a time. */
export const toMinutes = (t: string) => {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Current time in Japan (the itinerary's times), or the `?now=YYYY-MM-DDTHH:MM` preview override. */
function compute(): Now {
  const fake = new URLSearchParams(location.search).get("now");
  let date: string, h: number, mi: number;
  if (fake && /^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(fake)) {
    date = fake.slice(0, 10); [h, mi] = fake.slice(11).split(":").map(Number);
  } else {
    const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }); // "2026-12-29 14:32:10"
    date = s.slice(0, 10); h = Number(s.slice(11, 13)); mi = Number(s.slice(14, 16));
  }
  return { date, minutes: h * 60 + mi, hhmm: `${h}:${String(mi).padStart(2, "0")}` };
}

export function useNow(): Now {
  const [now, setNow] = useState(compute);
  useEffect(() => {
    const t = setInterval(() => setNow(compute()), 30_000);
    const onVis = () => document.visibilityState === "visible" && setNow(compute());
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return now;
}

// ---- "now" line on/off (default on), remembered on this device, shared by every Timeline on the page ----
const LINE_KEY = "jp-nowline";
const listeners = new Set<() => void>();
const readLine = () => { try { return localStorage.getItem(LINE_KEY) !== "off"; } catch { return true; } };
export function setNowLine(on: boolean) {
  try { localStorage.setItem(LINE_KEY, on ? "on" : "off"); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useNowLine(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, readLine, () => true);
}

/** The `?now=` preview value, if the page was opened with one. */
export function fakeNow(): string | null {
  const v = new URLSearchParams(location.search).get("now");
  return v && /^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(v) ? v : null;
}
/** Reload the page pretending it is `iso` (YYYY-MM-DD) at the current Japan clock time, on the given day page. */
export function startPreview(iso: string, hhmm: string, hash: string) {
  location.assign(`${location.pathname}?now=${iso}T${hhmm}${hash}`);
}
export function endPreview() {
  location.assign(location.pathname + location.hash);
}
