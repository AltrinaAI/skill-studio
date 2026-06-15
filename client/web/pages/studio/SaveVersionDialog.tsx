"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { btnGhost, btnPrimary } from "@/components/ui";
import * as api from "@/lib/api";

/**
 * "Save a version" — names the current state as a checkpoint (a git commit under
 * the hood). Autosave already keeps edits on disk; this records a version you can
 * diff against and roll back to. Driven by the host (the Versions sidebar panel),
 * which owns the git state and the actual commit.
 */
export default function SaveVersionDialog({
  root,
  dirName,
  tracked,
  hasIdentity,
  saving,
  error,
  onCommit,
  onClose,
}: {
  /** Skill root — used to draft a message from its diff on-device. */
  root: string;
  dirName: string;
  /** The skill is already a git repo (vs making its first-ever version). */
  tracked: boolean;
  /** A git user.email is configured. (Only meaningful when `tracked`.) */
  hasIdentity: boolean;
  saving: boolean;
  error: string | null;
  /** Persist the version; resolves true on success (the dialog then closes). */
  onCommit: (message: string) => Promise<boolean>;
  onClose: () => void;
}) {
  // The backend only reports identity for an existing repo; for an untracked skill
  // it's unknown, so don't block the FIRST version on it — let the commit run and
  // surface the backend's identity error if one's truly missing.
  const knownNoIdentity = tracked && !hasIdentity;
  const defaultMessage = tracked ? `Update ${dirName}` : "Initial version";
  const [message, setMessage] = useState(defaultMessage);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Set once the user types, so a slow background draft never clobbers their text.
  const userEdited = useRef(false);

  // "Draft a message from the diff" (a logged-in coding-agent CLI, or the
  // on-device model when opted in).
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<api.CommitModelStatus | null>(null);
  // A draft has been applied (so the button reads "Regenerate", not "Generate").
  const [drafted, setDrafted] = useState(false);

  // Draft (or re-draft) a message from the diff with the on-device model. The
  // backend reuses an eagerly-prepared draft when the diff is unchanged, so this
  // is usually instant. `auto` is the silent open-the-dialog path: it won't
  // overwrite text the user already started typing, and stays quiet on failure
  // (e.g. nothing to describe) — the explicit button surfaces errors.
  const generate = async (auto = false) => {
    if (generating || saving) return;
    setGenerating(true);
    setGenErr(null);
    try {
      // Auto/open path uses the cached deterministic draft; the manual button
      // forces a fresh re-roll (new seed) so each click gives a different take.
      const msg = auto ? await api.generateCommitMessage(root) : await api.regenerateCommitMessage(root);
      if (!auto || !userEdited.current) {
        setMessage(msg);
        setDrafted(true);
        requestAnimationFrame(() => taRef.current?.select());
      }
      setModelStatus((s) => (s ? { ...s, ready: true, downloaded: true } : s));
    } catch (e) {
      // Tauri rejects with a plain string (the Rust Err), not an Error — surface it.
      if (!auto) setGenErr(e instanceof Error ? e.message : typeof e === "string" ? e : "Couldn’t generate a message");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    taRef.current?.select();
    let cancelled = false;
    (async () => {
      // Resolve the backend first (which CLI / model, and whether to warn).
      let status: api.CommitModelStatus | null = null;
      try {
        status = await api.commitModelStatus();
      } catch {
        status = null;
      }
      if (cancelled) return;
      setModelStatus(status);
      // Prefer an eagerly-prepared draft (instant; never runs a backend).
      try {
        const draft = await api.peekCommitMessage(root);
        if (cancelled) return;
        if (draft) {
          setMessage((cur) => (cur === defaultMessage && !userEdited.current ? draft : cur));
          setDrafted(true);
          requestAnimationFrame(() => taRef.current?.select());
          return;
        }
      } catch {
        /* no draft ready → maybe draft one below */
      }
      if (cancelled) return;
      // Auto-draft on open ONLY for a ready on-device backend (free; the diff
      // never leaves the machine). A cloud CLI costs metered credit and sends the
      // diff out, so it waits for an explicit Generate click.
      if (api.isLocalCommitBackend(status) && status?.ready) void generate(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const canSubmit = !knownNoIdentity && !!message.trim() && !saving;
  const submit = async () => {
    if (!canSubmit) return;
    if (await onCommit(message.trim())) onClose();
  };

  return (
    // Don't dismiss mid-save (re-exposes the version list).
    <Modal
      title="Save a new version"
      titleAside={<span className="truncate font-mono text-xs text-faint">{dirName}</span>}
      onClose={onClose}
      dismissDisabled={saving}
    >
        <div className="space-y-3 px-5 py-4">
          <textarea
            ref={taRef}
            value={message}
            onChange={(e) => {
              userEdited.current = true;
              setMessage(e.target.value);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            autoFocus
            placeholder="Describe what changed…"
            className="w-full resize-none rounded-md border border-border bg-app px-2.5 py-2 text-sm text-fg outline-none focus:border-accent"
          />

          {knownNoIdentity && (
            <p className="rounded-md bg-panel px-2.5 py-2 text-xs text-warn">
              Set a git identity to save versions:{" "}
              <code className="font-mono">git config --global user.email "you@example.com"</code> (and{" "}
              <code className="font-mono">user.name</code>).
            </p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {genErr && <p className="text-xs text-danger">{genErr}</p>}
          {modelStatus?.backend === "none" && (
            <p className="rounded-md bg-panel px-2.5 py-2 text-xs text-warn">{modelStatus.detail}.</p>
          )}
          {modelStatus?.backend === "llama" && !modelStatus.downloaded && (
            <p className="text-[0.7rem] text-faint">
              First use downloads the on-device AI model (~1–1.5 GB), one time. Generation runs fully on your machine.
            </p>
          )}
          {modelStatus?.ready && modelStatus.backend !== "llama" && modelStatus.backend !== "none" && (
            <p className="text-[0.7rem] text-faint">{modelStatus.detail} — your diff is sent there to draft the message.</p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={saving || generating || modelStatus?.backend === "none"}
            title="Draft a message from your changes using your logged-in AI CLI"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-faint transition-colors hover:bg-panel hover:text-fg disabled:opacity-40"
          >
            {generating ? "Generating…" : drafted ? "✨ Regenerate" : "✨ Generate"}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className={btnGhost}>
              Cancel
            </button>
            <button type="button" onClick={() => void submit()} disabled={!canSubmit || generating} className={btnPrimary}>
              {saving ? "Saving…" : "Save version"}
            </button>
          </div>
        </div>
    </Modal>
  );
}
