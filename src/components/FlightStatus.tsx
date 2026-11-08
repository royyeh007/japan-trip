import { useEffect, useState } from "react";
import { invoke } from "../supabase";
import { useNow } from "../now";

/** "去 BR192 12/26 松山 07:15 → 羽田 T3 11:00（座位 42B）" → parsed pieces */
export function parseFlight(text: string, fallbackDate?: string) {
  const m = text.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/);
  const d = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m || (!d && !fallbackDate)) return null;
  const month = d ? Number(d[1]) : 0, day = d ? Number(d[2]) : 0;
  const date = d ? `${month === 12 ? 2026 : 2027}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : fallbackDate!;
  const viaHaneda = /羽田|HND/i.test(text), viaNarita = /成田|NRT/i.test(text), viaSongshan = /松山|TSA/i.test(text), viaTaoyuan = /桃園|TPE/i.test(text);
  // 松山、羽田兩端都有免費即時資料；其他機場靠排程存下來的 aviationstack 資料（新增時、前一天、當天）
  const freeOnly = (viaHaneda || viaSongshan) && !viaNarita && !viaTaoyuan;
  const airline = (text.slice(0, m.index).replace(/^(去|回)\s*/, "").replace(/\d{1,2}\/\d{1,2}/, "").trim()) || m[1];
  const extra = text.match(/[（(]([^（）()]*)[）)]/)?.[1] ?? "";
  const route = text.replace(/[（(][^（）()]*[）)]/g, "").replace(/^(去|回)\s*/, "").replace(m[0], "").replace(/\d{1,2}\/\d{1,2}/, "").trim().replace(/^[\s・,，]+/, "");
  return { airline: m[1].toUpperCase(), number: m[2], code: `${m[1].toUpperCase()}${m[2]}`, airlineName: airline, route, extra, date, viaHaneda, viaNarita, viaSongshan, viaTaoyuan, freeOnly };
}

export interface Status { source?: string; airport: string; airportName: string; kind: "arr" | "dep"; sched: string; est: string | null; actual: string | null; delayMin: number | null; remark: string; terminal: string; gate: string; counter: string; baggage?: string; updated: string }
export interface Result { statuses: Status[]; note?: string; phase?: "info" | "eve" | "live"; fetchedAt?: string }

/** Fetch status for one flight line: on the day every 3 min; before the day (non-free airports) every 30 min. */
export function useFlightStatus(text: string, date?: string) {
  const f = parseFlight(text, date);
  const now = useNow();
  const [res, setRes] = useState<Result | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const today = !!f && f.date === now.date;
  const shouldAsk = !!f;
  useEffect(() => {
    if (!shouldAsk || !f) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await invoke<{ results: Result[] }>("flight-status", { flights: [{ airline: f.airline, number: f.number, date: f.date }] });
        if (alive) { setRes(r.results[0]); setErr(null); }
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
    };
    load();
    const t = setInterval(load, today ? 180_000 : 1_800_000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAsk, today, f?.airline, f?.number, f?.date]);
  const isLive = today && (!res?.phase || res.phase === "live");
  return { f, res, err, today, shouldAsk, isLive };
}

export const delayText = (st: Status) => (st.delayMin == null ? "" : st.delayMin > 0 ? `晚 ${st.delayMin} 分` : st.delayMin < 0 ? `早 ${-st.delayMin} 分` : "準時");
export const toneOf = (st: Status) => (st.delayMin != null && st.delayMin >= 15 ? "bad" : st.delayMin != null && st.delayMin < 0 ? "ok" : "");

function Links({ f }: { f: NonNullable<ReturnType<typeof parseFlight>> }) {
  return (
    <span className="fl-links">
      <a href={`https://www.flightradar24.com/data/flights/${f.code.toLowerCase()}`} target="_blank" rel="noopener">Flightradar24</a>
      {f.viaNarita && <a href="https://www.narita-airport.jp/en/flight/" target="_blank" rel="noopener">成田官網</a>}
      {f.viaHaneda && <a href="https://tokyo-haneda.com/en/flight/" target="_blank" rel="noopener">羽田官網</a>}
      {f.viaTaoyuan && <a href="https://www.taoyuan-airport.com/flight_depart" target="_blank" rel="noopener">桃園官網</a>}
    </span>
  );
}

function Meta({ res, f, today }: { res: Result | undefined; f: NonNullable<ReturnType<typeof parseFlight>>; today: boolean }) {
  const when = res?.fetchedAt ? new Date(res.fetchedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const phaseLabel = res?.phase === "live" ? "當天即時" : res?.phase === "eve" ? "出發前一天查的" : res?.phase === "info" ? "新增時查的" : today ? "即時" : "";
  const src = res?.statuses[0]?.source;
  const upd = !res?.fetchedAt && res?.statuses[0]?.updated ? `更新 ${res.statuses[0].updated.slice(-5)}` : null;
  return <div className="fl-status muted">{src && `資料來源：${src}`}{phaseLabel && `・${phaseLabel}`}{when && `・${when}`}{upd && `・${upd}`}{res?.note && `・${res.note}`} <Links f={f} /></div>;
}

function Line({ st, today }: { st: Status; today: boolean }) {
  const delay = delayText(st);
  return (
    <div className={`fl-status live ${today ? toneOf(st) : ""}`}>
      <span className="fl-tag">{st.airportName}{today ? " LIVE" : ""}</span>
      <span>{st.kind === "arr" ? "抵達" : "起飛"}{today ? "預定" : "表定"} {st.sched}{today && st.actual ? `，實際 ${st.actual}` : today && st.est ? `，預計 ${st.est}` : ""}{today && delay && `（${delay}）`}</span>
      {today && st.remark && <span className="fl-remark">{st.remark}</span>}
      <span className="muted">
        {st.terminal && `T${st.terminal} `}
        {today && st.gate ? `登機門 ${st.gate}` : st.kind === "dep" ? (today ? "登機門未公布" : "登機門當天公布") : ""}
        {today && st.counter && st.kind === "dep" && `・櫃台 ${st.counter}`}
        {today && st.baggage && st.kind === "arr" && `・行李轉盤 ${st.baggage}`}
      </span>
    </div>
  );
}

/** Compact lines (hero and detail sheet). */
export function FlightStatus({ text, date }: { text: string; date?: string }) {
  const { f, res, err, today, shouldAsk, isLive } = useFlightStatus(text, date);
  if (!f) return null;
  if (!shouldAsk) return <div className="fl-status muted">當天會自動顯示松山、羽田的登機門、櫃台和準點狀態。<Links f={f} /></div>;
  if (err) return <div className="fl-status muted">即時狀態抓不到：{err} <Links f={f} /></div>;
  if (res === undefined) return <div className="fl-status muted">航班狀態載入中…</div>;
  if (res.statuses.length === 0) return <div className="fl-status muted">{today ? "今天還查不到" : "還沒有"} {f.code} 的航班資料{res.note ? `（${res.note}）` : ""} <Links f={f} /></div>;
  return <>{res.statuses.map((st) => <Line key={st.airport + st.kind} st={st} today={isLive} />)}<Meta res={res} f={f} today={today} /></>;
}

/** Big card for the timeline: flight number + on-time status in large type, gate / counter / carousel in large type. */
export function FlightCard({ text, date }: { text: string; date?: string }) {
  const { f, res, err, today, shouldAsk, isLive } = useFlightStatus(text, date);
  if (!f) return <span className="legbox">{text}</span>;
  const dep = res?.statuses.find((s) => s.kind === "dep");
  const arr = res?.statuses.find((s) => s.kind === "arr");
  const main = dep ?? arr;
  const status = isLive && main ? (main.actual && main.kind === "dep" ? (main.remark || "已起飛") : main.remark || delayText(main) || "") : "";
  const delay = isLive && main ? delayText(main) : "";
  const tone = isLive && main ? toneOf(main) : "";
  const gate = isLive ? (dep?.gate || (arr && !dep ? arr.gate : "")) : "";
  const gateLabel = gate ? `登機門 ${gate}` : today ? "登機門 未公布" : "登機門 當天公布";
  return (
    <div className={`flightcard ${tone}`}>
      <div className="fc-top">
        <span className="fc-code">✈ {f.airlineName && f.airlineName !== f.code ? `${f.airlineName} ` : ""}{f.code}</span>
        {(status || delay) && <span className={`fc-status ${tone}`}>{status}{delay && status !== delay ? `・${delay}` : ""}</span>}
        {!isLive && today && res && res.statuses.length > 0 && <span className="fc-status">今天的即時資料載入中</span>}
      </div>
      <div className="fc-route">{f.route}</div>
      {main && (isLive || res?.phase) && (
        <div className="fc-times muted">
          {dep && <span>起飛{isLive ? "預定" : "表定"} {dep.sched}{isLive && dep.actual ? `・實際 ${dep.actual}` : isLive && dep.est ? `・預計 ${dep.est}` : ""}</span>}
          {arr && <span>抵達{isLive ? "預定" : "表定"} {arr.sched}{isLive && arr.actual ? `・實際 ${arr.actual}` : isLive && arr.est ? `・預計 ${arr.est}` : ""}</span>}
        </div>
      )}
      <div className="fc-gate">
        <span className="fc-big">{gateLabel}</span>
        {dep?.terminal && <span className="fc-mid">T{dep.terminal}</span>}
        {isLive && dep?.counter && <span className="fc-mid">櫃台 {dep.counter}</span>}
        {isLive && arr?.baggage && <span className="fc-mid">行李轉盤 {arr.baggage}</span>}
      </div>
      {f.extra && <div className="fc-extra muted">{f.extra}</div>}
      {shouldAsk ? (err ? <div className="fl-status muted">即時狀態抓不到：{err} <Links f={f} /></div> : res === undefined ? <div className="fl-status muted">載入中…</div> : <Meta res={res} f={f} today={today} />) : <div className="fl-status muted">當天自動顯示即時狀態與登機門 <Links f={f} /></div>}
    </div>
  );
}
