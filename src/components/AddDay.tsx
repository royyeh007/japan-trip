import { useState } from "react";
import { dateIdOfIso, dateOf } from "../data";
import type { Family } from "../data";
import { supabase } from "../supabase";
import { useTrip } from "../trip";

const CITIES = ["東京", "長野", "輕井澤", "草津", "成田", "台北", "其他"];

/** Small form to add a date for this family (e.g. an earlier arrival or later departure). */
export function AddDay({ family, onDone }: { family: Family; onDone: (dateId?: string) => void }) {
  const { trip, reload } = useTrip();
  const [date, setDate] = useState("2026-12-25");
  const [city, setCity] = useState("東京");
  const [title, setTitle] = useState("");
  const [hotel, setHotel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase) return;
    setErr(null);
    if (date < "2026-12-15" || date > "2027-01-15") { setErr("日期要在 2026/12/15 到 2027/1/15 之間"); return; }
    const id = dateIdOfIso(date);
    if (trip.days.some((d) => d.id === id && d.fam?.includes(family.id))) { setErr("這天已經有你們家的行程了"); return; }
    setBusy(true);
    const { d, w } = dateOf(id);
    const { error } = await supabase.from("days").insert({ date_id: id, fam: [family.id], d, w, city: city.trim() || "東京", title: title.trim() || `${family.label} ${d}`, hotel: hotel.trim(), items: [] });
    if (error) { setErr(error.message); setBusy(false); return; }
    await reload();
    setBusy(false);
    onDone(id);
  };

  return (
    <div className="panel addday">
      <h3>幫{family.label}加一天</h3>
      <p className="note">加了之後可以上傳表單／截圖，或點右下角「問 Claude」直接說那天要做什麼。</p>
      <div className="grid">
        <label>日期<input type="date" value={date} min="2026-12-15" max="2027-01-15" onChange={(e) => setDate(e.target.value)} /></label>
        <label>城市
          <select value={CITIES.includes(city) ? city : "其他"} onChange={(e) => setCity(e.target.value === "其他" ? "" : e.target.value)}>
            {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {!CITIES.includes(city) && <label>城市名稱<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="例：大阪" /></label>}
        <label>標題（可空）<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：提早到東京・迪士尼" /></label>
        <label>那晚住哪（可空）<input value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="例：Conrad Tokyo" /></label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? "加入中…" : "加入這一天"}</button>
        <button type="button" className="btn" onClick={() => onDone()} disabled={busy}>取消</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
