//! Structured JSONL logger for hypivisor.
//!
//! Writes to `~/.pi/logs/hyper-pi.jsonl` — the same unified log that
//! pi-socket uses. Each entry includes a `component` field to distinguish
//! the source. Entries with `level: "error"` are marked `needsHardening: true`
//! so the harden skill can process them.
//!
//! This is **in addition to** the `tracing` macros that go to stderr.
//! stderr gives real-time visibility; the JSONL file gives persistent
//! structured logging for the harden skill.

use chrono::Utc;
use serde_json::json;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

fn log_dir() -> &'static PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = dirs::home_dir()
            .unwrap_or_else(|| ".".into())
            .join(".pi")
            .join("logs");
        let _ = fs::create_dir_all(&dir);
        dir
    })
}

fn write_entry(entry: serde_json::Value) {
    let path = log_dir().join("hyper-pi.jsonl");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        // Each line is well under PIPE_BUF (4096), so append is atomic
        let _ = writeln!(file, "{}", entry);
    }
}

/// Log a normal operational event.
pub fn info(component: &str, msg: &str) {
    write_entry(json!({
        "ts": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "level": "info",
        "component": component,
        "msg": msg,
    }));
}

/// Log an expected degraded condition (not a bug, but worth noting).
pub fn warn(component: &str, msg: &str) {
    write_entry(json!({
        "ts": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "level": "warn",
        "component": component,
        "msg": msg,
    }));
}

/// Log an unanticipated error. Marked `needsHardening: true` for the harden skill.
pub fn error(boundary: &str, msg: &str) {
    write_entry(json!({
        "ts": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "level": "error",
        "component": "hypivisor",
        "msg": msg,
        "needsHardening": true,
        "boundary": boundary,
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn write_entry_creates_valid_jsonl() {
        let dir = std::env::temp_dir().join("hypi_log_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.jsonl");

        let entry = json!({
            "ts": "2026-01-01T00:00:00.000Z",
            "level": "info",
            "component": "test",
            "msg": "hello",
        });

        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{}", entry);
        }

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(parsed["level"], "info");
        assert_eq!(parsed["msg"], "hello");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn error_entry_has_needs_hardening() {
        let entry = json!({
            "ts": "2026-01-01T00:00:00.000Z",
            "level": "error",
            "component": "hypivisor",
            "msg": "test error",
            "needsHardening": true,
            "boundary": "test.boundary",
        });

        assert_eq!(entry["needsHardening"], true);
        assert_eq!(entry["level"], "error");
        assert_eq!(entry["boundary"], "test.boundary");
    }
}
