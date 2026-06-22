//! Recently opened skills/markdown, persisted SERVER-SIDE so they belong to the
//! machine whose files they point at. The client reaches every `/api/*` through the
//! active server (the local one, or a remote it's proxying to), so this list follows
//! the connection automatically: you see a machine's recents whether you opened it
//! locally or over SSH. Stored as `recents.json` in the config dir; newest-first,
//! deduped by `root`, capped at `MAX`.
use serde::{Deserialize, Serialize};

use crate::paths;

const MAX: usize = 8;

#[derive(Serialize, Deserialize, Clone)]
pub struct Recent {
    /// The opened skill folder, or a loose markdown file's absolute path. Also the
    /// dedup/identity key.
    pub root: String,
    pub name: String,
    /// "skill" (default when absent) or "markdown" — how the client routes the open.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

fn store_path() -> Result<std::path::PathBuf, String> {
    Ok(paths::config_dir()?.join("recents.json"))
}

/// The stored list, newest-first. A missing or corrupt file reads as empty — listing
/// recents must never fail.
pub fn list() -> Vec<Recent> {
    let Ok(path) = store_path() else {
        return Vec::new();
    };
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save(items: &[Recent]) -> Result<Vec<Recent>, String> {
    paths::ensure_config_dir()?;
    let json = serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?;
    std::fs::write(store_path()?, json).map_err(|e| e.to_string())?;
    Ok(items.to_vec())
}

/// Add (or move to the front) an entry, returning the updated list. Dedup is by
/// `root`, so re-opening the same skill just bumps it to the top.
pub fn add(root: &str, name: &str, kind: Option<&str>) -> Result<Vec<Recent>, String> {
    let mut items = list();
    items.retain(|r| r.root != root);
    items.insert(0, Recent { root: root.into(), name: name.into(), kind: kind.map(Into::into) });
    items.truncate(MAX);
    save(&items)
}

/// Drop the entry with this root, returning the updated list.
pub fn remove(root: &str) -> Result<Vec<Recent>, String> {
    let mut items = list();
    items.retain(|r| r.root != root);
    save(&items)
}
