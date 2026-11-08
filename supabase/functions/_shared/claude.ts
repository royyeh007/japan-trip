import Anthropic from "npm:@anthropic-ai/sdk";
import { HttpError } from "./http.ts";

// 上傳整理（結構化輸出，品質優先）
export const MODEL = "claude-opus-5-5";
// 聊天（量大，成本優先）
export const CHAT_MODEL = "claude-sonnet-5-5";

export function anthropic() {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new HttpError(500, "伺服器還沒設定 ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey });
}
