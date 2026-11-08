// Live weather from Open-Meteo (free, no key, CORS-enabled).
// Forecast covers ~16 days ahead; before that we show the average of past years for the same dates.
// Places: a built-in list of common cities, plus anything else a trip mentions, looked up once via Open-Meteo's geocoder.

export interface Place { key: string; name: string; lat: number; lon: number }

export const KNOWN_PLACES: Place[] = [
  { key: "taipei", name: "台北", lat: 25.069, lon: 121.552 },
  { key: "tokyo", name: "東京", lat: 35.681, lon: 139.767 },
  { key: "nagano", name: "長野", lat: 36.648, lon: 138.188 },
  { key: "jigokudani", name: "地獄谷", lat: 36.733, lon: 138.462 },
  { key: "karuizawa", name: "輕井澤", lat: 36.343, lon: 138.635 },
  { key: "kusatsu", name: "草津", lat: 36.621, lon: 138.596 },
  { key: "narita", name: "成田", lat: 35.776, lon: 140.318 },
  { key: "taoyuan", name: "桃園", lat: 25.080, lon: 121.232 },
  { key: "yokohama", name: "橫濱", lat: 35.444, lon: 139.638 },
  { key: "kamakura", name: "鎌倉", lat: 35.319, lon: 139.550 },
  { key: "hakone", name: "箱根", lat: 35.232, lon: 139.107 },
  { key: "kawaguchiko", name: "河口湖", lat: 35.497, lon: 138.769 },
  { key: "nikko", name: "日光", lat: 36.750, lon: 139.598 },
  { key: "matsumoto", name: "松本", lat: 36.238, lon: 137.972 },
  { key: "takayama", name: "高山", lat: 36.146, lon: 137.252 },
  { key: "kanazawa", name: "金澤", lat: 36.561, lon: 136.656 },
  { key: "nagoya", name: "名古屋", lat: 35.182, lon: 136.906 },
  { key: "kyoto", name: "京都", lat: 35.011, lon: 135.768 },
  { key: "osaka", name: "大阪", lat: 34.694, lon: 135.502 },
  { key: "nara", name: "奈良", lat: 34.685, lon: 135.805 },
  { key: "kobe", name: "神戶", lat: 34.690, lon: 135.196 },
  { key: "sapporo", name: "札幌", lat: 43.062, lon: 141.354 },
  { key: "fukuoka", name: "福岡", lat: 33.590, lon: 130.402 },
  { key: "okinawa", name: "沖繩", lat: 26.212, lon: 127.681 },
  { key: "seoul", name: "首爾", lat: 37.566, lon: 126.978 },
  { key: "busan", name: "釜山", lat: 35.180, lon: 129.075 },
  { key: "hongkong", name: "香港", lat: 22.302, lon: 114.177 },
  { key: "bangkok", name: "曼谷", lat: 13.756, lon: 100.502 },
  { key: "singapore", name: "新加坡", lat: 1.352, lon: 103.820 },
  { key: "kaohsiung", name: "高雄", lat: 22.627, lon: 120.301 },
  { key: "taichung", name: "台中", lat: 24.148, lon: 120.674 },
  { key: "tainan", name: "台南", lat: 22.999, lon: 120.227 },
  { key: "hualien", name: "花蓮", lat: 23.991, lon: 121.601 },
];

/** City name (as written in a day) -> weather place. */
const CITY_PLACE: Record<string, string> = {
  東京: "tokyo", 東京都: "tokyo", Tokyo: "tokyo", 新宿: "tokyo", 銀座: "tokyo", 淺草: "tokyo", 台場: "tokyo", 迪士尼: "tokyo", 舞浜: "tokyo", 羽田: "tokyo", 築地: "tokyo", 澀谷: "tokyo", 池袋: "tokyo",
  長野: "nagano", Nagano: "nagano", 輕井澤: "karuizawa", 軽井沢: "karuizawa", Karuizawa: "karuizawa", 草津: "kusatsu", Kusatsu: "kusatsu", 地獄谷: "jigokudani", 湯田中: "jigokudani",
  成田: "narita", Narita: "narita", 台北: "taipei", 松山: "taipei", Taipei: "taipei", 桃園: "taoyuan", Taoyuan: "taoyuan",
  橫濱: "yokohama", 横浜: "yokohama", Yokohama: "yokohama", 鎌倉: "kamakura", 箱根: "hakone", Hakone: "hakone", 河口湖: "kawaguchiko", 富士: "kawaguchiko", 日光: "nikko", 松本: "matsumoto", 高山: "takayama", 金澤: "kanazawa", 金沢: "kanazawa",
  名古屋: "nagoya", Nagoya: "nagoya", 京都: "kyoto", Kyoto: "kyoto", 大阪: "osaka", Osaka: "osaka", 梅田: "osaka", 難波: "osaka", 環球影城: "osaka", 奈良: "nara", 神戶: "kobe", 神戸: "kobe", 札幌: "sapporo", 福岡: "fukuoka",
  沖繩: "okinawa", 那霸: "okinawa", 首爾: "seoul", Seoul: "seoul", 釜山: "busan", 香港: "hongkong", 曼谷: "bangkok", Bangkok: "bangkok", 新加坡: "singapore", Singapore: "singapore",
  高雄: "kaohsiung", 台中: "taichung", 台南: "tainan", 花蓮: "hualien",
};

// ---- place registry: built-in + geocoded ----
const registry = new Map<string, Place>(KNOWN_PLACES.map((p) => [p.key, p]));
export const placeByKey = (key: string) => registry.get(key);
const geoKey = (city: string) => `geo:${city.trim()}`;
const skipCity = (city: string) => !city.trim() || /^(其他|未定|待定|TBD|-)$/i.test(city.trim());

function knownKeyFor(city: string): string | undefined {
  const c = city.trim();
  return CITY_PLACE[c] ?? Object.entries(CITY_PLACE).find(([name]) => c.includes(name))?.[1];
}

/** Resolve city names the built-in list doesn't know, via Open-Meteo's geocoder (cached on this device for a week). */
export async function ensurePlaces(cities: string[]) {
  const todo = [...new Set(cities.map((c) => c.trim()))].filter((c) => !skipCity(c) && !knownKeyFor(c) && !registry.has(geoKey(c)));
  await Promise.all(todo.map(async (c) => {
    const k = geoKey(c);
    let hit: Place | null | undefined;
    try {
      const raw = localStorage.getItem(`wx-geo:${c}`);
      const v = raw ? JSON.parse(raw) as { at: number; p: Place | null } : null;
      if (v && Date.now() - v.at < 7 * 86400000) hit = v.p;
    } catch { /* ignore */ }
    if (hit === undefined) {
      try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c)}&count=1&language=zh&format=json`);
        const j = r.ok ? await r.json() as { results?: { latitude: number; longitude: number; name: string }[] } : null;
        const g = j?.results?.[0];
        hit = g ? { key: k, name: c, lat: g.latitude, lon: g.longitude } : null;
      } catch { hit = null; }
      try { localStorage.setItem(`wx-geo:${c}`, JSON.stringify({ at: Date.now(), p: hit })); } catch { /* ignore */ }
    }
    if (hit) registry.set(k, { ...hit, key: k });
  }));
}

/** Places to show for a day: the trip's explicit list for that date (settings.day_places), otherwise the day's city. */
export function placesFor(date: string, city: string, dayPlaces?: Record<string, string[]>): string[] {
  const explicit = dayPlaces?.[date]?.filter((k) => registry.has(k));
  if (explicit?.length) return explicit;
  const key = knownKeyFor(city) ?? (registry.has(geoKey(city)) ? geoKey(city) : undefined);
  return key ? [key] : [];
}

export function roleOf(n: number, i: number) {
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
const coords = (places: Place[]) => `latitude=${places.map((p) => p.lat).join(",")}&longitude=${places.map((p) => p.lon).join(",")}`;

export async function fetchForecast(places: Place[], dates: string[], tz: string): Promise<WeatherMap> {
  if (places.length === 0) return {};
  const wanted = new Set(dates);
  const url =
    `https://api.open-meteo.com/v1/forecast?${coords(places)}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum` +
    `&timezone=${encodeURIComponent(tz)}&forecast_days=16`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const list = asList(await res.json());
  const out: WeatherMap = {};
  list.forEach((loc, i) => {
    const key = places[i].key;
    const d = loc.daily;
    d.time.forEach((date, j) => {
      if (!wanted.has(date)) return;
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

const shiftYears = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`.replace(/-02-29$/, "-02-28");

/** Average of the same calendar dates over the last 10 years (one archive request per year, all places at once). */
export async function fetchNormals(places: Place[], dates: string[], tz: string): Promise<WeatherMap> {
  if (places.length === 0 || dates.length === 0) return {};
  const first = dates[0], last = dates[dates.length - 1];
  const thisYear = new Date().getUTCFullYear();
  const firstYear = Number(first.slice(0, 4));
  const years = [...Array(10)].map((_, i) => firstYear - 1 - i).filter((y) => y < thisYear || (y === thisYear && shiftYears(last, y - firstYear) < new Date().toISOString().slice(0, 10)));
  const lists = await Promise.all(years.map(async (y) => {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?${coords(places)}` +
      `&start_date=${shiftYears(first, y - firstYear)}&end_date=${shiftYears(last, y - firstYear)}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=${encodeURIComponent(tz)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`archive ${res.status}`);
    return asList(await res.json());
  }));
  return summarizeNormals(places, dates, lists);
}

export function summarizeNormals(places: Place[], dates: string[], lists: { daily: Daily }[][]): WeatherMap {
  const out: WeatherMap = {};
  const wanted = new Map(dates.map((d) => [d.slice(5), d])); // "12-26" -> trip date
  places.forEach((place, i) => {
    const acc = new Map<string, { max: number[]; min: number[]; wet: number; snowy: number; codes: Map<number, number> }>();
    for (const list of lists) {
      const d = list[i]?.daily;
      if (!d) continue;
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
    }
    acc.forEach((a, date) => {
      const n = a.max.length;
      const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const code = [...a.codes.entries()].sort((x, y) => y[1] - x[1])[0][0];
      (out[date] ??= {})[place.key] = {
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
export function merge(normals: WeatherMap, forecast: WeatherMap, dates: string[]): WeatherMap {
  const out: WeatherMap = {};
  for (const date of dates) out[date] = { ...(normals[date] ?? {}), ...(forecast[date] ?? {}) };
  return out;
}
