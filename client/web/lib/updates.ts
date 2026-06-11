// App-update state for the UpdateBanner: one module-level store polling
// GET /api/update/status — a slow heartbeat at rest, fast while a download or
// restart is in flight. Same external-store idiom as lib/remote.ts. A 404 means
// this server has no updater (browser dev / remote binary) — stop for good.
import { useSyncExternalStore } from "react";
import { updateStatus, updateApply, type UpdateStatus } from "@/lib/api";

let status: UpdateStatus | null = null;
let unsupported = false;
let bootstrapped = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const IDLE_POLL_MS = 30 * 60 * 1000;
const ACTIVE_POLL_MS = 1500;

function emit() {
  for (const l of listeners) l();
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = unsupported ? null : setTimeout(() => void refresh(), ms);
}

async function refresh(): Promise<void> {
  try {
    status = await updateStatus();
    emit();
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status === 404) {
      unsupported = true;
      status = null;
      emit();
      return;
    }
    // Mid-update the server restarts (or hiccups) and goes briefly
    // unreachable — keep the last in-flight status so the banner keeps showing
    // "Downloading…"/"Restarting…" on the fast poll until the server answers.
    // Any other failure hides the banner until it returns.
    if (status?.phase !== "ready" && status?.phase !== "downloading") {
      status = null;
      emit();
    }
  }
  const active = status?.phase === "downloading" || status?.phase === "ready";
  // The server's own first feed check runs ~5s after launch, after our first
  // fetch — one early follow-up so a fresh update shows in seconds, not after
  // the idle cadence.
  const followUp = !bootstrapped && !status?.available;
  bootstrapped = true;
  schedule(active ? ACTIVE_POLL_MS : followUp ? 20_000 : IDLE_POLL_MS);
}

/** Kick off the install: optimistic "downloading" so the banner reacts at once,
 *  then the fast poll tracks the server's real progress. */
export async function applyUpdate(): Promise<void> {
  if (!status) return;
  status = { ...status, phase: "downloading", progress: null, error: null };
  emit();
  try {
    await updateApply();
  } catch {
    /* the refresh below picks up the server's real phase/error */
  }
  await refresh();
}

/** The latest update status; null until the first fetch lands (or unsupported). */
export function useUpdate(): UpdateStatus | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
    () => status,
  );
}

// First check waits out app startup; after that the schedule above takes over.
schedule(3000);
