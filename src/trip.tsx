import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { clearInvite, setStoredInvite, setStoredTrip, storedInvite, storedTrip, supabase } from "./supabase";
import { labelOf as labelIn } from "./data";
import type { ContactRow, Day, Family, FamilyId, InfoBlock, InfoPage, Member, Membership, TodoRow, Trip } from "./data";
import { setTimezone } from "./now";

export interface TripData { families: Family[]; days: Day[]; todos: TodoRow[]; contacts: ContactRow[]; notes: Record<string, string>; info: InfoPage[] }
/** signedout → (join: an invite code is waiting) → pick: choose/create/join a trip → ready: inside a trip */
export type Phase = "noconfig" | "loading" | "signedout" | "join" | "pick" | "ready" | "error";

interface Ctx {
  phase: Phase;
  error: string | null;
  session: Session | null;
  /** every trip this person belongs to */
  memberships: Membership[];
  /** the open trip and this person's row in it */
  current: Trip | null;
  member: Member | null;
  trip: TripData;
  /** Which family's itinerary is on screen. */
  viewFam: FamilyId;
  setViewFam: (f: FamilyId) => void;
  labelOf: (id: FamilyId) => string;
  /** pending invite code (from a #invite= link or typed in) */
  invite: string | null;
  setInvite: (code: string | null) => void;
  enterTrip: (id: string) => void;
  leaveToPicker: () => void;
  reload: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
  signOut: () => Promise<void>;
}

const EMPTY: TripData = { families: [], days: [], todos: [], contacts: [], notes: {}, info: [] };
const TripContext = createContext<Ctx | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [invite, setInviteState] = useState<string | null>(() => storedInvite());
  const [trip, setTrip] = useState<TripData>(EMPTY);
  const [tripLoaded, setTripLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewFam, setViewFam] = useState<FamilyId | null>(null);

  // 1. session (supabase-js also picks up the ?code= from the Google redirect; we then clean the URL)
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
      if (location.search.includes("code=")) history.replaceState(null, "", location.pathname + location.hash);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); setAuthReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 2. which trips this person is in
  const refreshMemberships = useCallback(async () => {
    const uid = session?.user.id;
    if (!supabase || !uid) { setMemberships([]); setMembershipsLoaded(true); return; }
    const { data, error } = await supabase.from("members")
      .select("trip_id, user_id, email, family_id, role, name, last_opened_at, trips(id, name, start_date, end_date, place, tz, settings, created_by, created_at)")
      .eq("user_id", uid);
    if (error) { setError(error.message); return; }
    const rows = ((data ?? []) as unknown as (Member & { trips: Trip | Trip[] | null })[])
      .map(({ trips, ...m }) => ({ ...m, trip: (Array.isArray(trips) ? trips[0] : trips) as Trip }))
      .filter((m) => !!m.trip)
      .sort((a, b) => (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? ""));
    setMemberships(rows);
    setMembershipsLoaded(true);
  }, [session]);
  useEffect(() => { if (authReady) { setMembershipsLoaded(false); refreshMemberships(); } }, [authReady, refreshMemberships]);

  // 3. which trip to open: the one this device was in last, else the most recently opened anywhere; none → picker
  useEffect(() => {
    if (!membershipsLoaded) return;
    if (currentId && memberships.some((m) => m.trip_id === currentId)) return;
    if (currentId) { setCurrentId(null); setStoredTrip(null); setPickerOpen(true); return; } // was removed from that trip
    if (pickerOpen) return;
    const remembered = storedTrip();
    const pick = (remembered && memberships.find((m) => m.trip_id === remembered)) ?? memberships[0];
    if (pick) setCurrentId(pick.trip_id);
  }, [membershipsLoaded, memberships, currentId, pickerOpen]);

  const current = useMemo(() => memberships.find((m) => m.trip_id === currentId)?.trip ?? null, [memberships, currentId]);
  const member = useMemo<Member | null>(() => {
    const m = memberships.find((x) => x.trip_id === currentId);
    return m ? { trip_id: m.trip_id, user_id: m.user_id, email: m.email, family_id: m.family_id, role: m.role, name: m.name, last_opened_at: m.last_opened_at } : null;
  }, [memberships, currentId]);
  useEffect(() => { setTimezone(current?.tz); }, [current?.tz]);

  const enterTrip = useCallback((id: string) => {
    setCurrentId(id); setStoredTrip(id); setPickerOpen(false); setViewFam(null); setTripLoaded(false);
    supabase?.rpc("open_trip", { p_trip: id }).then(() => { /* remembered server-side too */ }, () => { /* ignore */ });
    setMemberships((ms) => ms.map((m) => (m.trip_id === id ? { ...m, last_opened_at: new Date().toISOString() } : m)));
    if (location.hash.startsWith("#admin")) location.hash = "";
  }, []);
  const leaveToPicker = useCallback(() => { setPickerOpen(true); setCurrentId(null); setStoredTrip(null); setTrip(EMPTY); setTripLoaded(false); setViewFam(null); }, []);
  const setInvite = useCallback((code: string | null) => { if (code) setStoredInvite(code); else clearInvite(); setInviteState(code); }, []);

  // 4. the open trip's content (RLS limits it to trips this person is in)
  const reload = useCallback(async () => {
    if (!supabase || !current) return;
    setError(null);
    const id = current.id;
    const [f, d, x, t, c, ip] = await Promise.all([
      supabase.from("families").select("id, name, label, flights").eq("trip_id", id).order("sort"),
      supabase.from("days").select("date_id, fam, d, w, city, title, hotel, items").eq("trip_id", id),
      supabase.from("extras").select("key, data").eq("trip_id", id),
      supabase.from("todos").select("id, fam, due, text, done, sort, created_at").eq("trip_id", id).order("sort").order("created_at"),
      supabase.from("contacts").select("id, fam, name, value, sort, created_at").eq("trip_id", id).order("sort").order("created_at"),
      supabase.from("info_pages").select("id, title, body, blocks, sort, updated_at, updated_by_name").eq("trip_id", id).order("sort").order("updated_at"),
    ]);
    const err = f.error ?? d.error ?? x.error ?? t.error ?? c.error;
    if (err) { setError(err.message); return; }
    const extras = Object.fromEntries((x.data ?? []).map((e) => [e.key, e.data]));
    // 其他資訊：info_pages；資料庫還沒升級（沒有這張表）時退回舊的 extras.info
    const legacy: { id: string; title: string; updated?: string; blocks: InfoBlock[] }[] = Array.isArray(extras.info) ? extras.info : [];
    const info: InfoPage[] = ip.error
      ? legacy.map((t, i) => ({ id: t.id, title: t.title, body: "", blocks: t.blocks, sort: i, updated_at: t.updated ?? "", updated_by_name: null }))
      : (ip.data ?? []) as InfoPage[];
    setTrip({
      families: (f.data ?? []) as Family[],
      days: (d.data ?? []).map((r) => ({ id: r.date_id, fam: r.fam, d: r.d, w: r.w, city: r.city, title: r.title, hotel: r.hotel, items: r.items })),
      todos: (t.data ?? []) as TodoRow[],
      contacts: (c.data ?? []) as ContactRow[],
      notes: extras.notes ?? {},
      info,
    });
    setTripLoaded(true);
  }, [current]);
  useEffect(() => { if (current) { setTripLoaded(false); reload(); } }, [current, reload]);

  // Other people's changes: every 5 minutes (and when the page comes back into view) ask only "did anything change?"
  // with three tiny queries; do the full reload only when the answer is yes.
  const sigRef = useRef<string>("");
  const checkForChanges = useCallback(async () => {
    if (!supabase || !current || document.visibilityState !== "visible") return;
    const id = current.id;
    const [d, t, c, ip] = await Promise.all([
      supabase.from("days").select("date_id, fam, updated_at").eq("trip_id", id),
      supabase.from("todos").select("id, done, due, text").eq("trip_id", id),
      supabase.from("contacts").select("id, name, value").eq("trip_id", id),
      supabase.from("info_pages").select("id, updated_at").eq("trip_id", id),
    ]);
    if (d.error || t.error || c.error) return;
    const sig = JSON.stringify([d.data, t.data, c.data, ip.error ? null : ip.data]);
    if (sigRef.current && sig !== sigRef.current) await reload();
    sigRef.current = sig;
  }, [current, reload]);
  useEffect(() => {
    if (!current) return;
    sigRef.current = "";
    checkForChanges();
    const onVis = () => { if (document.visibilityState === "visible") checkForChanges(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const timer = setInterval(checkForChanges, 300_000);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); clearInterval(timer); };
  }, [current, checkForChanges]);

  const signOut = async () => {
    await supabase?.auth.signOut();
    setMemberships([]); setCurrentId(null); setPickerOpen(false); setViewFam(null); setTrip(EMPTY); setTripLoaded(false);
  };

  const phase: Phase =
    !supabase ? "noconfig"
    : error ? "error"
    : !authReady ? "loading"
    : !session ? "signedout"
    : invite ? "join"
    : !membershipsLoaded ? "loading"
    : !current ? (memberships.length === 0 || pickerOpen || !memberships.some((m) => m.trip_id === (storedTrip() ?? memberships[0]?.trip_id)) ? "pick" : "loading")
    : !tripLoaded ? "loading"
    : "ready";

  const families = trip.families;
  const labelOf = useCallback((id: FamilyId) => labelIn(families, id), [families]);

  return (
    <TripContext.Provider value={{
      phase, error, session, memberships, current, member, trip,
      viewFam: viewFam ?? member?.family_id ?? families[0]?.id ?? "",
      setViewFam, labelOf, invite, setInvite, enterTrip, leaveToPicker, reload, refreshMemberships, signOut,
    }}>
      {children}
    </TripContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTrip outside TripProvider");
  return ctx;
}
