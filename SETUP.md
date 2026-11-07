# 第一次設定（Supabase + Google 登入 + Claude）

網頁放在 GitHub Pages（公開的空殼），行程、成員、上傳都在 Supabase，登入並加入某一家才看得到。
Claude 的 API key 只放在 Supabase 的 Edge Function 裡，不會出現在 repo 或網頁。

## 1. Supabase 專案

1. https://supabase.com → New project（免費方案就夠）。
2. **Settings → API** 記下：Project URL、`anon` key、`service_role` key。
3. **Settings → General** 記下 Project ref（網址裡 `https://<ref>.supabase.co` 的那段）。

## 2. Google 登入

1. https://console.cloud.google.com → 建一個專案 → **APIs & Services → OAuth consent screen**：
   User type 選 External，填 App 名稱（例如「日本跨年行程」）和你的 email。
   做完按 **Publish app**（只用基本資料，不需要 Google 審核）。不 Publish 的話只有列在 Test users 的 email 能登入。
2. **Credentials → Create credentials → OAuth client ID** → Web application。
   Authorized redirect URIs 加：`https://<ref>.supabase.co/auth/v1/callback`。
   記下 Client ID 和 Client secret。
3. Supabase → **Authentication → Providers → Google**：打開，貼 Client ID / Secret，存檔。
4. Supabase → **Authentication → URL Configuration**：
   - Site URL：`https://royyeh007.github.io/japan-trip/`
   - Redirect URLs 加兩個：`https://royyeh007.github.io/japan-trip/**` 和 `http://localhost:5173/**`

## 3. 本機設定檔

```bash
cp .env.example .env.local
```
填 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`ADMIN_EMAIL`（你登入 Google 用的 email，會變成管理員）、`SITE_URL`。
`.env.local` 不會進 git。

## 4. 建表、部署、灌資料

Claude API key 在 https://console.anthropic.com → API keys 產生。

```bash
supabase login                              # 開瀏覽器登入 Supabase
make link REF=<project ref>
make db-push                                # 建表、權限、Storage bucket
make secrets ANTHROPIC_API_KEY=sk-ant-...   # 給 Edge Function 用
make fn-deploy                              # 部署 parse-upload、chat 兩個 function
make seed                                   # 把 seed/trip.ts 的行程、表單、管理員放進去，最後會印出邀請連結
```

## 5. GitHub Pages

repo → **Settings → Secrets and variables → Actions → Variables** 加兩個（這兩個本來就是公開的，不是機密）：
`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。或用指令：

```bash
gh variable set VITE_SUPABASE_URL --body "https://<ref>.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --body "eyJ..."
```

Pages 的來源已經設成 GitHub Actions；之後每次 push 到 `main` 都會自動部署。
`.github/workflows/keepalive.yml` 每天打一次 Supabase，免得免費方案 7 天沒人用被暫停。

## 6. 平常怎麼用

- **邀請家人**：登入後到「上傳・審核」最下面複製邀請連結，傳給家人。他們點開 → Google 登入 → 選自己是哪一家，就加入了。
- **改行程**：
  - 大改：改本機的 `seed/trip.ts`，跑 `make seed`（只會蓋掉檔案裡有的那幾天）。
  - 家人上傳表單／截圖，或在「問 Claude」直接說要改什麼 → 你在「上傳・審核」按確認。
- **本機預覽**：`make`，開 http://localhost:5173。登入後資料一樣從 Supabase 來。
