// A small Markdown subset rendered as React elements (no innerHTML, so nothing a page author types can run as code).
// Supports: # headings, paragraphs (single line breaks kept), - / 1. lists with one level of indented sub-items,
// | tables |, > quotes, --- rules; inline **bold**, `code`, [text](https://…), bare https:// links and
// ![caption](https://…) images, which render as thumbnails that open in a lightbox.
import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { InfoBlock } from "./data";

interface Item { text: string; sub: string[] }
type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; lines: string[] }
  | { t: "quote"; lines: string[] }
  | { t: "ul" | "ol"; items: Item[] }
  | { t: "table"; cols: string[]; rows: string[][] }
  | { t: "hr" };

const LIST_RE = /^([-*•]|\d+[.)])\s+(.+)$/;
const SUB_RE = /^\s{2,}([-*•]|\d+[.)])\s+(.+)$/;
const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line.trim());

export function parseMd(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ t: "p", lines: para }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], s = line.trim();
    if (!s) { flush(); continue; }
    const h = s.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flush(); out.push({ t: "h", level: h[1].length, text: h[2].trim() }); continue; }
    if (/^([-*_])\1{2,}$/.test(s)) { flush(); out.push({ t: "hr" }); continue; }
    if (s.startsWith(">")) {
      flush();
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) { q.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
      i--; out.push({ t: "quote", lines: q }); continue;
    }
    if (/^\|.*\|$/.test(s)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { if (!isSep(lines[i])) rows.push(splitRow(lines[i])); i++; }
      i--;
      if (rows.length) { const [cols, ...rest] = rows; out.push({ t: "table", cols, rows: rest.map((r) => cols.map((_, j) => r[j] ?? "")) }); }
      continue;
    }
    const li = s.match(LIST_RE);
    if (li && !/^\s{2,}/.test(line)) {
      flush();
      const ordered = /\d/.test(li[1]);
      const items: Item[] = [];
      while (i < lines.length) {
        const l = lines[i], ls = l.trim();
        const sub = l.match(SUB_RE), top = ls.match(LIST_RE);
        if (sub && items.length) items[items.length - 1].sub.push(sub[2].trim());
        else if (top && !/^\s{2,}/.test(l) && /\d/.test(top[1]) === ordered) items.push({ text: top[2].trim(), sub: [] });
        else if (ls && /^\s{2,}\S/.test(l) && items.length) items[items.length - 1].text += " " + ls; // wrapped line
        else break;
        i++;
      }
      i--; out.push({ t: ordered ? "ol" : "ul", items }); continue;
    }
    para.push(s);
  }
  flush();
  return out;
}

const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|!\[[^\]\n]*\]\(https?:\/\/[^\s)]+\)|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()\]]+)/g;
export const IMG_RE = /!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;
/** Inline Markdown → React nodes. Only http(s) links become anchors, only http(s) images become thumbnails. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index!, tok = m[0];
    if (i > last) out.push(text.slice(last, i));
    if (tok.startsWith("**")) out.push(<b key={k++}>{tok.slice(2, -2)}</b>);
    else if (tok.startsWith("`")) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("![")) {
      const mm = tok.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/)!;
      out.push(<Thumb key={k++} src={mm[2]} alt={mm[1].trim()} />);
    } else if (tok.startsWith("[")) {
      const mm = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)!;
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noopener noreferrer">{mm[1]}</a>);
    } else out.push(<a key={k++} href={tok} target="_blank" rel="noopener noreferrer">{tok}</a>);
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A small picture next to the text; tap to see it big. The one Lightbox lives in App and listens for this event. */
function Thumb({ src, alt }: { src: string; alt: string }) {
  return (
    <button type="button" className="thumb" onClick={() => openImage(src, alt)} title={alt ? `${alt}（點一下放大）` : "點一下放大"}>
      <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    </button>
  );
}
export function openImage(src: string, alt = "") {
  window.dispatchEvent(new CustomEvent("jp-lightbox", { detail: { src, alt } }));
}

/** Full-size view of a thumbnail. Closes on ×, Esc, or a tap outside the picture. Mount once (App). */
export function Lightbox() {
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = (e: Event) => setImg((e as CustomEvent<{ src: string; alt: string }>).detail);
    window.addEventListener("jp-lightbox", on);
    return () => window.removeEventListener("jp-lightbox", on);
  }, []);
  useEffect(() => {
    if (!img) return;
    // capture phase + stopPropagation so Esc closes only the picture, not the chat panel or sheet behind it
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setImg(null); } };
    document.addEventListener("keydown", onKey, true);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, [img]);
  if (!img) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={img.alt || "放大的圖片"} onClick={() => setImg(null)}>
      <button ref={closeRef} type="button" className="x" aria-label="關閉" onClick={() => setImg(null)}>×</button>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={img.src} alt={img.alt} referrerPolicy="no-referrer" />
        {img.alt && <figcaption>{img.alt}</figcaption>}
      </figure>
    </div>
  );
}

const Lines = ({ lines }: { lines: string[] }) => <>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</>;

export function Markdown({ text }: { text: string }) {
  const blocks = parseMd(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": return b.level <= 2 ? <h3 key={i}>{inline(b.text)}</h3> : <h4 key={i}>{inline(b.text)}</h4>;
          case "p": return <p key={i}><Lines lines={b.lines} /></p>;
          case "quote": return <blockquote key={i}><Lines lines={b.lines} /></blockquote>;
          case "hr": return <hr key={i} />;
          case "ul":
          case "ol": {
            const Tag = b.t;
            return (
              <Tag key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it.text)}{it.sub.length > 0 && <ul>{it.sub.map((s, k) => <li key={k}>{inline(s)}</li>)}</ul>}</li>
                ))}
              </Tag>
            );
          }
          case "table": return (
            <div key={i} className="tablewrap">
              <table className="infotable">
                <thead><tr>{b.cols.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
      })}
    </div>
  );
}

const cell = (s: string) => s.replace(/\|/g, "｜").replace(/\s*\n\s*/g, " ");
const keep = (xs: (string | false | undefined)[]) => xs.filter((x): x is string => !!x);

/** The old structured 其他資訊 blocks (from seed) as Markdown, so a seeded page can be edited like any other. */
export function blocksToMd(blocks: InfoBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "p": parts.push(b.text); break;
      case "list": parts.push(keep([b.h && `### ${b.h}`, ...b.items.map((x) => `- ${x}`)]).join("\n")); break;
      case "table":
        parts.push(keep([
          b.h && `### ${b.h}`,
          `| ${b.cols.map(cell).join(" | ")} |`,
          `| ${b.cols.map(() => "---").join(" | ")} |`,
          ...b.rows.map((r) => `| ${b.cols.map((_, j) => cell(r[j] ?? "")).join(" | ")} |`),
        ]).join("\n"));
        break;
      case "flow": {
        const lines = keep([b.h && `### ${b.h}`]);
        b.steps.forEach((s, i) => {
          lines.push(`${i + 1}. **${s.t}** ${s.d}`);
          if (b.branch && b.branch.after === i + 1) for (const o of b.branch.options) lines.push(`   - **${o.label}：${o.t}** ${o.d}`);
        });
        parts.push(lines.join("\n"));
        break;
      }
      case "sources": parts.push(["### 資料來源", ...b.items.map((s) => `- [${s.t}](${s.u})`)].join("\n")); break;
    }
  }
  return parts.join("\n\n");
}
