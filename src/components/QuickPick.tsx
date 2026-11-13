import { useEffect, useRef, useState } from "react";
import { COUNTRY_NAME, KIND_TIP, NETWORK_NAME, RATE_KIND_NAME, STOP_KINDS, explain, pct } from "../cards";
import type { Pick, StopKind } from "../cards";
import { useNow } from "../now";
import { useTrip } from "../trip";
import { useRecommend } from "./CardPick";

const ICON: Record<StopKind, string> = { food: "🍜", shop: "🛍", hotel: "🏨", move: "🚃", sight: "⛩" };
const ORDER: StopKind[] = ["food", "shop", "hotel", "move", "sight"];
/** Visa / Mastercard / JCB are taken almost everywhere in Japan; AmEx, Discover and UnionPay often are not at small shops. */
const WIDELY = ["visa", "mastercard", "jcb"];
const widelyAccepted = (p: Pick) => p.card.network.length === 0 || p.card.network.some((n) => WIDELY.includes(n));

/** The pocket card: five big rows, one per kind of purchase, each with the card to pull out and a fallback when the shop refuses AmEx. */
function QuickPickSheet({ onClose }: { onClose: () => void }) {
  const r = useRecommend();
  const { current } = useTrip();
  const now = useNow();
  const closeRef = useRef<HTMLButtonElement>(null);
  // today's promotions while travelling, the first day's otherwise
  const date = current && now.date >= current.start_date && now.date <= current.end_date ? now.date : current?.start_date;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [onClose]);
  const rows = ORDER.filter((k) => STOP_KINDS.includes(k)).map((k) => {
    const picks = r.pick(k, date);
    const top = picks[0];
    const fallback = top && !widelyAccepted(top) ? picks.find(widelyAccepted) : undefined;
    return { k, top, fallback };
  });
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog quickpick" role="dialog" aria-modal="true" aria-labelledby="qp-title">
        <header>
          <div>
            <h3 id="qp-title">現在刷哪張？</h3>
            <small>在{COUNTRY_NAME[r.dest]}，依你勾的 {r.mine.length} 張卡算。結帳幣別選當地貨幣。</small>
          </div>
          <button ref={closeRef} type="button" className="x" aria-label="關閉" onClick={onClose}>×</button>
        </header>
        <ul className="qprows">
          {rows.map(({ k, top, fallback }) => top && (
            <li key={k} className={top.stale ? "stale" : ""}>
              <span className="qpk" aria-hidden="true">{ICON[k]}</span>
              <div className="qpmain">
                <span className="qpl">{RATE_KIND_NAME[k]}</span>
                <span className="qpcard">{top.card.name}</span>
                <span className="qpwhy">{explain(top)}{top.stale ? "・⚠ 優惠標示已到期，要確認" : ""}</span>
                {top.rate?.cond && <span className="qpcond">{top.rate.cond}</span>}
                {fallback && <span className="qpfb">不收 {top.card.network.map((n) => NETWORK_NAME[n] ?? n).join("／")} 就用 <b>{fallback.card.short || fallback.card.name}</b>（淨 {pct(fallback.net)}）</span>}
              </div>
              <b className={`qpnet${top.net < 0 ? " neg" : ""}`}>{pct(top.net)}</b>
            </li>
          ))}
        </ul>
        <p className="note qptip">{KIND_TIP.shop}</p>
        <div className="actions">
          <a className="btn" href="#cards" onClick={onClose}>我的信用卡 ›</a>
          <button type="button" className="btn primary" onClick={onClose}>知道了</button>
        </div>
      </div>
    </>
  );
}

/** Bottom-left floating button, shown whenever the person has cards and the switch is on. Opens the pocket card. */
export function QuickPickFab() {
  const r = useRecommend();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!r.enabled) setOpen(false); }, [r.enabled]);
  if (!r.enabled) return null;
  return (
    <>
      <button type="button" className="cardfab" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} title="現在要買東西，刷哪張卡最划算">💳 刷哪張</button>
      {open && <QuickPickSheet onClose={() => setOpen(false)} />}
    </>
  );
}
