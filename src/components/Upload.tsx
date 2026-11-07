import { useCallback, useEffect, useState } from "react";
import { FAMILY_LABELS, isLeg } from "../data";
import type { Day, FamilyId, Proposal, Upload as UploadRow } from "../data";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { openForm } from "../form";
import { DownloadIcon } from "../icons";

const STATUS: Record<UploadRow["status"], string> = { pending: "等確認", approved: "已更新", rejected: "已退回", failed: "解析失敗" };

/** Compact read-only rendering of a proposed day, for the review list. */
function ProposalDays({ p }: { p: Proposal }) {
  return (
    <div className="preview">
      {p.summary && <p><b>{p.summary}</b></p>}
      {p.flights.length > 0 && <p>航班：{p.flights.join("／")}</p>}
      {p.joins.map((j, i) => <p key={i}>{j.date_id.slice(1, 3)}/{Number(j.date_id.slice(3))}：跟{FAMILY_LABELS[j.with]}一起{j.from ? `（${j.from} 起）` : ""}</p>)}
      {p.days.map((day) => (
        <details key={day.id + day.scope} open={p.days.length <= 2}>
          <summary>{day.d}（{day.w}）{day.scope === "shared" ? "・大家一起" : ""} ・ {day.title}{day.hotel && ` ・ 住 ${day.hotel}`}</summary>
          <ul>
            {day.items.map((it, i) => isLeg(it)
              ? <li key={i} className="pl">→ {it.txt}</li>
              : <li key={i}><b>{it.t}</b> {it.n}{it.st && ` [${it.st}]`}{it.book?.length ? `：${it.book.join("；")}` : ""}</li>)}
          </ul>
        </details>
      ))}
      {p.notes.length > 0 && <ul className="notes">{p.notes.map((n, i) => <li key={i}>⚠ {n}</li>)}</ul>}
    </div>
  );
}

/** Admin: write an approved proposal into the live itinerary. */
async function applyProposal(row: UploadRow, days: Day[], email: string) {
  if (!supabase || !row.parsed) return;
  const p = row.parsed;
  for (const day of p.days) {
    const fam = day.scope === "shared" ? null : [p.family_id];
    const { error } = await supabase.from("days").upsert(
      { date_id: day.id, fam, d: day.d, w: day.w, city: day.city, title: day.title, hotel: day.hotel, items: day.items, updated_at: new Date().toISOString() },
      { onConflict: "date_id,fam" },
    );
    if (error) throw new Error(error.message);
  }
  for (const j of p.joins) {
    const target = days.find((d) => d.id === j.date_id && d.fam?.includes(j.with)) ?? days.find((d) => d.id === j.date_id && !d.fam);
    if (!target) continue;
    if (!target.fam) continue; // already a shared day
    if (!j.from) {
      if (!target.fam.includes(p.family_id)) {
        const { error } = await supabase.from("days").update({ fam: [...target.fam, p.family_id] }).eq("date_id", j.date_id).contains("fam", [j.with]);
        if (error) throw new Error(error.message);
      }
    } else {
      const idx = target.items.findIndex((it) => !isLeg(it) && it.t === j.from);
      const items = idx >= 0 ? target.items.slice(idx) : target.items;
      const { error } = await supabase.from("days").upsert(
        { date_id: j.date_id, fam: [p.family_id], d: target.d, w: target.w, city: target.city, title: `${j.from} 起和${FAMILY_LABELS[j.with]}一起`, hotel: target.hotel, items, updated_at: new Date().toISOString() },
        { onConflict: "date_id,fam" },
      );
      if (error) throw new Error(error.message);
    }
  }
  if (p.flights.length > 0) {
    const { error } = await supabase.from("families").update({ flights: p.flights }).eq("id", p.family_id);
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase.from("uploads").update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: email }).eq("id", row.id);
  if (error) throw new Error(error.message);
}

function InviteBox() {
  const { member } = useTrip();
  const [invites, setInvites] = useState<{ code: string; uses: number; max_uses: number; note: string | null }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("invites").select("code, uses, max_uses, note").order("created_at", { ascending: false });
    setInvites(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    if (!supabase) return;
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
    const { error } = await supabase.from("invites").insert({ code, note: new Date().toLocaleDateString("zh-TW"), created_by: member?.email, max_uses: 50 });
    if (error) alert(error.message); else load();
  };
  const linkOf = (code: string) => `${location.origin}${location.pathname}#invite=${code}`;
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(linkOf(code)); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { prompt("複製這個連結", linkOf(code)); }
  };
  return (
    <div className="panel">
      <h3>邀請連結</h3>
      <p className="note">把連結傳給家人，點開用 Google 登入、選自己是哪一家就加入了。一個連結可以用 50 次。</p>
      {invites.map((i) => (
        <div className="invite" key={i.code}>
          <code>{linkOf(i.code)}</code>
          <span className="muted">用了 {i.uses}/{i.max_uses}</span>
          <button type="button" className="btn" onClick={() => copy(i.code)}>{copied === i.code ? "已複製" : "複製"}</button>
        </div>
      ))}
      <button type="button" className="btn primary" onClick={create}>產生新的邀請連結</button>
    </div>
  );
}

export function UploadView() {
  const { member, trip, reload } = useTrip();
  const isAdmin = member?.role === "admin";
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Proposal | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [acting, setActing] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("uploads").select("id, family_id, uploaded_by, kind, path, status, parsed, error, created_at").order("created_at", { ascending: false }).limit(50);
    setRows((data ?? []) as UploadRow[]);
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  const submit = async () => {
    if (!supabase || !member || (!file && !text.trim())) return;
    setErr(null); setResult(null);
    try {
      let path: string | undefined;
      if (file) {
        setBusy("上傳檔案中…");
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        path = `${member.family_id}/${Date.now()}-${file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}.${ext}`;
        const { error } = await supabase.storage.from("uploads").upload(path, file);
        if (error) throw new Error(error.message);
      }
      setBusy("Claude 讀取中，大約 20–60 秒…");
      const res = await invoke<{ id: string; proposal: Proposal }>("parse-upload", { path, text: text.trim() || undefined });
      setResult(res.proposal); setFile(null); setText("");
      loadRows();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const decide = async (row: UploadRow, ok: boolean) => {
    if (!supabase || !member) return;
    setActing(row.id);
    try {
      if (ok) { await applyProposal(row, trip.days, member.email); await reload(); }
      else { const { error } = await supabase.from("uploads").update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: member.email }).eq("id", row.id); if (error) throw new Error(error.message); }
      await loadRows();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setActing(null); }
  };

  const pending = rows.filter((r) => r.status === "pending" && r.parsed);
  const mine = rows.filter((r) => r.uploaded_by === member?.email);

  return (
    <>
      <section className="dayhead">
        <h2>{isAdmin ? "上傳與審核" : "上傳行程"}</h2>
        <p className="note">傳填好的表單（xlsx）、行程截圖、PDF，或直接貼文字，Claude 會整理成行程，Lily 家確認後就會出現在網頁上。</p>
      </section>

      {isAdmin && (
        <div className="panel">
          <h3>待確認（{pending.length}）</h3>
          {pending.length === 0 && <p className="note">目前沒有。</p>}
          {pending.map((r) => (
            <div className="review" key={r.id}>
              <div className="meta">
                <span>{FAMILY_LABELS[r.family_id as FamilyId] ?? r.family_id}</span>
                <span>{r.uploaded_by}</span>
                <span>{r.kind === "chat" ? "從聊天" : "上傳"}・{new Date(r.created_at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {r.parsed && <ProposalDays p={r.parsed} />}
              <div className="actions">
                <button type="button" className="btn primary" disabled={acting === r.id} onClick={() => decide(r, true)}>確認，更新行程</button>
                <button type="button" className="btn" disabled={acting === r.id} onClick={() => decide(r, false)}>退回</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <h3>上傳</h3>
        <div className="uploadform">
          <label className="filepick">
            <input type="file" accept=".xlsx,.xls,.csv,.pdf,.txt,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : "選檔案：表單 xlsx、截圖、PDF"}</span>
          </label>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="或直接貼行程文字，例如：12/26 15:00 到機場，17:00 飯店 check-in，18:30 晚餐 ○○…" />
          <div className="actions">
            <button type="button" className="btn primary" onClick={submit} disabled={!!busy || (!file && !text.trim())}>{busy ?? "送出給 Claude 整理"}</button>
            <button type="button" className="btn" onClick={openForm}><DownloadIcon />下載填寫表單</button>
          </div>
          {err && <p className="err">{err}</p>}
          {result && (
            <div className="resultbox">
              <p><b>已送出，等 Lily 家確認。</b>Claude 讀出來的內容：</p>
              <ProposalDays p={result} />
            </div>
          )}
        </div>
      </div>

      {mine.length > 0 && (
        <div className="panel">
          <h3>我送過的</h3>
          <ul className="ulist">
            {mine.map((r) => (
              <li key={r.id}>
                <span className={`status ${r.status}`}>{STATUS[r.status]}</span>
                <span>{r.parsed?.summary || r.error || (r.kind === "chat" ? "聊天提案" : r.path?.split("/").pop())}</span>
                <span className="muted">{new Date(r.created_at).toLocaleDateString("zh-TW")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && <InviteBox />}
    </>
  );
}
