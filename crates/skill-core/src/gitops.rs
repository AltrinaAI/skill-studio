// Per-skill git version control. Shells out to the system `git` (like editors do)
// so no native git library is bundled. Every op is a no-op or a clear error when
// git is unavailable or the directory isn't a repository.
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    available: bool,
    is_repo: bool,
    in_parent_repo: bool,
    toplevel: Option<String>,
    branch: Option<String>,
    dirty: bool,
    has_remote: bool,
    has_identity: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    sha: String,
    summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    short: String,
    message: String,
    author: String,
    relative_date: String,
}

fn git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))
}

/// Run a git command, returning trimmed stdout only on success.
fn git_ok(root: &Path, args: &[&str]) -> Option<String> {
    let out = git(root, args).ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn git_info(root: &str) -> Result<GitInfo, String> {
    let root_path = PathBuf::from(root);
    let mut info = GitInfo {
        available: git_available(),
        ..Default::default()
    };
    if !info.available {
        return Ok(info);
    }
    let canon_root = std::fs::canonicalize(&root_path).unwrap_or_else(|_| root_path.clone());
    if let Some(top) = git_ok(&root_path, &["rev-parse", "--show-toplevel"]) {
        let canon_top = std::fs::canonicalize(&top).unwrap_or_else(|_| PathBuf::from(&top));
        info.toplevel = Some(canon_top.to_string_lossy().into_owned());
        if canon_top == canon_root {
            info.is_repo = true;
        } else {
            info.in_parent_repo = true;
        }
    }
    if info.is_repo {
        info.branch = git_ok(&root_path, &["branch", "--show-current"]).filter(|s| !s.is_empty());
        info.dirty = git_ok(&root_path, &["status", "--porcelain"])
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        info.has_remote = git_ok(&root_path, &["remote"]).map(|s| !s.is_empty()).unwrap_or(false);
        info.has_identity = git_ok(&root_path, &["config", "user.email"])
            .map(|s| !s.is_empty())
            .unwrap_or(false);
    }
    Ok(info)
}

pub fn git_init(root: &str) -> Result<GitInfo, String> {
    if !git_available() {
        return Err("Git isn't installed.".into());
    }
    let root_path = PathBuf::from(root);
    let out = git(&root_path, &["init"])?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    git_info(root)
}

pub fn git_commit(root: &str, message: &str) -> Result<CommitResult, String> {
    if !git_available() {
        return Err("Git isn't installed.".into());
    }
    let root_path = PathBuf::from(root);
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Enter a commit message.".into());
    }
    if git_ok(&root_path, &["config", "user.email"]).map(|s| s.is_empty()).unwrap_or(true) {
        return Err(
            "No git identity set. Run: git config --global user.email \"you@example.com\" (and user.name).".into(),
        );
    }
    let add = git(&root_path, &["add", "-A"])?;
    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).trim().to_string());
    }
    let out = git(&root_path, &["commit", "-m", msg])?;
    if !out.status.success() {
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        if combined.contains("nothing to commit") {
            return Err("Nothing to commit — no changes since the last version.".into());
        }
        return Err(combined.trim().to_string());
    }
    Ok(CommitResult {
        sha: git_ok(&root_path, &["rev-parse", "HEAD"]).unwrap_or_default(),
        summary: git_ok(&root_path, &["log", "-1", "--pretty=%s"]).unwrap_or_default(),
    })
}

pub fn git_log(root: &str, limit: usize) -> Result<Vec<Commit>, String> {
    if !git_available() {
        return Ok(vec![]);
    }
    let root_path = PathBuf::from(root);
    let n = limit.clamp(1, 200).to_string();
    // Unit-separator (0x1f) between fields; newline between commits.
    let out = git(&root_path, &["log", "-n", &n, "--pretty=%h%x1f%s%x1f%an%x1f%ar"])?;
    if !out.status.success() {
        return Ok(vec![]); // not a repo yet / no commits
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut commits = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split('\u{1f}').collect();
        if parts.len() == 4 {
            commits.push(Commit {
                short: parts[0].to_string(),
                message: parts[1].to_string(),
                author: parts[2].to_string(),
                relative_date: parts[3].to_string(),
            });
        }
    }
    Ok(commits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_when_git_present() {
        if !git_available() {
            return; // skip on machines without git
        }
        let base = std::env::temp_dir().join(format!("ass_git_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("SKILL.md"), "---\nname: t\n---\nhi").unwrap();
        let root = base.to_string_lossy().to_string();

        git_init(&root).unwrap();
        // Local identity so the commit works regardless of global config.
        let _ = git(&base, &["config", "user.email", "test@example.com"]);
        let _ = git(&base, &["config", "user.name", "Test"]);

        let info = git_info(&root).unwrap();
        assert!(info.is_repo && info.available);

        let res = git_commit(&root, "initial version").unwrap();
        assert!(!res.sha.is_empty());

        let log = git_log(&root, 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].message, "initial version");

        // Nothing-to-commit path.
        assert!(git_commit(&root, "again").is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}
