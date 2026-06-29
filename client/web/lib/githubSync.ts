import * as api from "@/lib/api";
import type { GhSyncResult } from "@/lib/api";

/** Reconcile a skill with its remote (remote-first: ff-pull / push / rebase) and
 *  apply the side-effects every caller needs. A pull changed the working tree, so
 *  the editor must reload; a push only moved git state, so a bump that refreshes
 *  diff baselines + git-derived panels is enough. Shared by the Remote panel's
 *  "Sync now" and the Versions header's quick-sync so the two never diverge. */
export async function runGithubSync(
  root: string,
  { reload, bumpGit }: { reload: (force?: boolean) => void; bumpGit: () => void },
): Promise<GhSyncResult> {
  const r = await api.githubSyncNow(root);
  if (r.pulled > 0) reload(true);
  else bumpGit();
  return r;
}
