import { useState } from "react";
import type { InfoBlock } from "../data";
import { useTrip } from "../trip";

function Flow({ b }: { b: Extract<InfoBlock, { type: "flow" }> }) {
  return (
    <div className="flow">
      {b.h && <h4>{b.h}</h4>}
      <ol className="steps">
        {b.steps.map((s, i) => (
          <li key={i}>
            <span className="num" aria-hidden="true">{i + 1}</span>
            <div className="body">
              <b>{s.t}</b>
              <p>{s.d}</p>
              {b.branch && b.branch.after === i + 1 && (
                <div className="branch">
                  {b.branch.options.map((o) => (
                    <div className={`opt ${o.tone}`} key={o.label}>
                      <span className="lbl">{o.label}</span>
                      <b>{o.t}</b>
                      <p>{o.d}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Block({ b }: { b: InfoBlock }) {
  switch (b.type) {
    case "p": return <p className="lead">{b.text}</p>;
    case "list": return (<div className="sec">{b.h && <h4>{b.h}</h4>}<ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>);
    case "table": return (
      <div className="sec">
        {b.h && <h4>{b.h}</h4>}
        <div className="tablewrap"><table className="infotable"><thead><tr>{b.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
      </div>
    );
    case "flow": return <Flow b={b} />;
    case "sources": return (<div className="sec sources"><h4>資料來源</h4><ul>{b.items.map((s) => <li key={s.u}><a href={s.u} target="_blank" rel="noopener">{s.t}</a></li>)}</ul></div>);
  }
}

export function InfoView() {
  const { trip } = useTrip();
  const tabs = trip.info;
  const [cur, setCur] = useState(0);
  const tab = tabs[cur];
  return (
    <>
      <section className="dayhead"><h2>其他資訊</h2></section>
      {tabs.length === 0 ? <p className="note">還沒有內容。</p> : (
        <>
          <div className="infotabs" role="tablist" aria-label="資訊分頁">
            {tabs.map((t, i) => <button key={t.id} type="button" role="tab" aria-selected={i === cur} className={i === cur ? "on" : ""} onClick={() => setCur(i)}>{t.title}</button>)}
          </div>
          <article className="info" key={tab.id}>
            <div className="meta"><span>更新於 {tab.updated}</span></div>
            {tab.blocks.map((b, i) => <Block key={i} b={b} />)}
          </article>
        </>
      )}
    </>
  );
}
