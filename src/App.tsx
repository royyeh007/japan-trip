import { useCallback, useEffect, useMemo, useState } from "react";
import { DATE_IDS, daysFor, isoOf } from "./data";
import type { Day, FamilyId, Stop } from "./data";
import { useWeather } from "./useWeather";
import { ChipWeather } from "./components/Weather";
import { DayView } from "./components/DayView";
import { DetailSheet } from "./components/DetailSheet";
import { TodoView } from "./components/TodoView";
import { UploadView } from "./components/Upload";
import { Chat } from "./components/Chat";
import { Login } from "./components/Login";
import { Join } from "./components/Join";
import { useTrip } from "./trip";
import type { LinkedLeg } from "./maps";

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const PAGES = ["todo", "upload", "chat"];
function currentView() {
  const h = location.hash.slice(1) || store.get("jp-day") || "";
  if (PAGES.includes(h) || (DATE_IDS as readonly string[]).includes(h)) return h;
  return DATE_IDS[0];
}

export interface Selected { day: Day; stop: Stop; arrive?: LinkedLeg }

function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="wrap pick">
      <header className="hero"><h1>{title}</h1></header>
      <div className="notice">{children}</div>
    </div>
  );
}

export default function App() {
  const { phase, error, invite, signOut, reload } = useTrip();
  if (phase === "noconfig") {
    return (
      <Notice title="還沒接上 Supabase">
        <p>本機請在 <code>.env.local</code> 填 <code>VITE_SUPABASE_URL</code> 和 <code>VITE_SUPABASE_ANON_KEY</code>；GitHub Pages 請在 repo 的 Variables 設同名變數。做法在 SETUP.md。</p>
      </Notice>
    );
  }
  if (phase === "error") {
    return (
      <Notice title="讀不到資料">
        <p className="err">{error}</p>
        <div className="actions"><button type="button" className="btn primary" onClick={reload}>再試一次</button><button type="button" className="btn" onClick={signOut}>登出</button></div>
      </Notice>
    );
  }
  if (phase === "loading") return <Notice title="載入中…" />;
  if (phase === "signedout") return <Login invite={invite} />;
  if (phase === "join") return <Join />;
  return <Main />;
}

function Main() {
  const { member, trip, viewFam, setViewFam, signOut } = useTrip();
  const [view, setView] = useState(currentView);
  const [selected, setSelected] = useState<Selected | null>(null);
  const wx = useWeather();
  const fam = trip.families.find((f) => f.id === viewFam) ?? { id: viewFam, name: viewFam, label: viewFam, flights: [] };

  useEffect(() => {
    const onHash = () => { setSelected(null); setView(currentView()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    store.set("jp-day", view);
    document.querySelector(`nav.days a[data-id="${view}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view, viewFam]);

  useEffect(() => { document.title = `${fam.label}・日本跨年行程`; }, [fam.label]);

  // This family's day list (one per date), the days it actually has, and the city route built from them
  const { days, own, route } = useMemo(() => {
    const days = daysFor(trip.days, viewFam);
    const own = days.filter((x) => x.has).map((x) => x.day);
    const route: string[] = [];
    for (const d of own) if (route[route.length - 1] !== d.city) route.push(d.city);
    return { days, own, route };
  }, [trip.days, viewFam]);

  const close = useCallback(() => setSelected(null), []);
  const cur = days.find((x) => x.day.id === view);
  const isPage = PAGES.includes(view);

  return (
    <>
      <div className="wrap">
        <header className="hero">
          <div className="fambar">
            <span className="fampill">{fam.label}</span>
            <select className="famselect" value={viewFam} aria-label="看哪一家的行程" onChange={(e) => setViewFam(e.target.value as FamilyId)}>
              {trip.families.map((f) => <option key={f.id} value={f.id}>看 {f.label}</option>)}
            </select>
            <span className="muted who-am-i">{member?.name ?? member?.email}</span>
            <button type="button" className="link" onClick={signOut}>登出</button>
          </div>
          <div className="eyebrow">
            2026.12.26 — 2027.1.2 ・ {own.length === days.length && days.length > 0 ? `${days.length} 天 ${days.length - 1} 夜` : `目前有 ${own.length} 天行程`}
          </div>
          <h1>日本跨年行程</h1>
          <div className="route">
            {route.map((c, i) => (
              <span key={i}>{i > 0 && <i>→ </i>}{c}</span>
            ))}
          </div>
          <div className="flights">
            {fam.flights.length > 0
              ? fam.flights.map((f) => <span key={f} className="flight">{f}</span>)
              : <span className="flight muted">去回航班待補</span>}
            {trip.notes.shared && <span className="flight">{trip.notes.shared}</span>}
          </div>
        </header>

        <nav className="days" aria-label="選擇頁面">
          {days.map(({ day: d, has }) => (
            <a key={d.id} href={`#${d.id}`} data-id={d.id} className={has ? undefined : "pending"} aria-current={view === d.id ? "page" : undefined}>
              <span className="dd">{d.d}</span>
              <span className="dc">{d.w}・{has ? d.city : "待補"}</span>
              {has && <ChipWeather date={isoOf(d.d)} wx={wx} />}
            </a>
          ))}
          <a href="#todo" data-id="todo" className="list" aria-current={view === "todo" ? "page" : undefined}>
            <span className="dd">✓</span><span className="dc">待辦・聯絡</span>
          </a>
          <a href="#upload" data-id="upload" className="list" aria-current={view === "upload" ? "page" : undefined}>
            <span className="dd">↑</span><span className="dc">上傳行程</span>
          </a>
          <a href="#chat" data-id="chat" className="list" aria-current={view === "chat" ? "page" : undefined}>
            <span className="dd">✦</span><span className="dc">問 Claude</span>
          </a>
        </nav>

        <main>
          {view === "todo" ? <TodoView />
            : view === "upload" ? <UploadView />
            : view === "chat" ? <Chat />
            : cur ? <DayView day={cur.day} has={cur.has} family={fam} wx={wx} onOpen={(stop, arrive) => setSelected({ day: cur.day, stop, arrive })} />
            : !isPage && <section className="dayhead"><h2>還沒有行程資料</h2><p className="note">管理員還沒把行程放進資料庫（`make seed`）。</p></section>}
        </main>
      </div>
      {selected && <DetailSheet {...selected} onClose={close} />}
    </>
  );
}
