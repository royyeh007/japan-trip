import { useState } from "react";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { dotDate, tripLength } from "../data";
import { fillTripDays } from "../days";

function CreateTrip({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { session } = useTrip();
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [place, setPlace] = useState("");
  const [famLabel, setFamLabel] = useState("");
  const [myName, setMyName] = useState<string>(session?.user.user_metadata?.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("create_trip", { p_name: name.trim(), p_start: start, p_end: end, p_place: place.trim(), p_family_label: famLabel.trim(), p_my_name: myName.trim() });
    if (error) { setErr(error.message); setBusy(false); return; }
    // every date gets an empty "everyone" day so the trip is ready to fill in
    try { await fillTripDays(String(data), start, end, place); } catch { /* the days can be added later from the date strip */ }
    onCreated(String(data));
  };

  return (
    <div className="panel">
      <h3>建立新行程</h3>
      <p className="note">建立的人就是這個行程的管理員，之後可以邀請家人、管理團員。開始到結束的每一天會先建好空白的日子。</p>
      <div className="formgrid">
        <label>行程名稱<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：2027 春天京都" /></label>
        <label>去哪裡（可空）<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例：日本・京都、大阪" /></label>
        <label>開始日期<input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
        <label>結束日期<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>你們這一家叫什麼<input value={famLabel} onChange={(e) => setFamLabel(e.target.value)} placeholder="例：Lily 家" /></label>
        <label>你的名字<input value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="例：小明" /></label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={submit} disabled={busy || !name.trim() || !start || !end}>{busy ? "建立中…" : "建立行程"}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>取消</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** After sign-in: the trips this person is in, plus "create" and "join with a code". */
export function TripPicker() {
  const { session, memberships, enterTrip, setInvite, refreshMemberships, signOut } = useTrip();
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="fambar">
          <span className="eyebrow">{session?.user.email}</span>
          <button type="button" className="link who-am-i" onClick={signOut}>登出</button>
        </div>
        <h1>我們的行程</h1>
        <p className="note">{memberships.length ? "選一個行程進去，或建立新的、加入別人的。" : "你還沒有任何行程。建立一個新行程，或用家人傳給你的邀請碼加入。"}</p>
      </header>

      {memberships.length > 0 && (
        <>
          <h2>我的行程</h2>
          <div className="tripcards">
            {memberships.map((m) => (
              <button key={m.trip_id} type="button" className="tripcard" onClick={() => enterTrip(m.trip_id)}>
                <span className="tn">{m.trip.name}</span>
                <span className="td">{dotDate(m.trip.start_date)} — {dotDate(m.trip.end_date)} ・ {tripLength(m.trip)} 天</span>
                {m.trip.place && <span className="tp">{m.trip.place}</span>}
                <span className="tm">
                  {m.role === "admin" && <span className="tag admin">管理員</span>}
                  {m.role === "viewer" && <span className="tag none">觀察員</span>}
                  <span className="muted">{m.name ?? m.email ?? ""}</span>
                </span>
                <span className="go">進入 ›</span>
              </button>
            ))}
          </div>
        </>
      )}

      <h2>建立或加入</h2>
      {creating ? (
        <CreateTrip onCreated={async (id) => { await refreshMemberships(); enterTrip(id); }} onCancel={() => setCreating(false)} />
      ) : (
        <div className="panel">
          <h3>建立新行程</h3>
          <p className="note">自己當管理員，再把家人邀進來。</p>
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>＋ 建立新行程</button>
        </div>
      )}
      <div className="panel">
        <h3>用邀請碼加入</h3>
        <p className="note">家人傳給你的邀請連結點開會自動帶入；也可以把邀請碼貼在這裡。</p>
        <div className="addrow">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="邀請碼，例：abc123" autoCapitalize="none" autoCorrect="off" onKeyDown={(e) => e.key === "Enter" && code.trim() && setInvite(code.trim())} />
          <button type="button" className="btn primary" onClick={() => setInvite(code.trim())} disabled={!code.trim()}>加入</button>
        </div>
      </div>
    </div>
  );
}
