import { useState } from "react";
import { daysFor } from "../data";
import type { Day, Stop } from "../data";
import type { LinkedLeg } from "../maps";
import { useTrip } from "../trip";
import { useScrollEdges } from "../useScrollEdges";
import { Timeline } from "./DayView";

/** One date, every family side by side: each column is that family's effective version (own fork or the shared one). */
export function AllFamiliesDay({ dateId, onOpen }: { dateId: string; onOpen: (day: Day, s: Stop, arrive?: LinkedLeg) => void }) {
  const { trip } = useTrip();
  const cols = trip.families.map((f) => ({ family: f, day: daysFor(trip.days, f.id).find((d) => d.id === dateId) ?? null }));
  const any = cols.find((c) => c.day)?.day;
  const { ref, edge, update, scrollBy } = useScrollEdges<HTMLDivElement>(dateId);
  const [active, setActive] = useState(0);

  // which column is (mostly) on screen → highlighted tab
  const onScroll = () => {
    update();
    const el = ref.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const x = el.scrollLeft + 24;
    let i = 0;
    kids.forEach((k, n) => { if (k.offsetLeft <= x) i = n; });
    setActive(i);
  };
  const jump = (i: number) => {
    const el = ref.current;
    const col = el?.children[i] as HTMLElement | undefined;
    if (el && col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };

  return (
    <>
      <section className="dayhead">
        <div className="meta"><span>{any ? `${any.d}（${any.w}）` : dateId}</span><span className="hotel">所有家的這一天</span></div>
        <h2>四家同一天</h2>
      </section>
      <div className="famtabs" role="tablist" aria-label="跳到哪一家">
        {cols.map((c, i) => (
          <button key={c.family.id} type="button" role="tab" aria-selected={active === i} className={active === i ? "on" : ""} onClick={() => jump(i)}>{c.family.label}</button>
        ))}
        <span className="hint">← 左右滑動看四家 →</span>
      </div>
      <div className={`allbar${edge.start ? " at-start" : ""}${edge.end ? " at-end" : ""}`}>
        <button type="button" className="scrollbtn left" onClick={() => scrollBy(-1, 0.5)} aria-label="往左" tabIndex={-1}>‹</button>
        <div className="allgrid" ref={ref} onScroll={onScroll}>
          {cols.map(({ family, day }) => (
            <section className="famcol" key={family.id}>
              <header>
                <b>{family.label}</b>
                {day ? <span className={`tag ${day.fam ? "own" : "shared"}`}>{day.fam ? "自己的版本" : "大家一起"}</span> : <span className="tag none">沒有行程</span>}
              </header>
              {day && (
                <>
                  <div className="sub">{day.title}{day.hotel && <><br />住 {day.hotel}</>}</div>
                  {day.items.length === 0
                    ? <p className="note">還沒有內容</p>
                    : <Timeline day={day} onOpen={(s, a) => onOpen(day, s, a)} />}
                </>
              )}
              {!day && <p className="note">{family.label}這天不在行程裡。</p>}
            </section>
          ))}
        </div>
        <button type="button" className="scrollbtn right" onClick={() => scrollBy(1, 0.5)} aria-label="往右" tabIndex={-1}>›</button>
      </div>
    </>
  );
}
