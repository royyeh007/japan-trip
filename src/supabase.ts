import { createClient } from "@supabase/supabase-js";
import type { FunctionsHttpError } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null when the .env / GitHub variables are not set yet; the app then shows a setup notice. */
export const supabase = url && key ? createClient(url, key) : null;

/** Call an Edge Function and surface its JSON `error` message as a thrown Error. */
export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase 還沒設定");
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const ctx = (error as FunctionsHttpError).context;
    let msg = error.message;
    try { const j = await ctx?.json(); if (j?.error) msg = j.error; } catch { /* not json */ }
    throw new Error(msg);
  }
  return data as T;
}

const INVITE_KEY = "jp-invite";

/** `#invite=CODE` in the URL: remember it for the join screen and take it out of the hash. Call before rendering. */
export function captureInvite() {
  const m = location.hash.match(/^#invite=([A-Za-z0-9_-]+)/);
  if (!m) return;
  try { localStorage.setItem(INVITE_KEY, m[1]); } catch { /* storage blocked */ }
  history.replaceState(null, "", location.pathname + location.search);
}
export function storedInvite() { try { return localStorage.getItem(INVITE_KEY); } catch { return null; } }
export function clearInvite() { try { localStorage.removeItem(INVITE_KEY); } catch { /* ignore */ } }
