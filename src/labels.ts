import type { Kind, Status } from "./data";

export const KIND: Record<Kind, string> = { food: "食", sight: "景", hotel: "宿", shop: "買", move: "移" };
export const KIND_NAME: Record<Kind, string> = { food: "餐廳", sight: "景點", hotel: "住宿", shop: "購物", move: "交通" };
export const SEAL: Record<Status, string> = { ok: "已訂", todo: "要訂", tbd: "待定" };
