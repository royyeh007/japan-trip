import { useState } from "react";
import { daysFor, isLeg } from "../data";
import type { Day, Stop } from "../data";
import { linkLegs } from "../maps";
import type { LinkedLeg } from "../maps";
import { KIND, SEAL } from "../labels";
import { useNow } from "../now";
import { useTrip } from "../trip";

/** Every day of the viewed family's itinerary on one page: date, city, hotel, and the stops as a compact chain. */
export function Overview({ onOpen }: { onOpen: (day: Day, stop: Stop, arrive?: LinkedLeg) => void }) {
  const { trip, viewFam, labelOf } = useTrip();
  const days = daysFor(trip.days, viewFam);
  const [brief, setBrief] = useState(false);
  const now = useNow();
  const keep = (s: Stop) => !brief || s.k === "food" || s.k === "hotel" || s.st === "ok";

  return (
    <>
      <section className="dayhead">
        <h2>行程總覽</h2>
        <p className="note">{labelOf(viewFam)}的每一天一頁看完。點日期進那一天，點地點看詳細資訊。頁首可以切換看別家。</p>
      </section>
      <div className="toolbar">
        <div className="modebar" role="group" aria-label="顯示多少">
          <button type="button" className={!brief ? "on" : ""} onClick={() => setBrief(false)}>全部地點</button>
          <button type="button" className={brief ? "on" : ""} onClick={() => setBrief(true)}>只看吃、住、已訂</button>
        </div>
        <button type="button" className="btn noprint" onClick={() => window.print()}>列印／存成 PDF</button>
      </div>
      {days.length === 0 && <p className="note">還沒有任何日期。</p>}
      <ol className="overview">
        {days.map((d) => {
          const { arrive } = linkLegs(d);
          const stops = d.items.map((it, i) => ({ it, i })).filter((x): x is { it: Stop; i: number } => !isLeg(x.it) && keep(x.it));
          return (
            <li key={d.id + (d.fam ?? []).join(",")} className={d.id === now.date ? "today" : ""}>
              <a className="ovhead" href={`#${d.id}`}>
                <span className="ovdate"><b>{d.d}</b><small>{d.w}</small></span>
                <span className="ovmain">
                  <span className="ovtitle">{d.title}</span>
                  <span className="ovmeta">{d.city}{d.hotel && ` ・ 住 ${d.hotel}`}{d.fam && ` ・ ${d.fam.map(labelOf).join("＋")}的版本`}</span>
                </span>
              </a>
              {stops.length === 0
                ? <p className="note ovempty">{d.items.length === 0 ? "還沒有行程" : "這天沒有吃、住或已訂的項目"}</p>
                : (
                  <ul className="ovstops">
                    {stops.map(({ it, i }) => (
                      <li key={i}>
                        <button type="button" onClick={() => onOpen(d, it, arrive.get(i))}>
                          <span className={`k ${it.k}`} aria-hidden="true">{KIND[it.k]}</span>
                          <span className="t">{it.t}</span>
                          <span className="n">{it.n}</span>
                          {it.st && <span className={`seal ${it.st}`}>{SEAL[it.st]}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
