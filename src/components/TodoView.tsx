import { useState } from "react";
import { useTrip } from "../trip";

function load(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem("jp-todo") || "{}"); } catch { return {}; }
}

export function TodoView() {
  const { trip } = useTrip();
  const [saved, setSaved] = useState(load);
  const toggle = (k: string, v: boolean) => {
    const next = { ...saved, [k]: v };
    setSaved(next);
    try { localStorage.setItem("jp-todo", JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  return (
    <>
      <section className="dayhead"><h2>待辦與聯絡資料</h2></section>
      <div className="panel">
        <h3>要訂、要搶的</h3>
        <p className="note">勾選只存在這台裝置上。</p>
        <ul className="todo">
          {trip.todo.map(([k, when, text, done]) => (
            <li key={k}>
              <input type="checkbox" id={`td-${k}`} checked={!!(done || saved[k])} disabled={done} onChange={(e) => toggle(k, e.target.checked)} />
              <label htmlFor={`td-${k}`}>
                <span className={`when ${done ? "done" : ""}`}>{when}</span>
                <span className="what">{text}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel">
        <h3>聯絡資料</h3>
        <div className="contacts">
          {trip.contacts.map(([a, b]) => <div key={a}>{a}<span>{b}</span></div>)}
        </div>
      </div>
    </>
  );
}
