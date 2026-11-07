import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export interface Member { email: string; family_id: string; role: "member" | "admin"; name: string | null }

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

/** The caller must be signed in and belong to a family. */
export async function requireMember(req: Request) {
  const { user, admin } = clients(req);
  const { data, error } = await user.auth.getUser();
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new HttpError(401, "請先登入");
  const { data: member } = await admin.from("members").select("email, family_id, role, name").eq("email", email).maybeSingle();
  if (!member) throw new HttpError(403, "你還沒加入任何一家，請用邀請連結加入");
  return { user, admin, member: member as Member, email };
}
