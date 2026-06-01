// Sync a skill into another agent's personal/global skills directory by copying
// its directory tree. A skill is just a folder with SKILL.md, and SKILL.md is a
// shared format across agents, so syncing is a plain copy — no conversion.
use std::path::{Path, PathBuf};

use serde::Serialize;

const IGNORED_DIRS: [&str; 5] = [".git", "node_modules", ".next", "__pycache__", ".venv"];
const MAX_TOTAL: u64 = 100 * 1024 * 1024; // 100 MB
const AGENTS: [&str; 4] = ["Claude Code", "Codex", "Cursor", "OpenClaw"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTarget {
    agent: String,
    dir: String,
    present: bool,
    is_source: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    dest: String,
}

/// The personal/global skills directory each agent reads (where a synced copy goes).
pub fn agent_user_dir(agent: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let rel = match agent {
        "Claude Code" => ".claude/skills",
        "Codex" => ".codex/skills",
        "Cursor" => ".cursor/skills",
        "OpenClaw" => ".openclaw/skills",
        _ => return None,
    };
    Some(home.join(rel))
}

fn skill_dir_name(root: &Path) -> Option<String> {
    root.file_name().map(|s| s.to_string_lossy().into_owned())
}

/// For each agent, where the skill would land and whether a copy is already there.
pub fn sync_targets(root: &str) -> Result<Vec<SyncTarget>, String> {
    let root_path = PathBuf::from(root);
    let name = skill_dir_name(&root_path).ok_or_else(|| "Invalid skill path.".to_string())?;
    let canon_root = std::fs::canonicalize(&root_path).unwrap_or_else(|_| root_path.clone());
    let mut out = Vec::new();
    for agent in AGENTS {
        let Some(dir) = agent_user_dir(agent) else {
            continue;
        };
        let dest = dir.join(&name);
        let present = dest.join("SKILL.md").exists();
        let is_source = std::fs::canonicalize(&dest).map(|c| c == canon_root).unwrap_or(false);
        out.push(SyncTarget {
            agent: agent.to_string(),
            dir: dir.to_string_lossy().into_owned(),
            present,
            is_source,
        });
    }
    Ok(out)
}

/// Copy the skill into `<agent user dir>/<dirName>`. Refuses to overwrite unless
/// asked, and never copies a skill onto itself.
pub fn sync_skill(root: &str, agent: &str, overwrite: bool) -> Result<SyncResult, String> {
    let root_path = PathBuf::from(root);
    if !root_path.join("SKILL.md").exists() {
        return Err("Not a skill directory (no SKILL.md).".into());
    }
    let name = skill_dir_name(&root_path).ok_or_else(|| "Invalid skill path.".to_string())?;
    let dir = agent_user_dir(agent).ok_or_else(|| format!("Unknown agent: {agent}"))?;
    let dest = dir.join(&name);

    let canon_root = std::fs::canonicalize(&root_path).unwrap_or_else(|_| root_path.clone());
    if std::fs::canonicalize(&dest).map(|c| c == canon_root).unwrap_or(false) {
        return Err("The skill already lives here.".into());
    }
    if dest.exists() {
        if !overwrite {
            return Err(format!("A skill named \"{name}\" already exists for {agent}."));
        }
        std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut total: u64 = 0;
    copy_tree(&root_path, &dest, &mut total)?;
    Ok(SyncResult {
        dest: dest.to_string_lossy().into_owned(),
    })
}

pub(crate) fn copy_tree(src: &Path, dst: &Path, total: &mut u64) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    let rd = std::fs::read_dir(src).map_err(|e| e.to_string())?;
    for entry in rd.filter_map(|e| e.ok()) {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if ft.is_dir() {
            if IGNORED_DIRS.contains(&name_str.as_ref()) {
                continue;
            }
            copy_tree(&from, &to, total)?;
        } else if ft.is_file() {
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            *total += len;
            if *total > MAX_TOTAL {
                return Err("Skill is too large to sync.".into());
            }
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_agent_dirs() {
        assert!(agent_user_dir("Claude Code").unwrap().ends_with(".claude/skills"));
        assert!(agent_user_dir("Codex").unwrap().ends_with(".codex/skills"));
        assert!(agent_user_dir("Cursor").unwrap().ends_with(".cursor/skills"));
        assert!(agent_user_dir("OpenClaw").unwrap().ends_with(".openclaw/skills"));
        assert!(agent_user_dir("Nope").is_none());
    }

    #[test]
    fn copies_tree_skipping_ignored_and_symlinks() {
        let base = std::env::temp_dir().join(format!("ass_sync_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("src");
        std::fs::create_dir_all(src.join(".git")).unwrap();
        std::fs::create_dir_all(src.join("scripts")).unwrap();
        std::fs::write(src.join("SKILL.md"), "x").unwrap();
        std::fs::write(src.join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::write(src.join("scripts/run.py"), "print(1)").unwrap();

        let dst = base.join("dst");
        let mut total = 0;
        copy_tree(&src, &dst, &mut total).unwrap();

        assert!(dst.join("SKILL.md").exists());
        assert!(dst.join("scripts/run.py").exists());
        assert!(!dst.join(".git").exists(), ".git must be skipped");
        let _ = std::fs::remove_dir_all(&base);
    }
}
