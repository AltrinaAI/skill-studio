// Transport-agnostic core: skill filesystem ops + discovery, no GUI/Tauri deps.
// Reused by both the Tauri desktop app and the headless skill-server.
pub mod discover;
pub mod filetypes;
pub mod gitops;
pub mod pathsafe;
pub mod secrets;
pub mod skill;
pub mod sync;
