import { Fragment } from "react";
import { ACTION_RE, QUICK_START, ROLE_NAMES, ROLE_SUMMARY, guideFor } from "../../supabase/functions/_shared/guide";
import type { GuideRole } from "../../supabase/functions/_shared/guide";
import { askClaude } from "./Chat";
import { useTrip } from "../trip";

/** Buttons inside the guide jump to the real feature: a page, the chat, the account menu, the add-day form. */
function useGo(interactive: boolean) {
  const { leaveToPicker } = useTrip();
  return (target: string) => {
    if (!interactive) return;
    switch (target) {
      case "chat": askClaude(""); break;
      case "menu": window.dispatchEvent(new CustomEvent("jp-open-menu")); break;
      case "switch": leaveToPicker(); break;
      case "addday": window.dispatchEvent(new CustomEvent("jp-add-day")); break;
      default: location.hash = `#${target}`;
    }
    if (target !== "menu") window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

/** Text with `[[target|label]]` markers rendered as buttons. */
function Rich({ text, go, interactive }: { text: string; go: (t: string) => void; interactive: boolean }) {
  const parts: (string | { t: string; l: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(ACTION_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push({ t: m[1], l: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => typeof p === "string"
        ? <Fragment key={i}>{p}</Fragment>
        : interactive
          ? <button key={i} type="button" className="gbtn" onClick={() => go(p.t)}>{p.l}</button>
          : <span key={i} className="gbtn static">{p.l}</span>)}
    </>
  );
}

/** The how-to page, showing only what this role can do. `compact` = the read-only version on the trip picker. */
export function GuideView({ role, compact = false }: { role: GuideRole; compact?: boolean }) {
  const sections = guideFor(role);
  const go = useGo(!compact);
  return (
    <>
      {!compact && (
        <section className="dayhead">
          <h2>使用教學</h2>
          <div className="gcard">
            <div className="grole"><span className={`tag ${role === "admin" ? "admin" : role === "viewer" ? "none" : "shared"}`}>{ROLE_NAMES[role]}</span><span>{ROLE_SUMMARY[role]}</span></div>
            <div className="gquick">
              <small>常用</small>
              {QUICK_START[role].map((a) => <button key={a.target} type="button" className="btn" onClick={() => go(a.target)}>{a.label}</button>)}
            </div>
          </div>
        </section>
      )}
      <div className={`guide${compact ? " compact" : ""}`}>
        {sections.map((s, i) => (
          <details key={s.id} className="gsec" open={!compact && i < 2}>
            <summary>
              <span className="gicon" aria-hidden="true">{s.icon}</span>
              <span className="gtitle"><h3>{s.title}</h3>{s.lead && <small><Rich text={s.lead} go={go} interactive={!compact} /></small>}</span>
              <span className="chev" aria-hidden="true">›</span>
            </summary>
            <ol className="gsteps">
              {s.items.map((it, j) => <li key={j}><Rich text={it.text} go={go} interactive={!compact} /></li>)}
            </ol>
          </details>
        ))}
        {role !== "viewer" && !compact && (
          <div className="gcard gask">
            <span>還有問題？</span>
            <button type="button" className="btn primary" onClick={() => go("chat")}>✦ 直接問 AI 小助手怎麼用</button>
          </div>
        )}
      </div>
    </>
  );
}
