/* eslint-disable react-refresh/only-export-components -- this file deliberately pairs the proposal UI with the apply logic it needs */
import { useState } from "react";
import { FAMILY_LABELS, isLeg } from "../data";
import type { Day, Proposal, Stop, Upload as UploadRow } from "../data";
import { supabase } from "../supabase";
import { useTrip } from "../trip";

export const STATUS: Record<UploadRow["status"], string> = { pending: "等你確認", approved: "已更新", rejected: "已取消", failed: "解析失敗" };

/** Compact read-only rendering of a proposal. */
export function ProposalDays({ p }: { p: Proposal }) {
  return (
    <div className="preview">
      {p.summary && <p><b>{p.summary}</b></p>}
      {p.flights.length > 0 && <p>航班：{p.flights.join("／")}</p>}
      {p.joins.map((j, i) => <p key={i}>{Number(j.date_id.slice(1, 3))}/{Number(j.date_id.slice(3))}：跟{FAMILY_LABELS[j.with]}一起{j.from ? `（${j.from} 起）` : ""}</p>)}
      {p.days.map((day) => (
        <details key={day.id + day.scope} open={p.days.length <= 2}>
          <summary>{day.d}（{day.w}）{day.scope === "shared" ? "・大家一起" : `・${FAMILY_LABELS[p.family_id]}`} ・ {day.title}{day.hotel && ` ・ 住 ${day.hotel}`}</summary>
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

/** Write a confirmed proposal into the live itinerary (RLS limits members to their own family's days and shared days). */
export async function applyProposal(id: string, p: Proposal, days: Day[], reviewedBy: string) {
  if (!supabase) throw new Error("Supabase 還沒設定");
  const now = new Date().toISOString();
  for (const day of p.days) {
    const fam = day.scope === "shared" ? null : [p.family_id];
    // keep notes people wrote on stops that still exist (matched by name)
    const existing = days.find((d) => d.id === day.id && (fam ? d.fam?.includes(p.family_id) : !d.fam)) ?? days.find((d) => d.id === day.id);
    const items = day.items.map((it) => {
      if (isLeg(it)) return it;
      const prev = existing?.items.find((e): e is Stop => !isLeg(e) && e.n === it.n);
      return prev?.memo?.length ? { ...it, memo: prev.memo } : it;
    });
    const { error } = await supabase.from("days").upsert(
      { date_id: day.id, fam, d: day.d, w: day.w, city: day.city, title: day.title, hotel: day.hotel, items, updated_at: now },
      { onConflict: "date_id,fam" },
    );
    if (error) throw new Error(error.message);
  }
  for (const j of p.joins) {
    const target = days.find((d) => d.id === j.date_id && d.fam?.includes(j.with)) ?? days.find((d) => d.id === j.date_id && !d.fam);
    if (!target || !target.fam) continue; // missing, or already a shared day
    if (!j.from) {
      if (!target.fam.includes(p.family_id)) {
        const { error } = await supabase.from("days").update({ fam: [...target.fam, p.family_id], updated_at: now }).eq("date_id", j.date_id).contains("fam", [j.with]);
        if (error) throw new Error(error.message);
      }
    } else {
      const idx = target.items.findIndex((it) => !isLeg(it) && it.t === j.from);
      const items = idx >= 0 ? target.items.slice(idx) : target.items;
      const { error } = await supabase.from("days").upsert(
        { date_id: j.date_id, fam: [p.family_id], d: target.d, w: target.w, city: target.city, title: `${j.from} 起和${FAMILY_LABELS[j.with]}一起`, hotel: target.hotel, items, updated_at: now },
        { onConflict: "date_id,fam" },
      );
      if (error) throw new Error(error.message);
    }
  }
  if (p.flights.length > 0) {
    const { error } = await supabase.from("families").update({ flights: p.flights }).eq("id", p.family_id);
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase.from("uploads").update({ status: "approved", reviewed_at: now, reviewed_by: reviewedBy }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function cancelProposal(id: string, reviewedBy: string) {
  if (!supabase) return;
  const { error } = await supabase.from("uploads").update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** A proposal with 確認更新 / 取消 buttons. `onDone` fires after either. */
export function ProposalCard({ id, proposal, meta, onDone }: { id: string; proposal: Proposal; meta?: string; onDone?: (status: "approved" | "rejected") => void }) {
  const { trip, member, reload } = useTrip();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (ok: boolean) => {
    if (!member) return;
    setBusy(true); setErr(null);
    try {
      if (ok) { await applyProposal(id, proposal, trip.days, member.user_id); await reload(); }
      else await cancelProposal(id, member.user_id);
      setDone(ok ? "approved" : "rejected");
      onDone?.(ok ? "approved" : "rejected");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="review">
      {meta && <div className="meta"><span>{meta}</span></div>}
      <ProposalDays p={proposal} />
      {done ? (
        <span className={`status ${done}`}>{STATUS[done]}</span>
      ) : (
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => act(true)}>{busy ? "更新中…" : "確認，更新行程"}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => act(false)}>取消</button>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
