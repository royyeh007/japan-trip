// 排程更新航班資料（aviationstack 省著用）。
//   GitHub Actions 每 15 分鐘用 CRON_TOKEN 呼叫一次（所有行程的所有航班），或成員在新增航班後呼叫（只做「新增時查一次」）。
//   每個航班（羽田、松山也一樣走 aviationstack，機場免費資料只當備援）：
//     info：第一次看到這個航班時查一次（確認航班號、拿正式時間和航廈）
//     eve ：出發前一天查一次
//     live：當天從起飛前 3 小時到起飛後 3 小時，每 30 分鐘一次（起飛前後一小時內每 12 分鐘），降落或取消就停，每班最多 12 次
//   航班文字只有月／日，年份照所屬行程的日期判斷；「今天」用該行程的時區。
import { handle, json, HttpError } from "../_shared/http.ts";
import { clients, requireMember } from "../_shared/supa.ts";
import { LIVE_BUDGET_PER_FLIGHT, avFetchAndStore, flightKey, minutes, nowIn, parseFlightText } from "../_shared/flights.ts";
import type { AvCache, Query, Row } from "../_shared/flights.ts";

const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

Deno.serve(handle(async (req) => {
  const { admin } = clients(req);
  const cronToken = Deno.env.get("CRON_TOKEN");
  const auth = req.headers.get("Authorization") ?? "";
  const isCron = !!cronToken && auth === `Bearer ${cronToken}`;
  let targets: { q: Query; tz: string }[];
  if (isCron) {
    // every family's flight lines, in every trip
    const { data: fams } = await admin.from("families").select("id, flights, trips(start_date, end_date, tz)");
    targets = (fams ?? []).flatMap((f: Row) => {
      const t = (Array.isArray(f.trips) ? f.trips[0] : f.trips) as Row | null;
      const range = t ? { start: String(t.start_date), end: String(t.end_date) } : null;
      return (f.flights as string[]).map((line) => parseFlightText(line, range)).filter((x): x is NonNullable<typeof x> => !!x).map((q) => ({ q, tz: String(t?.tz ?? "Asia/Tokyo") }));
    });
  } else {
    // a member adding flights: only the "info" pass, only for what they sent
    const body = await req.json().catch(() => ({})) as { flights?: string[]; trip_id?: string };
    const { trip } = await requireMember(req, body);
    const range = { start: trip.start_date, end: trip.end_date };
    targets = (body.flights ?? []).map((line) => parseFlightText(line, range)).filter((f): f is NonNullable<typeof f> => !!f).map((q) => ({ q, tz: trip.tz || "Asia/Tokyo" }));
    if (targets.length === 0) return json({ done: [], note: "沒有需要查的航班" });
  }
  const done: { flight: string; phase: string; note: string }[] = [];
  const seen = new Set<string>();

  for (const { q, tz } of targets) {
    const base = `av:${flightKey(q)}:${q.date}`;
    if (seen.has(base)) continue; // 同一班被好幾家列到
    seen.add(base);
    const now = nowIn(tz);
    const today = now.slice(0, 10), nowMin = minutes(now.slice(11, 16));
    const { data: rows } = await admin.from("flight_cache").select("key, data, fetched_at").like("key", `${base}%`);
    const have = new Map((rows ?? []).map((r: Row) => [r.key, r]));

    // info：第一次
    if (!have.has(`${base}:info`)) {
      const r = await avFetchAndStore(admin, q, `${base}:info`, "info");
      done.push({ flight: `${flightKey(q)} ${q.date}`, phase: "info", note: r.note });
      continue; // one request per flight per run is plenty
    }
    if (!isCron) continue;

    // eve：出發前一天
    if (today === addDays(q.date, -1) && !have.has(`${base}:eve`)) {
      const r = await avFetchAndStore(admin, q, `${base}:eve`, "eve");
      done.push({ flight: `${flightKey(q)} ${q.date}`, phase: "eve", note: r.note });
      continue;
    }

    // live：當天
    if (today === q.date) {
      const info = (have.get(`${base}:eve`) ?? have.get(`${base}:info`))?.data as AvCache | undefined;
      const live = have.get(`${base}:live`);
      const liveData = live?.data as AvCache | undefined;
      if (liveData?.final) continue;
      const used = liveData?.liveCount ?? 0;
      if (used >= LIVE_BUDGET_PER_FLIGHT) continue; // 這班今天的額度用完了
      const schedDep = liveData?.schedDep ?? info?.schedDep ?? null;
      const depMin = schedDep ? minutes(schedDep) : null;
      const inWindow = depMin == null ? true : nowMin >= depMin - 180 && nowMin <= depMin + 180;
      const near = depMin != null && Math.abs(nowMin - depMin) <= 60;
      const ageMin = live ? (Date.now() - new Date(live.fetched_at).getTime()) / 60000 : Infinity;
      if (inWindow && ageMin >= (near ? 12 : 30)) {
        const r = await avFetchAndStore(admin, q, `${base}:live`, "live", used);
        done.push({ flight: `${flightKey(q)} ${q.date}`, phase: "live", note: r.note });
      }
    }
  }
  const month = new Date().toISOString().slice(0, 7);
  const { data: quota } = await admin.from("flight_cache").select("data").eq("key", `quota:${month}`).maybeSingle();
  return json({ done, quota: (quota?.data as Row | undefined)?.n ?? 0, checked: seen.size, at: new Date().toISOString() });
}));

export { HttpError };
