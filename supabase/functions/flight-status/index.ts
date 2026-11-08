// 即時航班狀態，來源都是機場官方公開資料：
//   羽田 HND：tokyo-haneda.com 公開 JSON（國際線到著／出發）
//   松山 TSA：臺北松山機場 政府開放資料 JSON（國際線到站／離站，含登機門、報到櫃台）
// 一個航班可能兩端都有資料（例如 BR192：松山的登機門＋羽田的抵達狀態），都回。
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";

interface Query { airline: string; number: string; date: string } // IATA 兩碼、航班號、YYYY-MM-DD
export interface Status {
  airport: "HND" | "TSA"; airportName: string; kind: "arr" | "dep"; other: string; otherName: string;
  sched: string; est: string | null; actual: string | null; delayMin: number | null;
  remark: string; terminal: string; gate: string; counter: string; updated: string;
}

// IATA → 羽田 JSON 用的 ICAO 代碼
const ICAO: Record<string, string> = { BR: "EVA", CI: "CAL", JL: "JAL", NH: "ANA", IT: "TTW", MM: "APJ", JX: "SJX", JW: "VNL", GK: "JJP", "7C": "JJA", TW: "TWB", OZ: "AAR", KE: "KAL", CX: "CPA", UO: "HKE", HX: "CRK", SQ: "SIA", TR: "TGW", DL: "DAL", UA: "UAL", AA: "AAL", TG: "THA", PR: "PAL", VN: "HVN", MU: "CES", CA: "CCA", CZ: "CSN", HO: "DKH", MF: "CXA", "9C": "CQH", ZH: "CSZ", BX: "ABL", "3U": "CSC", LJ: "JNA", QF: "QFA", AF: "AFR", BA: "BAW", LH: "DLH", EK: "UAE", QR: "QTR", TK: "THY", GA: "GIA", MH: "MAS", AK: "AXM", D7: "XAX", BI: "RBA", "5J": "CEB", HA: "HAL", AC: "ACA", FJ: "FJI", NZ: "ANZ" };

const HND = {
  arr: "https://tokyo-haneda.com/app_resource/flight/data/int/hdacfarv.json",
  dep: "https://tokyo-haneda.com/app_resource/flight/data/int/hdacfdep.json",
};
const TSA = {
  arr: "https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=7dc1379a-9485-4491-866d-fc4f9590ffcf",
  dep: "https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=42879f51-f47f-4d26-8b2b-5535c652cbde",
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const hhmm = (s: string | undefined | null) => (s && s.length >= 16 ? s.slice(11, 16) : s && s.length === 4 ? `${s.slice(0, 2)}:${s.slice(2)}` : null);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const delayOf = (sched: string, eff: string | null) => (eff ? minutes(eff) - minutes(sched) : null);

async function getJson(url: string, label: string, timeoutMs = 10_000): Promise<Row | Row[] | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (family trip page)" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) { console.warn(`${label} ${r.status}`); return null; }
    return await r.json();
  } catch (e) { console.warn(`${label} failed: ${e instanceof Error ? e.message : e}`); return null; }
}

// ---------- 羽田 ----------
function matchHND(feed: Row | null, kind: "arr" | "dep", q: Query): Status | null {
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
    updated: feed.last_upd ?? "",
  };
}

// ---------- 松山 ----------
function matchTSA(rows: Row[] | null, kind: "arr" | "dep", q: Query): Status | null {
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
    updated: String(row.UpdateTime ?? "").replace("T", " ").slice(0, 16),
  };
}

Deno.serve(handle(async (req) => {
  await requireMember(req);
  const body = await req.json().catch(() => ({})) as { flights?: Query[] };
  const flights = (body.flights ?? []).filter((f) => f && /^[A-Z0-9]{2}$/i.test(f.airline) && /^\d{1,4}$/.test(f.number) && /^\d{4}-\d{2}-\d{2}$/.test(f.date)).slice(0, 10);
  if (flights.length === 0) throw new HttpError(400, "沒有航班");
  const [hndArr, hndDep, tsaArr, tsaDep] = await Promise.all([
    getJson(HND.arr, "HND arr"), getJson(HND.dep, "HND dep"), getJson(TSA.arr, "TSA arr"), getJson(TSA.dep, "TSA dep"),
  ]);
  const results = flights.map((q) => {
    const statuses = [
      matchTSA(tsaDep as Row[] | null, "dep", q), matchTSA(tsaArr as Row[] | null, "arr", q),
      matchHND(hndDep as Row | null, "dep", q), matchHND(hndArr as Row | null, "arr", q),
    ].filter((s): s is Status => !!s);
    // departure end first, then arrival end
    statuses.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dep" ? -1 : 1));
    return { query: q, statuses };
  });
  return json({ results });
}));
