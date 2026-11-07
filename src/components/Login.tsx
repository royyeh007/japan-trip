import { useState } from "react";
import { setIntent, supabase } from "../supabase";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12S6.6 21.7 12 21.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
  </svg>
);

/** Home page. New people: invite code first, then Google. Existing members: Google only. */
export function Login({ invite }: { invite: string | null }) {
  const [code, setCode] = useState(invite ?? "");
  const [busy, setBusy] = useState<"register" | "login" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const google = async () => {
    const { error } = await supabase!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) throw new Error(error.message);
  };

  // 註冊：先確認邀請碼有效，記下來，再去 Google。回來後在「你是哪一家」畫面用這個碼加入。
  const register = async () => {
    if (!supabase) return;
    setBusy("register"); setErr(null);
    try {
      const c = code.trim();
      const { data: valid, error } = await supabase.rpc("invite_valid", { p_code: c });
      if (error) throw new Error(error.message);
      if (!valid) throw new Error("邀請碼不對或已經用完，跟 Lily 家要一個新的連結。");
      try { localStorage.setItem("jp-invite", c); } catch { /* ignore */ }
      setIntent("register");
      await google();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); }
  };

  const login = async () => {
    if (!supabase) return;
    setBusy("login"); setErr(null);
    setIntent("login");
    try { await google(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); }
  };

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="eyebrow">2026.12.26 — 2027.1.2 ・ 日本跨年</div>
        <h1>日本跨年行程</h1>
        <p className="note">{invite ? "你拿到邀請了。按「用 Google 註冊」，登入 Google 後選一下你是哪一家。" : "行程只給家人看。第一次來需要邀請碼（家人傳的連結會自動帶入）。"}</p>
      </header>
      <div className="joinform">
        <label>邀請碼<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="從邀請連結來會自動填好" autoCapitalize="none" autoCorrect="off" /></label>
        <button type="button" className="btn primary big" onClick={register} disabled={!!busy || !code.trim()}>
          <GoogleIcon />{busy === "register" ? "前往 Google…" : "用 Google 註冊"}
        </button>
        {err && <p className="err">{err}</p>}
        <p className="note">已經加入過了？</p>
        <button type="button" className="btn big" onClick={login} disabled={!!busy}>
          <GoogleIcon />{busy === "login" ? "前往 Google…" : "用 Google 登入"}
        </button>
      </div>
    </div>
  );
}
