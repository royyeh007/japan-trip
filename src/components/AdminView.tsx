import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { COMMON_TZ } from "../data";
import type { InviteRow, Member, Role } from "../data";

const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
const linkOf = (code: string) => `${location.origin}${location.pathname}#invite=${code}`;

function Members() {
  const { current, member: me, trip, refreshMemberships } = useTrip();
  const [rows, setRows] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!supabase || !current) return;
    const { data } = await supabase.from("members").select("trip_id, user_id, email, family_id, role, name, last_opened_at").eq("trip_id", current.id).order("role").order("name");
    setRows((data ?? []) as Member[]);
  }, [current]);
  useEffect(() => { load(); }, [load]);
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    const { error } = await p;
    if (error) alert(error.message); else { await load(); await refreshMemberships(); }
    setBusy(false);
  };
  const setRole = (m: Member, role: Role) => supabase && current && run(supabase.from("members").update({ role }).eq("trip_id", current.id).eq("user_id", m.user_id));
  const setFamily = (m: Member, family_id: string) => supabase && current && run(supabase.from("members").update({ family_id }).eq("trip_id", current.id).eq("user_id", m.user_id));
  const remove = (m: Member) => supabase && current && confirm(`把 ${m.name ?? m.email} 從這個行程移除？他可以再用邀請連結加入。`) && run(supabase.from("members").delete().eq("trip_id", current.id).eq("user_id", m.user_id));
  return (
    <div className="panel admin">
      <h3>團員（{rows.length}）</h3>
      <p className="note">管理員可以改所有人的行程、管理邀請和團員；一般成員只能改自己家和大家一起的日子。每個行程至少要有一位管理員。</p>
      {rows.map((m) => (
        <div className="row" key={m.user_id}>
          <span className="person"><b>{m.name ?? "（沒有名字）"}</b><span className="muted"> {m.email}{m.user_id === me?.user_id ? "（你）" : ""}</span></span>
          <select value={m.family_id} onChange={(e) => setFamily(m, e.target.value)} disabled={busy} aria-label="哪一家">
            {trip.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <select value={m.role} onChange={(e) => setRole(m, e.target.value as Role)} disabled={busy} aria-label="角色">
            <option value="member">成員</option>
            <option value="admin">管理員</option>
          </select>
          <button type="button" className="link" onClick={() => remove(m)} disabled={busy || m.user_id === me?.user_id}>移除</button>
        </div>
      ))}
    </div>
  );
}

function Invites() {
  const { current, member, trip } = useTrip();
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [role, setRole] = useState<Role>("member");
  const [famPreset, setFamPreset] = useState("");
  const [maxUses, setMaxUses] = useState(20);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase || !current) return;
    const { data } = await supabase.from("invites").select("code, role, family_id, uses, max_uses, note, expires_at, created_at").eq("trip_id", current.id).order("created_at", { ascending: false });
    setRows((data ?? []) as InviteRow[]);
  }, [current]);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    if (!supabase || !current) return;
    const { error } = await supabase.from("invites").insert({ trip_id: current.id, code: newCode(), role, family_id: famPreset || null, max_uses: maxUses, note: note.trim() || null, created_by: member?.user_id });
    if (error) alert(error.message); else { setNote(""); load(); }
  };
  const del = async (code: string) => {
    if (!supabase || !confirm("刪掉這個邀請連結？已經用它加入的人不受影響。")) return;
    const { error } = await supabase.from("invites").delete().eq("code", code);
    if (error) alert(error.message); else load();
  };
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(linkOf(code)); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { prompt("複製這個連結", linkOf(code)); }
  };
  return (
    <div className="panel admin">
      <h3>邀請連結</h3>
      <p className="note">把連結傳給家人，點開用 Google 登入、選自己是哪一家就加入了。可以先幫對方選好是哪一家，或讓他自己選／新建。</p>
      {rows.map((i) => (
        <div className="invite" key={i.code}>
          <code>{linkOf(i.code)}</code>
          <span className="muted">
            {i.role === "admin" ? "管理員邀請" : "成員邀請"}{i.family_id && `・${trip.families.find((f) => f.id === i.family_id)?.label ?? i.family_id}`}{i.note && `・${i.note}`}・用了 {i.uses}/{i.max_uses}
          </span>
          <button type="button" className="btn" onClick={() => copy(i.code)}>{copied === i.code ? "已複製" : "複製"}</button>
          <button type="button" className="link" onClick={() => del(i.code)}>刪除</button>
        </div>
      ))}
      <div className="formgrid">
        <label>角色
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="member">成員</option><option value="admin">管理員</option></select>
        </label>
        <label>先選好是哪一家（可空）
          <select value={famPreset} onChange={(e) => setFamPreset(e.target.value)}>
            <option value="">讓對方自己選或新建</option>
            {trip.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label>可用次數<input type="number" min={1} max={500} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label>備註（可空）<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：給 Claire 家" /></label>
      </div>
      <button type="button" className="btn primary" onClick={create}>產生新的邀請連結</button>
    </div>
  );
}

function Families() {
  const { current, trip, reload } = useTrip();
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [members, setMembers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase || !current) return;
    supabase.from("members").select("family_id").eq("trip_id", current.id).then(({ data }) => {
      const n: Record<string, number> = {};
      for (const r of data ?? []) n[r.family_id] = (n[r.family_id] ?? 0) + 1;
      setMembers(n);
    });
  }, [current, trip.families]);
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => { setBusy(true); const { error } = await p; if (error) alert(error.message); else await reload(); setBusy(false); };
  const add = () => {
    if (!supabase || !current || !label.trim()) return;
    const id = "f" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
    run(supabase.from("families").insert({ trip_id: current.id, id, name: label.trim(), label: label.trim(), sort: trip.families.length })).then(() => setLabel(""));
  };
  const save = (id: string) => supabase && current && run(supabase.from("families").update({ label: eLabel.trim(), name: eLabel.trim() }).eq("trip_id", current.id).eq("id", id)).then(() => setEditing(null));
  const del = (id: string, lbl: string) => {
    if (!supabase || !current) return;
    if ((members[id] ?? 0) > 0) { alert("這一家還有成員，先把他們換到別家。"); return; }
    if (trip.days.some((d) => d.fam?.includes(id))) { alert("這一家還有自己的日子，先把那些日子刪掉。"); return; }
    if (confirm(`刪掉「${lbl}」？`)) run(supabase.from("families").delete().eq("trip_id", current.id).eq("id", id));
  };
  return (
    <div className="panel admin">
      <h3>家庭</h3>
      <p className="note">同一家的人共用一份行程。加入的人也可以在加入時自己新建一家。</p>
      {trip.families.map((f) => (
        <div className="row" key={f.id}>
          {editing === f.id ? (
            <>
              <input value={eLabel} onChange={(e) => setELabel(e.target.value)} aria-label="名稱" />
              <button type="button" className="btn primary" onClick={() => save(f.id)} disabled={busy || !eLabel.trim()}>存</button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>取消</button>
              <span />
            </>
          ) : (
            <>
              <span className="person"><b>{f.label}</b><span className="muted"> {members[f.id] ?? 0} 人・{f.flights.length ? f.flights.join("／") : "沒有航班"}</span></span>
              <button type="button" className="link" onClick={() => { setEditing(f.id); setELabel(f.label); }}>改名</button>
              <button type="button" className="link" onClick={() => del(f.id, f.label)} disabled={busy}>刪除</button>
              <span />
            </>
          )}
        </div>
      ))}
      <div className="addrow">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="新的一家，例：Iris 家" onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" className="btn primary" onClick={add} disabled={busy || !label.trim()}>＋ 新增</button>
      </div>
    </div>
  );
}

function Settings() {
  const { current, refreshMemberships, leaveToPicker } = useTrip();
  const [name, setName] = useState(current?.name ?? "");
  const [start, setStart] = useState(current?.start_date ?? "");
  const [end, setEnd] = useState(current?.end_date ?? "");
  const [place, setPlace] = useState(current?.place ?? "");
  const [tz, setTz] = useState(current?.tz ?? "Asia/Tokyo");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const save = async () => {
    if (!supabase || !current) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("trips").update({ name: name.trim(), start_date: start, end_date: end, place: place.trim(), tz }).eq("id", current.id);
    if (error) setMsg(error.message); else { await refreshMemberships(); setMsg("已儲存"); }
    setBusy(false);
  };
  const destroy = async () => {
    if (!supabase || !current || confirmName.trim() !== current.name) return;
    if (!confirm(`真的要刪掉「${current.name}」？所有家庭的行程、待辦、聊天紀錄都會一起消失，無法復原。`)) return;
    setBusy(true);
    const { error } = await supabase.from("trips").delete().eq("id", current.id);
    if (error) { alert(error.message); setBusy(false); return; }
    await refreshMemberships();
    leaveToPicker();
  };
  const zones = COMMON_TZ.includes(tz) ? COMMON_TZ : [tz, ...COMMON_TZ];
  return (
    <>
      <div className="panel admin">
        <h3>行程設定</h3>
        <div className="formgrid">
          <label>行程名稱<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>去哪裡<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例：日本・東京、長野" /></label>
          <label>開始日期<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>結束日期<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>當地時區（「現在」的線、航班日期用）
            <select value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select>
          </label>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={save} disabled={busy || !name.trim() || !start || !end || end < start}>{busy ? "儲存中…" : "儲存"}</button>
          {msg && <span className="note" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>
      <div className="panel admin dangerzone">
        <h3>刪除整個行程</h3>
        <p className="note">所有人的行程、待辦、聯絡資料、上傳和聊天紀錄都會刪掉，無法復原。輸入行程名稱「{current?.name}」確認。</p>
        <div className="addrow">
          <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={current?.name} />
          <button type="button" className="btn danger" onClick={destroy} disabled={busy || confirmName.trim() !== current?.name}>刪除行程</button>
        </div>
      </div>
    </>
  );
}

/** #admin — trip administration (admins only). */
export function AdminView() {
  const { member } = useTrip();
  if (member?.role !== "admin") {
    return <section className="dayhead"><h2>管理行程</h2><p className="note">只有這個行程的管理員可以進來。</p></section>;
  }
  return (
    <>
      <section className="dayhead"><h2>管理行程</h2><p className="note">團員、邀請連結、家庭和行程設定。</p></section>
      <Members />
      <Invites />
      <Families />
      <Settings />
    </>
  );
}
