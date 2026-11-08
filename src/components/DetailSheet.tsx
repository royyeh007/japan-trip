import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FlightStatus } from "./FlightStatus";
import { askClaude } from "./Chat";
import { isLeg, isViewer } from "../data";
import type { Day, Item, Kind, Leg, Memo, Mode, Status, Stop } from "../data";
import { canEdit } from "../data";
import { useTrip } from "../trip";
import { MODE, dirURL, placeURL } from "../maps";
import type { LinkedLeg } from "../maps";
import { ModeIcon, PinIcon } from "../icons";
import { KIND_NAME, SEAL } from "../labels";
import { editDayItems, findStop, removeStopAt, sameDayRow, sortByTime } from "../dayEdit";

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const copy = () => {
    const selectIt = () => {
      if (!ref.current) return;
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
    };
    try {
      navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, selectIt);
    } catch { selectIt(); }
  };
  return (
    <span className="copy">
      <code ref={ref}>{value}</code>
      <button type="button" onClick={copy}>{done ? "已複製" : "複製"}</button>
    </span>
  );
}

const List = ({ items }: { items: string[] }) => <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

/** Notes on a stop: anyone who can edit this day (own family, or a shared day) can add one; you can delete your own. */
function Memos({ day, stop }: { day: Day; stop: Stop }) {
  const { member, current, reload } = useTrip();
  const [memos, setMemos] = useState<Memo[]>(stop.memo ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canEdit(day.fam, member);
  useEffect(() => { setMemos(stop.memo ?? []); }, [stop]);

  const write = async (next: Memo[]) => {
    if (!current) return;
    setBusy(true);
    const err = await editDayItems(current.id, day, (items) => {
      const idx = findStop(items, stop);
      return idx < 0 ? null : items.map((it, i) => (i === idx ? { ...it, memo: next } : it));
    });
    if (err) alert(err); else { setMemos(next); setText(""); reload(); }
    setBusy(false);
  };
  const add = () => { if (member && text.trim()) write([...memos, { by: member.user_id, name: member.name ?? member.email ?? "家人", text: text.trim(), at: new Date().toISOString() }]); };
  const del = (m: Memo) => { if (confirm("刪掉這則備註？")) write(memos.filter((x) => x !== m)); };

  return (
    <div className="sec memos">
      <h4>備註</h4>
      {memos.length === 0 && <p className="note">還沒有備註。</p>}
      <ul>
        {memos.map((m, i) => (
          <li key={i}>
            <span className="who-when">{m.name}・{new Date(m.at).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}</span>
            <span className="mtext">{m.text}</span>
            {member?.user_id === m.by && <button type="button" className="link" onClick={() => del(m)} disabled={busy}>刪</button>}
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="addrow memo-add">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="加一則備註，例：記得帶護照影本" onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }} />
          <button type="button" className="btn primary" onClick={add} disabled={busy || !text.trim()}>＋ 新增</button>
        </div>
      ) : (
        <p className="note">{isViewer(member) ? "觀察員只能看，不能加備註。" : "這是別家的行程，只能看不能加備註。"}</p>
      )}
    </div>
  );
}

// ---------- quick edit / add ----------
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const STATUS_OPTS: { v: Status | ""; l: string }[] = [{ v: "", l: "不用訂" }, { v: "ok", l: "已訂" }, { v: "todo", l: "要訂" }, { v: "tbd", l: "待定" }];

interface Draft { t: string; n: string; k: Kind; st: Status | ""; q: string; addr: string; tel: string; who: string; s: string; book: string; rec: string; info: string; tips: string; legMode: Mode | ""; legTxt: string }
const draftOf = (stop: Stop | null, arrive: Leg | undefined): Draft => ({
  t: stop?.t ?? "", n: stop?.n ?? "", k: stop?.k ?? "sight", st: stop?.st ?? "", q: stop?.q ?? "", addr: stop?.addr ?? "", tel: stop?.tel ?? "", who: stop?.who ?? "", s: stop?.s ?? "",
  book: (stop?.book ?? []).join("\n"), rec: (stop?.rec ?? []).join("\n"), info: (stop?.info ?? []).join("\n"), tips: (stop?.tips ?? []).join("\n"),
  legMode: arrive?.leg ?? "", legTxt: arrive?.txt ?? "",
});
function stopOf(d: Draft, base?: Stop): Stop {
  const out: Stop = { ...(base ?? {}), t: d.t.trim(), n: d.n.trim(), k: d.k, q: d.q.trim() || d.n.trim() };
  const set = <K extends keyof Stop>(k: K, v: Stop[K] | undefined | "") => { if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete out[k]; else out[k] = v as Stop[K]; };
  set("st", d.st || undefined); set("who", d.who.trim()); set("s", d.s.trim()); set("addr", d.addr.trim()); set("tel", d.tel.trim());
  set("book", lines(d.book)); set("rec", lines(d.rec)); set("info", lines(d.info)); set("tips", lines(d.tips));
  return out;
}

/** Form for one stop (edit it, or add a new one after it) plus the leg that leads into it. */
function StopEditor({ day, stop, arrive, mode, onDone, onCancel }: { day: Day; stop: Stop; arrive?: Leg; mode: "edit" | "add"; onDone: (key: { t: string; n: string }) => void; onCancel: () => void }) {
  const { current, reload } = useTrip();
  const [d, setD] = useState<Draft>(() => (mode === "edit" ? draftOf(stop, arrive) : { ...draftOf(null, undefined), t: stop.t }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = <K extends keyof Draft>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const hasArrive = mode === "add" || !!arrive || day.items.findIndex((it) => !isLeg(it)) !== day.items.indexOf(stop);

  const save = async () => {
    if (!current) return;
    if (!d.n.trim()) { setErr("名稱不能空"); return; }
    if (d.t.trim() && !/^\d{1,2}:\d{2}$/.test(d.t.trim())) { setErr("時間請用 H:MM，例如 9:30、14:00"); return; }
    setBusy(true); setErr(null);
    const next = stopOf(d, mode === "edit" ? stop : undefined);
    const leg: Leg | null = d.legMode && d.legTxt.trim() ? { leg: d.legMode, txt: d.legTxt.trim() } : null;
    const timeChanged = mode === "add" || d.t.trim() !== stop.t;
    const e = await editDayItems(current.id, day, (items) => {
      const idx = findStop(items, stop);
      if (idx < 0) return null;
      let out: Item[] = [...items];
      if (mode === "edit") {
        out[idx] = next;
        const prevIsLeg = idx > 0 && isLeg(out[idx - 1]);
        if (leg && prevIsLeg) out[idx - 1] = { ...(out[idx - 1] as Leg), leg: leg.leg, txt: leg.txt };
        else if (leg && !prevIsLeg) out.splice(idx, 0, leg);
        else if (!leg && prevIsLeg && d.legTxt.trim() === "") out.splice(idx - 1, 1);
      } else {
        out.splice(idx + 1, 0, ...(leg ? [leg, next] : [next]));
      }
      return timeChanged ? sortByTime(out) : out;
    });
    setBusy(false);
    if (e) { setErr(e); return; }
    await reload();
    onDone({ t: next.t, n: next.n });
  };

  return (
    <div className="sec editor">
      <h4>{mode === "edit" ? "編輯這一站" : "在這站後面加一站"}</h4>
      <div className="formgrid">
        <label>時間<input value={d.t} onChange={up("t")} placeholder="例：14:40" inputMode="numeric" /></label>
        <label>名稱<input value={d.n} onChange={up("n")} placeholder="例：晚餐：○○" /></label>
        <label>類型<select value={d.k} onChange={up("k")}>{(Object.keys(KIND_NAME) as Kind[]).map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</select></label>
        <label>訂位狀態<select value={d.st} onChange={up("st")}>{STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
        <label>Google 地圖搜尋字<input value={d.q} onChange={up("q")} placeholder="空白就用名稱" /></label>
        <label>地址<input value={d.addr} onChange={up("addr")} /></label>
        <label>電話<input value={d.tel} onChange={up("tel")} inputMode="tel" /></label>
        <label>只有誰去（可空）<input value={d.who} onChange={up("who")} placeholder="例：4 位女生" /></label>
      </div>
      <label className="full">一句話說明<input value={d.s} onChange={up("s")} /></label>
      <div className="formgrid">
        <label>訂位資訊（一行一項）<textarea rows={2} value={d.book} onChange={up("book")} /></label>
        <label>推薦（一行一項）<textarea rows={2} value={d.rec} onChange={up("rec")} /></label>
        <label>資訊（一行一項）<textarea rows={2} value={d.info} onChange={up("info")} /></label>
        <label>提醒（一行一項）<textarea rows={2} value={d.tips} onChange={up("tips")} /></label>
      </div>
      {hasArrive && (
        <div className="formgrid">
          <label>從上一站怎麼去
            <select value={d.legMode} onChange={up("legMode")}>
              <option value="">（不填）</option>
              {(Object.keys(MODE) as Mode[]).map((m) => <option key={m} value={m}>{MODE[m].label}</option>)}
            </select>
          </label>
          <label>交通說明<input value={d.legTxt} onChange={up("legTxt")} placeholder="例：計程車約 10 分鐘" /></label>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : mode === "edit" ? "儲存" : "加入"}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>取消</button>
      </div>
      {mode === "edit" && <p className="note">改了時間會自動照時間重新排序。</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

export function DetailSheet({ day: day0, stop: stop0, arrive: arrive0, onClose }: { day: Day; stop: Stop; arrive?: LinkedLeg; onClose: () => void }) {
  const { member, current, trip, reload } = useTrip();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [key, setKey] = useState({ t: stop0.t, n: stop0.n });
  const [mode, setMode] = useState<"view" | "edit" | "add">("view");
  const [busy, setBusy] = useState(false);

  // Follow the live data: after an edit (ours or someone else's) show the current version of this stop
  const { day, stop, arrive } = useMemo(() => {
    const d = trip.days.find((x) => sameDayRow(x, day0)) ?? day0;
    const idx = findStop(d.items, key);
    const s = idx >= 0 ? (d.items[idx] as Stop) : stop0;
    const prev = idx > 0 && isLeg(d.items[idx - 1]) ? (d.items[idx - 1] as Leg) : undefined;
    const a: LinkedLeg | undefined = prev ? { ...prev, from: arrive0?.from, to: s.q } : (idx < 0 ? arrive0 : undefined);
    return { day: d, stop: s, arrive: a };
  }, [trip.days, day0, stop0, arrive0, key]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);

  const editable = canEdit(day.fam, member);
  const codes = (stop.book ?? [])
    .map((b) => b.match(/(?:編號|番號|番号|ID|確認碼|確認號|訂位碼|訂房碼|代碼|代號|Confirmation|Booking|Reservation|Ref\.?|No\.?)[：:#\s]*([A-Za-z0-9-]{5,})/i)?.[1])
    .filter((c): c is string => !!c);
  const travel = arrive ? MODE[arrive.leg].travel : null;
  const info = [...(stop.s ? [stop.s] : []), ...(stop.info ?? [])];
  // what comes after this stop: the leg out of it and the next stop
  const idx = day.items.indexOf(stop);
  const nextItem = idx >= 0 ? day.items[idx + 1] : undefined;
  const departLeg = nextItem && isLeg(nextItem) ? nextItem : undefined;
  const nextStop = day.items.slice(idx + 1).find((it): it is Stop => !isLeg(it));
  const ask = () => { onClose(); setTimeout(() => askClaude(`「${stop.n}」（${day.d}）這個地方幫我查一下：營業時間或開放時間、怎麼去、要注意什麼、有什麼推薦。`), 50); };

  const remove = async () => {
    if (!current || !confirm(`把「${stop.n}」從 ${day.d} 的行程刪掉？`)) return;
    setBusy(true);
    const err = await editDayItems(current.id, day, (items) => { const i = findStop(items, stop); return i < 0 ? null : removeStopAt(items, i); });
    setBusy(false);
    if (err) { alert(err); return; }
    await reload();
    onClose();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title">
        <header>
          <div className="hd">
            <div className="st">
              {day.d}（{day.w}）{stop.t} ・ {KIND_NAME[stop.k]}{stop.who && ` ・ ${stop.who}`}
            </div>
            <h3 id="sh-title">{stop.n}</h3>
            {stop.st && <div className="seal-wrap"><span className={`seal ${stop.st}`}>{SEAL[stop.st]}</span></div>}
          </div>
          <button ref={closeRef} className="x" type="button" aria-label="關閉" onClick={onClose}>×</button>
        </header>
        <div className="body">
          {mode !== "view" ? (
            <StopEditor key={mode} day={day} stop={stop} arrive={arrive} mode={mode} onDone={(k) => { setKey(k); setMode("view"); }} onCancel={() => setMode("view")} />
          ) : (
            <>
              <div className="acts">
                <a className="btn primary" href={placeURL(stop.q)} target="_blank" rel="noopener"><PinIcon />在 Google 地圖開啟</a>
                {arrive && travel && arrive.from && arrive.from !== stop.q && (
                  <a className="btn" href={dirURL(arrive.from, stop.q, travel)} target="_blank" rel="noopener">
                    <ModeIcon mode={arrive.leg} />從上一站過來
                  </a>
                )}
              </div>
              {editable && (
                <div className="acts editacts">
                  <button type="button" className="btn" onClick={() => setMode("edit")} disabled={busy}>✎ 編輯</button>
                  <button type="button" className="btn" onClick={() => setMode("add")} disabled={busy}>＋ 之後加一站</button>
                  <button type="button" className="btn danger" onClick={remove} disabled={busy}>{busy ? "刪除中…" : "刪除這一站"}</button>
                </div>
              )}
              {arrive && <div className="sec"><h4>怎麼去</h4><p>{arrive.txt}</p></div>}
              {(departLeg || nextStop) && (
                <div className="sec">
                  <h4>接下來</h4>
                  {departLeg && <p><ModeIcon mode={departLeg.leg} /> {departLeg.txt}</p>}
                  {departLeg?.leg === "flight" && <FlightStatus text={departLeg.txt} date={day.id} />}
                  {nextStop && <p className="muted">下一站 {nextStop.t} {nextStop.n}</p>}
                </div>
              )}
              {stop.book && (
                <div className="sec"><h4>訂位資訊</h4><div className={`bookbox ${stop.st ?? ""}`}><List items={stop.book} /></div></div>
              )}
              {(stop.addr || stop.tel || codes.length > 0) && (
                <div className="sec">
                  <dl className="kv">
                    {stop.addr && <><dt>地址</dt><dd>{stop.addr}</dd></>}
                    {stop.tel && <><dt>電話</dt><dd><Copy value={stop.tel} /></dd></>}
                    {codes.map((c) => <Fragment key={c}><dt>訂位碼</dt><dd><Copy value={c} /></dd></Fragment>)}
                  </dl>
                </div>
              )}
              {stop.rec && <div className="sec"><h4>推薦</h4><List items={stop.rec} /></div>}
              {info.length > 0 && <div className="sec"><h4>資訊</h4><List items={info} /></div>}
              {stop.tips && <div className="sec"><h4>提醒</h4><List items={stop.tips} /></div>}
              <Memos day={day} stop={stop} />
              {!isViewer(member) && (
                <div className="sec askrow">
                  <button type="button" className="btn" onClick={ask}>✦ 問 Claude 這個地點</button>
                  <span className="note">資料不夠的話，讓它上網查營業時間、怎麼去、推薦。</span>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
