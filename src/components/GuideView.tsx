import { ROLE_NAMES, ROLE_SUMMARY, guideFor } from "../../supabase/functions/_shared/guide";
import type { GuideRole } from "../../supabase/functions/_shared/guide";
import { askClaude } from "./Chat";

/** The how-to page, showing only what this role can do. Also used (with a fixed role) on the trip picker. */
export function GuideView({ role, compact = false }: { role: GuideRole; compact?: boolean }) {
  const sections = guideFor(role);
  return (
    <>
      {!compact && (
        <section className="dayhead">
          <h2>使用教學</h2>
          <p className="note">你在這個行程是<b>{ROLE_NAMES[role]}</b>：{ROLE_SUMMARY[role]}</p>
        </section>
      )}
      <div className="guide">
        {sections.map((s, i) => (
          <details key={s.id} className="panel gsec" open={!compact && i < 2}>
            <summary><h3>{s.title}</h3><span className="chev" aria-hidden="true">›</span></summary>
            <ul>{s.items.map((it, j) => <li key={j}>{it.text}</li>)}</ul>
          </details>
        ))}
        {role !== "viewer" && !compact && (
          <p className="note guideask">還有問題？<button type="button" className="link" onClick={() => askClaude("這個網站要怎麼")}>直接問 Claude 怎麼用</button></p>
        )}
      </div>
    </>
  );
}
