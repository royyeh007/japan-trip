import { PLACES, describe, placesFor, roleOf } from "../weather";
import type { DayWeather, WIcon } from "../weather";
import type { WeatherState } from "../useWeather";

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const cloud = "M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11.2 3.5 3.5 0 0 0 7 18z";

export function WxIcon({ icon }: { icon: WIcon }) {
  switch (icon) {
    case "sun":
      return <svg {...base} className="wx-i sun"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case "partly":
      return <svg {...base} className="wx-i partly"><path d="M9 3v1.5M3.6 5.6l1 1M2 11h1.5M13.4 5.6l-1 1" /><path d="M5.6 10.6A4 4 0 0 1 12.8 8" /><path d={cloud} transform="translate(2 1) scale(.9)" /></svg>;
    case "cloud":
      return <svg {...base} className="wx-i cloud"><path d={cloud} /></svg>;
    case "fog":
      return <svg {...base} className="wx-i cloud"><path d="M4 9h16M3 13h18M5 17h14" /></svg>;
    case "rain":
      return <svg {...base} className="wx-i rain"><path d={cloud} transform="translate(0 -3)" /><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2" /></svg>;
    case "snow":
      return <svg {...base} className="wx-i snow"><path d={cloud} transform="translate(0 -3)" /><path d="M8 19.5h.01M12 21h.01M16 19.5h.01M10 22h.01M14 22.5h.01" strokeWidth="2.6" /></svg>;
    default:
      return <svg {...base} className="wx-i rain"><path d={cloud} transform="translate(0 -3)" /><path d="M13 16l-2 3h3l-2 3" /></svg>;
  }
}

const r = (n: number) => Math.round(n);

function Line({ w }: { w: DayWeather }) {
  const { label } = describe(w.code);
  if (w.kind === "forecast") {
    return (
      <>
        <span className="wx-l">{label}</span>
        <span className="wx-t"><b>{r(w.max)}°</b> / {r(w.min)}°</span>
        <span className="wx-xs">
          {w.pop != null && <span className="wx-x">降雨機率 {w.pop}%</span>}
          {w.snow != null && w.snow > 0 && <span className="wx-x">預計降雪 {w.snow.toFixed(1)} cm</span>}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="wx-l">多半{label}</span>
      <span className="wx-t"><b>{r(w.max)}°</b> / {r(w.min)}°</span>
      <span className="wx-xs">
        {w.pop != null && <span className="wx-x">往年有 {w.pop}% 的日子下雨或下雪</span>}
        {w.snow != null && w.snow > 0 && <span className="wx-x">{w.snow}% 的日子下雪</span>}
      </span>
    </>
  );
}

export function DayWeatherPanel({ date, city, wx }: { date: string; city: string; wx: WeatherState }) {
  const keys = placesFor(date, city);
  if (keys.length === 0) return null;
  const day = wx.data?.[date] ?? {};
  const anyForecast = keys.some((k) => day[k]?.kind === "forecast");
  const updated = wx.updatedAt ? new Date(wx.updatedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <section className="wx" aria-label="天氣">
      <div className="wx-head">
        <span className={`wx-tag ${anyForecast ? "live" : ""}`}>{anyForecast ? "天氣預報" : "往年同日平均"}</span>
        <span className="wx-note">
          {anyForecast
            ? `每 30 分鐘自動更新${updated ? `・更新於 ${updated}` : ""}`
            : "2016–2025 年同一天的平均；出發前約 16 天會自動換成正式預報"}
        </span>
      </div>
      <div className="wx-rows">
        {keys.map((k, i) => {
          const place = PLACES.find((p) => p.key === k)!;
          const w = day[k];
          return (
            <div className="wx-row" key={k}>
              {w ? <WxIcon icon={describe(w.code).icon} /> : <span className="wx-i" />}
              <span className="wx-p"><small>{roleOf(keys.length, i)}</small>{place.name}</span>
              {w ? <Line w={w} /> : <span className="wx-x wx-xs">{wx.loading ? "載入中…" : "天氣資料暫時抓不到，稍後會自動重試"}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Tiny summary for the date chips: first place's icon + high/low. */
export function ChipWeather({ date, city, wx }: { date: string; city: string; wx: WeatherState }) {
  const keys = placesFor(date, city);
  const k = keys[keys.length - 1];
  const w = k ? wx.data?.[date]?.[k] : undefined;
  if (!w) return null;
  return (
    <span className="dw">
      <WxIcon icon={describe(w.code).icon} />
      {r(w.max)}°/{r(w.min)}°
    </span>
  );
}
