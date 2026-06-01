// Backend bridge with two transports:
//   • Desktop (Tauri): in-process `invoke`.
//   • Browser (served by skill-server, e.g. backend in WSL2): `fetch('/api/...')`.
// Auto-detected at runtime. YAML parse/validate stays here in TS (lib/skill).
import { invoke } from "@tauri-apps/api/core";
import {
  parseSkillMd,
  serializeSkillMd,
  validateSkill,
  estimateTokens,
  countLines,
  type SkillFrontmatter,
} from "@/lib/skill";
import type { SkillData, FileData, TreeNode } from "@/lib/types";

/** True when running inside the Tauri desktop shell (vs a plain browser). */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Same-origin by default (server serves the UI + /api). Override for dev with
// VITE_API_BASE (e.g. point a Vite dev server at a remote skill-server).
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function http<T>(method: "GET" | "POST", path: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/api/${path}`, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(args ?? {}) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json && json.error) || `Request failed (${res.status})`);
  return json as T;
}

interface RawSkill {
  root: string;
  dirName: string;
  raw: string;
  tree: TreeNode[];
  files: string[];
  fileCount: number;
  dirCount: number;
  totalBytes: number;
}

// --- raw command transports ---
const readSkillRaw = (path: string) =>
  isTauri ? invoke<RawSkill>("read_skill", { path }) : http<RawSkill>("POST", "read-skill", { path });

export const readFile = (root: string, rel: string) =>
  isTauri ? invoke<FileData>("read_file", { root, rel }) : http<FileData>("POST", "read-file", { root, rel });

export const writeFile = (root: string, rel: string, content: string) =>
  isTauri
    ? invoke<void>("write_file", { root, rel, content })
    : http<void>("POST", "write-file", { root, rel, content });

const readImage = (root: string, rel: string) =>
  isTauri
    ? invoke<{ mime: string; base64: string }>("read_image_base64", { root, rel })
    : http<{ mime: string; base64: string }>("POST", "read-image", { root, rel });

export const discoverSkills = () =>
  isTauri ? invoke<AgentSkills[]>("discover_skills") : http<AgentSkills[]>("GET", "discover");

// --- composed helpers ---
export async function loadSkill(path: string): Promise<SkillData> {
  const r = await readSkillRaw(path);
  const parsed = parseSkillMd(r.raw);
  const validation = validateSkill({
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    hasFrontmatter: parsed.hasFrontmatter,
    parseError: parsed.parseError,
    dirName: r.dirName,
    files: r.files,
  });
  return {
    root: r.root,
    dirName: r.dirName,
    raw: r.raw,
    frontmatter: parsed.frontmatter,
    frontmatterRaw: parsed.frontmatterRaw,
    body: parsed.body,
    hasFrontmatter: parsed.hasFrontmatter,
    parseError: parsed.parseError,
    tree: r.tree,
    files: r.files,
    validation,
    stats: {
      bodyLines: countLines(parsed.body),
      bodyTokens: estimateTokens(parsed.body),
      fileCount: r.fileCount,
      dirCount: r.dirCount,
      totalBytes: r.totalBytes,
    },
  };
}

export async function saveSkillMd(root: string, frontmatter: SkillFrontmatter, body: string): Promise<void> {
  await writeFile(root, "SKILL.md", serializeSkillMd(frontmatter, body));
}

export async function imageDataUrl(root: string, rel: string): Promise<string> {
  const { mime, base64 } = await readImage(root, rel);
  return `data:${mime};base64,${base64}`;
}

/** Export the skill as a .zip — native save dialog (desktop) or browser download. */
export async function exportZip(root: string): Promise<void> {
  if (isTauri) {
    await invoke<boolean>("export_skill_zip", { root });
    return;
  }
  const a = document.createElement("a");
  a.href = `${API_BASE}/api/download?root=${encodeURIComponent(root)}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Native folder dialog — desktop only (browser uses the FolderPicker modal + listDir). */
export const pickSkillFolder = () => invoke<string | null>("pick_skill_folder");

// --- remote folder browsing (browser mode) ---
export interface DirEntry {
  name: string;
  isDir: boolean;
  isSkill: boolean;
}
export interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}
export const listDir = (path: string) => http<DirListing>("POST", "list-dir", { path });

export interface DiscoveredSkill {
  name?: string;
  description?: string;
  root: string;
  /** Backend-computed provenance: "personal" | "official" | "plugin". */
  kind: string;
  /** Repo/folder name when the skill is project-scoped (`<repo>/.claude/skills/…`). */
  project?: string;
}
export interface AgentSkills {
  agent: string;
  skills: DiscoveredSkill[];
}

// --- sync a skill into another agent's personal dir ---
export interface SyncTarget {
  agent: string;
  dir: string;
  present: boolean;
  isSource: boolean;
}
export const syncTargets = (root: string) =>
  isTauri ? invoke<SyncTarget[]>("sync_targets", { root }) : http<SyncTarget[]>("POST", "sync-targets", { root });
export const syncSkill = (root: string, agent: string, overwrite: boolean) =>
  isTauri
    ? invoke<{ dest: string }>("sync_skill", { root, agent, overwrite })
    : http<{ dest: string }>("POST", "sync-skill", { root, agent, overwrite });

// --- per-skill git version control ---
export interface GitInfo {
  available: boolean;
  isRepo: boolean;
  inParentRepo: boolean;
  toplevel?: string;
  branch?: string;
  dirty: boolean;
  hasRemote: boolean;
  hasIdentity: boolean;
}
export interface GitCommit {
  short: string;
  message: string;
  author: string;
  relativeDate: string;
}
export const gitInfo = (root: string) =>
  isTauri ? invoke<GitInfo>("git_info", { root }) : http<GitInfo>("POST", "git-info", { root });
export const gitInit = (root: string) =>
  isTauri ? invoke<GitInfo>("git_init", { root }) : http<GitInfo>("POST", "git-init", { root });
export const gitCommit = (root: string, message: string) =>
  isTauri
    ? invoke<{ sha: string; summary: string }>("git_commit", { root, message })
    : http<{ sha: string; summary: string }>("POST", "git-commit", { root, message });
export const gitLog = (root: string, limit = 20) =>
  isTauri ? invoke<GitCommit[]>("git_log", { root, limit }) : http<GitCommit[]>("POST", "git-log", { root, limit });

// --- secret manager (machine-local env vars for skills) ---
export interface SecretEntry {
  key: string;
  value: string;
}
export interface AgentInstall {
  agent: string;
  /** The agent's home dir exists on this machine. */
  installed: boolean;
  /** The skill-studio activation skill is installed for this agent. */
  hasSkill: boolean;
}
export interface SecretsStatus {
  configured: boolean;
  storePath: string;
  envPath: string;
  count: number;
  agents: AgentInstall[];
}
export interface SetupResult {
  envPath: string;
  storePath: string;
  installedAgents: string[];
  skillInstalled: boolean;
}
export const secretsStatus = () =>
  isTauri ? invoke<SecretsStatus>("secrets_status") : http<SecretsStatus>("GET", "secrets-status");
export const secretsList = () =>
  isTauri ? invoke<SecretEntry[]>("secrets_list") : http<SecretEntry[]>("GET", "secrets-list");
export const secretSet = (key: string, value: string) =>
  isTauri ? invoke<void>("secret_set", { key, value }) : http<void>("POST", "secret-set", { key, value });
export const secretDelete = (key: string) =>
  isTauri ? invoke<void>("secret_delete", { key }) : http<void>("POST", "secret-delete", { key });
export const secretsSetup = () =>
  isTauri ? invoke<SetupResult>("secrets_setup") : http<SetupResult>("POST", "secrets-setup");
