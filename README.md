# 我們的行程

幾個家庭一起出門時共用的行程網頁（React + TypeScript + Vite + Supabase）。一個帳號可以在好幾個行程裡；每個行程有自己的家庭、成員、日子、待辦、聊天。

- 用 Google 登入 → 選行程／建立新行程／用邀請碼加入 → 進入行程。下次登入直接回到上次打開的行程；右上角「⋯」可以切換行程、退出行程、改名字、登出。
- 建立行程的人是管理員：「管理」頁可以改團員角色和家庭、產生邀請連結（可先指定是哪一家）、新增／改名家庭、改行程名稱日期時區、刪除整個行程。每個行程至少要有一位管理員；最後一個人退出時行程會一起刪掉。
- 進入行程後，每一家的行程都看得到，頁首可以切換看哪一家；「大家一起」的日子每家共用一份，也可以做一份自己家的版本。日期列最後「＋ 加一天」可以自己加日子（行程前後兩週內）。
- 聊天機器人只看得到你所在的這個行程。
- 每個地點有詳細資訊（訂位資訊、訂位碼可複製、推薦、提醒、大家加的備註），每段交通連到 Google 地圖路線，每天有「整天路線」按鈕。
- 每天的天氣：出發前約 16 天內是 Open-Meteo 正式預報，之前顯示往年同日平均。
- 旅行當天打開會直接跳到今天，行程上有一條「現在」的線，過去的地點會變淡（行程當地時間，每 30 秒更新）。想先看效果：開關旁有「預覽」，或網址加 `?now=2026-12-29T14:30`（要放在 `#` 前面）。
- **上傳行程**：傳填好的表單（xlsx）、截圖、PDF 或貼文字，AI 小助手整理成行程，自己看過按「確認更新」就上線。
- **問 AI 小助手**：聊天機器人看得到這個行程每一家的行程，可以問細節，也可以直接說要改什麼，整理好按「確認更新」就生效。

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

一天：`{ id: "2026-12-26", fam: ["lily"], d: "12/26", w: "六", city, title, hotel, items }`。`id` 是完整日期；`fam` 不寫就是大家一起的。資料庫裡每一列還有 `trip_id`（屬於哪個行程）。

- 地點：`{ t: "時間", n: "名稱", q: "Google 地圖搜尋字", k: "food|sight|hotel|shop|move", st: "ok|todo|tbd", book: [...], rec: [...], tips: [...], tel, addr }`
- 交通：`{ leg: "taxi|walk|train|bus|charter|shuttle|flight", txt: "說明" }`，放在兩個地點中間
