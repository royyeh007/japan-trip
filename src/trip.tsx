import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { clearIntent, supabase, storedInvite } from "./supabase";
import type { Contact, Day, Family, FamilyId, Member, TodoItem } from "./data";

export interface TripData { families: Family[]; days: Day[]; todo: TodoItem[]; contacts: Contact[]; notes: Record<string, string> }
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

const EMPTY: TripData = { families: [], days: [], todo: [], contacts: [], notes: {} };
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
    const [f, d, x] = await Promise.all([
      supabase.from("families").select("id, name, label, flights").order("sort"),
      supabase.from("days").select("date_id, fam, d, w, city, title, hotel, items"),
      supabase.from("extras").select("key, data"),
    ]);
    const err = f.error ?? d.error ?? x.error;
    if (err) { setError(err.message); return; }
    const extras = Object.fromEntries((x.data ?? []).map((e) => [e.key, e.data]));
    setTrip({
      families: (f.data ?? []) as Family[],
      days: (d.data ?? []).map((r) => ({ id: r.date_id, fam: r.fam, d: r.d, w: r.w, city: r.city, title: r.title, hotel: r.hotel, items: r.items })),
      todo: extras.todo ?? [],
      contacts: extras.contacts ?? [],
      notes: extras.notes ?? {},
    });
    setTripLoaded(true);
  }, [member]);
  useEffect(() => { if (member) { setTripLoaded(false); reload(); } }, [member, reload]);

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
