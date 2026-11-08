import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export interface Member { trip_id: string; user_id: string; email: string | null; family_id: string; role: "member" | "admin" | "viewer"; name: string | null }
export interface Trip { id: string; name: string; start_date: string; end_date: string; place: string; tz: string; settings: Record<string, unknown> }

/** Two clients: `user` runs under the caller's JWT (RLS applies); `admin` uses the service role (bypasses RLS). */
export function clients(req: Request) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";
  const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { user, admin };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The caller must be signed in and belong to the trip named in the request body (`trip_id`). Returns the trip too.
 * `editor: true` also rejects viewers (觀察員：只能看，不能改行程、上傳或用聊天機器人).
 */
export async function requireMember(req: Request, body: { trip_id?: string }, opts: { editor?: boolean } = {}) {
  const { user, admin } = clients(req);
  const { data, error } = await user.auth.getUser();
  const u = data?.user;
  if (error || !u) throw new HttpError(401, "請先登入");
  const tripId = body.trip_id;
  if (!tripId || !UUID_RE.test(tripId)) throw new HttpError(400, "缺 trip_id");
  const [{ data: member }, { data: trip }] = await Promise.all([
    admin.from("members").select("trip_id, user_id, email, family_id, role, name").eq("trip_id", tripId).eq("user_id", u.id).maybeSingle(),
    admin.from("trips").select("id, name, start_date, end_date, place, tz, settings").eq("id", tripId).maybeSingle(),
  ]);
  if (!trip) throw new HttpError(404, "沒有這個行程");
  if (!member) throw new HttpError(403, "你不在這個行程裡");
  const m = member as Member;
  if (opts.editor && m.role === "viewer") throw new HttpError(403, "觀察員只能看行程，不能用這個功能");
  return { user, admin, member: m, trip: trip as Trip, uid: u.id, who: m.name ?? m.email ?? "成員" };
}
