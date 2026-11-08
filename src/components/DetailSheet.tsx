import { Fragment, useEffect, useRef, useState } from "react";
import { FlightStatus } from "./FlightStatus";
import { askClaude } from "./Chat";
import { isLeg } from "../data";
import type { Day, Memo, Stop } from "../data";
import { canEdit } from "../data";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { MODE, dirURL, placeURL } from "../maps";
import type { LinkedLeg } from "../maps";
import { ModeIcon, PinIcon } from "../icons";
import { KIND_NAME, SEAL } from "../labels";

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

  const write = async (next: Memo[]) => {
    if (!supabase) return;
    setBusy(true);
    // Re-read the day first so a note never overwrites changes someone else made while this sheet was open
    let sel = supabase.from("days").select("items").eq("trip_id", current!.id).eq("date_id", day.id);
    sel = day.fam ? sel.contains("fam", day.fam) : sel.is("fam", null);
    const { data: fresh, error: readErr } = await sel.maybeSingle();
    if (readErr || !fresh) { alert(readErr?.message ?? "這一天已經不存在了"); setBusy(false); return; }
    const items = fresh.items as Day["items"];
    let idx = items.findIndex((it) => !("leg" in it) && it.t === stop.t && it.n === stop.n);
    if (idx < 0) idx = items.findIndex((it) => !("leg" in it) && it.n === stop.n);
    if (idx < 0) { alert("這個地點已經被改掉了，重新打開再試"); setBusy(false); return; }
    const updated = items.map((it, i) => (i === idx ? { ...it, memo: next } : it));
    let q = supabase.from("days").update({ items: updated, updated_at: new Date().toISOString() }).eq("trip_id", current!.id).eq("date_id", day.id);
    q = day.fam ? q.contains("fam", day.fam) : q.is("fam", null);
    const { error } = await q;
    if (error) alert(error.message); else { setMemos(next); setText(""); reload(); }
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
        <p className="note">這是別家的行程，只能看不能加備註。</p>
      )}
    </div>
  );
}


export function DetailSheet({ day, stop, arrive, onClose }: { day: Day; stop: Stop; arrive?: LinkedLeg; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);

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
          <div className="acts">
            <a className="btn primary" href={placeURL(stop.q)} target="_blank" rel="noopener"><PinIcon />在 Google 地圖開啟</a>
            {arrive && travel && arrive.from && arrive.from !== stop.q && (
              <a className="btn" href={dirURL(arrive.from, stop.q, travel)} target="_blank" rel="noopener">
                <ModeIcon mode={arrive.leg} />從上一站過來
              </a>
            )}
          </div>
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
          <div className="sec askrow">
            <button type="button" className="btn" onClick={ask}>✦ 問 Claude 這個地點</button>
            <span className="note">資料不夠的話，讓它上網查營業時間、怎麼去、推薦。</span>
          </div>
        </div>
      </aside>
    </>
  );
}
