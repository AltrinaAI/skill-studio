// Secret manager: a machine-local store of environment variables that skills
// load at runtime via the bundled `skill-studio` activation skill. Values live
// in a JSON store (the source of truth the UI edits) and are rendered to a
// shell-sourceable env file (`export KEY=VALUE`) that `activate.sh` reads.
//
// Storage is a 0600 file, not an OS keychain: WSL (the primary target) has no
// Secret Service, and the rendered env file must be plaintext for shells to
// source it anyway. A keyring backend can slot in behind this interface later
// for native desktop without changing callers.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::sync::{agent_user_dir, copy_tree};

const AGENTS: [&str; 4] = ["Claude Code", "Codex", "Cursor", "OpenClaw"];
const BOOTSTRAP_SKILL: &str = "skill-studio";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretEntry {
    key: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstall {
    agent: String,
    /// The agent's home dir exists on this machine.
    installed: bool,
    /// The `skill-studio` activation skill is present for this agent.
    has_skill: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretsStatus {
    configured: bool,
    store_path: String,
    env_path: String,
    count: usize,
    agents: Vec<AgentInstall>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupResult {
    env_path: String,
    store_path: String,
    installed_agents: Vec<String>,
    skill_installed: bool,
}

fn config_dir() -> Result<PathBuf, String> {
    if let Ok(x) = std::env::var("XDG_CONFIG_HOME") {
        if !x.is_empty() {
            return Ok(PathBuf::from(x).join("skill-studio"));
        }
    }
    let home = dirs::home_dir().ok_or_else(|| "Cannot locate home directory.".to_string())?;
    Ok(home.join(".config").join("skill-studio"))
}

fn store_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("secrets.json"))
}
fn env_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("env"))
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}
#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) {}

fn ensure_dir() -> Result<PathBuf, String> {
    let dir = config_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    set_mode(&dir, 0o700);
    Ok(dir)
}

fn load_store() -> Result<BTreeMap<String, String>, String> {
    match std::fs::read(store_path()?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Corrupt secrets store: {e}")),
        Err(_) => Ok(BTreeMap::new()),
    }
}

fn save_store(map: &BTreeMap<String, String>) -> Result<(), String> {
    ensure_dir()?;
    let path = store_path()?;
    let json = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    set_mode(&path, 0o600);
    render_env(map)
}

/// Single-quote a value for a POSIX shell, escaping embedded single quotes.
fn sh_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

fn render_env(map: &BTreeMap<String, String>) -> Result<(), String> {
    ensure_dir()?;
    let path = env_path()?;
    let mut body = String::new();
    if !map.is_empty() {
        body.push_str("# Rendered by Agent Skill Studio — do not edit by hand.\n");
        for (k, val) in map {
            body.push_str(&format!("export {k}={}\n", sh_quote(val)));
        }
    }
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    set_mode(&path, 0o600);
    Ok(())
}

/// A valid environment-variable name: leading letter/underscore, then word chars.
fn valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

pub fn secrets_list() -> Result<Vec<SecretEntry>, String> {
    Ok(load_store()?
        .into_iter()
        .map(|(key, value)| SecretEntry { key, value })
        .collect())
}

pub fn secret_set(key: &str, value: &str) -> Result<(), String> {
    let key = key.trim();
    if !valid_key(key) {
        return Err(
            "Invalid name. Use letters, digits, and underscores, not starting with a digit (e.g. OPENAI_API_KEY)."
                .into(),
        );
    }
    let mut map = load_store()?;
    map.insert(key.to_string(), value.to_string());
    save_store(&map)
}

pub fn secret_delete(key: &str) -> Result<(), String> {
    let mut map = load_store()?;
    map.remove(key);
    save_store(&map)
}

fn agent_base_dir(agent: &str) -> Option<PathBuf> {
    agent_user_dir(agent).and_then(|d| d.parent().map(Path::to_path_buf))
}

pub fn secrets_status() -> Result<SecretsStatus, String> {
    let store = store_path()?;
    let env = env_path()?;
    let agents = AGENTS
        .iter()
        .map(|a| AgentInstall {
            agent: (*a).to_string(),
            installed: agent_base_dir(a).map(|d| d.exists()).unwrap_or(false),
            has_skill: agent_user_dir(a)
                .map(|d| d.join(BOOTSTRAP_SKILL).join("SKILL.md").exists())
                .unwrap_or(false),
        })
        .collect();
    Ok(SecretsStatus {
        configured: store.exists(),
        count: load_store()?.len(),
        store_path: store.to_string_lossy().into_owned(),
        env_path: env.to_string_lossy().into_owned(),
        agents,
    })
}

/// Copy the bundled `skill-studio` activation skill into every installed agent's
/// skills dir, overwriting any prior copy. Returns the agents it installed to.
pub fn install_bootstrap_skill(skill_src: &Path) -> Result<Vec<String>, String> {
    if !skill_src.join("SKILL.md").exists() {
        return Err("Bundled skill-studio skill not found.".into());
    }
    let mut installed = Vec::new();
    for agent in AGENTS {
        let Some(base) = agent_base_dir(agent) else { continue };
        if !base.exists() {
            continue; // agent not installed on this machine
        }
        let Some(skills_dir) = agent_user_dir(agent) else { continue };
        let dest = skills_dir.join(BOOTSTRAP_SKILL);
        if dest.exists() {
            std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
        }
        std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
        let mut total = 0;
        copy_tree(skill_src, &dest, &mut total)?;
        installed.push(agent.to_string());
    }
    Ok(installed)
}

/// First-run setup: materialize the store + env file and (re)install the
/// activation skill into every installed agent. `skill_src` is the bundled
/// `skill-studio` folder, resolved by the caller (Tauri resource / server path).
pub fn secrets_setup(skill_src: Option<&Path>) -> Result<SetupResult, String> {
    let map = load_store()?;
    save_store(&map)?; // creates the store + env file if absent
    let installed_agents = match skill_src {
        Some(src) if src.join("SKILL.md").exists() => install_bootstrap_skill(src)?,
        _ => Vec::new(),
    };
    Ok(SetupResult {
        env_path: env_path()?.to_string_lossy().into_owned(),
        store_path: store_path()?.to_string_lossy().into_owned(),
        skill_installed: !installed_agents.is_empty(),
        installed_agents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_validated() {
        assert!(valid_key("OPENAI_API_KEY"));
        assert!(valid_key("_x"));
        assert!(!valid_key("1ABC"));
        assert!(!valid_key("a-b"));
        assert!(!valid_key(""));
    }

    #[test]
    fn quoting_is_shell_safe() {
        assert_eq!(sh_quote("abc"), "'abc'");
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn set_list_render_delete_roundtrip() {
        let tmp = std::env::temp_dir().join(format!("ass_secrets_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("XDG_CONFIG_HOME", &tmp);

        secret_set("OPENAI_API_KEY", "sk-test'x").unwrap();
        secret_set("FOO", "bar baz").unwrap();
        assert_eq!(secrets_list().unwrap().len(), 2);

        let env = std::fs::read_to_string(env_path().unwrap()).unwrap();
        assert!(env.contains("export FOO='bar baz'"));
        assert!(env.contains(r"export OPENAI_API_KEY='sk-test'\''x'"));

        secret_delete("FOO").unwrap();
        assert_eq!(secrets_list().unwrap().len(), 1);
        assert!(secret_set("1bad", "x").is_err());

        // Empty store renders an empty env file (so activate.sh reports "none").
        secret_delete("OPENAI_API_KEY").unwrap();
        assert!(std::fs::read_to_string(env_path().unwrap()).unwrap().is_empty());

        std::env::remove_var("XDG_CONFIG_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
