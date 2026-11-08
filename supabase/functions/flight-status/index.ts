// 即時航班狀態。目前只有羽田：機場官網公開的 JSON（約 5 分鐘更新一次）。
// 其他機場回 null，前端改顯示官網／Flightradar24 連結。
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";

interface Query { airline: string; number: string; date: string } // IATA 兩碼、航班號、YYYY-MM-DD
interface Status {
  airport: "HND"; kind: "arr" | "dep"; other: string; otherName: string;
  sched: string; est: string | null; actual: string | null; delayMin: number | null;
  remark: string; terminal: string; gate: string; counter: string; updated: string;
}

// IATA → 羽田 JSON 用的 ICAO 代碼
const ICAO: Record<string, string> = { BR: "EVA", CI: "CAL", JL: "JAL", NH: "ANA", IT: "TTW", MM: "APJ", JX: "SJX", JW: "VNL", GK: "JJP", "7C": "JJA", TW: "TWB", OZ: "AAR", KE: "KAL", CX: "CPA", UO: "HKE", HX: "CRK", SQ: "SIA", TR: "TGW", DL: "DAL", UA: "UAL", AA: "AAL", TG: "THA", PR: "PAL", VN: "HVN", MU: "CES", CA: "CCA", CZ: "CSN", HO: "DKH", MF: "CXA", "9C": "CQH", ZH: "CSZ", BX: "ABL", "3U": "CSC", LJ: "JNA", QF: "QFA", AF: "AFR", BA: "BAW", LH: "DLH", EK: "UAE", QR: "QTR", TK: "THY", GA: "GIA", MH: "MAS", AK: "AXM", D7: "XAX", BI: "RBA", "5J": "CEB", HA: "HAL", AC: "ACA", FJ: "FJI", NZ: "ANZ" };

const FEEDS = {
  arr: "https://tokyo-haneda.com/app_resource/flight/data/int/hdacfarv.json",
  dep: "https://tokyo-haneda.com/app_resource/flight/data/int/hdacfdep.json",
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const hhmm = (s: string | undefined | null) => (s && s.length >= 16 ? s.slice(11, 16) : s && s.length === 4 ? `${s.slice(0, 2)}:${s.slice(2)}` : null);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

async function fetchFeed(kind: "arr" | "dep"): Promise<{ upd: string; rows: Row[] }> {
  const r = await fetch(FEEDS[kind], { headers: { "User-Agent": "Mozilla/5.0 (family trip page)" } });
  if (!r.ok) throw new HttpError(502, `羽田機場資料暫時抓不到（${r.status}）`);
  const j = await r.json();
  return { upd: j.last_upd, rows: j.flight_info ?? [] };
}

function match(rows: Row[], kind: "arr" | "dep", q: Query, upd: string): Status | null {
  const icao = ICAO[q.airline.toUpperCase()];
  if (!icao) return null;
  const num = q.number.padStart(4, "0");
  const ymd = q.date.replace(/-/g, "/");
  const row = rows.find((r) => String(r["定刻"] ?? "").startsWith(ymd) && (r["航空会社"] ?? []).some((a: Row) => a["ＡＬコード"] === icao && a["便名"] === num));
  if (!row) return null;
  const sched = hhmm(row["定刻"])!;
  const est = hhmm(row["変更時刻"]);
  const actual = hhmm(row["AT"]) ?? null;
  const eff = actual ?? est;
  const delayMin = eff ? minutes(eff) - minutes(sched) : null;
  const otherKey = kind === "arr" ? "出発地" : "行先地";
  return {
    airport: "HND", kind,
    other: row[`${otherKey}空港コード`] ?? "", otherName: row[`${otherKey}空港和名称`] ?? "",
    sched, est: est && est !== sched ? est : null, actual, delayMin,
    remark: row["備考訳名称"]?.["zh-Hant"] ?? row["備考英名称"] ?? "",
    terminal: row["ターミナル区分"] ?? "", gate: row["ゲート番号コード"] ?? "", counter: row["チェックインカウンター番号"] ?? "",
    updated: upd,
  };
}

Deno.serve(handle(async (req) => {
  await requireMember(req);
  const body = await req.json().catch(() => ({})) as { flights?: Query[] };
  const flights = (body.flights ?? []).filter((f) => f && /^[A-Z0-9]{2}$/i.test(f.airline) && /^\d{1,4}$/.test(f.number) && /^\d{4}-\d{2}-\d{2}$/.test(f.date)).slice(0, 10);
  if (flights.length === 0) throw new HttpError(400, "沒有航班");
  const [arr, dep] = await Promise.all([fetchFeed("arr"), fetchFeed("dep")]);
  const results = flights.map((q) => ({ query: q, status: match(arr.rows, "arr", q, arr.upd) ?? match(dep.rows, "dep", q, dep.upd) }));
  return json({ results, updated: arr.upd });
}));
