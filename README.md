# 日本跨年行程

2026/12/26–2027/1/2 東京・長野・輕井澤・草津，四個家庭共用的行程網頁（React + TypeScript + Vite + Supabase）。

- 首頁輸入邀請碼（邀請連結會自動帶入）→ 用 Google 註冊 → 選自己是哪一家。已加入的人直接用 Google 登入。沒登入看不到任何行程；登入後四家的行程都看得到，頁首可以切換看哪一家。
- 12/28–1/1 是大家一起的日子；其他天每家各自的行程，沒放上來的會顯示「行程待補」。
- 每個地點有詳細資訊（訂位資訊、訂位碼可複製、推薦、提醒），每段交通連到 Google 地圖路線，每天有「整天路線」按鈕。
- 每天的天氣：出發前約 16 天內是 Open-Meteo 正式預報，之前顯示往年同日平均。
- **上傳行程**：傳填好的表單（xlsx）、截圖、PDF 或貼文字，Claude 整理成行程，自己看過按「確認更新」就上線。
- **問 Claude**：聊天機器人看得到四家的行程，可以問細節，也可以直接說要改什麼，整理好按「確認更新」就生效。

## 結構

| 位置 | 內容 |
|---|---|
| `src/` | 網頁。`data.ts` 只有型別和小工具，行程內容不在程式碼裡 |
| `supabase/migrations/` | 資料表、RLS 權限、Storage bucket |
| `supabase/functions/parse-upload` | 讀上傳的檔案 → Claude → 行程提案 |
| `supabase/functions/chat` | 聊天機器人（可送出修改提案） |
| `seed/trip.ts` | 行程內容的本機來源（**不進 git**），`make seed` 推進資料庫。格式見 `seed/trip.example.ts` |
| `seed/assets/trip-form.xlsx` | 給家人填的表單（不進 git），`make seed` 會上傳到私有 bucket |

## 第一次設定

看 [SETUP.md](SETUP.md)：建 Supabase 專案、開 Google 登入、`make link / db-push / secrets / fn-deploy / seed`、GitHub Variables。

## 本機預覽

```bash
make          # 第一次會自動 npm install，然後開 http://localhost:5173
make help     # 所有指令
```

## 行程格式

一天：`{ id: "d1226", fam: ["lily"], d: "12/26", w: "六", city, title, hotel, items }`。`fam` 不寫就是大家一起的。

- 地點：`{ t: "時間", n: "名稱", q: "Google 地圖搜尋字", k: "food|sight|hotel|shop|move", st: "ok|todo|tbd", book: [...], rec: [...], tips: [...], tel, addr }`
- 交通：`{ leg: "taxi|walk|train|bus|charter|shuttle|flight", txt: "說明" }`，放在兩個地點中間
