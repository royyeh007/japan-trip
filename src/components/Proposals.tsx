/* eslint-disable react-refresh/only-export-components -- this file deliberately pairs the proposal UI with the apply logic it needs */
import { useState } from "react";
import { dateOf, isLeg, labelOf as labelIn } from "../data";
import type { Day, Family, Proposal, Stop, Upload as UploadRow } from "../data";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { fillTripDays } from "../days";

export const STATUS: Record<UploadRow["status"], string> = { pending: "等你確認", approved: "已更新", rejected: "已取消", failed: "解析失敗" };

/** Compact read-only rendering of a proposal. */
export function ProposalDays({ p }: { p: Proposal }) {
  const { labelOf } = useTrip();
  return (
    <div className="preview">
      {p.summary && <p><b>{p.summary}</b></p>}
      {p.flights.length > 0 && <p>航班：{p.flights.join("／")}</p>}
      {p.joins.map((j, i) => <p key={i}>{dateOf(j.date_id).d}：跟{labelOf(j.with)}一起{j.from ? `（${j.from} 起）` : ""}</p>)}
      {p.days.map((day) => (
        <details key={day.id + day.scope} open={p.days.length <= 2}>
          <summary>{day.d}（{day.w}）{day.scope === "shared" ? "・大家一起" : `・${labelOf(p.family_id)}`} ・ {day.title}{day.hotel && ` ・ 住 ${day.hotel}`}</summary>
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

/** Write a confirmed proposal into the live itinerary of one trip (RLS limits members to their own family's days and shared days). */
export async function applyProposal(id: string, p: Proposal, tripId: string, days: Day[], families: Family[], reviewedBy: string) {
  if (!supabase) throw new Error("Supabase 還沒設定");
  const now = new Date().toISOString();
  for (const day of p.days) {
    const fam = day.scope === "shared" ? null : [p.family_id];
    // If this family currently shares a joint version of the day with other families (e.g. fam ["lily","yanzhi"]),
    // take the family out of that row first so the new version does not leave two competing rows behind.
    if (fam) {
      const joint = days.find((d) => d.id === day.id && d.fam && d.fam.length > 1 && d.fam.includes(p.family_id));
      if (joint?.fam) {
        const rest = joint.fam.filter((f) => f !== p.family_id);
        const { error: je } = await supabase.from("days").update({ fam: rest, updated_at: now }).eq("trip_id", tripId).eq("date_id", day.id).contains("fam", joint.fam);
        if (je) throw new Error(je.message);
      }
    }
    // keep notes people wrote on stops that still exist (matched by name), and the map search string:
    // the chat doesn't see q (saves tokens) and leaves it empty for stops it kept, so take the old one
    const existing = days.find((d) => d.id === day.id && (fam ? d.fam?.includes(p.family_id) : !d.fam)) ?? days.find((d) => d.id === day.id);
    const items = day.items.map((it) => {
      if (isLeg(it)) return it;
      const prev = existing?.items.find((e): e is Stop => !isLeg(e) && e.n === it.n);
      const q = it.q || prev?.q || it.n;
      const keep = { q, ...(prev?.ll ? { ll: prev.ll } : {}), ...(prev?.ref ? { ref: prev.ref } : {}), ...(prev?.memo?.length ? { memo: prev.memo } : {}) };
      return { ...it, ...keep };
    });
    const { d, w } = dateOf(day.id);
    const { error } = await supabase.from("days").upsert(
      { trip_id: tripId, date_id: day.id, fam, d, w, city: day.city, title: day.title, hotel: day.hotel, items, updated_at: now },
      { onConflict: "trip_id,date_id,fam" },
    );
    if (error) throw new Error(error.message);
  }
  for (const j of p.joins) {
    const target = days.find((d) => d.id === j.date_id && d.fam?.includes(j.with)) ?? days.find((d) => d.id === j.date_id && !d.fam);
    if (!target || !target.fam) continue; // missing, or already a shared day
    if (!j.from) {
      if (!target.fam.includes(p.family_id)) {
        const { error } = await supabase.from("days").update({ fam: [...target.fam, p.family_id], updated_at: now }).eq("trip_id", tripId).eq("date_id", j.date_id).contains("fam", [j.with]);
        if (error) throw new Error(error.message);
      }
    } else {
      const idx = target.items.findIndex((it) => !isLeg(it) && it.t === j.from);
      const items = idx >= 0 ? target.items.slice(idx) : target.items;
      const { error } = await supabase.from("days").upsert(
        { trip_id: tripId, date_id: j.date_id, fam: [p.family_id], d: target.d, w: target.w, city: target.city, title: `${j.from} 起和${labelIn(families, j.with)}一起`, hotel: target.hotel, items, updated_at: now },
        { onConflict: "trip_id,date_id,fam" },
      );
      if (error) throw new Error(error.message);
    }
  }
  if (p.flights.length > 0) {
    const { error } = await supabase.from("families").update({ flights: p.flights }).eq("trip_id", tripId).eq("id", p.family_id);
    if (error) throw new Error(error.message);
    invoke("flight-refresh", { trip_id: tripId, flights: p.flights }).catch(() => { /* best effort: the 15-minute schedule will pick it up */ });
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
  const { trip, current, member, reload, refreshMemberships } = useTrip();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Days (or a requested extension) outside the trip's dates: admins can widen the trip while confirming
  const outside = current ? proposal.days.filter((d) => d.id < current.start_date || d.id > current.end_date).map((d) => d.id) : [];
  const wantStart = [proposal.extend_to?.start_date, ...outside].filter((x): x is string => !!x).sort()[0];
  const wantEnd = [proposal.extend_to?.end_date, ...outside].filter((x): x is string => !!x).sort().reverse()[0];
  const newStart = current && wantStart && wantStart < current.start_date ? wantStart : current?.start_date;
  const newEnd = current && wantEnd && wantEnd > current.end_date ? wantEnd : current?.end_date;
  const widens = !!current && (newStart !== current.start_date || newEnd !== current.end_date);
  const [extend, setExtend] = useState(true);
  const act = async (ok: boolean) => {
    if (!member || !current) return;
    setBusy(true); setErr(null);
    try {
      if (ok) {
        await applyProposal(id, proposal, current.id, trip.days, trip.families, member.user_id);
        if (widens && extend && member.role === "admin" && supabase && newStart && newEnd) {
          const { error } = await supabase.from("trips").update({ start_date: newStart, end_date: newEnd }).eq("id", current.id);
          if (error) throw new Error(`行程日期沒改成：${error.message}`);
          try { await fillTripDays(current.id, newStart, newEnd, current.place, trip.days.filter((d) => !d.fam).map((d) => d.id)); } catch { /* days can be added later */ }
          await refreshMemberships();
        }
        await reload();
      }
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
      {widens && !done && current && (
        member?.role === "admin" ? (
          <label className="extendrow">
            <input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} />
            <span>同時把行程日期改成 <b>{dateOf(newStart!).d} – {dateOf(newEnd!).d}</b>（原本 {dateOf(current.start_date).d} – {dateOf(current.end_date).d}），多出來的日子會補上空白的「大家一起」版本</span>
          </label>
        ) : (
          <p className="note extendrow">有日期在行程範圍（{dateOf(current.start_date).d} – {dateOf(current.end_date).d}）之外：確認後會加進你們家的行程；要延長整個行程的日期請找管理員。</p>
        )
      )}
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
