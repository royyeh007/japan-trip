// Live weather from Open-Meteo (free, no key, CORS-enabled).
// Forecast covers ~16 days ahead; before that we show the average of past years for the same dates.

export interface Place { key: string; name: string; lat: number; lon: number }

export const PLACES: Place[] = [
  { key: "taipei", name: "台北", lat: 25.069, lon: 121.552 },
  { key: "tokyo", name: "東京", lat: 35.681, lon: 139.767 },
  { key: "nagano", name: "長野", lat: 36.648, lon: 138.188 },
  { key: "jigokudani", name: "地獄谷", lat: 36.733, lon: 138.462 },
  { key: "karuizawa", name: "輕井澤", lat: 36.343, lon: 138.635 },
  { key: "kusatsu", name: "草津", lat: 36.621, lon: 138.596 },
  { key: "narita", name: "成田", lat: 35.776, lon: 140.318 },
  { key: "taoyuan", name: "桃園", lat: 25.080, lon: 121.232 },
];

/** Each trip date (YYYY-MM-DD): where the day starts, any stop on the way, and where it ends. */
export const DAY_PLACES: Record<string, string[]> = {
  "2026-12-26": ["taipei", "tokyo"],
  "2026-12-27": ["tokyo"],
  "2026-12-28": ["tokyo", "nagano"],
  "2026-12-29": ["nagano", "jigokudani", "karuizawa"],
  "2026-12-30": ["karuizawa", "kusatsu"],
  "2026-12-31": ["kusatsu", "tokyo"],
  "2027-01-01": ["tokyo"],
  "2027-01-02": ["tokyo", "narita", "taoyuan"],
};

export function roleOf(date: string, i: number) {
  const n = DAY_PLACES[date]?.length ?? 0;
  if (n < 2) return "整天";
  return i === 0 ? "出發地" : i === n - 1 ? "目的地" : "途中";
}

export interface DayWeather {
  kind: "forecast" | "normal";
  code: number;      // WMO weather code (for normals: most common)
  max: number;       // °C
  min: number;       // °C
  pop: number | null;   // forecast: max precipitation probability %, normal: % of past days with ≥1 mm
  snow: number | null;  // forecast: snowfall cm, normal: % of past days with snow
}

export type WeatherMap = Record<string, Record<string, DayWeather>>; // date -> placeKey -> weather

type Daily = Record<string, (number | null)[]> & { time: string[] };
type Resp = { daily: Daily } | { daily: Daily }[];

const asList = (r: Resp) => (Array.isArray(r) ? r : [r]);
const lats = PLACES.map((p) => p.lat).join(",");
const lons = PLACES.map((p) => p.lon).join(",");

export async function fetchForecast(): Promise<WeatherMap> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum` +
    `&timezone=Asia%2FTokyo&forecast_days=16`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const list = asList(await res.json());
  const out: WeatherMap = {};
  list.forEach((loc, i) => {
    const key = PLACES[i].key;
    const d = loc.daily;
    d.time.forEach((date, j) => {
      if (!(date in DAY_PLACES)) return;
      const max = d.temperature_2m_max[j], min = d.temperature_2m_min[j];
      if (max == null || min == null) return;
      (out[date] ??= {})[key] = {
        kind: "forecast",
        code: d.weather_code[j] ?? 0,
        max, min,
        pop: d.precipitation_probability_max?.[j] ?? null,
        snow: d.snowfall_sum?.[j] ?? null,
      };
    });
  });
  return out;
}

const tripMD = (date: string) => date.slice(5); // "12-26"

/** Average of the same calendar dates over the last 10 winters. */
export async function fetchNormals(): Promise<WeatherMap> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}` +
    `&start_date=2015-12-20&end_date=2025-01-05` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=Asia%2FTokyo`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`archive ${res.status}`);
  return summarizeNormals(asList(await res.json()));
}

export function summarizeNormals(list: { daily: Daily }[]): WeatherMap {
  const out: WeatherMap = {};
  const wanted = new Map(Object.keys(DAY_PLACES).map((d) => [tripMD(d), d]));
  list.forEach((loc, i) => {
    const key = PLACES[i].key;
    const d = loc.daily;
    const acc = new Map<string, { max: number[]; min: number[]; wet: number; snowy: number; codes: Map<number, number> }>();
    d.time.forEach((t, j) => {
      const date = wanted.get(t.slice(5));
      const max = d.temperature_2m_max[j], min = d.temperature_2m_min[j];
      if (!date || max == null || min == null) return;
      let a = acc.get(date);
      if (!a) acc.set(date, (a = { max: [], min: [], wet: 0, snowy: 0, codes: new Map() }));
      a.max.push(max); a.min.push(min);
      if ((d.precipitation_sum[j] ?? 0) >= 1) a.wet++;
      if ((d.snowfall_sum[j] ?? 0) > 0) a.snowy++;
      const c = simplify(d.weather_code[j] ?? 0);
      a.codes.set(c, (a.codes.get(c) ?? 0) + 1);
    });
    acc.forEach((a, date) => {
      const n = a.max.length;
      const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const code = [...a.codes.entries()].sort((x, y) => y[1] - x[1])[0][0];
      (out[date] ??= {})[key] = {
        kind: "normal", code,
        max: avg(a.max), min: avg(a.min),
        pop: Math.round((a.wet / n) * 100),
        snow: Math.round((a.snowy / n) * 100),
      };
    });
  });
  return out;
}

/** Group WMO codes so "most common" is meaningful. */
function simplify(c: number) {
  if (c <= 1) return 0;
  if (c <= 3) return 2;
  if (c <= 48) return 45;
  if (c <= 67 || (c >= 80 && c <= 82)) return 61;
  if (c <= 77 || c === 85 || c === 86) return 71;
  return 95;
}

export type WIcon = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";
export function describe(code: number): { label: string; icon: WIcon } {
  if (code === 0) return { label: "晴", icon: "sun" };
  if (code <= 2) return { label: "晴時多雲", icon: "partly" };
  if (code === 3) return { label: "陰", icon: "cloud" };
  if (code <= 48) return { label: "有霧", icon: "fog" };
  if (code <= 57) return { label: "毛毛雨", icon: "rain" };
  if (code <= 67) return { label: code >= 66 ? "凍雨" : "雨", icon: "rain" };
  if (code <= 77) return { label: "雪", icon: "snow" };
  if (code <= 82) return { label: "陣雨", icon: "rain" };
  if (code <= 86) return { label: "陣雪", icon: "snow" };
  return { label: "雷雨", icon: "storm" };
}

/** Merge: forecast wins where it exists; otherwise the past-years average. */
export function merge(normals: WeatherMap, forecast: WeatherMap): WeatherMap {
  const out: WeatherMap = {};
  for (const date of Object.keys(DAY_PLACES)) {
    out[date] = { ...(normals[date] ?? {}), ...(forecast[date] ?? {}) };
  }
  return out;
}
