import { useEffect, useState } from "react";
import { ensurePlaces, fetchForecast, fetchNormals, merge, placeByKey, placesFor } from "./weather";
import type { Place, WeatherMap } from "./weather";
import { tripDates } from "./data";
import type { Day, Trip } from "./data";

const FORECAST_TTL = 30 * 60 * 1000;          // refresh forecast every 30 min
const NORMALS_TTL = 7 * 24 * 60 * 60 * 1000;  // past-years averages barely change

function readCache<T>(k: string, ttl: number): { at: number; data: T } | null {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "null");
    return v && Date.now() - v.at < ttl ? v : null;
  } catch { return null; }
}
function writeCache(k: string, data: unknown) {
  try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch { /* storage blocked */ }
}

export interface WeatherState { data: WeatherMap | null; updatedAt: number | null; error: boolean; loading: boolean; dayPlaces?: Record<string, string[]> }

/** Weather for every place this trip's days mention (plus the trip's own per-date place list), over the trip's date window. */
export function useWeather(trip: Trip | null, days: Day[]): WeatherState {
  const dayPlaces = trip?.settings?.day_places;
  const tripId = trip?.id ?? "";
  // the inputs that decide which places/dates to fetch, as one string so the effect re-runs only on real change
  const sig = trip ? JSON.stringify([trip.id, trip.start_date, trip.end_date, trip.tz, [...new Set(days.map((d) => `${d.id}|${d.city}`))].sort(), dayPlaces ?? null]) : "";
  const [state, setState] = useState<WeatherState>(() => {
    const n = tripId ? readCache<WeatherMap>(`wx-n:${tripId}`, NORMALS_TTL) : null;
    const f = tripId ? readCache<WeatherMap>(`wx-f:${tripId}`, FORECAST_TTL) : null;
    return { data: n && trip ? merge(n.data, f?.data ?? {}, tripDates(trip)) : null, updatedAt: f?.at ?? null, error: false, loading: true, dayPlaces };
  });

  useEffect(() => {
    if (!trip) return;
    let alive = true;
    const dates = tripDates(trip);
    const tz = trip.tz || "Asia/Tokyo";
    const load = async (force = false) => {
      setState((s) => ({ ...s, loading: true, dayPlaces }));
      try {
        await ensurePlaces(days.map((d) => d.city));
        const keys = new Set<string>();
        for (const d of days) for (const k of placesFor(d.id, d.city, dayPlaces)) keys.add(k);
        for (const ks of Object.values(dayPlaces ?? {})) for (const k of ks) keys.add(k);
        const places = [...keys].map(placeByKey).filter((p): p is Place => !!p);
        const nc = readCache<WeatherMap>(`wx-n:${trip.id}`, NORMALS_TTL);
        const normals = nc?.data ?? (await fetchNormals(places, dates, tz).then((d) => (writeCache(`wx-n:${trip.id}`, d), d)).catch(() => ({} as WeatherMap)));
        const fc = force ? null : readCache<WeatherMap>(`wx-f:${trip.id}`, FORECAST_TTL);
        let forecast = fc?.data, at = fc?.at ?? Date.now();
        if (!forecast) { forecast = await fetchForecast(places, dates, tz); writeCache(`wx-f:${trip.id}`, forecast); at = Date.now(); }
        if (alive) setState({ data: merge(normals, forecast, dates), updatedAt: at, error: false, loading: false, dayPlaces });
      } catch {
        if (alive) setState((s) => ({ ...s, error: true, loading: false, dayPlaces }));
      }
    };
    load();
    const timer = setInterval(() => load(true), FORECAST_TTL);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return state;
}
