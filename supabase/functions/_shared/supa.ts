import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export interface Member { user_id: string; email: string | null; family_id: string; role: "member" | "admin"; name: string | null }

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

/** The caller must be signed in (anonymous via invite link, or Google) and belong to a family. */
export async function requireMember(req: Request) {
  const { user, admin } = clients(req);
  const { data, error } = await user.auth.getUser();
  const u = data?.user;
  if (error || !u) throw new HttpError(401, "請先登入");
  const { data: member } = await admin.from("members").select("user_id, email, family_id, role, name").eq("user_id", u.id).maybeSingle();
  if (!member) throw new HttpError(403, "你還沒加入任何一家，請用邀請連結加入");
  const m = member as Member;
  return { user, admin, member: m, uid: u.id, who: m.name ?? m.email ?? "家人" };
}
