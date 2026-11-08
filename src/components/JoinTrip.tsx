import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { dotDate } from "../data";
import type { InviteInfo } from "./Login";

/**
 * Join a trip with an invite code: shows which trip it is, lets the person pick (or create) their family, then joins.
 * Used right after signing in through an invite link, and from the trip picker's "用邀請碼加入".
 */
export function JoinTrip({ code: initial, onDone, onCancel }: { code: string; onDone: (tripId: string) => void; onCancel: () => void }) {
  const { session, memberships, signOut } = useTrip();
  const [code, setCode] = useState(initial);
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [fam, setFam] = useState<string | "new" | null>(null);
  const [newFam, setNewFam] = useState("");
  const [name, setName] = useState<string>(session?.user.user_metadata?.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = async (c: string) => {
    if (!supabase || !c.trim()) return;
    setInfo(undefined); setErr(null);
    const { data, error } = await supabase.rpc("invite_valid", { p_code: c.trim() });
    if (error) { setErr(error.message); setInfo(null); return; }
    const i = (data as InviteInfo | null) ?? null;
    setInfo(i);
    if (i) setFam(i.family_id ?? (i.families.length ? null : "new"));
  };
  useEffect(() => { check(initial); }, [initial]);

  const already = info ? memberships.find((m) => m.trip_id === info.trip_id) : undefined;

  const submit = async () => {
    if (!supabase || !info) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("join_with_invite", {
      p_code: code.trim(),
      p_family: fam === "new" ? null : fam,
      p_name: name.trim(),
      p_new_family: fam === "new" ? newFam.trim() : null,
    });
    if (error) { setErr(error.message); setBusy(false); return; }
    onDone(String(data));
  };

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="eyebrow">{session?.user.email}</div>
        <h1>{info ? `加入「${info.name}」` : "用邀請碼加入"}</h1>
        {info && <p className="note">{dotDate(info.start_date)} — {dotDate(info.end_date)}{info.place && ` ・ ${info.place}`}{info.role === "admin" && " ・ 這是管理員邀請"}</p>}
        {info === undefined && <p className="note">確認邀請碼中…</p>}
        {info === null && <p className="note">這個邀請碼不對或已經用完。檢查一下，或跟邀請你的人再要一個。</p>}
      </header>

      {!info && (
        <div className="joinform">
          <label>邀請碼<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例：abc123" autoCapitalize="none" autoCorrect="off" /></label>
          <button type="button" className="btn primary big" onClick={() => check(code)} disabled={!code.trim() || info === undefined}>檢查邀請碼</button>
          {err && <p className="err">{err}</p>}
          <button type="button" className="link" onClick={onCancel}>返回</button>
        </div>
      )}

      {info && already && (
        <div className="joinform">
          <p className="note">你已經在這個行程裡了（{already.name ?? already.email}）。</p>
          <button type="button" className="btn primary big" onClick={() => onDone(info.trip_id)}>進入行程</button>
          <button type="button" className="link" onClick={onCancel}>返回</button>
        </div>
      )}

      {info && !already && (
        <>
          {info.family_id ? (
            <p className="note">邀請你的人已經幫你選好：<b>{info.families.find((f) => f.id === info.family_id)?.label ?? info.family_id}</b></p>
          ) : (
            <>
              <p className="note">你是哪一家？同一家的人共用一份行程；大家互相都看得到，但只能改自己家和大家一起的日子。</p>
              <div className="fams" role="group" aria-label="選擇家庭">
                {info.families.map((f) => (
                  <button key={f.id} type="button" className="fam" aria-pressed={fam === f.id} onClick={() => setFam(f.id)}>
                    <span className="nm">{f.label}</span>
                  </button>
                ))}
                <button type="button" className="fam" aria-pressed={fam === "new"} onClick={() => setFam("new")}>
                  <span className="nm">＋ 新的一家</span>
                  <span className="hint">還沒有我們家</span>
                </button>
              </div>
            </>
          )}
          <div className="joinform">
            {fam === "new" && <label>你們這一家叫什麼<input value={newFam} onChange={(e) => setNewFam(e.target.value)} placeholder="例：Lily 家" /></label>}
            <label>你的名字<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：小明" /></label>
            <button type="button" className="btn primary big" onClick={submit} disabled={busy || !fam || (fam === "new" && !newFam.trim())}>{busy ? "加入中…" : "加入"}</button>
            {err && <p className="err">{err}</p>}
            <div className="actions">
              <button type="button" className="link" onClick={onCancel}>返回</button>
              <button type="button" className="link" onClick={signOut}>不是這個帳號？登出</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
