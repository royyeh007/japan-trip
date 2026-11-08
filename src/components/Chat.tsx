import { useCallback, useEffect, useRef, useState } from "react";
import type { Proposal } from "../data";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { ProposalCard } from "./Proposals";

interface Prop { id: string; proposal: Proposal }
interface Msg { id: string; role: "user" | "assistant"; content: string; proposals: Prop[]; status: "pending" | "done" | "error"; created_at: string }

const EXAMPLES = [
  "12/29 晚餐幾點、訂位碼多少？",
  "12/28 從東京怎麼去長野？",
  "我們家 12/26 15:00 到羽田，晚上住 Conrad，幫我加進去",
  "12/30 我們家想住草津別間飯店，其他照舊",
  "這個網站怎麼加一天？",
];

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.7L19.5 9.5l-5.7 1.8L12 17l-1.8-5.7L4.5 9.5l5.7-1.8L12 2zM5 16l.9 2.6L8.5 19.5l-2.6.9L5 23l-.9-2.6L1.5 19.5l2.6-.9L5 16z" /></svg>
);

/**
 * Floating chat button + panel. Conversation lives on the server: the function answers in the background and
 * writes the reply into chat_messages, so switching apps or a page reload never loses a reply (or the tokens).
 */
export function ChatWidget() {
  const { member } = useTrip();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [decided, setDecided] = useState<Record<string, "approved" | "rejected">>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // ---- server-side history ----
  const load = useCallback(async () => {
    if (!supabase || !member) return;
    const { data } = await supabase.from("chat_messages").select("id, role, content, proposals, status, created_at").eq("user_id", member.user_id).order("created_at").limit(60);
    const rows = (data ?? []) as Msg[];
    setMsgs(rows);
    setLoaded(true);
    const ids = rows.flatMap((m) => m.proposals.map((p) => p.id));
    if (ids.length) {
      const { data: ups } = await supabase.from("uploads").select("id, status").in("id", ids);
      setDecided(Object.fromEntries((ups ?? []).filter((u) => u.status !== "pending").map((u) => [u.id, u.status === "approved" ? "approved" : "rejected"])));
    }
  }, [member]);
  useEffect(() => { load(); }, [load]);

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
      const res = await invoke<{ id: string }>("chat", { text: content });
      // the server has the real rows now; swap the placeholder id so polling picks it up
      setMsgs((ms) => ms.map((m) => (m.id === tmpBot ? { ...m, id: res.id } : m)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsgs((ms) => ms.filter((m) => m.id !== tmpBot));
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!supabase || !member || !confirm("清除你的對話紀錄？")) return;
    await supabase.from("chat_messages").delete().eq("user_id", member.user_id);
    setMsgs([]);
  };

  return (
    <>
      <button type="button" className="chatfab" aria-expanded={open} aria-controls="chatpanel" onClick={() => setOpen((o) => !o)}>
        <SparkIcon />問 Claude
        {unread && <span className="dot" aria-label="有新回覆" />}
      </button>
      {open && <div className="chatscrim" onClick={() => setOpen(false)} />}
      <section id="chatpanel" className="chatpanel" hidden={!open} role="dialog" aria-label="問 Claude">
        <header>
          <div>
            <b>問 Claude</b>
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
