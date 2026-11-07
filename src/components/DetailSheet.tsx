import { Fragment, useEffect, useRef, useState } from "react";
import type { Day, Stop } from "../data";
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
    .map((b) => b.match(/(?:編號|番号|ID)[：:\s]*([A-Z0-9-]{5,})/)?.[1])
    .filter((c): c is string => !!c);
  const travel = arrive ? MODE[arrive.leg].travel : null;
  const info = [...(stop.s ? [stop.s] : []), ...(stop.info ?? [])];

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
        </div>
      </aside>
    </>
  );
}
