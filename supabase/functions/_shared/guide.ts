// 使用教學的唯一來源：網頁的「使用教學」頁和聊天機器人的「網站怎麼用」都從這裡來，改一處兩邊同步。
// 純資料、沒有任何執行環境相依，前端（Vite）和 Edge Function（Deno）都直接 import。
// 文字裡的 [[目標|按鈕文字]] 在網頁上會變成真的可以按的按鈕（目標＝頁面代號或動作），給聊天機器人時會變成「按鈕文字」。
export type GuideRole = "admin" | "member" | "viewer";
export interface GuideItem { text: string; roles?: GuideRole[] }
export interface GuideSection { id: string; icon: string; title: string; lead?: string; roles?: GuideRole[]; items: GuideItem[] }
export interface GuideAction { target: string; label: string }

export const ROLE_NAMES: Record<GuideRole, string> = { admin: "管理員", member: "成員", viewer: "觀察員" };
export const ROLE_SUMMARY: Record<GuideRole, string> = {
  admin: "可以看、改所有家的行程，管理團員、邀請、家庭和行程設定。",
  member: "可以看每一家的行程；能改自己家的日子和大家一起的日子，能用 AI 助理。",
  viewer: "只能看行程、待辦、聯絡資料和航班狀態，不能修改，也沒有聊天機器人。",
};
/** The handful of things each role will press most often, shown at the top of the guide. */
export const QUICK_START: Record<GuideRole, GuideAction[]> = {
  admin: [{ target: "admin", label: "⚙ 管理行程" }, { target: "upload", label: "↑ 上傳行程" }, { target: "chat", label: "✦ AI 助理" }, { target: "overview", label: "☷ 總覽" }],
  member: [{ target: "overview", label: "☷ 總覽" }, { target: "upload", label: "↑ 上傳行程" }, { target: "chat", label: "✦ AI 助理" }, { target: "todo", label: "✓ 待辦・聯絡" }],
  viewer: [{ target: "overview", label: "☷ 總覽" }, { target: "todo", label: "✓ 待辦・聯絡" }],
};

const editors: GuideRole[] = ["admin", "member"];

export const GUIDE: GuideSection[] = [
  { id: "enter", icon: "→", title: "登入與選行程", lead: "一個帳號可以在好幾個行程裡。", items: [
    { text: "用 Google 登入。第一次來需要家人傳的邀請連結或邀請碼；加入過的人直接登入。" },
    { text: "登入後會直接進上次打開的行程。要換行程：按右上角 [[menu|👤 你的名字]] → [[switch|切換行程]]。" },
    { text: "在選擇行程的頁面可以「建立新行程」（已經在任何一個行程裡的人才能建），或貼邀請碼加入別人的行程。建立行程的人就是那個行程的管理員。" },
    { text: "[[menu|👤 你的名字]] 裡還有：改我的名字、退出這個行程（要輸入 delete 確認；最後一個人退出會把整個行程刪掉）、登出。" },
  ] },
  { id: "view", icon: "☷", title: "看行程", items: [
    { text: "頁首「看哪一家」可以切換看每一家的行程；「只看 ○○家／看所有家」把每一家同一天並排。" },
    { text: "日期列可以左右滑，今天會特別標示；每個日期上有天氣（出發前 16 天內是預報，更早是往年平均）。" },
    { text: "[[overview|☷ 總覽]] 把每一天的地點一頁列出來，可切成「只看吃、住、已訂」，也能列印或存成 PDF。" },
    { text: "點任何地點會打開詳細資訊：在 Google 地圖開啟、從上一站過來的路線、訂位資訊、訂位碼一鍵複製、電話、推薦、提醒、備註。" },
    { text: "「開啟今天的 Google 地圖路線」會把整天的地點串成一條路線。" },
    { text: "旅行當天打開，行程上會有一條紅色「現在」的線，過去的地點變淡；旁邊有開關，還沒出發也可以按「預覽」先看效果。" },
    { text: "有航班的那天，航班卡片當天會顯示準點狀態、登機門、櫃台或行李轉盤。" },
    { text: "[[info|ⓘ 其他資訊]] 是大家一起整理的補充資料（例如入境、退稅、伴手禮、租車、藥妝和超商必買）；成員和管理員都可以寫。商品旁的小圖點一下會放大，按 × 或點旁邊關掉。" },
    { text: "別人改了行程，你的畫面最多 5 分鐘內會自動更新；切回網頁時也會立刻檢查。" },
  ] },
  { id: "edit", icon: "✎", title: "改行程", lead: "可以改自己家的日子和「大家一起」的日子；別家自己的版本只能看。管理員全部都能改。", roles: editors, items: [
    { text: "[[upload|↑ 上傳行程]]：傳填好的表單（那頁可以下載）、行程截圖、PDF，或直接貼文字，AI 助理整理成行程後你看一下，按「確認，更新行程」才會上線。" },
    { text: "[[chat|✦ AI 助理]]：直接說想改什麼（例如「12/30 我們家想住別間飯店，其他照舊」），它會整理成提案，一樣要按確認才生效。" },
    { text: "小改動不用麻煩 AI 助理：點開地點，有「✎ 編輯」（時間、名稱、訂位狀態、地址、電話、推薦、怎麼去）、「＋ 之後加一站」、「刪除這一站」。改了時間會自動重新排序。" },
    { text: "每個地點最下面可以加備註，大家都看得到；自己的備註可以刪。" },
    { text: "一站可以「連到另一個行程」（編輯地點時選），例如台灣行程的「出發前往日本」連到日本跨年行程。兩個行程都有加入的人點開那站就能看到那天的內容並一鍵跳過去；沒加入的人只看得到名稱。" },
    { text: "日期列最後的 [[addday|＋ 加一天]] 可以幫自己家加日期（行程前後兩週內）；自己加的日子可以刪掉。" },
    { text: "大家一起的日子想要自己家不一樣：按「做一份我們家的版本」，之後改的只影響自己家；按「改回大家一起的版本」就恢復。" },
    { text: "每一天頁面的「⇄ 優化順序」：勾選可以調動的地點（有訂位、用餐、車站機場預設不動），按計算會依距離找出移動最短的順序，看過再「套用」。它只算距離，不知道營業時間，所以當參考。" },
  ] },
  { id: "info", icon: "ⓘ", title: "其他資訊", lead: "入境、退稅、伴手禮、租車、要帶的東西……想到什麼就加一頁，大家都看得到。", roles: editors, items: [
    { text: "[[info|ⓘ 其他資訊]] →「＋ 新增一頁」：打標題和內容就好，直接打字會照段落顯示。想要格式可以用「# 小標」「- 項目」「1. 步驟」「| 表格 |」「[文字](網址)」，按「預覽」先看效果。" },
    { text: "「🖼 加圖片」或直接把圖片貼進內容，會變成文字旁的小縮圖（商品照、截圖都可以），大家點了就能放大比對。圖最長邊會自動縮到 1280，一張最多 5 MB。" },
    { text: "從網站或 LINE 複製來的一大段文字，貼進去按「✦ 幫我整理」：AI 會整理成條列或表格，不會上網查、也不會加原文沒有的內容。每個行程每天最多 10 次，用完就自己手寫。" },
    { text: "[[chat|✦ AI 助理]] 查到的答案（例如退稅流程、怎麼去）下面有「存到其他資訊」，按一下就變成一頁，不用再問一次。" },
    { text: "每一頁大家都能「✎ 編輯」或「刪除」；最後改的人和時間會顯示在頁面上。" },
  ] },
  { id: "todo", icon: "✓", title: "待辦與聯絡資料", items: [
    { text: "[[todo|✓ 待辦・聯絡]] 分自己家和大家一起；「看所有家」可以並排看每一家的清單。" },
    { text: "可以新增、修改、勾選待辦，新增時選「給誰看」。", roles: editors },
    { text: "聯絡資料會自動列出行程裡出現的電話和 email（有「行程」標籤），也可以自己再加。" },
    { text: "觀察員只能看待辦和聯絡資料，不能新增或勾選。", roles: ["viewer"] },
  ] },
  { id: "chat", icon: "✦", title: "AI 助理（聊天機器人）", roles: editors, items: [
    { text: "右下角 [[chat|✦ AI 助理]]。它看得到這個行程每一家的行程、待辦、聯絡資料，可以問細節（幾點、訂位碼、怎麼去），也可以改行程。" },
    { text: "貼店家或影片連結，它會上網查地址、營業時間、推薦，並建議排在哪一天。" },
    { text: "它只處理跟這個行程和網站有關的事，看不到其他行程，也不能改網站程式；改行程一定要你按「確認」。" },
    { text: "問到「其他資訊」裡的主題（退稅、入境……）時，它會先去讀那一頁再回答；有用的回答可以按「存到其他資訊」留下來。" },
    { text: "送出問題後切去別的 App 沒關係，回覆會留在對話裡；「清除對話」只清自己在這個行程的紀錄。" },
  ] },
  { id: "admin", icon: "⚙", title: "管理行程", lead: "只有管理員看得到這一頁。", roles: ["admin"], items: [
    { text: "[[admin|⚙ 管理]] → 團員：改每個人的家庭和角色（管理員／成員／觀察員），或移除。每個行程至少要有一位管理員。" },
    { text: "邀請連結：選角色、可先指定對方是哪一家、設定可用次數，把連結傳給對方即可；不用的連結可以刪除。" },
    { text: "家庭：新增、改名；還有成員或自己日子的家不能刪。" },
    { text: "行程設定：名稱、日期、地點、當地時區（影響「現在」的線和航班日期）。延長日期會自動補上空白的日子。" },
    { text: "刪除整個行程要輸入行程名稱確認，所有人的資料都會消失，無法復原。" },
    { text: "想讓某人只能看：邀請時選「觀察員」，或在團員清單把他改成觀察員。" },
  ] },
  { id: "viewer", icon: "👁", title: "觀察員能做什麼", roles: ["viewer"], items: [
    { text: "你是觀察員：可以看每一家的行程、[[overview|☷ 總覽]]、地點詳細資訊、[[todo|✓ 待辦・聯絡]]、天氣和航班狀態。" },
    { text: "不能改行程、加日子、加備註、上傳，也沒有聊天機器人。需要改東西請告訴行程裡的成員或管理員。" },
    { text: "想變成成員，請管理員在「管理 → 團員」把你的角色改掉。" },
  ] },
  { id: "faq", icon: "?", title: "常見問題", items: [
    { text: "地圖開到錯的地方？點開那個地點 →「編輯」→ 把「Google 地圖搜尋字」改成店名加地址。", roles: editors },
    { text: "Google 登入出錯或邀請連結失效：跟邀請你的人或管理員要一個新的連結；邀請有次數上限。" },
    { text: "沒看到別人剛改的內容：切到別的分頁再切回來，或等最多 5 分鐘會自動更新。" },
    { text: "想在手機上像 App 一樣用：用瀏覽器的「加入主畫面」。" },
  ] },
];

/** The sections and items this role should see. */
export function guideFor(role: GuideRole): GuideSection[] {
  return GUIDE
    .filter((s) => !s.roles || s.roles.includes(role))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0);
}

export const ACTION_RE = /\[\[([a-z-]+)\|([^\]]+)\]\]/g;
/** `[[target|label]]` → 「label」 for plain-text uses (the chatbot). */
export const plain = (text: string) => text.replace(ACTION_RE, "「$2」");

/** Plain text for the chatbot's system prompt: everything, with role tags so it can answer for whoever is asking. */
export function guideText(): string {
  const tag = (roles?: GuideRole[]) => (!roles || roles.length === 3 ? "" : `（${roles.map((r) => ROLE_NAMES[r]).join("、")}才有）`);
  return GUIDE.map((s) => `${s.title}${tag(s.roles)}：${s.lead ? plain(s.lead) : ""}\n${s.items.map((i) => `- ${plain(i.text)}${tag(i.roles)}`).join("\n")}`).join("\n");
}
