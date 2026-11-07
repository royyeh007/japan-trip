import Anthropic from "npm:@anthropic-ai/sdk";
import { HttpError } from "./http.ts";

export const MODEL = "claude-opus-5-5";

export function anthropic() {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new HttpError(500, "伺服器還沒設定 ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey });
}
