"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { btnGhost, btnPrimary, Spinner } from "@/components/ui";
import { NAME_REGEX, LIMITS } from "@/lib/skill";
import * as api from "@/lib/api";
import type { SkillHome } from "@/lib/api";

/**
 * Scaffold a brand-new skill: pick a name, description and location, and we
 * write a starter SKILL.md there, then open it in the editor. Name follows the
 * spec (it doubles as the folder name); location is one of the agent skill dirs.
 */
export default function NewSkillDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (root: string) => void;
}) {
  const [homes, setHomes] = useState<SkillHome[] | null>(null);
  const [target, setTarget] = useState("universal");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .skillHomes()
      .then((h) => {
        // Guard against a misrouted backend (e.g. a stale server that serves the
        // SPA for an unknown /api route) handing back a non-array.
        const list = Array.isArray(h) ? h : [];
        setHomes(list);
        if (list.length && !list.some((x) => x.id === "universal")) setTarget(list[0].id);
      })
      .catch(() => setHomes([]));
  }, []);
  const home = useMemo(() => homes?.find((h) => h.id === target), [homes, target]);
  const nameValid = NAME_REGEX.test(name) && name.length <= LIMITS.nameMax;
  const descValid = description.trim().length > 0;
  const canCreate = nameValid && descValid && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setErr(null);
    try {
      const root = await api.createSkill(target, name, description.trim());
      onCreated(root);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t create the skill");
      setBusy(false);
    }
  };

  return (
    <Modal title="New skill" onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-4 px-5 py-4"
        >
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="my-skill"
              spellCheck={false}
              autoFocus
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-sm text-fg outline-none focus:border-accent"
            />
            <p className="mt-1 text-[0.7rem] text-faint">
              {name && !nameValid
                ? "Lowercase letters, digits and single hyphens only (also the folder name)."
                : "Doubles as the folder name."}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the skill does and when an agent should use it."
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Location</label>
            {homes === null ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner className="h-3.5 w-3.5" /> Loading…
              </p>
            ) : (
              <>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                >
                  {homes.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
                {home && (
                  <p className="mt-1 truncate font-mono text-[0.7rem] text-faint" title={`${home.dir}/${name || "…"}`}>
                    {home.dir}/{name || "…"}
                  </p>
                )}
              </>
            )}
          </div>

          {err && <p className="text-xs text-danger">{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={btnGhost}>
              Cancel
            </button>
            <button type="submit" disabled={!canCreate} className={btnPrimary}>
              {busy ? "Creating…" : "Create skill"}
            </button>
          </div>
        </form>
    </Modal>
  );
}
