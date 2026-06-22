"use client";

import { useSyncExternalStore } from "react";
import * as api from "./api";

// Recents are now SERVER-SIDE (see api.ts): persisted in the active server's config
// dir and reached over `/api/recents`, which proxies to the remote while connected.
// So the list belongs to whichever machine you're working on — the same recents
// whether you opened it locally or over SSH — and the post-connect SPA reload
// re-fetches them for the now-active server automatically.
//
// The public surface (useRecents / addRecent / removeRecent) is unchanged and stays
// synchronous-looking: mutations update an in-memory cache optimistically (the client
// mirrors the server's dedup/cap/newest-first) and fire-and-forget the server write;
// load() re-syncs the authoritative list on each mount/reload.
export type { Recent } from "./api";
type Recent = api.Recent;

const listeners = new Set<() => void>();
let cache: Recent[] = [];

function emit() {
  for (const l of listeners) l();
}

/** Pull the authoritative list from the active server, then migrate any legacy
 *  localStorage recents — but ONLY if the server answered, so a slow cold start
 *  can't mark migration "done" and drop the old entries. */
async function load() {
  let reachable = false;
  try {
    cache = await api.recentsList();
    reachable = true;
    emit();
  } catch {
    /* server unreachable (cold start / mid-connect) — keep what we have, skip migration */
  }
  if (reachable) void migrateLegacy();
}

// One-time lift of the old client-only localStorage recents onto the server. Only
// reached once the server is reachable (see load()); the marker is set AFTER the
// entries land, so an interrupted/offline run retries next launch instead of losing
// them. Runs on the FIRST launch with this build — always Local, since the resume host
// is only persisted after a successful connect with this code — so entries go to the
// right machine; later launches short-circuit on the marker.
const LEGACY_KEY = "skillviewer-recents";
const MIGRATED_KEY = "skillviewer-recents-migrated";
async function migrateLegacy() {
  let old: Recent[];
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const raw = localStorage.getItem(LEGACY_KEY);
    old = raw ? JSON.parse(raw) : [];
  } catch {
    return;
  }
  if (Array.isArray(old) && old.length > 0) {
    // Push oldest-first so the newest ends up on top after the server prepends each.
    for (const r of [...old].reverse()) {
      if (!r || typeof r.root !== "string") continue;
      try {
        cache = await api.recentsAdd({ root: r.root, name: r.name ?? r.root, kind: r.kind });
        emit();
      } catch {
        return; // server dropped mid-migration — leave it unmarked and retry next launch
      }
    }
  }
  // Done: mark migrated and drop the legacy copy. Best-effort — if this throws, the
  // next launch re-reads an already-migrated (now empty) legacy list and no-ops.
  try {
    localStorage.setItem(MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

export function addRecent(r: Recent) {
  // Optimistic AND authoritative: the client mirrors the server's dedup/cap/newest-
  // first, so we keep the local result rather than overwriting from the response —
  // which, under rapid mutations, can arrive out of order and clobber a newer state.
  // The server is the source of truth on disk; load() re-syncs on the next reload.
  cache = [r, ...cache.filter((x) => x.root !== r.root)].slice(0, 8);
  emit();
  void api.recentsAdd(r).catch(() => {
    /* best-effort; the optimistic entry stands and re-syncs on reload */
  });
}

export function removeRecent(root: string) {
  cache = cache.filter((x) => x.root !== root);
  emit();
  void api.recentsRemove(root).catch(() => {
    /* best-effort; the optimistic removal stands and re-syncs on reload */
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useRecents(): Recent[] {
  return useSyncExternalStore(subscribe, () => cache, () => cache);
}

// Load on import (cold start / post-reload) so recents reflect the active server.
void load();
