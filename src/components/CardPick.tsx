import { useMemo } from "react";
import type { Kind } from "../data";
import { KIND_TIP, countryOf, explain, pct, rank, useCardsOn } from "../cards";
import type { Card, Country, Pick } from "../cards";
import { useTrip } from "../trip";

export interface Recommender {
  /** chips and sections should render */
  enabled: boolean;
  /** the switch on the 信用卡 page */
  on: boolean;
  /** the database has the card tables */
  available: boolean;
  ready: boolean;
  /** where the trip goes (decides which cards count as "abroad") */
  dest: Country;
  /** the cards this person ticked */
  mine: Card[];
  pick: (kind: Kind, date?: string) => Pick[];
}

/** This person's cards, ranked for a stop of some kind on some date. Everything reads from the trip context, so it is cheap to call per row. */
export function useRecommend(): Recommender {
  const { cards, current } = useTrip();
  const on = useCardsOn();
  const dest = countryOf(current?.place);
  const mine = useMemo(() => cards.catalog.filter((c) => cards.mine.includes(c.id)), [cards]);
  const enabled = on && cards.available && mine.length > 0;
  return { enabled, on, available: cards.available, ready: cards.ready, dest, mine, pick: (kind, date) => (enabled ? rank(mine, kind, dest, date) : []) };
}

/** The little tag on a stop row and in the overview: 💳 CSP 3.75% */
export function CardChip({ kind, date }: { kind: Kind; date?: string }) {
  const r = useRecommend();
  if (!r.enabled) return null;
  const top = r.pick(kind, date)[0];
  if (!top) return null;
  return (
    <span className={`cardpick${top.stale ? " stale" : ""}`} title={explain(top) + (top.stale ? "（優惠標示已到期，要確認）" : "")}>
      💳 {top.card.short || top.card.name}<small>{pct(top.net)}</small>
    </span>
  );
}

/** The 「刷哪張卡」 block in a stop's detail sheet: the pick, why, the condition, the runners-up and a tip for this kind of purchase. */
export function CardSection({ kind, date }: { kind: Kind; date: string }) {
  const r = useRecommend();
  if (!r.ready || !r.available || !r.on) return null;
  if (r.mine.length === 0) {
    return (
      <div className="sec cardsec">
        <h4>刷哪張卡</h4>
        <p className="note">到 <a href="#cards">💳 信用卡</a> 勾你有的卡，每一站就會告訴你刷哪張最划算（回饋最多、手續費最少）。</p>
      </div>
    );
  }
  const picks = r.pick(kind, date);
  const top = picks[0];
  const month = date ? `${Number(date.slice(5, 7))} 月` : "之後";
  return (
    <div className="sec cardsec">
      <h4>刷哪張卡</h4>
      <div className="cardtop">
        <span className="cardpick big">💳 {top.card.name}</span>
        <b className={`net${top.net < 0 ? " neg" : ""}`}>淨回饋 {pct(top.net)}</b>
      </div>
      <p className="why">{explain(top)}</p>
      {top.rate?.cond && <p className="note">條件：{top.rate.cond}</p>}
      {top.stale && <p className="note warn">⚠ 這個優惠標示到 {top.rate!.until!.replace(/-0?/g, "/").slice(5)}，{month}是否延續請先問銀行；下面「其次」的卡也可以考慮。</p>}
      {picks.length > 1 && (
        <p className="note">其次：{picks.slice(1, 4).map((p) => `${p.card.short || p.card.name} ${pct(p.net)}${p.stale ? "（要確認）" : ""}`).join("、")}</p>
      )}
      <p className="note tip">{KIND_TIP[kind]}</p>
      <a className="link" href="#cards">我的信用卡 ›</a>
    </div>
  );
}
