import { useState } from "react";
import { isLeg } from "../data";
import type { Day, Item, Stop } from "../data";
import { invoke } from "../supabase";
import { useTrip } from "../trip";
import { editDayItems } from "../dayEdit";

interface Result {
  changed: boolean; kmBefore: number; kmAfter: number; order: number[]; before: number[];
  stops: { n: string; t: string; newT: string; ll: [number, number] | null; source: string; movable: boolean }[];
  items: Item[]; warnings: string[];
}

/** Pick which stops may move, ask the server for the shortest order, preview it, apply only on confirmation. */
export function OptimizeDay({ day, onClose }: { day: Day; onClose: () => void }) {
  const { current, reload } = useTrip();
  const stops = day.items.filter((it): it is Stop => !isLeg(it));
  const n = stops.length;
  // default: everything between the first and last stop that is not time-bound (booked, a meal, a station/airport)
  const timeBound = (s: Stop) => s.st === "ok" || s.k === "move" || /^(早餐|午餐|晚餐|早午餐|下午茶|宵夜)/.test(s.n);
  const [movable, setMovable] = useState<Set<number>>(() => new Set(stops.map((_, i) => i).filter((i) => i > 0 && i < n - 1 && !timeBound(stops[i]))));
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (i: number) => setMovable((prev) => { const s = new Set(prev); if (s.has(i)) s.delete(i); else s.add(i); return s; });

  const run = async () => {
    if (!current) return;
    setBusy("定位地點、計算最短路線中（第一次會比較久，約 10–40 秒）…"); setErr(null); setRes(null);
    try {
      const r = await invoke<Result>("optimize-day", { trip_id: current.id, date_id: day.id, city: day.city, items: day.items, movable: [...movable] });
      setRes(r);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const apply = async () => {
    if (!current || !res) return;
    setBusy("套用中…"); setErr(null);
    const names = stops.map((s) => s.n).join("|");
    const e = await editDayItems(current.id, day, (fresh) => {
      const cur = fresh.filter((it): it is Stop => !isLeg(it));
      if (cur.map((s) => s.n).join("|") !== names) return null; // the day changed while we were looking
      const memoOf = new Map(cur.map((s) => [s.n, s.memo])); // keep notes added since the snapshot
      return res.items.map((it) => (isLeg(it) ? it : { ...it, ...(memoOf.get(it.n)?.length ? { memo: memoOf.get(it.n) } : {}) }));
    });
    setBusy(null);
    if (e) { setErr(e.startsWith("這個地點") ? "這一天剛剛被別人改過了，請關掉重新計算" : e); return; }
    await reload();
    onClose();
  };

  const saved = res ? Math.round((1 - res.kmAfter / Math.max(res.kmBefore, 0.01)) * 100) : 0;
  return (
    <div className="panel optimize">
      <h3>優化 {day.d} 的順序</h3>
      <p className="note">勾選可以調動順序的地點；起點、終點、有訂位的、用餐和車站機場預設不動（可以自己勾）。按「計算」會依地點之間的距離找出移動最短的順序，你看過沒問題再套用。</p>
      {!res && (
        <>
          <ul className="optlist">
            {stops.map((s, i) => {
              const locked = i === 0 || i === n - 1;
              return (
                <li key={i} className={locked ? "locked" : movable.has(i) ? "on" : ""}>
                  <label>
                    <input type="checkbox" checked={!locked && movable.has(i)} disabled={locked || !!busy} onChange={() => toggle(i)} />
                    <span className="t">{s.t}</span>
                    <span className="n">{s.n}</span>
                    {locked && <span className="tag none">{i === 0 ? "起點" : "終點"}</span>}
                    {!locked && s.st === "ok" && <span className="tag shared">已訂位</span>}
                    {!locked && s.st !== "ok" && timeBound(s) && <span className="tag none">有時間性</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="actions">
            <button type="button" className="btn primary" onClick={run} disabled={!!busy || movable.size === 0}>{busy ? "計算中…" : "計算最佳順序"}</button>
            <button type="button" className="btn" onClick={onClose} disabled={!!busy}>取消</button>
          </div>
          {busy && <p className="note">{busy}</p>}
        </>
      )}
      {res && (
        <>
          <div className="optsum">
            {res.changed
              ? <><b>{res.kmBefore} km → {res.kmAfter} km</b>{saved > 0 && <span className="tag shared">省 {saved}%</span>}</>
              : <b>現在的順序已經是最短的了（約 {res.kmBefore} km）</b>}
          </div>
          <ol className="optlist result">
            {res.order.map((i, pos) => {
              const s = res.stops[i];
              const moved = i !== pos;
              return (
                <li key={i} className={moved ? "moved" : ""}>
                  <span className="t">{s.newT}{s.newT !== s.t && <small>原 {s.t}</small>}</span>
                  <span className="n">{s.n}</span>
                  {moved && <span className="tag own">移動</span>}
                  {s.source === "estimate" && <span className="tag none" title="找不到精確座標，用 AI 估計的位置">座標估計</span>}
                  {!s.ll && <span className="tag none">沒座標</span>}
                </li>
              );
            })}
          </ol>
          {res.warnings.length > 0 && <ul className="notes">{res.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
          <p className="note">只算距離，不知道營業時間和你們想先做什麼，所以順序當參考。沒訂位的地點，時間是在前後固定點之間平均分配的，套用後可以再點進去微調；新的交通段會標「待確認」。距離是直線距離，實際路程會更長一些。</p>
          <div className="actions">
            {res.changed && <button type="button" className="btn primary" onClick={apply} disabled={!!busy}>{busy ? "套用中…" : "套用這個順序"}</button>}
            <button type="button" className="btn" onClick={() => setRes(null)} disabled={!!busy}>重新選擇</button>
            <button type="button" className="btn" onClick={onClose} disabled={!!busy}>關閉</button>
          </div>
        </>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
