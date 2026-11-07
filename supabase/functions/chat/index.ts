// 行程聊天機器人：看得到這一家看得到的行程，回答問題；要改行程時用工具送出提案，等 admin 審核。
import { betaZodTool } from "npm:@anthropic-ai/sdk/helpers/beta/zod";
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { anthropic, MODEL } from "../_shared/claude.ts";
import { FORMAT_GUIDE, ProposalZ, normalize } from "../_shared/proposal.ts";

interface Turn { role: "user" | "assistant"; content: string }

Deno.serve(handle(async (req) => {
  const { user, admin, member, uid, who } = await requireMember(req);
  const body = await req.json().catch(() => ({})) as { messages?: Turn[] };
  const turns = (body.messages ?? []).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim()).slice(-20);
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") throw new HttpError(400, "沒有訊息");

  // 這個人看得到的行程（RLS 會過濾），當作聊天的背景資料
  const [{ data: days }, { data: families }, { data: extras }, { data: todos }, { data: contacts }] = await Promise.all([
    user.from("days").select("date_id, fam, d, w, city, title, hotel, items"),
    user.from("families").select("id, name, label, flights").order("sort"),
    user.from("extras").select("key, data"),
    user.from("todos").select("fam, due, text, done").order("sort"),
    user.from("contacts").select("fam, name, value").order("sort"),
  ]);
  const context = {
    today: new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }),
    you: { name: who, family_id: member.family_id, role: member.role },
    families,
    days: (days ?? []).sort((a, b) => a.date_id.localeCompare(b.date_id)),
    notes: Object.fromEntries((extras ?? []).map((e) => [e.key, e.data])),
    todos: todos ?? [],
    contacts: contacts ?? [],
  };

  const proposals: { id: string; proposal: unknown }[] = [];
  const propose = betaZodTool({
    name: "propose_itinerary_change",
    description: "使用者想新增或修改行程時用這個工具送出整理好的行程。送出後畫面上會出現「確認更新」按鈕，使用者按了才生效。改某一天就要給那一天完整的 items（含沒改的部分）。",
    inputSchema: ProposalZ,
    run: async (input) => {
      const proposal = normalize(input);
      const family_id = member.role === "admin" ? proposal.family_id : member.family_id;
      const { data, error } = await admin.from("uploads")
        .insert({ family_id, uploaded_by: uid, kind: "chat", parsed: { ...proposal, family_id }, text: turns[turns.length - 1].content })
        .select("id").single();
      if (error || !data) return `送出失敗：${error?.message}`;
      proposals.push({ id: data.id, proposal: { ...proposal, family_id } });
      return `已整理好（id ${data.id}）。請簡短告訴使用者：畫面上會出現這份行程和「確認，更新行程」按鈕，按了就會更新。`;
    },
  });

  const client = anthropic();
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 4,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: `你是「日本跨年行程」網頁裡的小幫手，用繁體中文、台灣用語回答，語氣輕鬆簡短。
使用者是 ${who}（${member.family_id} 家）。資料裡有四家的行程，大家互相都看得到，哪一家的都可以回答。回答只根據下面的行程資料；資料裡沒有的就說不知道，不要編。
時間、訂位碼、地址這類細節要照資料逐字講。
使用者想改行程、加行程、補自己家的 12/26、12/27、1/2 時，如果意思清楚就直接用 propose_itinerary_change 送出完整的那一天（不清楚才先問）；使用者會在畫面上按「確認更新」。
大家一起的日子（12/28–1/1）每家預設共用一份；如果使用者只說自己家要不一樣（住別間、吃別的、時間不同），就用 scope=family 做一份這家自己的版本（把共用的那天複製過來再改）；只有明確說「大家都改」才用 scope=shared。
${FORMAT_GUIDE}`,
      },
      { type: "text", text: `目前的行程資料（JSON）：\n${JSON.stringify(context)}`, cache_control: { type: "ephemeral" } },
    ],
    tools: [propose],
    messages: turns.map((t) => ({ role: t.role, content: t.content })),
  });
  const final = await runner.runUntilDone();
  if (final.stop_reason === "refusal") throw new HttpError(502, "Claude 不方便回答這個問題");
  const reply = final.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return json({ reply: reply || "（沒有回覆）", proposals });
}));
