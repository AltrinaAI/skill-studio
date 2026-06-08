import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { useConfirm } from "@/components/useConfirm";
import { consumeDiscardBypass, hasSaveError } from "@/lib/editorState";

/**
 * App-wide guard for the rare case where an autosave FAILED — navigating away
 * would drop the un-persisted edit, so we prompt. Normal edits never block:
 * autosave persists them (and flushes the final buffer on unmount), so links,
 * navigate(), and back/forward all just work. Must be mounted inside the data
 * router (it lives in AppShell): useBlocker requires it. Window close / full
 * reload is covered separately by useAutosave's beforeunload. The one-shot bypass
 * (armDiscardBypass) lives in lib/editorState so pages can arm it without
 * depending on the app layer.
 */
export function useDiscardBlocker() {
  const confirm = useConfirm();
  const blocker = useBlocker(() => {
    if (consumeDiscardBypass()) return false;
    return hasSaveError();
  });
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    // The blocker only blocks when an autosave failed, so by here the edit really
    // would be lost — ask, holding the navigation until the user answers.
    let active = true;
    void (async () => {
      const leave = await confirm({
        title: "Leave without saving?",
        body: "Your last change couldn’t be saved and will be lost.",
        confirmLabel: "Leave",
        danger: true,
      });
      if (!active) return;
      if (leave) blocker.proceed();
      else blocker.reset();
    })();
    return () => {
      active = false;
    };
  }, [blocker, confirm]);
}
