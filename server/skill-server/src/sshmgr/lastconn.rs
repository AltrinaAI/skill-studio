//! VS Code-style connection memory: the host we were last connected to, persisted on
//! the CONNECTING machine (never the remote) so the next launch can auto-reconnect.
//! Written on a successful connect; cleared ONLY on an explicit user disconnect — not
//! on app-exit teardown, so quitting while connected still resumes next time. The
//! desktop's local server owns this; the standalone remote binary has no remoting and
//! never touches it.
use std::path::PathBuf;

fn path() -> Option<PathBuf> {
    skill_core::paths::config_dir().ok().map(|d| d.join("remote-last.json"))
}

/// The remembered host, or None to start Local. Missing/corrupt file ⇒ None.
pub fn load() -> Option<String> {
    let bytes = std::fs::read(path()?).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get("host")?.as_str().map(str::to_string)
}

/// Remember a host (best-effort; a write failure just means no resume next launch).
pub fn remember(host: &str) {
    let Some(p) = path() else { return };
    let _ = skill_core::paths::ensure_config_dir();
    let _ = std::fs::write(p, serde_json::json!({ "host": host }).to_string());
}

/// Forget the remembered host (the user chose Local).
pub fn forget() {
    if let Some(p) = path() {
        let _ = std::fs::remove_file(p);
    }
}
