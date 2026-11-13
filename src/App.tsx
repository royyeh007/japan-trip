import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { daysFor, dotDate, isViewer } from "./data";
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
import { FlightStatus } from "./components/FlightStatus";
import { InfoView } from "./components/InfoView";
import { Lightbox } from "./md";
import { AdminView } from "./components/AdminView";
import { Overview } from "./components/Overview";
import { GuideView } from "./components/GuideView";
import { CardsView } from "./components/CardsView";
import { QuickPickFab } from "./components/QuickPick";
import { Login } from "./components/Login";
import { JoinTrip } from "./components/JoinTrip";
import { TripPicker } from "./components/TripPicker";
import { supabase } from "./supabase";
import { useTrip } from "./trip";
import { endPreview, fakeNow, setNowLine, startPreview, useNow, useNowLine } from "./now";
import { useScrollEdges } from "./useScrollEdges";
import type { LinkedLeg } from "./maps";

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const PAGES = ["overview", "todo", "upload", "info", "cards", "admin", "guide"];
function currentView(dayIds: string[], dayKey: string, todayId?: string) {
  const h = location.hash.slice(1);
  if (PAGES.includes(h) || dayIds.includes(h)) return h;
  if (todayId && dayIds.includes(todayId)) return todayId; // during the trip, open on today
  const s = store.get(dayKey) ?? "";
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
  const { phase, error, invite, setInvite, signOut, reload, refreshMemberships, enterTrip } = useTrip();
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
        <div className="actions"><button type="button" className="btn primary" onClick={() => { refreshMemberships(); reload(); }}>再試一次</button><button type="button" className="btn" onClick={signOut}>登出</button></div>
      </Notice>
    );
  }
  if (phase === "loading") return <Notice title="載入中…" />;
  if (phase === "signedout") return <Login invite={invite} />;
  if (phase === "join" && invite) {
    return <JoinTrip code={invite} onDone={async (tripId) => { setInvite(null); await refreshMemberships(); enterTrip(tripId); }} onCancel={() => setInvite(null)} />;
  }
  if (phase === "pick") return <TripPicker />;
  return <Main />;
}

/** Leaving a trip: explain the consequence and require typing "delete" before the button works. */
function LeaveDialog({ onClose }: { onClose: () => void }) {
  const { current, leaveToPicker, refreshMemberships } = useTrip();
  const [text, setText] = useState("");
  const [alone, setAlone] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase || !current) return;
    supabase.from("members").select("user_id", { count: "exact", head: true }).eq("trip_id", current.id).then(({ count }) => setAlone(count === 1));
  }, [current]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ok = text.trim().toLowerCase() === "delete";
  const go = async () => {
    if (!supabase || !current || !ok) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("leave_trip", { p_trip: current.id });
    if (error) { setErr(error.message); setBusy(false); return; }
    await refreshMemberships();
    leaveToPicker();
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title">
        <h3 id="leave-title">退出「{current?.name}」</h3>
        <p className="note">
          {alone === null ? "確認中…" : alone
            ? "你是這個行程裡唯一的人，退出會把整個行程連同所有資料刪掉，無法復原。"
            : "退出後就看不到這個行程了，之後要再用邀請連結才能回來。你的備註和已經確認的行程會留著。"}
        </p>
        <label>請輸入 <code>delete</code> 確認
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="delete" autoCapitalize="none" autoCorrect="off" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && ok) go(); }} />
        </label>
        <div className="actions">
          <button type="button" className="btn danger" onClick={go} disabled={!ok || busy || alone === null}>{busy ? "處理中…" : alone ? "確認退出並刪除行程" : "確認退出"}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
    </>
  );
}

/** The account menu in the hero: switch trip, admin, rename, leave, sign out. */
function TripMenu() {
  const { current, member, leaveToPicker, refreshMemberships, signOut } = useTrip();
  const ref = useRef<HTMLDetailsElement>(null);
  const [leaving, setLeaving] = useState(false);
  const close = () => { if (ref.current) ref.current.open = false; };
  useEffect(() => {
    const open = () => { if (ref.current) { ref.current.open = true; ref.current.scrollIntoView({ block: "center", behavior: "smooth" }); } };
    window.addEventListener("jp-open-menu", open);
    return () => window.removeEventListener("jp-open-menu", open);
  }, []);
  const rename = async () => {
    if (!supabase || !current) return;
    const name = prompt("你在這個行程裡顯示的名字", member?.name ?? "");
    if (name === null) return;
    const { error } = await supabase.rpc("set_my_name", { p_trip: current.id, p_name: name });
    if (error) alert(error.message); else await refreshMemberships();
    close();
  };
  const leave = () => { close(); setLeaving(true); };
  const short = (member?.name ?? member?.email?.split("@")[0] ?? "我").split(/\s+/)[0];
  return (
    <>
    {leaving && <LeaveDialog onClose={() => setLeaving(false)} />}
    <details className="menu" ref={ref}>
      <summary aria-label="帳號與行程選單" title="切換行程、管理、登出">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        <span className="mname">{short}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <div className="list">
        <small>{member?.name ?? member?.email}</small>
        <button type="button" onClick={() => { close(); leaveToPicker(); }}>切換行程</button>
        {member?.role === "admin" && <a href="#admin" onClick={close}>管理行程</a>}
        <a href="#cards" onClick={close}>我的信用卡</a>
        <a href="#guide" onClick={close}>使用教學</a>
        <button type="button" onClick={rename}>改我的名字</button>
        <button type="button" className="danger" onClick={leave}>退出這個行程</button>
        <button type="button" onClick={signOut}>登出</button>
      </div>
    </details>
    </>
  );
}

function Main() {
  const { member, current, trip, viewFam, setViewFam } = useTrip();
  const fam = trip.families.find((f) => f.id === viewFam) ?? { id: viewFam, name: viewFam, label: viewFam || "我們家", flights: [] };
  const tripId = current?.id ?? "";
  const dayKey = `jp-day:${tripId}`;

  // "one" = this family's itinerary; "all" = every family side by side. Always starts on "one" so people land on their own itinerary.
  const [mode, setMode] = useState<"one" | "all">("one");

  // The days this family sees (shared + its own); in "all" mode, every date any family has
  const famDays = useMemo(() => daysFor(trip.days, viewFam), [trip.days, viewFam]);
  const allDays = useMemo(() => {
    const byDate = new Map<string, Day>();
    for (const d of trip.days) { const cur = byDate.get(d.id); if (!cur || (cur.fam && !d.fam)) byDate.set(d.id, d); }
    return [...byDate.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [trip.days]);
  const days = mode === "all" ? allDays : famDays;
  // In "one" mode, other families' own versions are not shown; say so
  const othersOwn = useMemo(() => {
    const m = new Map<string, Day[]>();
    for (const d of trip.days) {
      if (!d.fam || d.fam.includes(viewFam)) continue;
      for (const f of d.fam) { const arr = m.get(f) ?? []; if (!arr.some((x) => x.id === d.id)) arr.push(d); m.set(f, arr); }
    }
    return [...m.entries()].map(([f, ds]) => ({ f, ds: ds.sort((a, b) => a.id.localeCompare(b.id)).map((d) => d.d) }));
  }, [trip.days, viewFam]);
  const dayIds = useMemo(() => days.map((d) => d.id), [days]);
  const route = useMemo(() => { const r: string[] = []; for (const d of famDays) if (r[r.length - 1] !== d.city) r.push(d.city); return r; }, [famDays]);
  const idsRef = useRef(dayIds);
  idsRef.current = dayIds;
  const now = useNow();
  const nowLine = useNowLine();
  const todayId = now.date;

  const [view, setView] = useState(() => currentView(dayIds, dayKey, todayId));
  const [selected, setSelected] = useState<Selected | null>(null);
  const [adding, setAdding] = useState(false);
  const wx = useWeather(current, trip.days);

  useEffect(() => {
    const onHash = () => { setSelected(null); setAdding(false); setView(currentView(idsRef.current, dayKey)); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [dayKey]);
  useEffect(() => {
    const onAdd = () => { const first = idsRef.current[0]; if (first && location.hash !== `#${first}`) location.hash = `#${first}`; setTimeout(() => setAdding(true), 0); };
    window.addEventListener("jp-add-day", onAdd);
    return () => window.removeEventListener("jp-add-day", onAdd);
  }, []);
  // If the viewed family changes (or a day is removed), keep the view valid
  useEffect(() => { if (!PAGES.includes(view) && !dayIds.includes(view)) setView(dayIds[0] ?? "todo"); }, [dayIds, view]);

  useEffect(() => {
    store.set(dayKey, view);
    document.querySelector(`nav.days [data-id="${view}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view, viewFam, dayKey]);

  useEffect(() => { document.title = `${fam.label}・${current?.name ?? "行程"}`; }, [fam.label, current?.name]);

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
              {[...trip.families].sort((a, b) => (a.id === member?.family_id ? -1 : b.id === member?.family_id ? 1 : 0)).map((f) => <option key={f.id} value={f.id}>{f.id === member?.family_id ? `看我們家（${f.label}）` : `看 ${f.label}`}</option>)}
            </select>
            <TripMenu />
          </div>
          <div className="eyebrow">
            {first && last ? `${dotDate(first.id)} — ${dotDate(last.id)} ・ ${famDays.length} 天` : current ? `${dotDate(current.start_date)} — ${dotDate(current.end_date)}` : ""}
            {current?.place && ` ・ ${current.place}`}
          </div>
          <h1>{current?.name ?? "行程"}</h1>
          {route.length > 0 && (
            <div className="route">
              {route.map((c, i) => (
                <span key={i}>{i > 0 && <i>→ </i>}{c}</span>
              ))}
            </div>
          )}
          <div className="flights">
            {fam.flights.length > 0
              ? fam.flights.map((f) => <span key={f} className="flight">{f}</span>)
              : <span className="flight muted">去回航班待補</span>}
            {trip.notes.shared && <span className="flight">{trip.notes.shared}</span>}
          </div>
          {fam.flights.length > 0 && (
            <div className="flightlive">
              {fam.flights.map((f) => <FlightStatus key={f} text={f} />)}
            </div>
          )}
          <div className="quick">
            <a className="btn" href="#overview" aria-current={view === "overview" ? "page" : undefined}>☷ 總覽</a>
            <a className="btn" href="#todo" aria-current={view === "todo" ? "page" : undefined}>✓ 待辦・聯絡</a>
            {!isViewer(member) && <a className="btn" href="#upload" aria-current={view === "upload" ? "page" : undefined}>↑ 上傳行程</a>}
            {(trip.info.length > 0 || !isViewer(member)) && <a className="btn" href="#info" aria-current={view === "info" ? "page" : undefined}>ⓘ 其他資訊</a>}
            <a className="btn" href="#cards" aria-current={view === "cards" ? "page" : undefined}>💳 信用卡</a>
            {member?.role === "admin" && <a className="btn" href="#admin" aria-current={view === "admin" ? "page" : undefined}>⚙ 管理</a>}
          </div>
        </header>

        <div className={`daysbar${edge.start ? " at-start" : ""}${edge.end ? " at-end" : ""}`}>
          <button type="button" className="scrollbtn left" onClick={() => scrollDays(-1)} aria-label="往前幾天" tabIndex={-1}>‹</button>
          <nav className="days" ref={navRef} onScroll={updateEdge} aria-label="選擇日期">
            {days.map((d) => (
              <a key={d.id} href={`#${d.id}`} data-id={d.id} className={[d.items.length === 0 ? "pending" : "", d.id === todayId ? "today" : ""].join(" ").trim() || undefined} aria-current={view === d.id ? "page" : undefined}>
                <span className="dd">{d.d}</span>
                <span className="dc">{d.w}・{d.city}</span>
                <ChipWeather date={d.id} city={d.city} wx={wx} />
              </a>
            ))}
            {!isViewer(member) && (
              <button type="button" className="add" onClick={() => { setAdding(true); }} aria-expanded={adding}>
                <span className="dd">＋</span><span className="dc">加一天</span>
              </button>
            )}
          </nav>
          <button type="button" className="scrollbtn right" onClick={() => scrollDays(1)} aria-label="往後幾天" tabIndex={-1}>›</button>
        </div>

        <main>
          {fakeNow() && (
            <div className="previewbar">
              <span>預覽模式：假裝現在是 {now.date.slice(5).replace("-", "/")} {now.hhmm}（當地時間）</span>
              <button type="button" className="btn" onClick={endPreview}>結束預覽</button>
            </div>
          )}
          {!PAGES.includes(view) && (
            <div className="toolbar">
              <div className="modebar" role="group" aria-label="顯示方式">
                <button type="button" className={mode === "one" ? "on" : ""} onClick={() => setMode("one")}>只看 {fam.label}</button>
                <button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>看所有家</button>
              </div>
              <div className="nowctl">
                <label className="switch" title="旅行當天打開時，行程上會有一條標示現在時間的線">
                  <input type="checkbox" checked={nowLine} onChange={(e) => setNowLine(e.target.checked)} />
                  <span className="track" aria-hidden="true" />
                  <span>「現在」的線</span>
                </label>
                {nowLine && !fakeNow() && cur && todayId !== cur.id && (
                  <button type="button" className="link" onClick={() => startPreview(cur.id, now.hhmm, `#${cur.id}`)}>旅行當天才會出現・預覽</button>
                )}
              </div>
            </div>
          )}
          {!PAGES.includes(view) && mode === "one" && othersOwn.length > 0 && (
            <p className="note othersown">
              {othersOwn.map(({ f, ds }) => `${trip.families.find((x) => x.id === f)?.label ?? f}在 ${ds.join("、")} 有自己的版本`).join("；")}。
              <button type="button" className="link" onClick={() => setMode("all")}>看所有家</button>
            </p>
          )}
          {adding && <AddDay family={fam} onDone={(id) => { setAdding(false); if (id) location.hash = `#${id}`; }} />}
          {view === "overview" ? <Overview onOpen={(day, stop, arrive) => setSelected({ day, stop, arrive })} />
            : view === "todo" ? <TodoView />
            : view === "upload" ? <UploadView />
            : view === "info" ? <InfoView />
            : view === "cards" ? <CardsView />
            : view === "admin" ? <AdminView />
            : view === "guide" ? <GuideView role={member?.role ?? "member"} />
            : cur && mode === "all" ? <AllFamiliesDay dateId={cur.id} onOpen={(day, stop, arrive) => setSelected({ day, stop, arrive })} />
            : cur ? <DayView day={cur} family={fam} wx={wx} onOpen={(stop, arrive) => setSelected({ day: cur, stop, arrive })} onRemoved={() => { location.hash = `#${dayIds.find((id) => id !== cur.id) ?? "todo"}`; }} />
            : !adding && (
              <section className="dayhead">
                <h2>還沒有行程</h2>
                <p className="note">{isViewer(member) ? "這個行程還沒有內容。" : "按日期列的「＋ 加一天」先把日期加進來，再用「上傳行程」或右下角「AI 助理」把內容補上。"}</p>
              </section>
            )}
        </main>
      </div>
      {!isViewer(member) && <ChatWidget />}
      <QuickPickFab />
      {selected && <DetailSheet {...selected} onClose={close} />}
      <Lightbox />
    </>
  );
}
