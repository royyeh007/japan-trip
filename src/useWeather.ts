import { useEffect, useState } from "react";
import { fetchForecast, fetchNormals, merge } from "./weather";
import type { WeatherMap } from "./weather";

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

export interface WeatherState { data: WeatherMap | null; updatedAt: number | null; error: boolean; loading: boolean }

export function useWeather(): WeatherState {
  const [state, setState] = useState<WeatherState>(() => {
    const n = readCache<WeatherMap>("wx-normals2", NORMALS_TTL);
    const f = readCache<WeatherMap>("wx-forecast2", FORECAST_TTL);
    return { data: n ? merge(n.data, f?.data ?? {}) : null, updatedAt: f?.at ?? null, error: false, loading: true };
  });

  useEffect(() => {
    let alive = true;
    const load = async (force = false) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const nc = readCache<WeatherMap>("wx-normals2", NORMALS_TTL);
        const normals = nc?.data ?? (await fetchNormals().then((d) => (writeCache("wx-normals2", d), d)).catch(() => ({} as WeatherMap)));
        const fc = force ? null : readCache<WeatherMap>("wx-forecast2", FORECAST_TTL);
        let forecast = fc?.data, at = fc?.at ?? Date.now();
        if (!forecast) { forecast = await fetchForecast(); writeCache("wx-forecast2", forecast); at = Date.now(); }
        if (alive) setState({ data: merge(normals, forecast), updatedAt: at, error: false, loading: false });
      } catch {
        if (alive) setState((s) => ({ ...s, error: true, loading: false }));
      }
    };
    load();
    const timer = setInterval(() => load(true), FORECAST_TTL);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  return state;
}
