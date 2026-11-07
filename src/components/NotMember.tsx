import { useState } from "react";
import { setIntent, supabase } from "../supabase";
import { useTrip } from "../trip";

/** Signed in with Google but not a member: no itinerary, no join screen. Only a valid invite code moves them on. */
export function NotMember({ onInvite }: { onInvite: () => void }) {
  const { session, invite, signOut } = useTrip();
  const [code, setCode] = useState(invite ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const useCode = async () => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const c = code.trim();
    const { data: valid, error } = await supabase.rpc("invite_valid", { p_code: c });
    if (error || !valid) { setErr(error?.message ?? "邀請碼不對或已經用完，跟 Lily 家要一個新的連結。"); setBusy(false); return; }
    try { localStorage.setItem("jp-invite", c); } catch { /* ignore */ }
    setIntent("register");
    onInvite();
  };

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="eyebrow">{session?.user.email}</div>
        <h1>這個帳號還沒加入</h1>
        <p className="note">行程只給有邀請的家人看。請用家人傳給你的邀請連結，或在下面輸入邀請碼。</p>
      </header>
      <div className="joinform">
        <label>邀請碼<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例：abc123" autoCapitalize="none" autoCorrect="off" /></label>
        <button type="button" className="btn primary big" onClick={useCode} disabled={busy || !code.trim()}>{busy ? "檢查中…" : "用邀請碼加入"}</button>
        {err && <p className="err">{err}</p>}
        <button type="button" className="link" onClick={signOut}>登出，換一個帳號</button>
      </div>
    </div>
  );
}
