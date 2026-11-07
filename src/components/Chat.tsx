import { useEffect, useRef, useState } from "react";
import type { Proposal } from "../data";
import { invoke } from "../supabase";
import { useTrip } from "../trip";
import { ProposalCard } from "./Proposals";

interface Prop { id: string; proposal: Proposal; status?: "approved" | "rejected" }
interface Turn { role: "user" | "assistant"; content: string; proposals?: Prop[] }

export function Chat() {
  const { member } = useTrip();
  const key = `jp-chat-${member?.email ?? ""}`;
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(turns.slice(-40))); } catch { /* ignore */ } }, [key, turns]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...turns, { role: "user" as const, content }];
    setTurns(next); setText(""); setBusy(true); setErr(null);
    try {
      const res = await invoke<{ reply: string; proposals: { id: string; proposal: Proposal }[] }>("chat", { messages: next.map(({ role, content }) => ({ role, content })) });
      setTurns([...next, { role: "assistant", content: res.reply, proposals: res.proposals }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const markDone = (turnIndex: number, id: string, status: "approved" | "rejected") =>
    setTurns((ts) => ts.map((t, i) => i !== turnIndex ? t : { ...t, proposals: t.proposals?.map((p) => p.id === id ? { ...p, status } : p) }));

  return (
    <>
      <section className="dayhead">
        <h2>問 Claude</h2>
        <p className="note">可以問行程細節（幾點、訂位碼、怎麼去），也可以直接說「幫我把 12/26 晚餐改成 7 點」或「我們家 12/27 要去迪士尼」。它整理好會出現確認按鈕，按下去就更新。</p>
      </section>
      <div className="chat">
        <div className="msgs">
          {turns.length === 0 && <div className="msg bot">嗨！我看得到四家的行程，有什麼想問或想改的？</div>}
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
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="輸入問題或想改的行程…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>送出</button>
        </form>
        {turns.length > 0 && <button type="button" className="link" onClick={() => setTurns([])}>清除對話</button>}
      </div>
    </>
  );
}
