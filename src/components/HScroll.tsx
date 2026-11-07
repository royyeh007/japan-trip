import type { ReactNode } from "react";
import { useScrollEdges } from "../useScrollEdges";

/** Horizontal row of columns with edge fades, arrows, and a visible scrollbar so it is obvious it scrolls. */
export function HScroll({ children, hint = "← 左右滑動 →", deps }: { children: ReactNode; hint?: string; deps?: unknown }) {
  const { ref, edge, update, scrollBy } = useScrollEdges<HTMLDivElement>(deps);
  return (
    <>
      {hint && <div className="famtabs"><span className="hint">{hint}</span></div>}
      <div className={`allbar${edge.start ? " at-start" : ""}${edge.end ? " at-end" : ""}`}>
        <button type="button" className="scrollbtn left" onClick={() => scrollBy(-1, 0.5)} aria-label="往左" tabIndex={-1}>‹</button>
        <div className="allgrid" ref={ref} onScroll={update}>{children}</div>
        <button type="button" className="scrollbtn right" onClick={() => scrollBy(1, 0.5)} aria-label="往右" tabIndex={-1}>›</button>
      </div>
    </>
  );
}
