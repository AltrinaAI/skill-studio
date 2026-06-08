"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/Modal";
import { btnDanger, btnGhost, btnPrimary } from "@/components/ui";
import { ConfirmContext, type ConfirmOptions } from "@/components/useConfirm";

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * App-wide async confirm dialog. Replaces `window.confirm`, which is broken in
 * the desktop webview on macOS — wry doesn't implement the WKWebView JS dialog
 * panels, so `confirm()` returns `false` immediately and every confirm-gated
 * action (revert, delete, …) silently did nothing there. This renders our own
 * dialog, so it behaves identically in the browser and in the desktop/mobile
 * webview. Mount this provider once at the app root; read it with `useConfirm`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog opts={pending} onResolve={settle} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ opts, onResolve }: { opts: ConfirmOptions; onResolve: (ok: boolean) => void }) {
  // Focus the confirm button so Enter confirms (Esc cancels via the Modal),
  // matching the native confirm() this replaces.
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  return (
    <Modal title={opts.title} onClose={() => onResolve(false)} widthClass="max-w-sm">
      <div className="space-y-4 px-5 py-4">
        {opts.body != null && <div className="whitespace-pre-line text-sm text-muted">{opts.body}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onResolve(false)} className={btnGhost}>
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onResolve(true)}
            className={opts.danger ? btnDanger : btnPrimary}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
