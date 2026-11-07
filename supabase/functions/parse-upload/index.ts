// 收一個上傳的檔案（xlsx / csv / 照片 / PDF / 純文字）或一段文字，用 Claude 讀成行程提案，存進 uploads 等 admin 審核。
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import * as XLSX from "npm:xlsx@0.18.5";
import type Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { anthropic, MODEL } from "../_shared/claude.ts";
import { FORMAT_GUIDE, ProposalZ, normalize } from "../_shared/proposal.ts";

type Block = Anthropic.ContentBlockParam;

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

function xlsxToText(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name) => `## 工作表「${name}」\n${XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false })}`).join("\n\n");
}

const SYSTEM = `你在幫一個台灣家庭整理 2026/12/26–2027/1/2 的日本跨年行程（東京、長野、輕井澤、草津）。
使用者會給你一份填好的行程表單（Excel 轉成的 CSV）、一張行程截圖、PDF，或一段文字。
把裡面的行程讀出來，整理成指定的 JSON 格式。

${FORMAT_GUIDE}

表單的「基本資料」工作表有家庭、航班、住宿、每天是自己走還是跟哪家一起。
「12-26」「12-27」「1-2」工作表一行一個地點，第一行灰色的是範例，忽略範例、空白列和「範例」那張工作表。
「怎麼去」那欄是從上一站過去的交通，要變成前一個 leg。
只整理資料裡真的有的東西，不要自己補行程；不確定的寫進 notes。`;

Deno.serve(handle(async (req) => {
  const { admin, member, uid, who } = await requireMember(req);
  const body = await req.json().catch(() => ({})) as { path?: string; text?: string; family_id?: string };
  const family_id = member.role === "admin" && body.family_id ? body.family_id : member.family_id;

  const content: Block[] = [];
  let kind = "text";
  if (body.path) {
    if (member.role !== "admin" && !body.path.startsWith(`${member.family_id}/`)) throw new HttpError(403, "不能讀別家的檔案");
    const { data: blob, error } = await admin.storage.from("uploads").download(body.path);
    if (error || !blob) throw new HttpError(400, `讀不到檔案：${error?.message ?? "unknown"}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = body.path.split(".").pop()!.toLowerCase();
    if (["xlsx", "xls", "csv"].includes(ext)) { kind = "file"; content.push({ type: "text", text: xlsxToText(bytes) }); }
    else if (ext in IMAGE_TYPES) { kind = "image"; content.push({ type: "image", source: { type: "base64", media_type: IMAGE_TYPES[ext], data: encodeBase64(bytes) } }); }
    else if (ext === "pdf") { kind = "pdf"; content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) } }); }
    else if (["txt", "md"].includes(ext)) { kind = "file"; content.push({ type: "text", text: new TextDecoder().decode(bytes) }); }
    else throw new HttpError(400, "支援 xlsx、csv、照片（png/jpg）、PDF、txt");
  }
  if (body.text?.trim()) content.push({ type: "text", text: body.text.trim() });
  if (content.length === 0) throw new HttpError(400, "沒有內容");
  content.push({ type: "text", text: `上傳的人是 ${who}，屬於家庭 id「${family_id}」。表單裡沒寫家庭就用這個。` });

  const { data: row, error: insErr } = await admin.from("uploads")
    .insert({ family_id, uploaded_by: uid, kind, path: body.path ?? null, text: body.text ?? null })
    .select("id").single();
  if (insErr || !row) throw new HttpError(500, `存不進資料庫：${insErr?.message}`);

  try {
    const client = anthropic();
    // 串流版：SDK 對非串流的大 max_tokens 會拒絕；Edge Function 本身有 150 秒上限，所以 effort 用 medium
    const res = await client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(ProposalZ), effort: "medium" },
    }).finalMessage();
    if (res.stop_reason === "refusal") throw new Error("Claude 拒絕處理這個內容");
    if (res.stop_reason === "max_tokens") throw new Error("輸出不完整，請把檔案拆小一點（例如一次一天）再試");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const proposal = normalize(ProposalZ.parse(JSON.parse(text)));
    await admin.from("uploads").update({ parsed: proposal }).eq("id", row.id);
    return json({ id: row.id, proposal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("uploads").update({ status: "failed", error: msg }).eq("id", row.id);
    throw new HttpError(502, `解析失敗：${msg}`);
  }
}));
