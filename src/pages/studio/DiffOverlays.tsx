"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDiffGeometry } from "@/lib/diffGeometry";

interface Mark {
  topPct: number; // ruler position (% of scroll height)
  hPct: number;
  contentY: number; // px from the top of the scroll content (for the revert button)
  del: boolean;
  pos: number;
}

/**
 * Diff chrome mounted on the SCROLL PANE, OUTSIDE the centered editor column:
 *  • an overview ruler over the pane's right edge (atop the native scrollbar),
 *    with a green/red mark per changed chunk — click to jump;
 *  • a Revert button per chunk in the LEFT margin (beyond the text column, not
 *    shrinking it), portaled into the scroll content so it scrolls with the text.
 * Positions come from the editor via the diff-geometry store (it alone can place
 * off-screen, wrapped, and widget-displaced lines).
 */
export default function DiffOverlays({ scrollEl }: { scrollEl: HTMLElement | null }) {
  const geom = useDiffGeometry();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [left, setLeft] = useState(0);

  const recompute = useCallback(() => {
    if (!scrollEl || !geom || geom.marks.length === 0) {
      setMarks([]);
      return;
    }
    const sRect = scrollEl.getBoundingClientRect();
    const eRect = geom.el.getBoundingClientRect();
    // The editor's top/left within the scroll content (scroll-invariant: the rect
    // moves with scroll, scrollTop/Left cancel it back out).
    const editorTop = eRect.top - sRect.top + scrollEl.scrollTop;
    const editorLeft = eRect.left - sRect.left + scrollEl.scrollLeft;
    const total = scrollEl.scrollHeight || 1;
    // Sit the revert button in the whitespace just left of the text column; clamp
    // so it never leaves the pane on a narrow window.
    setLeft(Math.max(2, editorLeft - 26));
    setMarks(
      geom.marks.map((m) => {
        const contentY = editorTop + m.top;
        return { topPct: (contentY / total) * 100, hPct: Math.max((m.height / total) * 100, 0.5), contentY, del: m.del, pos: m.pos };
      }),
    );
  }, [scrollEl, geom]);

  // Marks are content-relative (scroll-invariant), so recompute only on geometry
  // change, pane resize, and content-height change (e.g. the SKILL.md form
  // growing) — never per scroll. The revert buttons are absolute children of the
  // scroll content, so they scroll with the text on their own.
  useEffect(() => {
    recompute();
    if (!scrollEl) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(scrollEl);
    if (scrollEl.firstElementChild) ro.observe(scrollEl.firstElementChild);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [scrollEl, recompute]);

  if (marks.length === 0 || !scrollEl) return null;

  return (
    <>
      {/* Overview ruler over the right scrollbar (track is click-through). */}
      <div className="diff-ruler" aria-hidden>
        {marks.map((m, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            title="Jump to change"
            onClick={() => scrollEl.scrollTo({ top: m.contentY - scrollEl.clientHeight / 2, behavior: "smooth" })}
            className={`diff-ruler-mark${m.del ? " is-del" : ""}`}
            style={{ top: `${m.topPct.toFixed(3)}%`, height: `max(${m.hPct.toFixed(3)}%, 3px)` }}
          />
        ))}
      </div>

      {/* Revert buttons in the left margin, scrolling with the content. */}
      {createPortal(
        marks.map((m, i) => (
          <button
            key={i}
            type="button"
            title="Revert this change to the committed version"
            aria-label="Revert this change"
            onClick={() => geom?.revert(m.pos)}
            className="diff-revert-btn"
            style={{ top: `${Math.round(m.contentY)}px`, left: `${left}px` }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
            </svg>
          </button>
        )),
        scrollEl,
      )}
    </>
  );
}
