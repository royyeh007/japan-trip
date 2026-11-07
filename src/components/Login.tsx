import { useState } from "react";
import { supabase } from "../supabase";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12S6.6 21.7 12 21.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
  </svg>
);

export function Login({ invite }: { invite: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) { setErr(error.message); setBusy(false); }
  };
  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="eyebrow">2026.12.26 — 2027.1.2 ・ 日本跨年</div>
        <h1>日本跨年行程</h1>
        <p className="note">
          {invite ? "你拿到邀請連結了。用 Google 登入後，選一下你是哪一家就可以看行程。" : "行程只有家人看得到，請用 Google 登入。還沒加入的人需要邀請連結。"}
        </p>
      </header>
      <button type="button" className="btn primary big" onClick={go} disabled={busy}>
        <GoogleIcon />{busy ? "前往 Google…" : "用 Google 登入"}
      </button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
