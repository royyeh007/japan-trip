// 信用卡推薦：規則在 supabase/functions/_shared/cards.ts（網頁和聊天機器人共用）；這裡只有網頁端的開關。
import { useSyncExternalStore } from "react";

export * from "../supabase/functions/_shared/cards";
export type { Card, CardRate, Country, Pick, RateKind, RateWhere, StopKind } from "../supabase/functions/_shared/cards";

// ---- 「每一站顯示推薦的卡」開關（預設開），記在這台裝置 ----
const KEY = "jp-cards-on";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export function setCardsOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useCardsOn(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read, () => true);
}
