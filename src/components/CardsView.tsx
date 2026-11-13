import { useMemo, useState } from "react";
import { COUNTRY_NAME, COUNTRY_ORDER, NETWORKS, NETWORK_NAME, RATE_KIND_NAME, STOP_KINDS, WHERE_NAME, explain, isAbroad, pct, rank, setCardsOn } from "../cards";
import type { Card, CardRate, Country, RateKind, RateWhere } from "../cards";
import { isViewer } from "../data";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { useRecommend } from "./CardPick";

const newId = () => "c-" + (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
const fmtDate = (s: string | null | undefined) => (s ? s.replace(/-/g, "/") : "");
const COUNTRIES = COUNTRY_ORDER;
/** The rates of this card that matter at the destination, bonus categories only (for the catalog rows). */
const bonusesAt = (c: Card, dest: Country) => {
  const abroad = isAbroad(c, dest);
  return c.rates.filter((x) => x.kind !== "all" && (x.where === "home" ? !abroad : x.where === "overseas" ? abroad : x.where === dest));
};

// ---------- the editor for one catalog entry ----------
interface RateDraft { where: RateWhere; kind: RateKind; rate: string; note: string; until: string; cond: string }
interface Draft { id: string; name: string; short: string; bank: string; country: Country; network: string[]; fx_fee: string; rates: RateDraft[]; cap: string; conditions: string; source: string; checked_at: string }
const emptyRate = (where: RateWhere): RateDraft => ({ where, kind: "all", rate: "", note: "", until: "", cond: "" });
const draftOf = (c: Card | null, name = "", country: Country = "us"): Draft => ({
  id: c?.id ?? newId(), name: c?.name ?? name, short: c?.short ?? "", bank: c?.bank ?? "", country: c?.country ?? country, network: c?.network ?? [], fx_fee: String(c?.fx_fee ?? (country === "tw" ? 1.5 : 0)),
  rates: c ? c.rates.map((r) => ({ where: r.where, kind: r.kind, rate: String(r.rate), note: r.note ?? "", until: r.until ?? "", cond: r.cond ?? "" })) : [emptyRate("overseas"), { ...emptyRate("overseas"), kind: "food" }, { ...emptyRate("overseas"), kind: "hotel" }],
  cap: c?.cap ?? "", conditions: c?.conditions ?? "", source: c?.source ?? "", checked_at: c?.checked_at ?? new Date().toISOString().slice(0, 10),
});
interface LookupResult { card: Partial<Card> & { note?: string }; remaining: number }

function CardEditor({ card, name, country, onDone, onCancel }: { card: Card | null; name?: string; country?: Country; onDone: (id: string) => void; onCancel: () => void }) {
  const { member, current, reloadCards } = useTrip();
  const [d, setD] = useState<Draft>(() => draftOf(card, name, country));
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const up = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const upRate = (i: number, patch: Partial<RateDraft>) => setD((x) => ({ ...x, rates: x.rates.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  /** Sonnet looks the card up online (issuer page + card sites) and fills the form; the person checks it before saving. */
  const lookup = async () => {
    if (!current || !d.name.trim()) { setErr("先填卡片名稱"); return; }
    setBusy("ai"); setErr(null); setAiNote(null);
    try {
      const res = await invoke<LookupResult>("card-lookup", { trip_id: current.id, name: d.name.trim(), country: d.country });
      const c = res.card;
      setD((x) => ({
        ...x,
        name: c.name || x.name, short: c.short ?? x.short, bank: c.bank ?? x.bank, country: c.country ?? x.country, network: c.network ?? x.network,
        fx_fee: c.fx_fee != null ? String(c.fx_fee) : x.fx_fee,
        rates: c.rates?.length ? c.rates.map((r) => ({ where: r.where, kind: r.kind, rate: String(r.rate), note: r.note ?? "", until: r.until ?? "", cond: r.cond ?? "" })) : x.rates,
        cap: c.cap ?? x.cap, conditions: c.conditions ?? x.conditions, source: c.source ?? x.source, checked_at: new Date().toISOString().slice(0, 10),
      }));
      setAiNote(`${c.note ? c.note + " " : ""}請對照銀行公告看一下再儲存。（今天還可以查 ${res.remaining} 次）`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!supabase || !member) return;
    if (!d.name.trim()) { setErr("卡片名稱不能空"); return; }
    const fee = Number(d.fx_fee);
    if (isNaN(fee) || fee < 0 || fee > 10) { setErr("手續費請填 0～10 之間的數字（%）"); return; }
    const rates: CardRate[] = [];
    for (const r of d.rates) {
      if (r.rate.trim() === "") continue;
      const n = Number(r.rate);
      if (isNaN(n) || n < 0 || n > 50) { setErr("回饋請填 0～50 之間的數字（%）"); return; }
      if (r.until && !/^\d{4}-\d{2}-\d{2}$/.test(r.until)) { setErr("到期日請用 YYYY-MM-DD"); return; }
      const row: CardRate = { where: r.where, kind: r.kind, rate: n };
      if (r.note.trim()) row.note = r.note.trim();
      if (r.until) row.until = r.until;
      if (r.cond.trim()) row.cond = r.cond.trim();
      rates.push(row);
    }
    setBusy("save"); setErr(null);
    const who = member.name ?? member.email ?? "成員";
    const row = { id: d.id, name: d.name.trim(), short: d.short.trim() || d.name.trim().slice(0, 8), bank: d.bank.trim(), country: d.country, network: d.network, fx_fee: fee, rates, cap: d.cap.trim(), conditions: d.conditions.trim(), source: d.source.trim(), checked_at: d.checked_at || null, updated_by: member.user_id, updated_by_name: who, updated_at: new Date().toISOString() };
    const { error } = card
      ? await supabase.from("card_catalog").update(row).eq("id", d.id)
      : await supabase.from("card_catalog").insert({ ...row, created_by: member.user_id });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await reloadCards();
    onDone(d.id);
  };

  return (
    <div className="gcard cardedit">
      <h3>{card ? `編輯「${card.name}」` : "新增一張卡到卡片庫"}</h3>
      <p className="note">回饋填「在那裡買那類東西可以拿到的總回饋 %」（已含基本回饋；點數卡換成約略的 %，例：3x 點數以 1.5¢ 計 ≈ 4.5%）。「出國」＝發卡國以外都適用。沒把握的欄位留白就好，或先按「✦ 幫我查這張卡」。</p>
      <div className="formgrid">
        <label>卡片名稱<input value={d.name} onChange={(e) => up("name", e.target.value)} placeholder="例：Chase Sapphire Preferred" autoFocus={!card} /></label>
        <label>短名（標籤用）<input value={d.short} onChange={(e) => up("short", e.target.value)} placeholder="例：CSP" maxLength={10} /></label>
        <label>銀行<input value={d.bank} onChange={(e) => up("bank", e.target.value)} placeholder="例：Chase" /></label>
        <label>發卡國<select value={d.country} onChange={(e) => up("country", e.target.value as Country)}>{COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_NAME[c]}</option>)}</select></label>
        <label>海外交易手續費 %<input value={d.fx_fee} onChange={(e) => up("fx_fee", e.target.value)} inputMode="decimal" placeholder="美國卡常見 0 或 3；英國 0 或 2.99；台灣 1.5" /></label>
      </div>
      <div className="netpick" role="group" aria-label="發卡組織">
        <span className="lbl">組織</span>
        {NETWORKS.map((n) => (
          <label key={n} className={`pill${d.network.includes(n) ? " on" : ""}`}>
            <input type="checkbox" checked={d.network.includes(n)} onChange={(e) => up("network", e.target.checked ? [...d.network, n] : d.network.filter((x) => x !== n))} />{NETWORK_NAME[n]}
          </label>
        ))}
      </div>
      <div className="rates">
        <div className="rhead"><span>在哪裡</span><span>買什麼</span><span>回饋 %</span><span>說明</span><span>到期</span><span>條件</span><span /></div>
        {d.rates.map((r, i) => (
          <div className="rrow" key={i}>
            <select value={r.where} onChange={(e) => upRate(i, { where: e.target.value as RateWhere })} aria-label="在哪裡">{(Object.keys(WHERE_NAME) as RateWhere[]).map((w) => <option key={w} value={w}>{WHERE_NAME[w]}</option>)}</select>
            <select value={r.kind} onChange={(e) => upRate(i, { kind: e.target.value as RateKind })} aria-label="買什麼">{(Object.keys(RATE_KIND_NAME) as RateKind[]).map((k) => <option key={k} value={k}>{RATE_KIND_NAME[k]}</option>)}</select>
            <input value={r.rate} onChange={(e) => upRate(i, { rate: e.target.value })} inputMode="decimal" placeholder="3" aria-label="回饋 %" />
            <input value={r.note} onChange={(e) => upRate(i, { note: e.target.value })} placeholder="例：3x 點數以 1.5¢ 計" aria-label="說明" />
            <input value={r.until} onChange={(e) => upRate(i, { until: e.target.value })} placeholder="到期 2026-12-31" inputMode="numeric" aria-label="到期日" />
            <input value={r.cond} onChange={(e) => upRate(i, { cond: e.target.value })} placeholder="要登錄、上限…" aria-label="條件" />
            <button type="button" className="link" onClick={() => setD((x) => ({ ...x, rates: x.rates.filter((_, j) => j !== i) }))} aria-label="刪這一列">✕</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setD((x) => ({ ...x, rates: [...x.rates, emptyRate("overseas")] }))}>＋ 加一列回饋</button>
      </div>
      <div className="formgrid">
        <label>回饋上限<input value={d.cap} onChange={(e) => up("cap", e.target.value)} placeholder="例：無上限" /></label>
        <label>重要條件<input value={d.conditions} onChange={(e) => up("conditions", e.target.value)} placeholder="例：年費 $95；超市加碼只限美國境內" /></label>
        <label>來源網址<input value={d.source} onChange={(e) => up("source", e.target.value)} placeholder="https://…" inputMode="url" /></label>
        <label>查證日期<input value={d.checked_at} onChange={(e) => up("checked_at", e.target.value)} placeholder="YYYY-MM-DD" inputMode="numeric" /></label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={save} disabled={!!busy}>{busy === "save" ? "儲存中…" : "儲存"}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={!!busy}>取消</button>
        {!isViewer(member) && <button type="button" className="btn" onClick={lookup} disabled={!!busy} title="AI 上網查這張卡目前的海外手續費和回饋，填進表單給你核對">{busy === "ai" ? "查詢中…（約 30 秒）" : "✦ 幫我查這張卡"}</button>}
      </div>
      {aiNote && <p className="note">{aiNote}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** One card in a list: name, country, network, fee, what it earns at the destination, the maintenance line. */
function CardRow({ c, dest, date, mine, actions }: { c: Card; dest: Country; date?: string; mine: boolean; actions: React.ReactNode }) {
  const best = rank([c], "all", dest, date)[0];
  const bonuses = bonusesAt(c, dest);
  const abroad = isAbroad(c, dest);
  return (
    <li>
      <div className="cmain">
        <span><b>{c.name}</b><span className={`tag cc ${c.country}`}>{COUNTRY_NAME[c.country] ?? c.country}</span>{mine && <span className="tag shared">我有</span>}</span>
        <span className="cmeta">{c.bank}{c.network.length > 0 && ` ・ ${c.network.map((n) => NETWORK_NAME[n] ?? n).join("／")}`}{abroad ? ` ・ 海外手續費 ${pct(c.fx_fee)}` : " ・ 在發卡國內，不收海外手續費"}</span>
        <span className="cwhy">{COUNTRY_NAME[dest]}一般消費：{explain(best)}{best.stale ? "（優惠標示已到期，要確認）" : ""}</span>
        {bonuses.length > 0 && <span className="cwhy">{bonuses.map((x) => `${RATE_KIND_NAME[x.kind]} ${pct(x.rate)}${x.note ? `（${x.note}）` : ""}`).join("、")}</span>}
        {(c.conditions || c.cap) && <span className="cwhy muted">{[c.conditions, c.cap].filter(Boolean).join(" ")}</span>}
        <span className="cmeta">查證 {fmtDate(c.checked_at)}{c.updated_by_name ? ` ・ ${c.updated_by_name} 改過` : ""}{c.source && <> ・ <a href={c.source} target="_blank" rel="noopener">來源 ↗</a></>}</span>
      </div>
      <div className="cacts">{actions}</div>
    </li>
  );
}

// ---------- the page ----------
export function CardsView() {
  const { member, current, cards, reloadCards } = useTrip();
  const r = useRecommend();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ card: Card | null; name?: string; addToMine?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Country | "all">("all");
  const dest = r.dest;
  const destName = COUNTRY_NAME[dest];
  const date0 = current?.start_date, date1 = current?.end_date;

  const mineSet = useMemo(() => new Set(cards.mine), [cards.mine]);
  const sorted = useMemo(() => [...cards.catalog].sort((a, b) => COUNTRY_ORDER.indexOf(a.country) - COUNTRY_ORDER.indexOf(b.country) || a.bank.localeCompare(b.bank) || a.name.localeCompare(b.name)), [cards.catalog]);
  const counts = useMemo(() => { const m: Partial<Record<Country, number>> = {}; for (const c of cards.catalog) m[c.country] = (m[c.country] ?? 0) + 1; return m; }, [cards.catalog]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return sorted.filter((c) => !mineSet.has(c.id) && `${c.name} ${c.short} ${c.bank} ${COUNTRY_NAME[c.country]}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, sorted, mineSet]);

  const add = async (id: string) => {
    if (!supabase || !member) return;
    setBusy(id); setErr(null);
    const { error } = await supabase.from("my_cards").insert({ user_id: member.user_id, card_id: id });
    setBusy(null);
    if (error && !/duplicate/i.test(error.message)) { setErr(error.message); return; }
    setQ("");
    await reloadCards();
  };
  const remove = async (id: string) => {
    if (!supabase || !member) return;
    setBusy(id); setErr(null);
    const { error } = await supabase.from("my_cards").delete().eq("user_id", member.user_id).eq("card_id", id);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await reloadCards();
  };
  const del = async (c: Card) => {
    if (!supabase || !confirm(`把「${c.name}」從卡片庫刪掉？有勾這張卡的人也會一起失去它。`)) return;
    setBusy(c.id); setErr(null);
    const { error } = await supabase.from("card_catalog").delete().eq("id", c.id);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await reloadCards();
  };
  const canDelete = (c: Card) => !!member && (c.created_by === member.user_id || member.role === "admin");

  if (cards.ready && !cards.available) {
    return (
      <section className="dayhead">
        <h2>信用卡</h2>
        <p className="note">資料庫還沒升級到有信用卡的版本（要跑 <code>make db-push</code>）。升級後這裡可以勾你有的卡，每一站會標出刷哪張最划算。</p>
      </section>
    );
  }

  // the plan: for each kind of spending, the best of my cards (at the trip's first day); flag promos that end before the trip ends
  const plan = STOP_KINDS.map((k) => ({ k, picks: r.mine.length ? rank(r.mine, k, dest, date0) : [] }));
  const endsEarly = r.mine.length && date1 ? STOP_KINDS.some((k) => rank(r.mine, k, dest, date1)[0]?.stale) : false;

  return (
    <>
      <section className="dayhead">
        <h2>信用卡</h2>
        <p className="note">勾你有的卡（美國、英國、台灣的都可以），每一站就會標出在{destName}刷哪張最划算：回饋最多、手續費最少（淨回饋 ＝ 回饋 − 海外交易手續費）。卡片庫是大家一起維護的，優惠會變，請以銀行公告為準。</p>
      </section>

      <div className="toolbar">
        <label className="switch" title="開著的話，每一站旁邊會有一個小標籤寫推薦刷哪張">
          <input type="checkbox" checked={r.on} onChange={(e) => setCardsOn(e.target.checked)} />
          <span className="track" aria-hidden="true" />
          <span>每一站顯示推薦的卡</span>
        </label>
        {!r.on && <span className="note" style={{ margin: 0 }}>關掉後行程上不會出現 💳 標籤，這一頁還是可以看。</span>}
      </div>

      {editing && <CardEditor key={editing.card?.id ?? "new"} card={editing.card} name={editing.name} country={filter === "all" ? "us" : filter} onCancel={() => setEditing(null)} onDone={async (id) => { if (editing.addToMine) await add(id); setEditing(null); }} />}

      <div className="gcard mycards">
        <h3>我的卡 {r.mine.length > 0 && <small className="muted">{r.mine.length} 張</small>}</h3>
        {!cards.ready ? <p className="note">載入中…</p> : r.mine.length === 0 ? (
          <p className="note">還沒有卡。在下面打卡名或銀行加入（例：Sapphire、Amex Gold、Barclaycard、CUBE）；卡片庫沒有的可以新增一張，讓 AI 幫查。</p>
        ) : (
          <ul className="cardlist">
            {r.mine.map((c) => (
              <CardRow key={c.id} c={c} dest={dest} date={date0} mine={false} actions={<>
                <button type="button" className="link" onClick={() => setEditing({ card: c })}>✎ 改資料</button>
                <button type="button" className="link" onClick={() => remove(c.id)} disabled={busy === c.id}>移除</button>
              </>} />
            ))}
          </ul>
        )}
        <div className="addcard">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="加一張卡：打卡名或銀行，例：Sapphire、Venture、Amex、Barclaycard、CUBE" aria-label="搜尋卡片庫" />
          {q.trim() && (
            <ul className="hits">
              {matches.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => add(c.id)} disabled={busy === c.id}>
                    <b>{c.name} <span className={`tag cc ${c.country}`}>{COUNTRY_NAME[c.country]}</span></b>
                    <small>{c.bank} ・ {destName}一般 {explain(rank([c], "all", dest, date0)[0]).split("＝")[0].trim()}</small>
                  </button>
                </li>
              ))}
              <li><button type="button" className="new" onClick={() => { setEditing({ card: null, name: q.trim(), addToMine: true }); }}>＋ 卡片庫沒有「{q.trim()}」，新增一張（可以讓 AI 幫查）</button></li>
            </ul>
          )}
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {r.mine.length > 0 && (
        <div className="gcard plan">
          <h3>這趟怎麼刷</h3>
          <p className="note">依消費類型算的推薦（以 {fmtDate(date0)} 的優惠計）。{endsEarly ? "有些優惠標示在行程結束前到期，那幾天的站會有 ⚠ 提醒。" : ""}</p>
          <div className="tablewrap">
            <table className="infotable plantable">
              <thead><tr><th>類型</th><th>推薦</th><th>淨回饋</th><th>為什麼／條件</th></tr></thead>
              <tbody>
                {plan.map(({ k, picks }) => {
                  const p = picks[0];
                  return (
                    <tr key={k}>
                      <td>{RATE_KIND_NAME[k]}</td>
                      <td>💳 {p.card.short || p.card.name}{p.stale && " ⚠"}</td>
                      <td className={p.net < 0 ? "neg" : ""}>{pct(p.net)}</td>
                      <td>{explain(p)}{p.rate?.cond ? `；${p.rate.cond}` : ""}{picks.length > 1 ? `。其次 ${picks.slice(1, 3).map((x) => `${x.card.short || x.card.name} ${pct(x.net)}`).join("、")}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="gcard tips">
        <h3>在{destName}刷卡的小提醒</h3>
        <ul>
          <li>店員或機器問要用哪種幣別結帳，一律選<b>當地貨幣（日本選日圓 JPY）</b>。選自己國家的幣別（DCC）會用店家較差的匯率換算，多付 3～7%。</li>
          <li><b>海外交易手續費</b>才是大頭：美國卡常見 3%、英國卡 2.99%、台灣卡 1.5%；沒有這筆費用的旅遊卡（Sapphire、Venture、Amex Gold/Platinum、Barclaycard Rewards、Halifax Clarity…）出國時通常勝過回饋高但收 3% 的卡。表上的「淨回饋」已經扣掉了。</li>
          <li>美國卡的「超市」「加油」加碼多半只限美國境內；餐廳、旅遊類多數全球適用。英國 Amex 的 MR 點數價值偏低，查卡片時注意換算。</li>
          <li>日本 Visa／Mastercard／JCB 幾乎都收；<b>AmEx 和 Discover</b>（走 JCB 網路）在大店沒問題，小店、拉麵店常常不收，備一張 Visa/Mastercard。感應付款（Apple Pay 的 Visa/Mastercard/AmEx）便利商店、車站、連鎖店都能用。</li>
          <li>Apple Pay 的 Suica／PASMO 用美國、英國卡加值可以（Mastercard、AmEx 最穩；部分 Visa 會被拒）。免稅店退稅會看結帳那張卡；小店、神社、售票機常常只收現金。</li>
          <li>很多加碼要<b>先登錄</b>或在 App 切換方案；到期日多寫到年底，跨年後的條款銀行多在 12 月才公告。</li>
        </ul>
      </div>

      <details className="gsec catalog">
        <summary>
          <span className="gicon" aria-hidden="true">🗂</span>
          <span className="gtitle"><h3>卡片庫（{cards.catalog.length} 張）</h3><small>大家共用；看到優惠變了就按「改資料」更新，誰改的會記下來。</small></span>
          <span className="chev" aria-hidden="true">›</span>
        </summary>
        <div className="catbody">
          <div className="catbar">
            <div className="modebar" role="group" aria-label="哪一國的卡">
              <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>全部</button>
              {COUNTRIES.filter((c) => counts[c]).map((c) => <button key={c} type="button" className={filter === c ? "on" : ""} onClick={() => setFilter(c)}>{COUNTRY_NAME[c]} {counts[c]}</button>)}
            </div>
            <button type="button" className="btn" onClick={() => setEditing({ card: null })}>＋ 新增一張卡</button>
          </div>
          <ul className="cardlist">
            {sorted.filter((c) => filter === "all" || c.country === filter).map((c) => (
              <CardRow key={c.id} c={c} dest={dest} date={date0} mine={mineSet.has(c.id)} actions={<>
                {mineSet.has(c.id)
                  ? <button type="button" className="link" onClick={() => remove(c.id)} disabled={busy === c.id}>移除</button>
                  : <button type="button" className="link" onClick={() => add(c.id)} disabled={busy === c.id}>＋ 我有這張</button>}
                <button type="button" className="link" onClick={() => setEditing({ card: c })}>✎ 改資料</button>
                {canDelete(c) && <button type="button" className="link danger" onClick={() => del(c)} disabled={busy === c.id}>刪除</button>}
              </>} />
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
