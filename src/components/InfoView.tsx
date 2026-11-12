import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, FormEvent } from "react";
import type { InfoBlock, InfoPage } from "../data";
import { Markdown, blocksToMd } from "../md";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";

const OPEN_KEY = "jp-info-open";
/** Jump to 其他資訊 and show this page (the chat's「存到其他資訊」uses it). Works whether or not the page is already open. */
export function openInfoPage(id: string) {
  try { sessionStorage.setItem(OPEN_KEY, id); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent("jp-open-info", { detail: id }));
  if (location.hash !== "#info") location.hash = "#info";
}

// ---- legacy structured pages (seeded before pages became Markdown) ----
function Flow({ b }: { b: Extract<InfoBlock, { type: "flow" }> }) {
  return (
    <div className="flow">
      {b.h && <h4>{b.h}</h4>}
      <ol className="steps">
        {b.steps.map((s, i) => (
          <li key={i}>
            <span className="num" aria-hidden="true">{i + 1}</span>
            <div className="body">
              <b>{s.t}</b>
              <p>{s.d}</p>
              {b.branch && b.branch.after === i + 1 && (
                <div className="branch">
                  {b.branch.options.map((o) => (
                    <div className={`opt ${o.tone}`} key={o.label}>
                      <span className="lbl">{o.label}</span>
                      <b>{o.t}</b>
                      <p>{o.d}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Block({ b }: { b: InfoBlock }) {
  switch (b.type) {
    case "p": return <p className="lead">{b.text}</p>;
    case "list": return (<div className="sec">{b.h && <h4>{b.h}</h4>}<ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>);
    case "table": return (
      <div className="sec">
        {b.h && <h4>{b.h}</h4>}
        <div className="tablewrap"><table className="infotable"><thead><tr>{b.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
      </div>
    );
    case "flow": return <Flow b={b} />;
    case "sources": return (<div className="sec sources"><h4>資料來源</h4><ul>{b.items.map((s) => <li key={s.u}><a href={s.u} target="_blank" rel="noopener">{s.t}</a></li>)}</ul></div>);
  }
}

function fmtDate(s: string) {
  if (!s) return "";
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("zh-TW");
}
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

interface Draft { id: string | null; title: string; body: string }

const IMAGE_BUCKET = "info-images";
/** Shrink a picture before upload (longest side ≤ 1280, JPEG) so phone photos don't eat the storage quota. Transparent areas become white. */
async function shrink(file: File, max = 1280): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return jpeg && (scale < 1 || jpeg.size < file.size) ? jpeg : file;
  } catch { return file; }
}
const extOf = (type: string) => ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[type] ?? "jpg";

/** Write or edit one page. 「✦ 幫我整理」 sends the text to the cheap formatting function (no web, no itinerary, daily cap). */
function Editor({ draft, onDone }: { draft: Draft; onDone: (id: string | null) => void }) {
  const { current, member, trip, reload } = useTrip();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState<"save" | "tidy" | null>(null);
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [tidied, setTidied] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Put a snippet where the cursor is (or at the end when previewing). */
  const insert = (snippet: string) => {
    const ta = taRef.current;
    setBody((b) => {
      const start = ta ? ta.selectionStart : b.length, end = ta ? ta.selectionEnd : b.length;
      const before = b.slice(0, start), after = b.slice(end);
      const pad = before && !/[\s|]$/.test(before) ? " " : "";
      return before + pad + snippet + (after && !/^[\s|]/.test(after) ? " " : "") + after;
    });
    setMode("write");
  };

  /** Upload pictures to this trip's folder and drop ![說明](網址) into the text; they show as thumbnails that open big. */
  const addImages = async (files: File[]) => {
    if (!supabase || !current) return;
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setErr(null);
    setUploading((n) => n + imgs.length);
    for (const f of imgs) {
      try {
        const blob = await shrink(f);
        const path = `${current.id}/${newId()}${Date.now().toString(36)}.${extOf(blob.type)}`;
        const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg", cacheControl: "31536000" });
        if (error) throw new Error(/mime|type/i.test(error.message) ? "這種圖片格式不支援，請用 JPG 或 PNG" : error.message);
        const url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
        const base = f.name.replace(/\.[^.]+$/, "").replace(/[[\]()]/g, "").trim();
        const alt = !base || /^(img|image|photo|dsc|pxl|screenshot|螢幕|截圖|unnamed|blob)/i.test(base) ? "圖片" : base;
        insert(`![${alt}](${url})`);
      } catch (e) { setErr(`圖片上傳失敗：${e instanceof Error ? e.message : String(e)}`); }
      finally { setUploading((n) => n - 1); }
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const fs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (fs.length) { e.preventDefault(); addImages(fs); }
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const fs = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (fs.length) { e.preventDefault(); addImages(fs); }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !current || !member) return;
    const t = title.trim();
    if (!t) { setErr("要有標題"); return; }
    setBusy("save"); setErr(null);
    const base = { title: t, body, blocks: null, updated_by: member.user_id, updated_by_name: member.name, updated_at: new Date().toISOString() };
    const id = draft.id ?? newId();
    const { error } = draft.id
      ? await supabase.from("info_pages").update(base).eq("trip_id", current.id).eq("id", draft.id)
      : await supabase.from("info_pages").insert({ ...base, trip_id: current.id, id, sort: Math.max(-1, ...trip.info.map((p) => p.sort)) + 1, created_by: member.user_id });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await reload();
    onDone(id);
  };

  const tidy = async () => {
    if (!current) return;
    setBusy("tidy"); setErr(null); setTidied(null);
    try {
      const r = await invoke<{ title: string; body: string; remaining: number }>("format-info", { trip_id: current.id, text: body, title: title.trim() || undefined });
      setBody(r.body);
      if (!title.trim() && r.title) setTitle(r.title);
      setMode("preview");
      setTidied(`整理好了，看一下有沒有錯再儲存。這個行程今天還可以用 ${r.remaining} 次。`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <form className="infoedit" onSubmit={save}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="標題（例如：退稅流程、租車注意事項）" maxLength={60} required aria-label="標題" />
      <div className="infoedit-bar">
        <div className="modebar" role="group" aria-label="寫或預覽">
          <button type="button" className={mode === "write" ? "on" : ""} onClick={() => setMode("write")}>寫</button>
          <button type="button" className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>預覽</button>
        </div>
        <span className="actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={uploading > 0} title="上傳圖片，會變成文字旁的縮圖；也可以直接把圖貼進內容">
            {uploading > 0 ? `上傳中…（${uploading}）` : "🖼 加圖片"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <button type="button" className="btn" onClick={tidy} disabled={!!busy || body.trim().length < 20} title="把貼進來的文字整理成條列或表格">
            {busy === "tidy" ? "整理中…" : "✦ 幫我整理"}
          </button>
        </span>
      </div>
      {mode === "write"
        ? <textarea ref={taRef} value={body} onChange={(e) => setBody(e.target.value)} rows={14} aria-label="內容" onPaste={onPaste} onDrop={onDrop}
            onDragOver={(e) => { if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault(); }}
            placeholder={"直接打字就好，一段一段寫。\n\n想要格式可以用：\n# 小標\n- 項目\n1. 步驟\n| 欄 | 欄 |\n[文字](網址)\n![說明](圖片網址)　← 按「加圖片」或直接貼圖"} />
        : <article className="info preview">{body.trim() ? <Markdown text={body} /> : <p className="note">還沒有內容。</p>}</article>}
      {tidied && <p className="note ok">{tidied}</p>}
      {err && <p className="err">{err}</p>}
      <p className="note">「🖼 加圖片」或直接把圖貼進內容，會變成文字旁的小縮圖（例如商品照），點了放大。「✦ 幫我整理」會把從網站、LINE 複製來的一大段文字整理成條列或表格；它不會上網查，也不會加原文沒有的內容。每個行程每天最多 10 次，用完就自己手寫。</p>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!!busy}>{busy === "save" ? "儲存中…" : "儲存"}</button>
        <button type="button" className="btn" onClick={() => onDone(null)} disabled={!!busy}>取消</button>
      </div>
    </form>
  );
}

/** 其他資訊: pages anyone in the trip (except viewers) can write. Seeded pages keep their old layout until someone edits them. */
export function InfoView() {
  const { trip, member, current, reload } = useTrip();
  const pages = trip.info;
  const editable = !!member && member.role !== "viewer";
  const [cur, setCur] = useState<string | null>(() => {
    try { const v = sessionStorage.getItem(OPEN_KEY); sessionStorage.removeItem(OPEN_KEY); return v; } catch { return null; }
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const on = (e: Event) => { setCur((e as CustomEvent<string>).detail); setDraft(null); };
    window.addEventListener("jp-open-info", on);
    return () => window.removeEventListener("jp-open-info", on);
  }, []);
  const page = pages.find((p) => p.id === cur) ?? pages[0];

  const startNew = () => setDraft({ id: null, title: "", body: "" });
  const startEdit = (p: InfoPage) => setDraft({ id: p.id, title: p.title, body: p.body?.trim() ? p.body : blocksToMd(p.blocks ?? []) });
  const remove = async (p: InfoPage) => {
    if (!supabase || !current || !confirm(`刪除「${p.title}」這一頁？大家都會看不到。`)) return;
    const { error } = await supabase.from("info_pages").delete().eq("trip_id", current.id).eq("id", p.id);
    if (error) { alert(error.message); return; }
    setCur(null);
    await reload();
  };

  return (
    <>
      <section className="dayhead">
        <div className="infohead">
          <h2>其他資訊</h2>
          {editable && !draft && <button type="button" className="btn" onClick={startNew}>＋ 新增一頁</button>}
        </div>
        <p className="note">{editable ? "大家都可以寫：入境、退稅、伴手禮、租車、要帶的東西……想到什麼就加一頁。AI 助理查到的答案也可以按「存到其他資訊」留在這裡。" : "成員整理的補充資料。"}</p>
      </section>
      {draft ? (
        <Editor key={draft.id ?? "new"} draft={draft} onDone={(id) => { setDraft(null); if (id) setCur(id); }} />
      ) : !page ? (
        <p className="note">還沒有內容。{editable && "按「＋ 新增一頁」開始。"}</p>
      ) : (
        <>
          <div className="infotabs" role="tablist" aria-label="資訊分頁">
            {pages.map((p) => <button key={p.id} type="button" role="tab" aria-selected={p.id === page.id} className={p.id === page.id ? "on" : ""} onClick={() => setCur(p.id)}>{p.title}</button>)}
          </div>
          <article className="info" key={page.id}>
            <div className="meta infometa">
              <span>更新於 {fmtDate(page.updated_at)}{page.updated_by_name ? `・${page.updated_by_name}` : ""}</span>
              {editable && (
                <span className="actions">
                  <button type="button" className="link" onClick={() => startEdit(page)}>✎ 編輯</button>
                  <button type="button" className="link danger" onClick={() => remove(page)}>刪除</button>
                </span>
              )}
            </div>
            {page.body?.trim() ? <Markdown text={page.body} /> : (page.blocks ?? []).map((b, i) => <Block key={i} b={b} />)}
          </article>
        </>
      )}
    </>
  );
}
