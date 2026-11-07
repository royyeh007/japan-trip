import { Fragment, useMemo, useState } from "react";
import { isLeg, isoOf } from "../data";
import { DayWeatherPanel } from "./Weather";
import type { WeatherState } from "../useWeather";
import type { Day, Family, Stop } from "../data";
import { MODE, dayRouteURL, dirURL, linkLegs } from "../maps";
import type { LinkedLeg } from "../maps";
import { DownloadIcon, ModeIcon, RouteIcon } from "../icons";
import { KIND, SEAL } from "../labels";
import { openForm } from "../form";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { toMinutes, useNow } from "../now";

function LegRow({ leg, done }: { leg: LinkedLeg; done?: boolean }) {
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
    <li className={`leg${done ? " done" : ""}`}>
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

function StopRow({ stop, done, onOpen }: { stop: Stop; done?: boolean; onOpen: () => void }) {
  const sub = stop.s || stop.book?.[0] || stop.rec?.[0] || "";
  return (
    <li className={`stop${done ? " done" : ""}`}>
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

/** Read-only timeline used by the day page and by the proposal preview. On the current day it dims what is past and draws a "now" line. */
export function Timeline({ day, onOpen }: { day: Day; onOpen?: (s: Stop, arrive?: LinkedLeg) => void }) {
  const { legs, arrive } = useMemo(() => linkLegs(day), [day]);
  const now = useNow();
  const isToday = now.date === isoOf(day.d);
  // index of the last stop whose time has passed; the line goes right after it (-1 = before everything)
  let lastDone = -1;
  if (isToday) day.items.forEach((it, i) => { if (!isLeg(it) && toMinutes(it.t) <= now.minutes) lastDone = i; });
  const line = <li className="nowline" key="now" aria-label={`現在 ${now.hhmm}`}><span className="lbl">現在 {now.hhmm}</span></li>;
  return (
    <ol className="tl">
      {isToday && lastDone < 0 && line}
      {day.items.map((it, i) => (
        <Fragment key={i}>
          {isLeg(it) ? (
            <LegRow leg={legs.get(i)!} done={isToday && i <= lastDone} />
          ) : (
            <StopRow stop={it} done={isToday && i <= lastDone} onOpen={() => onOpen?.(it, arrive.get(i))} />
          )}
          {isToday && i === lastDone && line}
        </Fragment>
      ))}
    </ol>
  );
}

/** Remove this family from a day: delete the row if it is theirs alone, otherwise just drop them from `fam`. */
async function removeDay(day: Day, familyId: string) {
  if (!supabase || !day.fam) return;
  const rest = day.fam.filter((f) => f !== familyId);
  const q = supabase.from("days");
  const { error } = rest.length === 0
    ? await q.delete().eq("date_id", day.id).contains("fam", [familyId])
    : await q.update({ fam: rest }).eq("date_id", day.id).contains("fam", [familyId]);
  if (error) throw new Error(error.message);
}

export function DayView({ day, family, onOpen, onRemoved, wx }: { day: Day; family: Family; onOpen: (s: Stop, arrive?: LinkedLeg) => void; onRemoved: () => void; wx: WeatherState }) {
  const { trip, reload } = useTrip();
  const [busy, setBusy] = useState(false);
  const own = !!day.fam && day.fam.includes(family.id);
  const shared = !day.fam;
  const hasSharedVersion = trip.days.some((d) => d.id === day.id && !d.fam);
  const empty = day.items.length === 0;

  // Copy the shared day into this family's own version so they can change hotel, meals, times without touching the others
  const fork = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from("days").insert({ date_id: day.id, fam: [family.id], d: day.d, w: day.w, city: day.city, title: day.title, hotel: day.hotel, items: day.items });
    if (error) alert(error.message); else await reload();
    setBusy(false);
  };

  const remove = async () => {
    const msg = hasSharedVersion ? `要把 ${family.label}自己的 ${day.d} 版本刪掉，改回大家一起的版本嗎？` : `要把 ${day.d} 從${family.label}的行程拿掉嗎？`;
    if (!confirm(msg)) return;
    setBusy(true);
    try { await removeDay(day, family.id); await reload(); onRemoved(); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <section className="dayhead">
        <div className="meta">
          <span>{day.d}（{day.w}）</span>
          <span className="hotel">{day.hotel ? `住 ${day.hotel}` : ""}</span>
          <span className={`tag ${shared ? "shared" : "own"}`}>{shared ? "大家一起的版本" : `${family.label}自己的版本`}</span>
          {shared && <button type="button" className="link" onClick={fork} disabled={busy}>做一份我們家的版本</button>}
          {own && <button type="button" className="link" onClick={remove} disabled={busy}>{hasSharedVersion ? "改回大家一起的版本" : "刪除這天"}</button>}
        </div>
        <h2>{day.title}</h2>
        {!empty && (
          <div className="actions">
            <a className="btn primary" href={dayRouteURL(day)} target="_blank" rel="noopener">
              <RouteIcon />開啟今天的 Google 地圖路線
            </a>
          </div>
        )}
        <DayWeatherPanel date={isoOf(day.d)} city={day.city} wx={wx} />
      </section>
      {empty ? (
        <div className="pendingbox">
          <p>這天還沒有行程。</p>
          <p>到「上傳行程」傳表單或截圖，或點右下角「問 Claude」直接說這天要做什麼，確認後就會出現在這裡。</p>
          <div className="actions">
            <a className="btn" href="#upload"><DownloadIcon />上傳行程</a>
            <button type="button" className="btn" onClick={openForm}><DownloadIcon />下載填寫表單</button>
          </div>
        </div>
      ) : (
        <Timeline day={day} onOpen={onOpen} />
      )}
    </>
  );
}
