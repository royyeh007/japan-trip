// 航班即時資料的共用程式：免費來源（羽田、松山）＋ aviationstack（省著用）＋ 快取與每月額度。
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Query { airline: string; number: string; date: string } // IATA 兩碼、航班號、YYYY-MM-DD
export interface Status {
  airport: string; airportName: string; kind: "arr" | "dep"; other: string; otherName: string;
  sched: string; est: string | null; actual: string | null; delayMin: number | null;
  remark: string; terminal: string; gate: string; counter: string; baggage?: string; updated: string; source: string;
}
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export const AV_MONTHLY_CAP = 90;

// IATA → 羽田 JSON 用的 ICAO 代碼
export const ICAO: Record<string, string> = { BR: "EVA", CI: "CAL", JL: "JAL", NH: "ANA", IT: "TTW", MM: "APJ", JX: "SJX", JW: "VNL", GK: "JJP", "7C": "JJA", TW: "TWB", OZ: "AAR", KE: "KAL", CX: "CPA", UO: "HKE", HX: "CRK", SQ: "SIA", TR: "TGW", DL: "DAL", UA: "UAL", AA: "AAL", TG: "THA", PR: "PAL", VN: "HVN", MU: "CES", CA: "CCA", CZ: "CSN", HO: "DKH", MF: "CXA", "9C": "CQH", ZH: "CSZ", BX: "ABL", "3U": "CSC", LJ: "JNA", QF: "QFA", AF: "AFR", BA: "BAW", LH: "DLH", EK: "UAE", QR: "QTR", TK: "THY", GA: "GIA", MH: "MAS", AK: "AXM", D7: "XAX", BI: "RBA", "5J": "CEB", HA: "HAL", AC: "ACA", FJ: "FJI", NZ: "ANZ" };
export const AIRPORT_ZH: Record<string, string> = { HND: "羽田", NRT: "成田", TSA: "松山", TPE: "桃園", KIX: "關西", NGO: "名古屋", FUK: "福岡", CTS: "新千歲", OKA: "那霸", KHH: "高雄" };

export const HND = {
  arr: "https://tokyo-haneda.com/app_resource/flight/data/int/hdacfarv.json",
  dep: "https://tokyo-haneda.com/app_resource/flight/data/int/hdacfdep.json",
};
export const TSA = {
  arr: "https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=7dc1379a-9485-4491-866d-fc4f9590ffcf",
  dep: "https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=42879f51-f47f-4d26-8b2b-5535c652cbde",
};

export const hhmm = (s: string | undefined | null) => (s && s.length >= 16 ? s.slice(11, 16) : s && s.length === 4 ? `${s.slice(0, 2)}:${s.slice(2)}` : null);
export const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const delayOf = (sched: string, eff: string | null) => (eff ? minutes(eff) - minutes(sched) : null);
/** "2026-12-26T11:05:00" in Japan time */
export const nowJST = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(" ", "T");
export const flightKey = (q: Query) => `${q.airline.toUpperCase()}${Number(q.number)}`;

/** "去 BR192 12/26 松山 07:15 → 羽田 T3 11:00" → Query + which airports the text mentions */
export function parseFlightText(text: string): (Query & { airports: string[] }) | null {
  const m = text.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/);
  const d = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m || !d) return null;
  const month = Number(d[1]), day = Number(d[2]);
  const date = `${month === 12 ? 2026 : 2027}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const airports: string[] = [];
  if (/羽田|HND/i.test(text)) airports.push("HND");
  if (/成田|NRT/i.test(text)) airports.push("NRT");
  if (/松山|TSA/i.test(text)) airports.push("TSA");
  if (/桃園|TPE/i.test(text)) airports.push("TPE");
  return { airline: m[1].toUpperCase(), number: m[2], date, airports };
}
/** True when both ends are covered by the free feeds, so aviationstack is never needed. */
export const freeCovered = (airports: string[]) => airports.length > 0 && airports.every((a) => a === "HND" || a === "TSA");

export async function getJson(url: string, label: string, timeoutMs = 10_000): Promise<Row | Row[] | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (family trip page)" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) { console.warn(`${label} ${r.status}`); return null; }
    return await r.json();
  } catch (e) { console.warn(`${label} failed: ${e instanceof Error ? e.message : e}`); return null; }
}

// ---------- 羽田 ----------
export function matchHND(feed: Row | null, kind: "arr" | "dep", q: Query): Status | null {
  if (!feed) return null;
  const icao = ICAO[q.airline.toUpperCase()];
  if (!icao) return null;
  const num = q.number.padStart(4, "0");
  const ymd = q.date.replace(/-/g, "/");
  const row = (feed.flight_info as Row[] ?? []).find((r) => String(r["定刻"] ?? "").startsWith(ymd) && (r["航空会社"] ?? []).some((a: Row) => a["ＡＬコード"] === icao && a["便名"] === num));
  if (!row) return null;
  const sched = hhmm(row["定刻"])!;
  const est = hhmm(row["変更時刻"]);
  const actual = hhmm(row["AT"]) ?? null;
  const otherKey = kind === "arr" ? "出発地" : "行先地";
  return {
    airport: "HND", airportName: "羽田", kind,
    other: row[`${otherKey}空港コード`] ?? "", otherName: row[`${otherKey}空港和名称`] ?? "",
    sched, est: est && est !== sched ? est : null, actual, delayMin: delayOf(sched, actual ?? est),
    remark: row["備考訳名称"]?.["zh-Hant"] ?? row["備考英名称"] ?? "",
    terminal: row["ターミナル区分"] ?? "", gate: row["ゲート番号コード"] ?? "", counter: row["チェックインカウンター番号"] ?? "",
    updated: feed.last_upd ?? "", source: "羽田機場官網",
  };
}

// ---------- 松山 ----------
export function matchTSA(rows: Row[] | null, kind: "arr" | "dep", q: Query): Status | null {
  if (!rows) return null;
  const mmdd = q.date.slice(5, 7) + q.date.slice(8, 10);
  const row = rows.find((r) => r.AirFlyDate === mmdd && r.AirLineIATA === q.airline.toUpperCase() && String(Number(r.AirLineNum)) === String(Number(q.number)));
  if (!row) return null;
  const sched = hhmm(kind === "dep" ? row.ExpectDepartureTime : row.ExpectArrivalTime)!;
  const real = hhmm(kind === "dep" ? row.RealDepartureTime : row.RealArrivalTime);
  const status = String(row.AirFlyStatus ?? "");
  const done = /Departed|Arrived/i.test(status);
  const remark = status.replace(/[A-Za-z ]+$/, "").trim() || status; // "已飛Departed" → "已飛"
  return {
    airport: "TSA", airportName: "松山", kind,
    other: kind === "dep" ? row.GoalAirportCode : row.UpAirportCode, otherName: kind === "dep" ? row.GoalAirportName : row.UpAirportName,
    sched, est: !done && real && real !== sched ? real : null, actual: done ? real : null, delayMin: delayOf(sched, real),
    remark: row.AirFlyDelayCause ? `${remark}（${row.AirFlyDelayCause}）` : remark,
    terminal: "", gate: row.AirBoardingGate ?? "", counter: row.CheckInCount ? `${row.CheckInCount} 號` : "",
    updated: String(row.UpdateTime ?? "").replace("T", " ").slice(0, 16), source: "松山機場開放資料",
  };
}

// ---------- aviationstack ----------
const AV_STATUS_ZH: Record<string, string> = { scheduled: "準備中", active: "飛行中", landed: "已降落", cancelled: "取消", incident: "異常", diverted: "改降" };
const localHHMM = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : null); // 給的是當地時間，直接取時分

export function avToStatuses(f: Row, updated: string): Status[] {
  const out: Status[] = [];
  for (const kind of ["dep", "arr"] as const) {
    const side = kind === "dep" ? f.departure : f.arrival;
    const other = kind === "dep" ? f.arrival : f.departure;
    if (!side?.scheduled) continue;
    const sched = localHHMM(side.scheduled)!;
    const est = localHHMM(side.estimated);
    const actual = localHHMM(side.actual);
    out.push({
      airport: side.iata ?? "", airportName: AIRPORT_ZH[side.iata] ?? side.iata ?? "", kind,
      other: other?.iata ?? "", otherName: AIRPORT_ZH[other?.iata] ?? other?.airport ?? "",
      sched, est: est && est !== sched ? est : null, actual, delayMin: side.delay ?? delayOf(sched, actual ?? est),
      remark: AV_STATUS_ZH[f.flight_status] ?? f.flight_status ?? "",
      terminal: side.terminal ?? "", gate: side.gate ?? "", counter: "", baggage: kind === "arr" ? (side.baggage ?? "") : "",
      updated, source: "aviationstack",
    });
  }
  return out;
}

export interface AvCache { statuses: Status[]; phase: "info" | "eve" | "live"; final?: boolean; schedDep?: string | null; flightDate?: string; note?: string }

/** Spend one aviationstack request (respecting the monthly cap) and store the result under `cacheKey`. */
export async function avFetchAndStore(admin: SupabaseClient, q: Query, cacheKey: string, phase: AvCache["phase"]): Promise<{ ok: boolean; data?: AvCache; note: string }> {
  const key = Deno.env.get("AVIATIONSTACK_KEY");
  if (!key) return { ok: false, note: "沒有設定 aviationstack key" };
  const now = nowJST();
  const quotaKey = `quota:${now.slice(0, 7)}`;
  const { data: quota } = await admin.from("flight_cache").select("data").eq("key", quotaKey).maybeSingle();
  const used = Number((quota?.data as Row | undefined)?.n ?? 0);
  if (used >= AV_MONTHLY_CAP) return { ok: false, note: `本月 aviationstack 額度用完（${used}/${AV_MONTHLY_CAP}）` };

  const url = `https://api.aviationstack.com/v1/flights?access_key=${key}&flight_iata=${flightKey(q)}&limit=5`;
  const res = await getJson(url, "aviationstack", 12_000) as Row | null;
  await admin.from("flight_cache").upsert({ key: quotaKey, data: { n: used + 1 }, fetched_at: new Date().toISOString() });
  const rows = (res?.data as Row[] | undefined) ?? [];
  const f = rows.find((r) => r.flight_date === q.date) ?? rows[0];
  const updated = now.replace("T", " ").slice(0, 16);
  const data: AvCache = f
    ? { statuses: avToStatuses(f, updated), phase, final: ["landed", "cancelled", "diverted"].includes(f.flight_status), schedDep: localHHMM(f.departure?.scheduled), flightDate: f.flight_date }
    : { statuses: [], phase, note: res?.error ? `aviationstack：${res.error.message ?? JSON.stringify(res.error)}` : "aviationstack 查不到這個航班號" };
  await admin.from("flight_cache").upsert({ key: cacheKey, data, fetched_at: new Date().toISOString() });
  return { ok: true, data, note: `aviationstack 本月第 ${used + 1} 次` };
}
