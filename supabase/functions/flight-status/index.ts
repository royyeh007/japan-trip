// 讀航班狀態（給網頁）。
//   主要來源：flight-refresh 排程存進 flight_cache 的 aviationstack 資料（info → eve → live），當天可補查一次（有上限）。
//   備援：aviationstack 沒資料或額度用完時，羽田、松山改抓機場免費資料。
import { handle, json, HttpError } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { HND, LIVE_BUDGET_PER_FLIGHT, TSA, avFetchAndStore, flightKey, getJson, matchHND, matchTSA, minutes, nowJST } from "../_shared/flights.ts";
import type { AvCache, Query, Row, Status } from "../_shared/flights.ts";

Deno.serve(handle(async (req) => {
  const { admin } = await requireMember(req);
  const body = await req.json().catch(() => ({})) as { flights?: Query[] };
  const flights = (body.flights ?? []).filter((f) => f && /^[A-Z0-9]{2}$/i.test(f.airline) && /^\d{1,4}$/.test(f.number) && /^\d{4}-\d{2}-\d{2}$/.test(f.date)).slice(0, 10);
  if (flights.length === 0) throw new HttpError(400, "沒有航班");
  let feeds: [Row | null, Row | null, Row[] | null, Row[] | null] | null = null; // 機場免費資料，只在需要備援時抓一次
  const results = [];
  for (const q of flights) {
    let statuses: Status[] = [];
    let note: string | undefined, phase: string | undefined, fetchedAt: string | undefined;
    {
      // 排程存的資料：live 優先，再 eve，再 info
      const base = `av:${flightKey(q)}:${q.date}`;
      const { data: rows } = await admin.from("flight_cache").select("key, data, fetched_at").like("key", `${base}%`);
      let pick = ["live", "eve", "info"].map((p) => (rows ?? []).find((r: Row) => r.key === `${base}:${p}`)).find(Boolean) as Row | undefined;
      // 當天補查：排程（GitHub 每 15 分）有時會慢，若 live 資料超過 15 分鐘沒更新就自己查一次（同樣受每月上限保護）
      const now = nowJST();
      if (now.slice(0, 10) === q.date && pick) {
        const d = pick.data as AvCache;
        const live = (rows ?? []).find((r: Row) => r.key === `${base}:live`) as Row | undefined;
        const ageMin = live ? (Date.now() - new Date(live.fetched_at).getTime()) / 60000 : Infinity;
        const depMin = d.schedDep ? minutes(d.schedDep) : null;
        const inWindow = depMin == null ? true : minutes(now.slice(11, 16)) >= depMin - 180 && minutes(now.slice(11, 16)) <= depMin + 180;
        const used = (live?.data as AvCache | undefined)?.liveCount ?? 0;
        if (inWindow && !(live?.data as AvCache | undefined)?.final && ageMin >= 15 && used < LIVE_BUDGET_PER_FLIGHT) {
          const r = await avFetchAndStore(admin, q, `${base}:live`, "live", used);
          if (r.ok && r.data) pick = { key: `${base}:live`, data: r.data, fetched_at: new Date().toISOString() };
        }
      }
      if (pick) {
        const d = pick.data as AvCache;
        statuses = d.statuses;
        phase = d.phase;
        fetchedAt = String(pick.fetched_at);
        note = d.note ?? (d.flightDate && d.flightDate !== q.date ? `這是 ${d.flightDate} 同班號的資料，當天會再更新` : undefined);
      } else {
        note = "還沒查過這個航班（新增後一小時內會自動查）";
      }
    }
    // 備援：羽田、松山的免費資料
    if (statuses.length === 0) {
      feeds ??= await Promise.all([getJson(HND.arr, "HND arr"), getJson(HND.dep, "HND dep"), getJson(TSA.arr, "TSA arr"), getJson(TSA.dep, "TSA dep")]) as typeof feeds;
      const [hndArr, hndDep, tsaArr, tsaDep] = feeds!;
      statuses = [matchTSA(tsaDep, "dep", q), matchTSA(tsaArr, "arr", q), matchHND(hndDep, "dep", q), matchHND(hndArr, "arr", q)].filter((s): s is Status => !!s);
      if (statuses.length > 0) { phase = "live"; note = note ? `${note}；改用機場即時資料` : "機場即時資料"; }
    }
    statuses.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dep" ? -1 : 1));
    results.push({ query: q, statuses, note, phase, fetchedAt });
  }
  return json({ results });
}));
