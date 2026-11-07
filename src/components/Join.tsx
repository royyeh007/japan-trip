import { useState } from "react";
import { FAMILY_IDS, FAMILY_LABELS } from "../data";
import type { FamilyId } from "../data";
import { clearInvite, supabase } from "../supabase";
import { useTrip } from "../trip";

export function Join() {
  const { session, invite, refreshMember, signOut } = useTrip();
  const [fam, setFam] = useState<FamilyId | null>(null);
  const [name, setName] = useState<string>(session?.user.user_metadata?.full_name ?? "");
  const [code, setCode] = useState(invite ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || !fam) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("join_with_invite", { p_code: code.trim(), p_family: fam, p_name: name.trim() });
    if (error) { setErr(error.message); setBusy(false); return; }
    clearInvite();
    await refreshMember();
  };

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="eyebrow">{session?.user.email ?? "用邀請連結進入"}</div>
        <h1>你是哪一家？</h1>
        <p className="note">選一下你的家庭，之後只會看到你們家的行程和大家一起的日子。</p>
      </header>
      <div className="fams" role="group" aria-label="選擇家庭">
        {FAMILY_IDS.map((id) => (
          <button key={id} type="button" className="fam" aria-pressed={fam === id} onClick={() => setFam(id)}>
            <span className="nm">{FAMILY_LABELS[id]}</span>
          </button>
        ))}
      </div>
      <div className="joinform">
        <label>你的名字<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：小明" /></label>
        <label>邀請碼<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="從邀請連結來的話會自動填好" /></label>
        <button type="button" className="btn primary big" onClick={submit} disabled={!fam || !code.trim() || busy}>{busy ? "加入中…" : "加入"}</button>
        {err && <p className="err">{err}</p>}
        <button type="button" className="link" onClick={signOut}>{session?.user.email ? "不是這個帳號？登出" : "回上一頁"}</button>
      </div>
    </div>
  );
}
