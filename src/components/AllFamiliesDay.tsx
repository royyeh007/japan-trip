import { daysFor, isoOf } from "../data";
import type { Day, Stop } from "../data";
import type { LinkedLeg } from "../maps";
import { useTrip } from "../trip";
import { Timeline } from "./DayView";

/** One date, every family side by side: each column is that family's effective version (own fork or the shared one). */
export function AllFamiliesDay({ dateId, onOpen }: { dateId: string; onOpen: (day: Day, s: Stop, arrive?: LinkedLeg) => void }) {
  const { trip } = useTrip();
  const cols = trip.families.map((f) => ({ family: f, day: daysFor(trip.days, f.id).find((d) => d.id === dateId) ?? null }));
  const any = cols.find((c) => c.day)?.day;
  return (
    <>
      <section className="dayhead">
        <div className="meta"><span>{any ? `${any.d}（${any.w}）` : dateId}</span><span className="hotel">所有家的這一天</span></div>
        <h2>四家同一天</h2>
        <p className="note">左右滑動比較。「大家一起」是共用的版本；有自己版本的家會標「自己的版本」。</p>
      </section>
      <div className="allgrid">
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
      <p className="note allfoot">{any && `天氣與地圖路線請切回單一家的畫面看（${isoOf(any.d)}）。`}</p>
    </>
  );
}
