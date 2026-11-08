import { useEffect, useState } from "react";
import { setStoredInvite, supabase } from "../supabase";
import { dotDate } from "../data";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12S6.6 21.7 12 21.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
  </svg>
);

export interface InviteInfo { trip_id: string; name: string; start_date: string; end_date: string; place: string; role: "member" | "admin" | "viewer"; family_id: string | null; families: { id: string; label: string }[] }

/** Home page: Google sign-in. With an invite link the trip being joined is shown first. */
export function Login({ invite }: { invite: string | null }) {
  const [code, setCode] = useState(invite ?? "");
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !invite) { setInfo(null); return; }
    supabase.rpc("invite_valid", { p_code: invite }).then(({ data }) => setInfo((data as InviteInfo | null) ?? null));
  }, [invite]);

  const google = async () => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const c = code.trim();
    if (c) setStoredInvite(c); // used by the join screen after the redirect
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) { setErr(error.message); setBusy(false); }
  };

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="eyebrow">家庭旅行・一起排行程</div>
        <h1>我們的行程</h1>
        {invite && info === undefined && <p className="note">確認邀請中…</p>}
        {invite && info && <p className="note">你收到「<b>{info.name}</b>」（{dotDate(info.start_date)} — {dotDate(info.end_date)}）的邀請。用 Google 登入後選一下你是哪一家就加入了。</p>}
        {invite && info === null && <p className="note err">這個邀請連結不對或已經用完，跟邀請你的人再要一個。登入後也可以在下面重新輸入邀請碼。</p>}
        {!invite && <p className="note">行程只給同行的人看。用 Google 登入後，可以建立新行程，或用家人傳的邀請碼加入他們的行程。</p>}
      </header>
      <div className="joinform">
        <button type="button" className="btn primary big" onClick={google} disabled={busy}>
          <GoogleIcon />{busy ? "前往 Google…" : "用 Google 登入"}
        </button>
        {!invite && (
          <label>有邀請碼？先貼在這裡（可空）<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例：abc123" autoCapitalize="none" autoCorrect="off" /></label>
        )}
        {err && <p className="err">{err}</p>}
      </div>
    </div>
  );
}
