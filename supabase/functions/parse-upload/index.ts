// 收一個上傳的檔案（xlsx / csv / 照片 / PDF / 純文字）或一段文字，用 Claude 讀成某個行程（trip_id）的行程提案，存進 uploads 等使用者確認。
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import * as XLSX from "npm:xlsx@0.18.5";
import type Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { anthropic, MODEL } from "../_shared/claude.ts";
import { ProposalZ, formatGuide, normalize } from "../_shared/proposal.ts";
import type { GuideCtx } from "../_shared/proposal.ts";

type Block = Anthropic.ContentBlockParam;

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

function xlsxToText(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name) => `## 工作表「${name}」\n${XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false })}`).join("\n\n");
}

const system = (ctx: GuideCtx) => `你在幫一群家庭整理「${ctx.trip.name}」的行程${ctx.trip.place ? `（${ctx.trip.place}）` : ""}，日期 ${ctx.trip.start_date} 到 ${ctx.trip.end_date}。
使用者會給你一份填好的行程表單（Excel 轉成的 CSV）、一張行程截圖、PDF，或一段文字。
把裡面的行程讀出來，整理成指定的 JSON 格式。表單裡的日期只有月／日，年份照這個行程的日期判斷。

${formatGuide(ctx)}

表單的「基本資料」工作表有家庭、航班、每天晚上住哪、哪幾天是跟別家一起走的（寫進 joins）。
「行程1」到「行程5」工作表每頁一天：最上面「這一頁是哪一天」那格是日期（例 12/24），沒填日期或整頁空白的工作表跳過。每頁一行一個地點，第一行灰色的是範例，忽略範例、空白列和「範例」那張工作表。
每一天的 hotel 從「基本資料」的住宿那一行對應日期找。
「怎麼去」那欄是從上一站過去的交通，要變成前一個 leg。
只整理資料裡真的有的東西，不要自己補行程；不確定的寫進 notes。`;

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({})) as { path?: string; text?: string; family_id?: string; trip_id?: string };
  const { admin, member, trip, uid, who } = await requireMember(req, body, { editor: true });
  const { data: famRows } = await admin.from("families").select("id, label").eq("trip_id", trip.id).order("sort");
  const families = (famRows ?? []) as { id: string; label: string }[];
  const family_id = member.role === "admin" && body.family_id && families.some((f) => f.id === body.family_id) ? body.family_id : member.family_id;

  const content: Block[] = [];
  let kind = "text";
  if (body.path) {
    const own = `${trip.id}/${member.family_id}/`;
    if (!body.path.startsWith(member.role === "admin" ? `${trip.id}/` : own)) throw new HttpError(403, "不能讀別家的檔案");
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
    .insert({ trip_id: trip.id, family_id, uploaded_by: uid, kind, path: body.path ?? null, text: body.text ?? null })
    .select("id").single();
  if (insErr || !row) throw new HttpError(500, `存不進資料庫：${insErr?.message}`);

  try {
    const { data: sharedRows } = await admin.from("days").select("date_id").eq("trip_id", trip.id).is("fam", null);
    const ctx: GuideCtx = { trip, families, sharedDates: [...new Set((sharedRows ?? []).map((d) => d.date_id as string))].sort() };
    const client = anthropic();
    // 串流版：SDK 對非串流的大 max_tokens 會拒絕；Edge Function 本身有 150 秒上限，所以 effort 用 medium
    const res = await client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: system(ctx),
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(ProposalZ), effort: "medium" },
    }).finalMessage();
    if (res.stop_reason === "refusal") throw new Error("AI 小助手拒絕處理這個內容");
    if (res.stop_reason === "max_tokens") throw new Error("輸出不完整，請把檔案拆小一點（例如一次一天）再試");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const proposal = normalize(ProposalZ.parse(JSON.parse(text)));
    // 家庭 id 一定要是這個行程裡的；非管理員只能送自己家的
    const famOk = families.some((f) => f.id === proposal.family_id);
    const finalFam = member.role === "admin" && famOk ? proposal.family_id : family_id;
    const fixed = { ...proposal, family_id: finalFam, joins: proposal.joins.filter((j) => families.some((f) => f.id === j.with)) };
    await admin.from("uploads").update({ parsed: fixed, family_id: finalFam }).eq("id", row.id);
    return json({ id: row.id, proposal: fixed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("uploads").update({ status: "failed", error: msg }).eq("id", row.id);
    throw new HttpError(500, `AI 小助手解析失敗：${msg}`);
  }
}));
