import { useState } from "react";
import { FAMILY_LABELS, canEdit } from "../data";
import type { ContactRow, FamilyId, TodoRow } from "../data";
import { supabase } from "../supabase";
import { useTrip } from "../trip";

type Scope = "mine" | "shared";
const visible = <T extends { fam: FamilyId[] | null }>(rows: T[], fam: FamilyId) => rows.filter((r) => !r.fam || r.fam.includes(fam));
const famOf = (scope: Scope, mine: FamilyId) => (scope === "shared" ? null : [mine]);

function Tag({ fam }: { fam: FamilyId[] | null }) {
  return <span className={`tag ${fam ? "own" : "shared"}`}>{fam ? fam.map((f) => FAMILY_LABELS[f]).join("＋") : "大家一起"}</span>;
}

function ScopePick({ value, onChange, mine }: { value: Scope; onChange: (s: Scope) => void; mine: FamilyId }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Scope)} aria-label="給誰看">
      <option value="mine">{FAMILY_LABELS[mine]}</option>
      <option value="shared">大家一起</option>
    </select>
  );
}

function Todos() {
  const { trip, member, viewFam, reload } = useTrip();
  const mine = member!.family_id;
  const rows = visible(trip.todos, viewFam);
  const [due, setDue] = useState(""); const [text, setText] = useState(""); const [scope, setScope] = useState<Scope>("mine");
  const [editing, setEditing] = useState<string | null>(null); const [eDue, setEDue] = useState(""); const [eText, setEText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => { setBusy(true); const { error } = await p; if (error) alert(error.message); else await reload(); setBusy(false); };

  const add = () => { if (!supabase || !text.trim()) return; run(supabase.from("todos").insert({ fam: famOf(scope, mine), due: due.trim(), text: text.trim(), created_by: member!.user_id })).then(() => { setDue(""); setText(""); }); };
  const toggle = (r: TodoRow, done: boolean) => supabase && run(supabase.from("todos").update({ done }).eq("id", r.id));
  const save = (r: TodoRow) => supabase && run(supabase.from("todos").update({ due: eDue.trim(), text: eText.trim() }).eq("id", r.id)).then(() => setEditing(null));
  const del = (r: TodoRow) => supabase && confirm(`刪掉「${r.text}」？`) && run(supabase.from("todos").delete().eq("id", r.id));

  return (
    <div className="panel">
      <h3>要訂、要搶的</h3>
      <p className="note">{viewFam === mine ? "大家一起的和你們家的都在這裡，勾選全家都看得到。" : `這是${FAMILY_LABELS[viewFam]}的清單；你新增的會加到自己家或大家一起。`}</p>
      <ul className="todo">
        {rows.map((r) => (
          <li key={r.id}>
            <input type="checkbox" id={`td-${r.id}`} checked={r.done} disabled={busy || !canEdit(r.fam, member)} onChange={(e) => toggle(r, e.target.checked)} />
            {editing === r.id ? (
              <div className="editrow">
                <input value={eDue} onChange={(e) => setEDue(e.target.value)} placeholder="時間（例：11/20 前）" />
                <input value={eText} onChange={(e) => setEText(e.target.value)} placeholder="要做什麼" />
                <div className="actions"><button type="button" className="btn primary" onClick={() => save(r)} disabled={busy || !eText.trim()}>存</button><button type="button" className="btn" onClick={() => setEditing(null)}>取消</button></div>
              </div>
            ) : (
              <label htmlFor={`td-${r.id}`}>
                <span className={`when ${r.done ? "done" : ""}`}>{r.due || "—"} <Tag fam={r.fam} /></span>
                <span className="what">{r.text}</span>
              </label>
            )}
            {editing !== r.id && canEdit(r.fam, member) && (
              <span className="rowacts">
                <button type="button" className="link" onClick={() => { setEditing(r.id); setEDue(r.due); setEText(r.text); }}>改</button>
                <button type="button" className="link" onClick={() => del(r)}>刪</button>
              </span>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="note">還沒有項目。</li>}
      </ul>
      <div className="addrow">
        <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="時間（例：11/20 前）" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="要做什麼" onKeyDown={(e) => e.key === "Enter" && add()} />
        <ScopePick value={scope} onChange={setScope} mine={mine} />
        <button type="button" className="btn primary" onClick={add} disabled={busy || !text.trim()}>＋ 新增</button>
      </div>
    </div>
  );
}

function Contacts() {
  const { trip, member, viewFam, reload } = useTrip();
  const mine = member!.family_id;
  const rows = visible(trip.contacts, viewFam);
  const [name, setName] = useState(""); const [value, setValue] = useState(""); const [scope, setScope] = useState<Scope>("mine");
  const [editing, setEditing] = useState<string | null>(null); const [eName, setEName] = useState(""); const [eValue, setEValue] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => { setBusy(true); const { error } = await p; if (error) alert(error.message); else await reload(); setBusy(false); };

  const add = () => { if (!supabase || !name.trim() || !value.trim()) return; run(supabase.from("contacts").insert({ fam: famOf(scope, mine), name: name.trim(), value: value.trim(), created_by: member!.user_id })).then(() => { setName(""); setValue(""); }); };
  const save = (r: ContactRow) => supabase && run(supabase.from("contacts").update({ name: eName.trim(), value: eValue.trim() }).eq("id", r.id)).then(() => setEditing(null));
  const del = (r: ContactRow) => supabase && confirm(`刪掉「${r.name}」？`) && run(supabase.from("contacts").delete().eq("id", r.id));
  const href = (v: string) => (v.includes("@") ? `mailto:${v}` : /^[+\d][\d\s-]{6,}$/.test(v) ? `tel:${v.replace(/[\s-]/g, "")}` : null);

  return (
    <div className="panel">
      <h3>聯絡資料</h3>
      <div className="contacts">
        {rows.map((r) => editing === r.id ? (
          <div className="editrow" key={r.id}>
            <input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="名稱" />
            <input value={eValue} onChange={(e) => setEValue(e.target.value)} placeholder="電話或 email" />
            <div className="actions"><button type="button" className="btn primary" onClick={() => save(r)} disabled={busy || !eName.trim() || !eValue.trim()}>存</button><button type="button" className="btn" onClick={() => setEditing(null)}>取消</button></div>
          </div>
        ) : (
          <div key={r.id}>
            <span className="cname">{r.name} <Tag fam={r.fam} /></span>
            <span className="cval">{href(r.value) ? <a href={href(r.value)!}>{r.value}</a> : r.value}</span>
            {canEdit(r.fam, member) && (
              <span className="rowacts">
                <button type="button" className="link" onClick={() => { setEditing(r.id); setEName(r.name); setEValue(r.value); }}>改</button>
                <button type="button" className="link" onClick={() => del(r)}>刪</button>
              </span>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="note">還沒有聯絡資料。</p>}
      </div>
      <div className="addrow">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名稱（例：飯店訂房）" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="電話或 email" onKeyDown={(e) => e.key === "Enter" && add()} />
        <ScopePick value={scope} onChange={setScope} mine={mine} />
        <button type="button" className="btn primary" onClick={add} disabled={busy || !name.trim() || !value.trim()}>＋ 新增</button>
      </div>
    </div>
  );
}

export function TodoView() {
  const { viewFam } = useTrip();
  return (
    <>
      <section className="dayhead"><h2>待辦與聯絡資料</h2><p className="note">正在看：{FAMILY_LABELS[viewFam]}（含大家一起的）。頁首可以切換看別家。</p></section>
      <Todos />
      <Contacts />
    </>
  );
}
