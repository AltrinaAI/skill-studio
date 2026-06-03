"use client";

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useManualSave } from "./useManualSave";
import { useStudio } from "./StudioContext";
import { humanSize } from "@/lib/fileTypes";
import * as api from "@/lib/api";
import type { FileData } from "@/lib/types";

const LiveEditor = lazy(() => import("./LiveEditor"));
const EditorFallback = () => <div className="px-8 py-6 text-sm text-muted">Loading editor…</div>;

export default function FilePane({ root, file, onSaved }: { root: string; file: FileData; onSaved?: () => void }) {
  const { gitVersion } = useStudio();
  const editable = file.content != null && !file.tooLarge && !file.isBinary && file.category !== "image";
  const [content, setContent] = useState(file.content ?? "");
  const baseName = file.rel.split("/").pop() ?? file.rel;

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  useEffect(() => {
    if (file.category !== "image") return;
    let cancelled = false;
    api
      .imageDataUrl(root, file.rel)
      .then((url) => !cancelled && setImgSrc(url))
      .catch(() => !cancelled && setImgError(true));
    return () => {
      cancelled = true;
    };
  }, [root, file.rel, file.category]);

  // --- Diff/review mode. The "Review changes" toggle lives in the nav bar; this
  // reacts to its ?diff=worktree query and feeds the HEAD baseline to the editor
  // overlay. The baseline is fetched BEFORE diffOriginal is set, so the unchanged
  // buffer and the new extension set reconfigure together (no cursor reset). ---
  const [searchParams] = useSearchParams();
  const reviewRequested = searchParams.get("diff") === "worktree";
  // undefined = not in diff mode (or baseline not loaded yet); a string ("" for a
  // new file) = baseline loaded → the editor renders the inline diff overlay.
  const [diffOriginal, setDiffOriginal] = useState<string | undefined>(undefined);

  const reqRef = useRef(0);
  useEffect(() => {
    // Bump the counter first so exiting review (or a baseline change) invalidates
    // any in-flight fetch — its late resolve can't re-enter the overlay.
    const myReq = ++reqRef.current;
    if (!reviewRequested || !editable) {
      setDiffOriginal(undefined);
      return;
    }
    api
      .gitFileAt(root, "HEAD", file.rel)
      .then((orig) => {
        if (myReq === reqRef.current) setDiffOriginal(orig);
      })
      .catch(() => {
        if (myReq === reqRef.current) setDiffOriginal(undefined);
      });
  }, [reviewRequested, editable, root, file.rel, gitVersion]);

  const save = useCallback(async () => {
    await api.writeFile(root, file.rel, content);
  }, [root, file.rel, content]);

  useManualSave(content, save, editable, onSaved);

  const inDiff = reviewRequested && diffOriginal !== undefined;
  const isNewFile = inDiff && diffOriginal === "";

  return (
    <div className="mx-auto max-w-208 px-6 py-8 sm:px-10">
      {inDiff && (
        <div className="mb-5 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-muted">
          {isNewFile ? (
            <>New file — all lines are new since the last commit.</>
          ) : (
            <>
              Reviewing changes since the last commit. Hover a change for{" "}
              <span className="font-medium text-fg">Revert</span>; <kbd className="font-sans">F7</kbd> jumps to the next.
            </>
          )}
        </div>
      )}
      <div className="mb-5 flex items-center gap-3 text-xs text-muted">
        <span className="font-mono text-faint">{file.rel}</span>
        <span>·</span>
        <span>{file.label}</span>
        <span>·</span>
        <span>{humanSize(file.size)}</span>
      </div>

      {file.category === "image" ? (
        <div className="flex justify-center py-6">
          {imgError ? (
            <div className="text-sm text-muted">Image could not be loaded — {baseName}</div>
          ) : imgSrc ? (
            <img src={imgSrc} alt={baseName} className="max-w-full rounded-lg border border-border" />
          ) : (
            <div className="text-sm text-muted">Loading image…</div>
          )}
        </div>
      ) : file.tooLarge ? (
        <p className="py-6 text-sm text-muted">File is too large to display ({humanSize(file.size)}).</p>
      ) : file.isBinary ? (
        <p className="py-6 text-sm text-muted">Binary file ({humanSize(file.size)}) — preview not available.</p>
      ) : (
        <Suspense fallback={<EditorFallback />}>
          <LiveEditor
            kind={file.category === "markdown" ? "markdown" : "code"}
            language={file.language}
            filename={baseName}
            value={content}
            onChange={setContent}
            diffOriginal={inDiff ? diffOriginal : undefined}
          />
        </Suspense>
      )}
    </div>
  );
}
