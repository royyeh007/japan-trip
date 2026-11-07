import { useEffect, useRef, useState } from "react";
import type { Proposal } from "../data";
import { invoke } from "../supabase";
import { useTrip } from "../trip";
import { ProposalCard } from "./Proposals";

interface Prop { id: string; proposal: Proposal; status?: "approved" | "rejected" }
interface Turn { role: "user" | "assistant"; content: string; proposals?: Prop[] }

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.7L19.5 9.5l-5.7 1.8L12 17l-1.8-5.7L4.5 9.5l5.7-1.8L12 2zM5 16l.9 2.6L8.5 19.5l-2.6.9L5 23l-.9-2.6L1.5 19.5l2.6-.9L5 16z" /></svg>
);

/** Floating chat button (bottom-right) + the chat panel. Stays mounted so an in-flight reply survives closing the panel. */
export function ChatWidget() {
  const { member } = useTrip();
  const key = `jp-chat-${member?.user_id ?? ""}`;
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(turns.slice(-40))); } catch { /* ignore */ } }, [key, turns]);
  useEffect(() => { if (open) { setUnread(false); endRef.current?.scrollIntoView({ block: "end" }); setTimeout(() => inputRef.current?.focus(), 50); } }, [open, turns, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...turns, { role: "user" as const, content }];
    setTurns(next); setText(""); setBusy(true); setErr(null);
    try {
      const res = await invoke<{ reply: string; proposals: { id: string; proposal: Proposal }[] }>("chat", { messages: next.map(({ role, content }) => ({ role, content })) });
      setTurns([...next, { role: "assistant", content: res.reply, proposals: res.proposals }]);
      if (!openRef.current) setUnread(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const markDone = (turnIndex: number, id: string, status: "approved" | "rejected") =>
    setTurns((ts) => ts.map((t, i) => i !== turnIndex ? t : { ...t, proposals: t.proposals?.map((p) => p.id === id ? { ...p, status } : p) }));

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
            <small>問行程細節，或直接說要改什麼</small>
          </div>
          <button type="button" className="x" aria-label="關閉" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="msgs">
          {turns.length === 0 && <div className="msg bot">嗨！問我行程的事，或直接說要改什麼。</div>}
          {turns.map((t, i) => (
            <div key={i} className={`msg ${t.role === "user" ? "user" : "bot"}`}>
              {t.content}
              {t.proposals?.map((p) => p.status
                ? <div key={p.id} className="chip">{p.status === "approved" ? "已更新到行程" : "已取消"}</div>
                : <ProposalCard key={p.id} id={p.id} proposal={p.proposal} onDone={(s) => markDone(i, p.id, s)} />)}
            </div>
          ))}
          {busy && <div className="msg bot thinking">想一下…</div>}
          {err && <div className="msg bot err">出錯了：{err}</div>}
          <div ref={endRef} />
        </div>
        <form className="chatform" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="輸入問題或想改的行程…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>送出</button>
        </form>
        {turns.length > 0 && <button type="button" className="link clear" onClick={() => setTurns([])}>清除對話</button>}
      </section>
    </>
  );
}
