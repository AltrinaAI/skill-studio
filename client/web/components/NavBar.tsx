"use client";

import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AltrinaMark } from "./FileIcon";
import { ThemeToggle } from "./ui";
import RemoteMenu from "./RemoteMenu";
import { secretsPath, studioPath } from "@/lib/routes";
import { useRecents } from "@/lib/recents";
import { toggleTheme } from "@/lib/theme";

function TerminalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}
function StudioIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

/** A persistent app-nav link (Terminals, Secrets) shown on every page; the entry
 *  for the current page reads as active. */
function NavLink({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel hover:text-fg"
      }`}
    >
      {icon}
      <span className="hidden text-xs sm:inline">{label}</span>
    </button>
  );
}

/**
 * The app's top chrome — constant height + identical layout across pages (no shift on
 * navigation). It deliberately carries four distinct IA categories (our mental model):
 *   1. Identity / location — the "Skill Studio" brand (links home, except on home) and
 *      the optional `breadcrumb` (page or skill name).
 *   2. Page chrome — the page's own `children` actions (e.g. Studio's Review/Manage/
 *      Export). Owned by the page; they sit in the bar only because there's room, and
 *      may move into the page body later.
 *   3. Destinations (pages) — Terminal, Secrets (Home = the brand). Always navigation;
 *      the current page reads active.
 *   4. Status / controls — Remote (connection status) and the theme toggle. Global.
 *
 * Known overlap kept for now: in Studio the Terminal link toggles the in-page
 * *projection* of the Terminal destination (the side panel) instead of navigating (see
 * `onTerminals`). The clean future split = that toggle becomes Studio page chrome and
 * the link navigates everywhere.
 */
export default function NavBar({
  breadcrumb,
  children,
  onTerminals,
  terminalsOpen,
}: {
  breadcrumb?: ReactNode;
  children?: ReactNode;
  /** Categories 2↔3 overlap (see header): a page that projects the Terminal
   *  destination inline (Studio's side panel) overrides the link to toggle that
   *  projection instead of navigating; the full Terminal page stays reachable from
   *  the projection (its expand button). Future-clean: move this toggle to page chrome. */
  onTerminals?: () => void;
  terminalsOpen?: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const atHome = pathname === "/";
  const recents = useRecents();

  // "Studio" is a persistent destination with no singleton route (one repo per skill):
  // in a skill → its index (SKILL.md); else resume the last-opened skill; else Home.
  const studioSeg = pathname.startsWith("/studio/") ? pathname.split("/")[2] : null;
  const lastSkill = recents.find((r) => r.kind !== "markdown");
  const studioTarget = studioSeg ? `/studio/${studioSeg}` : lastSkill ? studioPath(lastSkill.root) : "/";

  const brand = (
    <span className="flex items-center gap-1.5 text-brand">
      <AltrinaMark className="h-5 w-auto" />
      <span className="text-[0.95rem] font-semibold tracking-tight">Skill Studio</span>
    </span>
  );

  return (
    <header className="z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 text-sm">
      {/* (1) identity + location */}
      {atHome ? (
        <span className="px-1.5">{brand}</span>
      ) : (
        <button
          type="button"
          onClick={() => navigate("/")}
          title="Back to home"
          className="flex items-center rounded-md px-1.5 py-1 hover:bg-panel"
        >
          {brand}
        </button>
      )}
      {breadcrumb}
      <div className="ml-auto flex items-center gap-1">
        {/* Three visible buckets, divided to match the IA categories (see header):
            (2) page chrome | (3) destinations | (4) status + controls. */}
        {/* (2) page chrome — owned by the page, here only for space */}
        {children}
        {children && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
        {/* (3) destinations — the persistent "pages" cluster, identical on every page.
            Studio has no singleton route (per-skill), so it points at the current/last skill
            (else Home); in Studio the Terminal link toggles its projection (see onTerminals). */}
        <NavLink
          icon={<StudioIcon />}
          label="Studio"
          active={pathname.startsWith("/studio")}
          onClick={() => navigate(studioTarget)}
        />
        <NavLink
          icon={<TerminalIcon />}
          label="Terminals"
          active={onTerminals ? !!terminalsOpen : pathname === "/terminals"}
          onClick={onTerminals ?? (() => navigate("/terminals"))}
        />
        <NavLink icon={<KeyIcon />} label="Secrets" active={pathname === "/secrets"} onClick={() => navigate(secretsPath())} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {/* (4) status + controls — Remote (connection status) + theme toggle, the global utility corner */}
        <RemoteMenu />
        <ThemeToggle onClick={toggleTheme} />
      </div>
    </header>
  );
}
