"use client";

import { useEffect, useRef } from "react";
import { useEditorStatus } from "@/lib/editorState";
import { skillKind, isEditableBundledSkill } from "@/lib/agents";
import { generateCommitMessage, commitModelStatus, isLocalCommitBackend } from "@/lib/api";

/** How long edits must be settled (saved + untouched) before we draft a message
 *  in the background, so the Save dialog can open with it already prepared. */
const IDLE_DELAY = 10_000;

/**
 * Warm the commit-message cache for `root` while the user is idle, so the Save
 * dialog can pre-fill instantly. Once edits have settled for {@link IDLE_DELAY},
 * we generate a draft in the background, fire-and-forget; the backend caches it
 * keyed by the working-tree diff, and opening the dialog peeks that cache.
 *
 * LOCAL-ONLY: this silent, no-click draft runs ONLY when the active backend is
 * on-device (the opt-in llama engine). A cloud coding-agent CLI costs metered
 * credit and sends the diff to a third party, so it must not fire automatically —
 * for cloud, the Save dialog's explicit Generate button is the trigger.
 *
 * Scope + safety:
 * - Only versionable skills draft: personal ones plus the editable bundled
 *   skills (skill-miner) — matching the Source Control panel's gate.
 * - We only draft after a real edit has happened since the last draft, so a
 *   quiescent skill never triggers generation.
 * - Errors (no changes yet, model still downloading) are swallowed — the dialog's
 *   explicit Generate button remains the fallback.
 */
export function useEagerCommitDraft(root: string) {
  const editor = useEditorStatus();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True once the user has edited since the last draft — gates generation so we
  // don't run on a skill that was only opened, never changed.
  const dirtySinceDraft = useRef(false);
  // Whether the active backend is on-device. Resolved once and cached; null until
  // first checked. Only a local backend may auto-draft (see LOCAL-ONLY above).
  const local = useRef<boolean | null>(null);

  useEffect(() => {
    if (skillKind(root).kind !== "personal" && !isEditableBundledSkill(root)) return;
    if (editor.dirty || editor.saving) dirtySinceDraft.current = true;

    // Idle = an editor is mounted, its buffer is on disk, and nothing's failing.
    const idle = editor.present && !editor.dirty && !editor.saving && !editor.error;
    if (timer.current) clearTimeout(timer.current);
    if (!idle || !dirtySinceDraft.current) return;

    timer.current = setTimeout(async () => {
      dirtySinceDraft.current = false; // consume; a later edit re-arms it
      // Resolve the backend once; only the on-device backend may auto-draft.
      if (local.current === null) {
        local.current = await commitModelStatus().then(isLocalCommitBackend).catch(() => false);
      }
      if (!local.current) return; // cloud backend → wait for an explicit click
      // Fire-and-forget: this warms the backend cache. The Save dialog peeks it.
      void generateCommitMessage(root).catch(() => {});
    }, IDLE_DELAY);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [root, editor.present, editor.dirty, editor.saving, editor.error]);
}
