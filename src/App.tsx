import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { daysFor, isoOf } from "./data";
import type { Day, FamilyId, Stop } from "./data";
import { useWeather } from "./useWeather";
import { ChipWeather } from "./components/Weather";
import { DayView } from "./components/DayView";
import { DetailSheet } from "./components/DetailSheet";
import { TodoView } from "./components/TodoView";
import { UploadView } from "./components/Upload";
import { ChatWidget } from "./components/Chat";
import { AddDay } from "./components/AddDay";
import { AllFamiliesDay } from "./components/AllFamiliesDay";
import { Login } from "./components/Login";
import { Join } from "./components/Join";
import { NotMember } from "./components/NotMember";
import { getIntent, storedInvite } from "./supabase";
import { useTrip } from "./trip";
import { useNow } from "./now";
import { useScrollEdges } from "./useScrollEdges";
import type { LinkedLeg } from "./maps";

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const PAGES = ["todo", "upload"];
function currentView(dayIds: string[], todayId?: string) {
  const h = location.hash.slice(1);
  if (PAGES.includes(h) || dayIds.includes(h)) return h;
  if (todayId && dayIds.includes(todayId)) return todayId; // during the trip, open on today
  const s = store.get("jp-day") ?? "";
  if (PAGES.includes(s) || dayIds.includes(s)) return s;
  return dayIds[0] ?? "todo";
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
  // Signed in but not a member: only someone who came through 用 Google 註冊 (or typed a valid code) sees the family picker
  const [joining, setJoining] = useState(() => getIntent() === "register" && !!storedInvite());
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
  if (phase === "join") return joining ? <Join /> : <NotMember onInvite={() => setJoining(true)} />;
  return <Main />;
}

function Main() {
  const { member, trip, viewFam, setViewFam, signOut } = useTrip();
  const fam = trip.families.find((f) => f.id === viewFam) ?? { id: viewFam, name: viewFam, label: viewFam, flights: [] };

  // "one" = this family's itinerary; "all" = every family side by side for the chosen date
  const [mode, setMode] = useState<"one" | "all">(() => (store.get("jp-mode") === "all" ? "all" : "one"));
  useEffect(() => { store.set("jp-mode", mode); }, [mode]);

  // The days this family sees (shared + its own); in "all" mode, every date any family has
  const famDays = useMemo(() => daysFor(trip.days, viewFam), [trip.days, viewFam]);
  const allDays = useMemo(() => {
    const byDate = new Map<string, Day>();
    for (const d of trip.days) { const cur = byDate.get(d.id); if (!cur || (cur.fam && !d.fam)) byDate.set(d.id, d); }
    return [...byDate.values()].sort((a, b) => isoOf(a.d).localeCompare(isoOf(b.d)));
  }, [trip.days]);
  const days = mode === "all" ? allDays : famDays;
  const dayIds = useMemo(() => days.map((d) => d.id), [days]);
  const route = useMemo(() => { const r: string[] = []; for (const d of famDays) if (r[r.length - 1] !== d.city) r.push(d.city); return r; }, [famDays]);
  const idsRef = useRef(dayIds);
  idsRef.current = dayIds;
  const now = useNow();
  const todayId = `d${now.date.slice(5, 7)}${now.date.slice(8, 10)}`;

  const [view, setView] = useState(() => currentView(dayIds, todayId));
  const [selected, setSelected] = useState<Selected | null>(null);
  const [adding, setAdding] = useState(false);
  const wx = useWeather();

  useEffect(() => {
    const onHash = () => { setSelected(null); setAdding(false); setView(currentView(idsRef.current)); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // If the viewed family changes (or a day is removed), keep the view valid
  useEffect(() => { if (!PAGES.includes(view) && !dayIds.includes(view)) setView(dayIds[0] ?? "todo"); }, [dayIds, view]);

  useEffect(() => {
    store.set("jp-day", view);
    document.querySelector(`nav.days [data-id="${view}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view, viewFam]);

  useEffect(() => { document.title = `${fam.label}・日本跨年行程`; }, [fam.label]);

  // Scroll affordance for the date strip: fades + arrows that disappear at the ends
  const { ref: navRef, edge, update: updateEdge, scrollBy: scrollDays } = useScrollEdges<HTMLElement>(dayIds);

  const close = useCallback(() => setSelected(null), []);
  const cur = days.find((d) => d.id === view);
  const first = famDays[0], last = famDays[famDays.length - 1];

  return (
    <>
      <div className="wrap">
        <header className="hero">
          <div className="fambar">
            <span className="fampill">{fam.label}</span>
            <select className="famselect" value={viewFam} aria-label="看哪一家的行程" onChange={(e) => setViewFam(e.target.value as FamilyId)}>
              {trip.families.map((f) => <option key={f.id} value={f.id}>看 {f.label}</option>)}
            </select>
            <span className="muted who-am-i">{member?.name ?? member?.email ?? "家人"}</span>
            <button type="button" className="link" onClick={signOut}>登出</button>
          </div>
          <div className="eyebrow">{first && last ? `${isoOf(first.d).replace(/-/g, ".")} — ${isoOf(last.d).replace(/-/g, ".")} ・ ${famDays.length} 天` : "日本跨年"}</div>
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
          <div className="quick">
            <a className="btn" href="#todo" aria-current={view === "todo" ? "page" : undefined}>✓ 待辦・聯絡</a>
            <a className="btn" href="#upload" aria-current={view === "upload" ? "page" : undefined}>↑ 上傳行程</a>
          </div>
        </header>

        <div className={`daysbar${edge.start ? " at-start" : ""}${edge.end ? " at-end" : ""}`}>
          <button type="button" className="scrollbtn left" onClick={() => scrollDays(-1)} aria-label="往前幾天" tabIndex={-1}>‹</button>
          <nav className="days" ref={navRef} onScroll={updateEdge} aria-label="選擇日期">
            {days.map((d) => (
              <a key={d.id} href={`#${d.id}`} data-id={d.id} className={[d.items.length === 0 ? "pending" : "", d.id === todayId ? "today" : ""].join(" ").trim() || undefined} aria-current={view === d.id ? "page" : undefined}>
                <span className="dd">{d.d}</span>
                <span className="dc">{d.w}・{d.city}</span>
                <ChipWeather date={isoOf(d.d)} city={d.city} wx={wx} />
              </a>
            ))}
            <button type="button" className="add" onClick={() => { setAdding(true); }} aria-expanded={adding}>
              <span className="dd">＋</span><span className="dc">加一天</span>
            </button>
          </nav>
          <button type="button" className="scrollbtn right" onClick={() => scrollDays(1)} aria-label="往後幾天" tabIndex={-1}>›</button>
        </div>

        <main>
          {!PAGES.includes(view) && (
            <div className="modebar" role="group" aria-label="顯示方式">
              <button type="button" className={mode === "one" ? "on" : ""} onClick={() => setMode("one")}>只看 {fam.label}</button>
              <button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>看所有家</button>
            </div>
          )}
          {adding && <AddDay family={fam} onDone={(id) => { setAdding(false); if (id) location.hash = `#${id}`; }} />}
          {view === "todo" ? <TodoView />
            : view === "upload" ? <UploadView />
            : cur && mode === "all" ? <AllFamiliesDay dateId={cur.id} onOpen={(day, stop, arrive) => setSelected({ day, stop, arrive })} />
            : cur ? <DayView day={cur} family={fam} wx={wx} onOpen={(stop, arrive) => setSelected({ day: cur, stop, arrive })} onRemoved={() => { location.hash = `#${dayIds.find((id) => id !== cur.id) ?? "todo"}`; }} />
            : !adding && <section className="dayhead"><h2>還沒有行程資料</h2><p className="note">管理員還沒把行程放進資料庫（`make seed`）。</p></section>}
        </main>
      </div>
      <ChatWidget />
      {selected && <DetailSheet {...selected} onClose={close} />}
    </>
  );
}
