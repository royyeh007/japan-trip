import { useEffect, useState } from "react";
import { invoke } from "../supabase";
import { useNow } from "../now";

/** "去 BR192 12/26 松山 07:15 → 羽田 T3 11:00" → { airline: "BR", number: "192", date: "2026-12-26", ... } */
export function parseFlight(text: string, fallbackDate?: string) {
  const m = text.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/);
  const d = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m || (!d && !fallbackDate)) return null;
  const month = d ? Number(d[1]) : 0, day = d ? Number(d[2]) : 0;
  const date = d ? `${month === 12 ? 2026 : 2027}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : fallbackDate!;
  const viaHaneda = /羽田|HND/i.test(text), viaNarita = /成田|NRT/i.test(text), viaSongshan = /松山|TSA/i.test(text), viaTaoyuan = /桃園|TPE/i.test(text);
  return { airline: m[1].toUpperCase(), number: m[2], date, viaHaneda, viaNarita, viaSongshan, viaTaoyuan, supported: viaHaneda || viaSongshan };
}

interface Status { airport: string; airportName: string; kind: "arr" | "dep"; sched: string; est: string | null; actual: string | null; delayMin: number | null; remark: string; terminal: string; gate: string; counter: string; updated: string }

function Line({ st }: { st: Status }) {
  const tone = st.delayMin != null && st.delayMin >= 15 ? "bad" : st.delayMin != null && st.delayMin < 0 ? "ok" : "";
  const delay = st.delayMin == null ? "" : st.delayMin > 0 ? `晚 ${st.delayMin} 分` : st.delayMin < 0 ? `早 ${-st.delayMin} 分` : "準時";
  return (
    <div className={`fl-status live ${tone}`}>
      <span className="fl-tag">{st.airportName} LIVE</span>
      <span>{st.kind === "arr" ? "抵達" : "起飛"}預定 {st.sched}{st.actual ? `，實際 ${st.actual}` : st.est ? `，預計 ${st.est}` : ""}{delay && `（${delay}）`}</span>
      {st.remark && <span className="fl-remark">{st.remark}</span>}
      <span className="muted">
        {st.terminal && `T${st.terminal} `}
        {st.gate ? `登機門 ${st.gate}` : st.kind === "dep" ? "登機門未公布" : ""}
        {st.counter && st.kind === "dep" && `・櫃台 ${st.counter}`}
      </span>
      <span className="muted">更新 {st.updated.slice(-5)}</span>
    </div>
  );
}

/** Live status for one flight line: live data on the day for Haneda and Songshan ends; links for the rest. */
export function FlightStatus({ text, date }: { text: string; date?: string }) {
  const f = parseFlight(text, date);
  const now = useNow();
  const [sts, setSts] = useState<Status[] | undefined>(undefined); // undefined = not asked yet
  const [err, setErr] = useState<string | null>(null);
  const live = !!f && f.supported && f.date === now.date;

  useEffect(() => {
    if (!live || !f) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await invoke<{ results: { statuses: Status[] }[] }>("flight-status", { flights: [{ airline: f.airline, number: f.number, date: f.date }] });
        if (alive) { setSts(r.results[0]?.statuses ?? []); setErr(null); }
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
    };
    load();
    const t = setInterval(load, 180_000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, f?.airline, f?.number, f?.date]);

  if (!f) return null;
  const code = `${f.airline}${f.number}`;
  const links = (
    <span className="fl-links">
      <a href={`https://www.flightradar24.com/data/flights/${code.toLowerCase()}`} target="_blank" rel="noopener">Flightradar24</a>
      {f.viaNarita && <a href="https://www.narita-airport.jp/en/flight/" target="_blank" rel="noopener">成田官網</a>}
      {f.viaHaneda && <a href="https://tokyo-haneda.com/en/flight/" target="_blank" rel="noopener">羽田官網</a>}
      {f.viaTaoyuan && <a href="https://www.taoyuan-airport.com/flight_depart" target="_blank" rel="noopener">桃園官網</a>}
    </span>
  );
  const covered = [f.viaSongshan && "松山", f.viaHaneda && "羽田"].filter(Boolean).join("、");

  if (!live) return <div className="fl-status muted">即時狀態：{f.date !== now.date && covered ? `當天會自動顯示${covered}的登機門、櫃台和準點狀態；` : ""}{links}</div>;
  if (err) return <div className="fl-status muted">即時狀態抓不到：{err} {links}</div>;
  if (sts === undefined) return <div className="fl-status muted">即時狀態載入中…</div>;
  if (sts.length === 0) return <div className="fl-status muted">{covered}今天的名單裡還沒有 {code}（通常起飛前幾小時才出現） {links}</div>;
  return <>{sts.map((st) => <Line key={st.airport + st.kind} st={st} />)}{<div className="fl-status muted">{links}</div>}</>;
}
