import { useState } from "react";
import { supabase } from "../supabase";

const GOOGLE = import.meta.env.VITE_GOOGLE_LOGIN === "1";

export function Login({ invite }: { invite: string | null }) {
  const [code, setCode] = useState(invite ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 邀請連結進入：先匿名登入，下一個畫面選家庭時才會用邀請碼
  const enter = async () => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    try { localStorage.setItem("jp-invite", code.trim()); } catch { /* ignore */ }
    const { error } = await supabase.auth.signInAnonymously();
    if (error) { setErr(error.message); setBusy(false); }
  };
  const google = async () => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) { setErr(error.message); setBusy(false); }
  };

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="eyebrow">2026.12.26 — 2027.1.2 ・ 日本跨年</div>
        <h1>日本跨年行程</h1>
        <p className="note">{invite ? "你拿到邀請了，按「進入」然後選一下你是哪一家。" : "行程只給家人看。請用家人傳給你的邀請連結打開，或在下面輸入邀請碼。"}</p>
      </header>
      <div className="joinform">
        <label>邀請碼<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="從邀請連結來會自動填好" autoCapitalize="none" autoCorrect="off" /></label>
        <button type="button" className="btn primary big" onClick={enter} disabled={busy || !code.trim()}>{busy ? "進入中…" : "進入"}</button>
        {GOOGLE && <button type="button" className="btn big" onClick={google} disabled={busy}>用 Google 登入</button>}
        {err && <p className="err">{err}</p>}
        <p className="note">進入後會記在這台手機／電腦上，之後直接開網址就好。</p>
      </div>
    </div>
  );
}
