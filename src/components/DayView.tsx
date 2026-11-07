import { useMemo } from "react";
import { isLeg, isoOf } from "../data";
import { DayWeatherPanel } from "./Weather";
import type { WeatherState } from "../useWeather";
import type { Day, Family, Stop } from "../data";
import { MODE, dayRouteURL, dirURL, linkLegs } from "../maps";
import type { LinkedLeg } from "../maps";
import { DownloadIcon, ModeIcon, RouteIcon } from "../icons";
import { KIND, SEAL } from "../labels";
import { openForm } from "../form";
import { useTrip } from "../trip";

function LegRow({ leg }: { leg: LinkedLeg }) {
  const { travel, label } = MODE[leg.leg];
  const inner = (
    <>
      <span className="mi"><ModeIcon mode={leg.leg} /></span>
      <span className="lt">
        {leg.txt}
        {leg.st && <> <span className={`seal ${leg.st}`}>{SEAL[leg.st]}</span></>}
      </span>
    </>
  );
  const canLink = travel && leg.from && leg.to && leg.from !== leg.to;
  return (
    <li className="leg">
      <span />
      <span className="rail" />
      {canLink ? (
        <a href={dirURL(leg.from!, leg.to!, travel)} target="_blank" rel="noopener" aria-label={`${label}路線：${leg.txt}`}>
          {inner}
          <span className="go">路線 ↗</span>
        </a>
      ) : (
        <span className="legbox">{inner}</span>
      )}
    </li>
  );
}

function StopRow({ stop, onOpen }: { stop: Stop; onOpen: () => void }) {
  const sub = stop.s || stop.book?.[0] || stop.rec?.[0] || "";
  return (
    <li className="stop">
      <span className="t">{stop.t}</span>
      <span className={`k ${stop.k}`} aria-hidden="true">{KIND[stop.k]}</span>
      <button className="card" type="button" aria-haspopup="dialog" onClick={onOpen}>
        <div className="n">{stop.n}</div>
        {sub && <div className="s">{sub}</div>}
        <div className="row">
          {stop.st && <span className={`seal ${stop.st}`}>{SEAL[stop.st]}</span>}
          {stop.who && <span className="who">{stop.who}</span>}
          <span className="more">詳細資訊 ›</span>
        </div>
      </button>
    </li>
  );
}

/** Read-only timeline used by the day page and by the admin's review preview. */
export function Timeline({ day, onOpen }: { day: Day; onOpen?: (s: Stop, arrive?: LinkedLeg) => void }) {
  const { legs, arrive } = useMemo(() => linkLegs(day), [day]);
  return (
    <ol className="tl">
      {day.items.map((it, i) =>
        isLeg(it) ? (
          <LegRow key={i} leg={legs.get(i)!} />
        ) : (
          <StopRow key={i} stop={it} onOpen={() => onOpen?.(it, arrive.get(i))} />
        ),
      )}
    </ol>
  );
}

export function DayView({ day, has, family, onOpen, wx }: { day: Day; has: boolean; family: Family; onOpen: (s: Stop, arrive?: LinkedLeg) => void; wx: WeatherState }) {
  const { trip } = useTrip();
  if (!has) {
    const shared = trip.days.filter((d) => !d.fam).sort((a, b) => isoOf(a.d).localeCompare(isoOf(b.d)));
    return (
      <section className="dayhead">
        <div className="meta">
          <span>{day.d}（{day.w}）</span>
          <span className="hotel">各家分開走</span>
        </div>
        <h2>行程待補</h2>
        <div className="pendingbox">
          <p>這天各家分開走，{family.label}的行程還沒放上來。</p>
          {shared.length > 0 && <p>{shared[0].d}–{shared[shared.length - 1].d} 是大家一起的行程，可以先看那幾天。</p>}
          <p>要補的話：到「上傳行程」傳表單或截圖，或直接跟「問 Claude」說。</p>
          <div className="actions">
            <a className="btn" href="#upload"><DownloadIcon />上傳行程</a>
            <button type="button" className="btn" onClick={openForm}><DownloadIcon />下載填寫表單</button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <>
      <section className="dayhead">
        <div className="meta">
          <span>{day.d}（{day.w}）</span>
          <span className="hotel">{day.hotel ? `住 ${day.hotel}` : "回台灣"}</span>
        </div>
        <h2>{day.title}</h2>
        <div className="actions">
          <a className="btn primary" href={dayRouteURL(day)} target="_blank" rel="noopener">
            <RouteIcon />開啟今天的 Google 地圖路線
          </a>
        </div>
        <DayWeatherPanel date={isoOf(day.d)} wx={wx} />
      </section>
      <Timeline day={day} onOpen={onOpen} />
    </>
  );
}
