import { createContext, useContext, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  /** Body copy; `\n` renders as line breaks. */
  body?: ReactNode;
  /** Confirm button label (default "Confirm"). */
  confirmLabel?: string;
  /** Cancel button label (default "Cancel"). */
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
};

/** Supplied by {@link ConfirmProvider}; read by {@link useConfirm}. Kept here
 *  (not in confirm.tsx) so that file only exports a component — fast-refresh safe. */
export const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Returns `confirm(opts) => Promise<boolean>`. Must be used under a
 *  `ConfirmProvider` (mounted at the app root). */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside a ConfirmProvider");
  return ctx;
}
