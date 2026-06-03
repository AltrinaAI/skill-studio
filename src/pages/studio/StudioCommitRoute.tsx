"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Spinner } from "@/components/ui";
import * as api from "@/lib/api";
import type { GitCommitDetail, GitWorktreeDiff } from "@/lib/api";
import DiffView from "./DiffView";
import { useStudio } from "./StudioContext";

/** `/studio/:root/commit/:sha` — a read-only diff in the main pane. `:sha` is a
 *  commit SHA, or the literal "worktree" for all current uncommitted changes.
 *  Editable working-file diffs use the in-editor overlay instead (file route). */
export function Component() {
  const { data } = useStudio();
  const root = data.root;
  const sha = useParams().sha ?? "";
  const isWorktree = sha === "worktree";

  const [commit, setCommit] = useState<GitCommitDetail | null>(null);
  const [worktree, setWorktree] = useState<GitWorktreeDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);
  useEffect(() => {
    const myReq = ++reqRef.current;
    setLoading(true);
    setError(null);
    setCommit(null);
    setWorktree(null);
    (async () => {
      try {
        if (isWorktree) {
          const wt = await api.gitWorktreeDiff(root);
          if (myReq !== reqRef.current) return;
          setWorktree(wt);
        } else {
          const d = await api.gitCommitDiff(root, sha);
          if (myReq !== reqRef.current) return;
          setCommit(d);
        }
      } catch (e) {
        if (myReq !== reqRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load diff");
      } finally {
        if (myReq === reqRef.current) setLoading(false);
      }
    })();
  }, [root, sha, isWorktree]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner /> <span className="ml-2">Loading diff…</span>
      </div>
    );
  }
  if (error) return <p className="px-8 py-8 text-sm text-danger">{error}</p>;

  return (
    <div className="mx-auto w-full max-w-300 px-6 py-8 sm:px-10">
      {isWorktree ? (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-fg">Working tree changes</h2>
          <p className="mt-1 text-xs text-muted">
            {worktree && worktree.files.length > 0
              ? `${worktree.files.length} file${worktree.files.length === 1 ? "" : "s"} with uncommitted changes`
              : "No uncommitted changes."}
          </p>
        </div>
      ) : commit ? (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-fg">{commit.subject}</h2>
          {commit.body && <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-muted">{commit.body}</pre>}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
            <code className="font-mono text-muted">{commit.short}</code>
            <span>·</span>
            <span>{commit.author}</span>
            <span>·</span>
            <span title={commit.isoDate}>{commit.relativeDate}</span>
          </p>
        </div>
      ) : null}

      <DiffView
        diff={isWorktree ? worktree?.diff ?? "" : commit?.diff ?? ""}
        truncated={isWorktree ? worktree?.truncated : commit?.truncated}
        emptyLabel={isWorktree ? "Working tree is clean — nothing to compare." : "This commit has no file changes."}
      />
    </div>
  );
}
