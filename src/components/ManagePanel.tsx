"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./ui";
import SecretsManager from "./SecretsManager";
import { agentColor, KIND_TAG, type SkillKind } from "@/lib/agents";
import * as api from "@/lib/api";
import type { GitInfo, GitCommit, SyncTarget } from "@/lib/api";

const btnPrimary =
  "rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-app transition-opacity hover:opacity-90 disabled:opacity-40";
const btnGhost =
  "rounded-md border border-border px-3 py-1.5 text-sm text-fg transition-colors hover:bg-panel disabled:opacity-40";

function Section({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4 first:border-t-0">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function PreviewBadge() {
  return (
    <span className="rounded-full border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-accent">
      Preview
    </span>
  );
}

// ---- Version (git) ----------------------------------------------------------
function VersionSection({ root, dirName, kind }: { root: string; dirName: string; kind: SkillKind }) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const i = await api.gitInfo(root).catch(() => null);
    setInfo(i);
    setLog(i?.isRepo ? await api.gitLog(root, 20).catch(() => []) : []);
  }, [root]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startTracking = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.gitInit(root);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start tracking");
    } finally {
      setBusy(false);
    }
  };

  const openCommit = () => {
    setMessage(log.length === 0 ? "Initial commit" : `Update ${dirName}`);
    setErr(null);
    setCommitOpen(true);
  };
  const doCommit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.gitCommit(root, message);
      setCommitOpen(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  };

  if (info === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner className="h-3.5 w-3.5" /> Checking version control…
      </p>
    );
  }
  if (!info.available) {
    return <p className="text-sm text-muted">Git isn’t installed — install git to enable version history.</p>;
  }
  if (kind !== "personal") {
    return (
      <p className="text-sm text-muted">
        Version history is for your own skills. This is a {KIND_TAG[kind].label.toLowerCase()} skill — use{" "}
        <span className="font-medium text-fg">Sync</span> below to make an editable copy you can version.
      </p>
    );
  }
  if (info.inParentRepo) {
    return (
      <p className="text-sm text-muted">
        Tracked by a parent repository
        {info.toplevel ? (
          <>
            {" "}
            (<span className="font-mono text-[0.8em] text-faint">{info.toplevel}</span>)
          </>
        ) : null}
        . Manage history there.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {!info.isRepo ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Not tracked yet. Start a version history for this skill.</p>
          <button type="button" onClick={startTracking} disabled={busy} className={btnPrimary}>
            {busy ? "…" : "Start tracking"}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${info.dirty ? "bg-warn" : "bg-ok"}`} aria-hidden />
              <span className="text-fg">{info.dirty ? "Uncommitted changes" : "Up to date"}</span>
              {info.branch && <span className="font-mono text-xs text-faint">{info.branch}</span>}
            </span>
            <button
              type="button"
              onClick={openCommit}
              disabled={busy || !info.dirty || !info.hasIdentity}
              title={!info.hasIdentity ? "Set a git identity first" : !info.dirty ? "No changes to commit" : "Commit a version"}
              className={btnPrimary}
            >
              Commit…
            </button>
          </div>

          {!info.hasIdentity && (
            <p className="rounded-md bg-panel px-2.5 py-2 text-xs text-warn">
              Set a git identity to commit:{" "}
              <code className="font-mono">git config --global user.email "you@example.com"</code> (and{" "}
              <code className="font-mono">user.name</code>).
            </p>
          )}

          {commitOpen && (
            <div className="rounded-lg border border-border bg-app p-2.5">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                autoFocus
                placeholder="Describe this version…"
                className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setCommitOpen(false)} className={btnGhost}>
                  Cancel
                </button>
                <button type="button" onClick={doCommit} disabled={busy || !message.trim()} className={btnPrimary}>
                  {busy ? "Committing…" : "Commit"}
                </button>
              </div>
            </div>
          )}

          {log.length > 0 && (
            <ul className="space-y-0 overflow-hidden rounded-lg border border-border">
              {log.map((c, i) => (
                <li key={c.short + i} className="flex items-baseline gap-2 border-t border-border px-2.5 py-1.5 text-xs first:border-t-0">
                  <code className="shrink-0 font-mono text-faint">{c.short}</code>
                  <span className="min-w-0 flex-1 truncate text-fg" title={c.message}>
                    {c.message}
                  </span>
                  <span className="shrink-0 text-faint">{c.relativeDate}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

// ---- Sync -------------------------------------------------------------------
function SyncSection({ root }: { root: string }) {
  const [targets, setTargets] = useState<SyncTarget[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    api
      .syncTargets(root)
      .then(setTargets)
      .catch(() => setTargets([]));
  }, [root]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const doSync = async (agent: string, overwrite: boolean) => {
    if (overwrite && !window.confirm(`Overwrite the existing "${agent}" copy with this version?`)) return;
    setBusy(agent);
    setMsg(null);
    try {
      await api.syncSkill(root, agent, overwrite);
      setMsg({ ok: true, text: `Synced to ${agent}.` });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Sync failed" });
    } finally {
      setBusy(null);
    }
  };

  if (targets === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner className="h-3.5 w-3.5" /> Checking…
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Copy this skill into another agent’s personal skills so it’s available there too.</p>
      <ul className="space-y-1.5">
        {targets.map((t) => (
          <li key={t.agent} className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(t.agent) }} aria-hidden />
            <span className="text-fg">{t.agent}</span>
            <span className="ml-auto flex items-center gap-2">
              {t.isSource ? (
                <span className="text-xs text-faint">Source</span>
              ) : t.present ? (
                <>
                  <span className="text-xs text-ok">✓ Added</span>
                  <button type="button" onClick={() => doSync(t.agent, true)} disabled={busy === t.agent} className="text-xs text-faint hover:text-fg">
                    Update
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => doSync(t.agent, false)} disabled={busy === t.agent} className={btnGhost}>
                  {busy === t.agent ? "Adding…" : "Add"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}

// ---- Collaborate (wireframe / preview) -------------------------------------
function CollaborateSection() {
  return (
    <div className="space-y-2.5 opacity-90">
      <p className="text-xs text-muted">
        Link this skill’s repository to a shared remote and collaborate with your team — push, pull, and merge changes.
      </p>
      <div className="flex gap-2">
        <input
          disabled
          placeholder="git@github.com:org/skills.git"
          className="w-full cursor-not-allowed rounded-md border border-border bg-panel px-2 py-1.5 font-mono text-xs text-faint"
        />
        <button type="button" disabled className="shrink-0 cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-faint">
          Connect
        </button>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-faint">
          ↑ Push
        </button>
        <button type="button" disabled className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-faint">
          ↓ Pull
        </button>
        <button type="button" disabled className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-faint">
          Merge
        </button>
      </div>
      <p className="text-[0.7rem] text-faint">Coming soon — not yet functional.</p>
    </div>
  );
}

export default function ManagePanel({
  root,
  dirName,
  kind,
  declaredSecrets = [],
  onClose,
}: {
  root: string;
  dirName: string;
  kind: SkillKind;
  agent: string | null;
  declaredSecrets?: string[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-semibold text-fg">Manage</span>
          <span className="truncate font-mono text-xs text-faint">{dirName}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-faint hover:bg-panel hover:text-fg">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <Section title="Version">
            <VersionSection root={root} dirName={dirName} kind={kind} />
          </Section>
          <Section title="Secrets">
            <SecretsManager declared={declaredSecrets} />
          </Section>
          <Section title="Sync to another agent">
            <SyncSection root={root} />
          </Section>
          <Section title="Collaborate" badge={<PreviewBadge />}>
            <CollaborateSection />
          </Section>
        </div>
      </div>
    </div>
  );
}
