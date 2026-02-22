use std::{fs, path::PathBuf, process::Command};
use tracing::info;

/// Spawn a new `pi` process in the given directory.
/// Creates `new_folder` as a subdirectory if provided and non-empty.
/// Enforces that the final path is within `home_dir`.
pub fn spawn_agent(path_str: &str, new_folder: &str, home_dir: &PathBuf) -> Result<String, String> {
    let mut target = PathBuf::from(path_str);

    let new_folder = new_folder.trim();
    if !new_folder.is_empty() {
        target.push(new_folder);
    }

    if !target.exists() {
        if new_folder.is_empty() {
            return Err("Path does not exist".into());
        }
        fs::create_dir_all(&target).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let canonical = fs::canonicalize(&target).map_err(|e| format!("Invalid path: {}", e))?;

    if !canonical.starts_with(home_dir) {
        return Err("Path resolves outside home directory".into());
    }

    Command::new("pi")
        .current_dir(&canonical)
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    info!(path = %canonical.display(), "Agent spawned");
    Ok(canonical.to_string_lossy().to_string())
}
