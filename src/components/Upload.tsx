import { useCallback, useEffect, useState } from "react";
import type { Proposal, Upload as UploadRow } from "../data";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { openForm } from "../form";
import { DownloadIcon } from "../icons";
import { ProposalCard, STATUS } from "./Proposals";

export function UploadView() {
  const { member, current, labelOf } = useTrip();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; proposal: Proposal } | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);

  const loadRows = useCallback(async () => {
    if (!supabase || !current) return;
    const { data } = await supabase.from("uploads").select("id, family_id, uploaded_by, kind, path, status, parsed, error, created_at").eq("trip_id", current.id).order("created_at", { ascending: false }).limit(50);
    setRows((data ?? []) as UploadRow[]);
  }, [current]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const submit = async () => {
    if (!supabase || !member || !current || (!file && !text.trim())) return;
    setErr(null); setResult(null);
    try {
      let path: string | undefined;
      if (file) {
        setBusy("上傳檔案中…");
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        path = `${current.id}/${member.family_id}/${Date.now()}-${file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}.${ext}`;
        const { error } = await supabase.storage.from("uploads").upload(path, file);
        if (error) throw new Error(error.message);
      }
      setBusy("Claude 讀取中，大約 20–60 秒…");
      const res = await invoke<{ id: string; proposal: Proposal }>("parse-upload", { trip_id: current.id, path, text: text.trim() || undefined });
      setResult(res); setFile(null); setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  // Earlier proposals still waiting for a decision (own ones; admin sees everyone's), minus the one just shown above
  const pending = rows.filter((r) => r.status === "pending" && r.parsed && r.id !== result?.id);
  const history = rows.filter((r) => r.status !== "pending" && r.uploaded_by === member?.user_id);

  return (
    <>
      <section className="dayhead">
        <h2>上傳行程</h2>
        <p className="note">傳填好的表單（xlsx）、行程截圖、PDF，或直接貼文字。Claude 整理好後你看一下，按「確認，更新行程」就會更新到網頁上。</p>
      </section>

      <div className="panel">
        <h3>上傳</h3>
        <div className="uploadform">
          <label className="filepick">
            <input type="file" accept=".xlsx,.xls,.csv,.pdf,.txt,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : "選檔案：表單 xlsx、截圖、PDF"}</span>
          </label>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="或直接貼行程文字，例如：12/26 15:00 到機場，17:00 飯店 check-in，18:30 晚餐 ○○…" />
          <div className="actions">
            <button type="button" className="btn primary" onClick={submit} disabled={!!busy || (!file && !text.trim())}>{busy ?? "送出給 Claude 整理"}</button>
            <button type="button" className="btn" onClick={() => openForm(current?.name)}><DownloadIcon />下載填寫表單</button>
          </div>
          {err && <p className="err">{err}</p>}
          {result && (
            <div className="resultbox">
              <p><b>Claude 讀出來的內容，看一下沒問題就按確認：</b></p>
              <ProposalCard id={result.id} proposal={result.proposal} onDone={loadRows} />
            </div>
          )}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="panel">
          <h3>還沒確認的（{pending.length}）</h3>
          {pending.map((r) => (
            <ProposalCard key={r.id} id={r.id} proposal={r.parsed!}
              meta={`${labelOf(r.family_id)}・${r.kind === "chat" ? "從聊天" : "上傳"}・${new Date(r.created_at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
              onDone={loadRows} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="panel">
          <h3>之前送過的</h3>
          <ul className="ulist">
            {history.map((r) => (
              <li key={r.id}>
                <span className={`status ${r.status}`}>{STATUS[r.status]}</span>
                <span>{r.parsed?.summary || r.error || (r.kind === "chat" ? "聊天提案" : r.path?.split("/").pop())}</span>
                <span className="muted">{new Date(r.created_at).toLocaleDateString("zh-TW")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
