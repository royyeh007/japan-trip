import { useCallback, useEffect, useRef, useState } from "react";
import { dateOf } from "../data";
import type { Proposal } from "../data";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { ProposalCard } from "./Proposals";
import { openInfoPage } from "./InfoView";

interface Prop { id: string; proposal: Proposal }
interface Msg { id: string; role: "user" | "assistant"; content: string; proposals: Prop[]; status: "pending" | "done" | "error"; created_at: string }

/** Example questions, using this trip's real dates and places. */
function examples(days: { id: string; city: string }[], start: string, end: string) {
  const first = days[0], last = days[days.length - 1];
  const d1 = dateOf(first?.id ?? start).d, d2 = dateOf(days[1]?.id ?? end).d, dl = dateOf(last?.id ?? end).d;
  return [
    `${d1} 的行程是什麼？晚餐有訂位嗎？`,
    `${d2} 怎麼去${days[1]?.city ?? last?.city ?? "下一個城市"}？`,
    `我們家 ${d1} 15:00 到機場，晚上住 ○○ 飯店，幫我加進去`,
    `${dl} 我們家想住別間飯店，其他照舊`,
    "這個網站怎麼加一天？",
  ];
}

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.7L19.5 9.5l-5.7 1.8L12 17l-1.8-5.7L4.5 9.5l5.7-1.8L12 2zM5 16l.9 2.6L8.5 19.5l-2.6.9L5 23l-.9-2.6L1.5 19.5l2.6-.9L5 16z" /></svg>
);

/**
 * Floating chat button + panel. Conversation lives on the server: the function answers in the background and
 * writes the reply into chat_messages, so switching apps or a page reload never loses a reply (or the tokens).
 */
export function ChatWidget() {
  const { member, current, trip, reload } = useTrip();
  const EXAMPLES = examples(trip.days.filter((d) => !d.fam || d.fam.includes(member?.family_id ?? "")).sort((a, b) => a.id.localeCompare(b.id)), current?.start_date ?? "", current?.end_date ?? "");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [decided, setDecided] = useState<Record<string, "approved" | "rejected">>({});
  const [saved, setSaved] = useState<Record<string, string>>({}); // message id → info page id (「存到其他資訊」)
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // ---- server-side history ----
  const uid = member?.user_id, tripId = current?.id;
  const load = useCallback(async () => {
    if (!supabase || !uid || !tripId) return;
    const { data } = await supabase.from("chat_messages").select("id, role, content, proposals, status, created_at").eq("trip_id", tripId).eq("user_id", uid).order("created_at").limit(60);
    const rows = (data ?? []) as Msg[];
    setMsgs(rows);
    setLoaded(true);
    const ids = rows.flatMap((m) => m.proposals.map((p) => p.id));
    if (ids.length) {
      const { data: ups } = await supabase.from("uploads").select("id, status").in("id", ids);
      setDecided(Object.fromEntries((ups ?? []).filter((u) => u.status !== "pending").map((u) => [u.id, u.status === "approved" ? "approved" : "rejected"])));
    }
  }, [uid, tripId]);
  useEffect(() => { setMsgs([]); setLoaded(false); load(); }, [load]);

  // ---- poll any pending reply (also after a reload) ----
  const pending = msgs.filter((m) => m.status === "pending").map((m) => m.id).join(",");
  useEffect(() => {
    if (!pending || !supabase) return;
    const ids = pending.split(",");
    const t = setInterval(async () => {
      const { data } = await supabase!.from("chat_messages").select("id, role, content, proposals, status, created_at").in("id", ids);
      const finished = (data ?? []).filter((m) => m.status !== "pending") as Msg[];
      if (finished.length) {
        setMsgs((ms) => ms.map((m) => finished.find((f) => f.id === m.id) ?? m));
        if (!openRef.current) setUnread(true);
      }
    }, 2500);
    return () => clearInterval(t);
  }, [pending]);

  useEffect(() => { if (open) { setUnread(false); endRef.current?.scrollIntoView({ block: "end" }); setTimeout(() => inputRef.current?.focus(), 50); } }, [open, msgs]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Other parts of the page can open the chat with a question ready to send
  useEffect(() => {
    const onAsk = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t) setText(t); setOpen(true); };
    window.addEventListener("jp-chat-ask", onAsk);
    return () => window.removeEventListener("jp-chat-ask", onAsk);
  }, []);

  const send = async (preset?: string) => {
    const content = (preset ?? text).trim();
    if (!content || busy) return;
    setText(""); setBusy(true); setErr(null);
    const now = new Date().toISOString();
    const tmpUser = `tmp-u-${Date.now()}`, tmpBot = `tmp-a-${Date.now()}`;
    setMsgs((ms) => [...ms, { id: tmpUser, role: "user", content, proposals: [], status: "done", created_at: now }, { id: tmpBot, role: "assistant", content: "", proposals: [], status: "pending", created_at: now }]);
    try {
      const res = await invoke<{ id: string }>("chat", { trip_id: current?.id, text: content });
      // the server has the real rows now; swap the placeholder id so polling picks it up
      setMsgs((ms) => ms.map((m) => (m.id === tmpBot ? { ...m, id: res.id } : m)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsgs((ms) => ms.filter((m) => m.id !== tmpBot));
    } finally { setBusy(false); }
  };

  // Keep a reply as a 其他資訊 page: no new AI call, the tokens were already spent on the answer.
  const saveInfo = async (m: Msg) => {
    if (!supabase || !member || !current) return;
    const i = msgs.findIndex((x) => x.id === m.id);
    const q = i > 0 && msgs[i - 1].role === "user" ? msgs[i - 1].content.trim() : "";
    const firstLine = m.content.split("\n").find((l) => l.trim())?.replace(/^[#*\-\s]+/, "").trim() ?? "";
    const title = (q || firstLine || "AI 助理的回答").slice(0, 40);
    const id = (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
    const { error } = await supabase.from("info_pages").insert({
      trip_id: current.id, id, title, body: (q ? `> ${q}\n\n` : "") + m.content, blocks: null,
      sort: Math.max(-1, ...trip.info.map((p) => p.sort)) + 1, created_by: member.user_id, updated_by: member.user_id, updated_by_name: member.name,
    });
    if (error) { setErr(`存不進其他資訊：${error.message}`); return; }
    setSaved((s) => ({ ...s, [m.id]: id }));
    await reload();
  };

  const clear = async () => {
    if (!supabase || !member || !current || !confirm("清除你在這個行程的對話紀錄？")) return;
    await supabase.from("chat_messages").delete().eq("trip_id", current.id).eq("user_id", member.user_id);
    setMsgs([]);
  };

  return (
    <>
      <button type="button" className="chatfab" aria-expanded={open} aria-controls="chatpanel" onClick={() => setOpen((o) => !o)}>
        <SparkIcon />AI 助理
        {unread && <span className="dot" aria-label="有新回覆" />}
      </button>
      {open && <div className="chatscrim" onClick={() => setOpen(false)} />}
      <section id="chatpanel" className="chatpanel" hidden={!open} role="dialog" aria-label="AI 助理">
        <header>
          <div>
            <b>AI 助理</b>
            <small>問行程細節，或直接說要改什麼。切出去也沒關係，回覆會留著。</small>
          </div>
          <button type="button" className="x" aria-label="關閉" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="msgs">
          {loaded && msgs.length === 0 && (
            <>
              <div className="msg bot intro">
                嗨！我可以幫你：
                {"\n"}✦ 查行程：幾點、在哪、訂位碼、怎麼去
                {"\n"}✦ 改行程：說想改什麼，整理好按「確認」就更新
                {"\n"}✦ 補你們家自己的日子：直接描述那天的安排
                {"\n"}✦ 這個網站怎麼用
                {"\n"}試試看點下面的例子 👇
              </div>
              <div className="chips">
                {EXAMPLES.map((e) => <button key={e} type="button" className="chip-btn" onClick={() => send(e)} disabled={busy}>{e}</button>)}
              </div>
            </>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={`msg ${m.role === "user" ? "user" : "bot"}${m.status === "pending" ? " thinking" : ""}${m.status === "error" ? " err" : ""}`}>
              {m.status === "pending" ? "想一下…（切出去也沒關係，回來會有答案）" : m.content}
              {m.role === "assistant" && m.status === "done" && m.content && !m.id.startsWith("tmp-") && (
                saved[m.id]
                  ? <div className="saverow"><span className="chip">已存到其他資訊</span><button type="button" className="link" onClick={() => { setOpen(false); openInfoPage(saved[m.id]); }}>打開 ›</button></div>
                  : <div className="saverow"><button type="button" className="link" onClick={() => saveInfo(m)}>存到其他資訊</button></div>
              )}
              {m.proposals.map((p) => decided[p.id]
                ? <div key={p.id} className="chip">{decided[p.id] === "approved" ? "已更新到行程" : "已取消"}</div>
                : <ProposalCard key={p.id} id={p.id} proposal={p.proposal} onDone={(s) => setDecided((d) => ({ ...d, [p.id]: s }))} />)}
            </div>
          ))}
          {err && <div className="msg bot err">送不出去：{err}</div>}
          <div ref={endRef} />
        </div>
        <form className="chatform" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="輸入問題或想改的行程…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>送出</button>
        </form>
        {msgs.length > 0 && <button type="button" className="link clear" onClick={clear}>清除對話</button>}
      </section>
    </>
  );
}

/** Open the chat panel with this question typed in (the person still presses 送出). */
export function askClaude(text: string) {
  window.dispatchEvent(new CustomEvent("jp-chat-ask", { detail: text }));
}
