import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { clearIntent, supabase, storedInvite } from "./supabase";
import type { ContactRow, Day, Family, FamilyId, InfoTab, Member, TodoRow } from "./data";

export interface TripData { families: Family[]; days: Day[]; todos: TodoRow[]; contacts: ContactRow[]; notes: Record<string, string>; info: InfoTab[] }
export type Phase = "noconfig" | "loading" | "signedout" | "join" | "ready" | "error";

interface Ctx {
  phase: Phase;
  error: string | null;
  session: Session | null;
  member: Member | null;
  trip: TripData;
  /** Which family's itinerary is on screen (admins can switch). */
  viewFam: FamilyId;
  setViewFam: (f: FamilyId) => void;
  invite: string | null;
  reload: () => Promise<void>;
  refreshMember: () => Promise<void>;
  signOut: () => Promise<void>;
}

const EMPTY: TripData = { families: [], days: [], todos: [], contacts: [], notes: {}, info: [] };
const TripContext = createContext<Ctx | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [memberChecked, setMemberChecked] = useState(false);
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

  // 2. which family this person belongs to
  const refreshMember = useCallback(async () => {
    const uid = session?.user.id;
    if (!supabase || !uid) { setMember(null); setMemberChecked(true); return; }
    const { data, error } = await supabase.from("members").select("user_id, email, family_id, role, name").eq("user_id", uid).maybeSingle();
    if (error) { setError(error.message); return; }
    setMember((data as Member | null) ?? null);
    setMemberChecked(true);
  }, [session]);
  useEffect(() => { if (authReady) { setMemberChecked(false); refreshMember(); } }, [authReady, refreshMember]);

  // 3. the itinerary this person is allowed to see (RLS does the filtering)
  const reload = useCallback(async () => {
    if (!supabase || !member) return;
    setError(null);
    const [f, d, x, t, c] = await Promise.all([
      supabase.from("families").select("id, name, label, flights").order("sort"),
      supabase.from("days").select("date_id, fam, d, w, city, title, hotel, items"),
      supabase.from("extras").select("key, data"),
      supabase.from("todos").select("id, fam, due, text, done, sort, created_at").order("sort").order("created_at"),
      supabase.from("contacts").select("id, fam, name, value, sort, created_at").order("sort").order("created_at"),
    ]);
    const err = f.error ?? d.error ?? x.error ?? t.error ?? c.error;
    if (err) { setError(err.message); return; }
    const extras = Object.fromEntries((x.data ?? []).map((e) => [e.key, e.data]));
    setTrip({
      families: (f.data ?? []) as Family[],
      days: (d.data ?? []).map((r) => ({ id: r.date_id, fam: r.fam, d: r.d, w: r.w, city: r.city, title: r.title, hotel: r.hotel, items: r.items })),
      todos: (t.data ?? []) as TodoRow[],
      contacts: (c.data ?? []) as ContactRow[],
      notes: extras.notes ?? {},
      info: Array.isArray(extras.info) ? extras.info : [],
    });
    setTripLoaded(true);
  }, [member]);
  useEffect(() => { if (member) { setTripLoaded(false); reload(); } }, [member, reload]);
  // Other people's changes: every 5 minutes (and when the page comes back into view) ask only "did anything change?"
  // with three tiny queries; do the full reload only when the answer is yes.
  const sigRef = useRef<string>("");
  const checkForChanges = useCallback(async () => {
    if (!supabase || !member || document.visibilityState !== "visible") return;
    const [d, t, c] = await Promise.all([
      supabase.from("days").select("date_id, fam, updated_at"),
      supabase.from("todos").select("id, done, text"),
      supabase.from("contacts").select("id, name, value"),
    ]);
    if (d.error || t.error || c.error) return;
    const sig = JSON.stringify([d.data, t.data, c.data]);
    if (sigRef.current && sig !== sigRef.current) await reload();
    sigRef.current = sig;
  }, [member, reload]);
  useEffect(() => {
    if (!member) return;
    sigRef.current = "";
    checkForChanges();
    const onVis = () => { if (document.visibilityState === "visible") checkForChanges(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const timer = setInterval(checkForChanges, 300_000);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); clearInterval(timer); };
  }, [member, checkForChanges]);

  const signOut = async () => {
    clearIntent();
    await supabase?.auth.signOut();
    setMember(null); setViewFam(null); setTrip(EMPTY); setTripLoaded(false);
  };

  const phase: Phase =
    !supabase ? "noconfig"
    : error ? "error"
    : !authReady ? "loading"
    : !session ? "signedout"
    : !memberChecked ? "loading"
    : !member ? "join"
    : !tripLoaded ? "loading"
    : "ready";

  return (
    <TripContext.Provider value={{
      phase, error, session, member, trip,
      viewFam: viewFam ?? member?.family_id ?? "lily",
      setViewFam, invite: storedInvite(), reload, refreshMember, signOut,
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
