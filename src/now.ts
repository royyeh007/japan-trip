import { useEffect, useState } from "react";

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
