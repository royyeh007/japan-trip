// 行程順序優化：把使用者勾選「可以移動」的地點重新排，讓整天的移動距離最短；不能移動的地點（起點、終點、有訂位的）位置不變。
//   1. 定位：每個地點的座標。先看快取（flight_cache 裡 geo: 開頭的 key），再查 Nominatim（地址→搜尋字）、Photon，最後請 Claude 估一個（會標示是估計）。
//   2. 排序：固定點照原順序，可移動的點用動態規劃（子集合 DP）找總距離最短的插入方式；距離用直線距離當代理。
//   3. 時間：固定點保留原時間；可移動的點在前後固定點之間平均分配（5 分鐘為單位）。交通段：原本就相鄰的沿用，新的用距離估。
//   只回建議，不寫資料庫；使用者在畫面上按「套用」才會改。
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod@4";
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { anthropic, CHAT_MODEL } from "../_shared/claude.ts";

type LL = [number, number];
interface Stop { t: string; n: string; q: string; k: string; st?: string; addr?: string; ll?: LL; [k: string]: unknown }
interface Leg { leg: string; txt: string; [k: string]: unknown }
type Item = Stop | Leg;
const isLeg = (i: Item): i is Leg => "leg" in i;
// deno-lint-ignore no-explicit-any
type Admin = any;

const UA = "family-trip-planner/1.0 (+https://github.com/royyeh007/japan-trip)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const R = 6371;
const km = (a: LL, b: LL) => {
  const dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const toMin = (t: string) => { const m = t.match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const fmt = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

// ---------- geocoding ----------
interface Geo { ll: LL | null; source: "cache" | "nominatim" | "photon" | "estimate" | "stop" | "none"; at?: string }
async function cacheGet(admin: Admin, key: string): Promise<Geo | null> {
  const { data } = await admin.from("flight_cache").select("data, fetched_at").eq("key", key).maybeSingle();
  if (!data) return null;
  const g = data.data as Geo;
  if (!g.ll && Date.now() - new Date(data.fetched_at).getTime() > 7 * 86400000) return null; // retry misses after a week
  return g;
}
const cachePut = (admin: Admin, key: string, g: Geo) => admin.from("flight_cache").upsert({ key, data: g, fetched_at: new Date().toISOString() });

async function nominatim(q: string): Promise<LL | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, "Accept-Language": "ja,zh-TW,en" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json() as { lat: string; lon: string }[];
    return j?.[0] ? [Number(j[0].lat), Number(j[0].lon)] : null;
  } catch { return null; }
}
async function photon(q: string, bias?: LL | null): Promise<LL | null> {
  try {
    const b = bias ? `&lat=${bias[0]}&lon=${bias[1]}&zoom=12&location_bias_scale=0.6` : "";
    const r = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}${b}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json() as { features?: { geometry?: { coordinates?: number[] } }[] };
    const c = j?.features?.[0]?.geometry?.coordinates;
    return c ? [Number(c[1]), Number(c[0])] : null;
  } catch { return null; }
}

interface Est { ll: LL; conf: "high" | "medium" | "low" }
/** Claude's knowledge of where places are, one call for all of them: used to cross-check the geocoders and as the fallback (marked as an estimate). */
async function estimate(places: { i: number; n: string; q: string; addr?: string }[], ctx: string): Promise<Map<number, Est>> {
  const out = new Map<number, Est>();
  if (places.length === 0) return out;
  const GeoZ = z.object({ places: z.array(z.object({ i: z.number(), lat: z.number().nullable(), lon: z.number().nullable(), confidence: z.enum(["high", "medium", "low"]) })) });
  try {
    const res = await anthropic().messages.create({
      model: CHAT_MODEL, max_tokens: 2000,
      system: "你是地理定位助手。給你一些地點（店名、地圖搜尋字、地址），回每個地點的座標（WGS84 十進位，小數至少 4 位）。confidence：high = 你確定這個店家或地標的位置（誤差 300 公尺內）；medium = 知道大概在哪個區域（誤差 1 公里內，例如知道在銀座四丁目一帶）；low = 只知道城市。完全不知道就 lat/lon 填 null。",
      messages: [{ role: "user", content: `${ctx}\n${places.map((p) => `#${p.i}：${p.n}｜搜尋字：${p.q}${p.addr ? `｜地址：${p.addr}` : ""}`).join("\n")}` }],
      output_config: { format: zodOutputFormat(GeoZ), effort: "low" },
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    for (const p of GeoZ.parse(JSON.parse(text)).places) if (p.lat != null && p.lon != null) out.set(p.i, { ll: [p.lat, p.lon], conf: p.confidence });
  } catch (e) { console.warn("estimate failed", e instanceof Error ? e.message : e); }
  return out;
}

// ---------- ordering ----------
/** Visit every stop, start at 0 and end at n-1, fixed stops keep their relative order, movable ones go anywhere: min total distance. */
function bestOrder(n: number, d: number[][], movable: number[]): number[] {
  const fixed = [...Array(n).keys()].slice(1, n - 1).filter((i) => !movable.includes(i));
  const m = movable.length, K = fixed.length, FULL = (1 << m) - 1;
  const idx = (mask: number, fi: number, last: number) => (mask * (K + 1) + fi) * n + last;
  const size = (1 << m) * (K + 1) * n;
  const cost = new Float64Array(size).fill(Infinity), par = new Int32Array(size).fill(-1);
  cost[idx(0, 0, 0)] = 0;
  for (let mask = 0; mask <= FULL; mask++) for (let fi = 0; fi <= K; fi++) for (let last = 0; last < n; last++) {
    const c = cost[idx(mask, fi, last)];
    if (c === Infinity) continue;
    for (let b = 0; b < m; b++) if (!(mask & (1 << b))) { const nx = movable[b], s = idx(mask | (1 << b), fi, nx), v = c + d[last][nx]; if (v < cost[s]) { cost[s] = v; par[s] = idx(mask, fi, last); } }
    if (fi < K) { const nx = fixed[fi], s = idx(mask, fi + 1, nx), v = c + d[last][nx]; if (v < cost[s]) { cost[s] = v; par[s] = idx(mask, fi, last); } }
  }
  let best = -1, bestCost = Infinity;
  for (let last = 0; last < n; last++) { const s = idx(FULL, K, last); if (cost[s] + d[last][n - 1] < bestCost) { bestCost = cost[s] + d[last][n - 1]; best = s; } }
  const order: number[] = [n - 1];
  for (let s = best; s >= 0; s = par[s]) order.push(s % n);
  return order.reverse();
}
const pathKm = (order: number[], d: number[][]) => order.slice(1).reduce((s, x, i) => s + d[order[i]][x], 0);

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({})) as { trip_id?: string; date_id?: string; city?: string; items?: Item[]; movable?: number[] };
  const { admin, trip } = await requireMember(req, body, { editor: true });
  const items = Array.isArray(body.items) ? body.items : [];
  const stops = items.filter((it): it is Stop => !isLeg(it));
  const n = stops.length;
  if (n < 3) throw new HttpError(400, "至少要有三個地點才有順序可以排");
  // first and last stay put; at most 12 movable (the search is exponential in that number)
  const movable = [...new Set((body.movable ?? []).filter((i) => Number.isInteger(i) && i > 0 && i < n - 1))].sort((a, b) => a - b);
  if (movable.length === 0) throw new HttpError(400, "請至少勾選一個可以移動的地點");
  if (movable.length > 12) throw new HttpError(400, "一次最多 12 個可以移動的地點");

  // ---- 1. coordinates ----
  //   cache → Claude's estimate for everything still missing (one quick call) → geocoders, accepted only when they agree with the
  //   estimate (within 3 km) or, when Claude has no idea, when they land near the city; Claude's own estimate is the last resort.
  const city = (body.city ?? "").trim();
  const ctx = `行程在${trip.place || "未知地點"}${city ? `，這一天在${city}` : ""}。`;
  const anchorKey = `geo:city:${norm(`${city} ${trip.place}`)}`;
  let anchor: LL | null = (await cacheGet(admin, anchorKey))?.ll ?? null;
  if (!anchor && (city || trip.place)) { anchor = await photon(city || trip.place); if (anchor) await cachePut(admin, anchorKey, { ll: anchor, source: "photon" }); }

  const geo: Geo[] = stops.map((s) => (s.ll && Array.isArray(s.ll) && s.ll.length === 2 ? { ll: [Number(s.ll[0]), Number(s.ll[1])], source: "stop" } : { ll: null, source: "none" }));
  const keyOf = (s: Stop) => `geo:q:${norm(s.q || s.n)}`;
  for (let i = 0; i < n; i++) if (!geo[i].ll) { const c = await cacheGet(admin, keyOf(stops[i])); if (c?.ll) geo[i] = { ll: c.ll, source: c.source === "estimate" ? "estimate" : "cache" }; }
  const need = stops.map((_, i) => i).filter((i) => !geo[i].ll);
  const est = await estimate(need.map((i) => ({ i, n: stops[i].n, q: stops[i].q, addr: stops[i].addr })), ctx);
  const agrees = (i: number, ll: LL | null): ll is LL => {
    if (!ll) return false;
    const e = est.get(i);
    if (e && e.conf !== "low") return km(ll, e.ll) <= 3;
    return !anchor || km(ll, anchor) <= 25;
  };
  for (const i of need) {
    const s = stops[i];
    const e = est.get(i);
    const bias = e && e.conf !== "low" ? e.ll : anchor;
    let found: Geo | null = null;
    if (s.addr && s.addr.trim().length > 4) {
      const ll = await nominatim(s.addr.trim()); await sleep(1100);
      if (agrees(i, ll)) found = { ll, source: "nominatim" };
    }
    if (!found) for (const q of [...new Set([s.q, s.n].filter((x): x is string => !!x && x.trim().length > 1))]) {
      const ll = await photon(q.trim(), bias); await sleep(250);
      if (agrees(i, ll)) { found = { ll, source: "photon" }; break; }
    }
    if (!found && e && e.conf !== "low") found = { ll: e.ll, source: "estimate" };
    if (found) { geo[i] = found; await cachePut(admin, keyOf(s), found); }
  }

  // stops without coordinates cannot be placed: keep them where they are (treated as fixed) and say so
  const warnings: string[] = [];
  const unlocated = stops.map((_, i) => i).filter((i) => !geo[i].ll);
  const movableOk = movable.filter((i) => geo[i].ll);
  for (const i of unlocated) warnings.push(`「${stops[i].n}」找不到座標，位置維持不變`);
  if (geo[0].ll == null || geo[n - 1].ll == null) warnings.push("起點或終點沒有座標，距離是用其他點估的");
  if (movableOk.length === 0) throw new HttpError(422, `勾選的地點都定不到位：${unlocated.map((i) => stops[i].n).join("、")}`);

  // ---- 2. order ----
  // distance matrix: unknown coordinates → fall back to the nearest known neighbour in the original order (so they stay "in place" cheaply)
  const known = stops.map((_, i) => geo[i].ll);
  for (let i = 0; i < n; i++) if (!known[i]) { let j = i - 1; while (j >= 0 && !geo[j].ll) j--; let k2 = i + 1; while (k2 < n && !geo[k2].ll) k2++; known[i] = (j >= 0 ? geo[j].ll : null) ?? (k2 < n ? geo[k2].ll : null) ?? anchor ?? [0, 0]; }
  const d = stops.map((_, i) => stops.map((_, j) => (i === j ? 0 : km(known[i]!, known[j]!))));
  const before = [...Array(n).keys()];
  const order = bestOrder(n, d, movableOk);
  const kmBefore = pathKm(before, d), kmAfter = pathKm(order, d);

  // ---- 3. times & legs ----
  const times = stops.map((s) => toMin(s.t));
  const fixedSet = new Set(before.filter((i) => !movableOk.includes(i)));
  const newTimes = new Map<number, string>();
  // anchors = fixed stops with a parseable time, in the new order; movable stops between two anchors share the gap evenly
  let seg: number[] = [], prevT: number | null = null;
  const flush = (nextT: number | null) => {
    if (seg.length === 0) return;
    const a = prevT ?? (nextT != null ? nextT - 60 * seg.length : null), b = nextT ?? (prevT != null ? prevT + 60 * seg.length : null);
    seg.forEach((si, j) => {
      if (a == null || b == null) { newTimes.set(si, stops[si].t); return; }
      const t = Math.round((a + (b - a) * (j + 1) / (seg.length + 1)) / 5) * 5;
      newTimes.set(si, fmt(Math.max(0, Math.min(23 * 60 + 55, t))));
    });
    seg = [];
  };
  for (const i of order) {
    if (fixedSet.has(i) && !isNaN(times[i])) { flush(times[i]); prevT = times[i]; newTimes.set(i, stops[i].t); }
    else if (fixedSet.has(i)) newTimes.set(i, stops[i].t);
    else seg.push(i);
  }
  flush(null);

  // legs: reuse the original leg(s) for pairs that were already consecutive in that direction, otherwise estimate from distance
  const legsBetween = new Map<string, Leg[]>();
  { let prev = -1, buf: Leg[] = [], si = -1;
    for (const it of items) { if (isLeg(it)) buf.push(it); else { si++; if (prev >= 0) legsBetween.set(`${prev}>${si}`, buf); buf = []; prev = si; } } }
  const legFor = (a: number, b: number): Leg[] => {
    const had = legsBetween.get(`${a}>${b}`);
    if (had && had.length) return had;
    if (!geo[a].ll || !geo[b].ll) return [{ leg: "taxi", txt: "交通待確認" }];
    const dist = d[a][b];
    if (dist < 0.15) return [{ leg: "walk", txt: "就在附近，走路 2 分鐘左右" }];
    if (dist <= 1.2) return [{ leg: "walk", txt: `走路約 ${Math.max(3, Math.round(dist * 1000 / 75))} 分鐘（約 ${dist.toFixed(1)} 公里）` }];
    return [{ leg: "train", txt: `約 ${dist.toFixed(1)} 公里，電車或計程車（交通待確認）` }];
  };
  const newItems: Item[] = [];
  order.forEach((i, pos) => {
    if (pos > 0) newItems.push(...legFor(order[pos - 1], i));
    const s: Stop = { ...stops[i], t: newTimes.get(i) ?? stops[i].t };
    if (geo[i].ll && geo[i].source !== "estimate") s.ll = geo[i].ll!; // remember good coordinates so next time is instant
    newItems.push(s);
  });

  const changed = order.some((i, pos) => i !== pos);
  return json({
    changed, kmBefore: Math.round(kmBefore * 10) / 10, kmAfter: Math.round(kmAfter * 10) / 10,
    order, before,
    stops: stops.map((s, i) => ({ n: s.n, t: s.t, newT: newTimes.get(i) ?? s.t, ll: geo[i].ll, source: geo[i].source, movable: movableOk.includes(i) })),
    items: newItems, warnings,
  });
}));
