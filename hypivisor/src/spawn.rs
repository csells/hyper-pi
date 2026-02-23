use std::{fs, path::PathBuf, process::Command};
use tracing::info;

/// Validate and prepare the target directory for spawning.
/// Returns the canonicalized path on success.
/// Separated from the actual spawn to enable unit testing of path validation.
pub fn validate_spawn_path(
    path_str: &str,
    new_folder: &str,
    home_dir: &PathBuf,
) -> Result<PathBuf, String> {
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

    Ok(canonical)
}

/// Spawn a new `pi` process in the given directory.
/// Creates `new_folder` as a subdirectory if provided and non-empty.
/// Enforces that the final path is within `home_dir`.
pub fn spawn_agent(path_str: &str, new_folder: &str, home_dir: &PathBuf) -> Result<String, String> {
    let canonical = validate_spawn_path(path_str, new_folder, home_dir)?;

    Command::new("pi")
        .current_dir(&canonical)
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    info!(path = %canonical.display(), "Agent spawned");
    Ok(canonical.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a uniquely-named test directory under $HOME.
    fn unique_test_dir(suffix: &str) -> (PathBuf, PathBuf) {
        let home = dirs::home_dir().unwrap_or_else(|| std::env::temp_dir());
        let dir = home.join(format!(".hypi_test_sp_{}", suffix));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (home, dir)
    }

    #[test]
    fn rejects_path_outside_home() {
        let (_, home) = unique_test_dir("outside");
        let result = validate_spawn_path("/usr", "", &home);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside home"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn rejects_nonexistent_path_without_new_folder() {
        let (_, home) = unique_test_dir("nonexist");
        let nonexistent = home.join("does_not_exist");
        let result = validate_spawn_path(nonexistent.to_str().unwrap(), "", &home);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Path does not exist"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn creates_new_folder_when_specified() {
        let (home, dir) = unique_test_dir("newfolder");
        let result = validate_spawn_path(dir.to_str().unwrap(), "new_project", &home);
        assert!(result.is_ok());
        let canonical = result.unwrap();
        assert!(canonical.ends_with("new_project"));
        assert!(dir.join("new_project").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn trims_whitespace_from_new_folder() {
        let (home, dir) = unique_test_dir("trim");
        let result = validate_spawn_path(dir.to_str().unwrap(), "  trimmed  ", &home);
        assert!(result.is_ok());
        let canonical = result.unwrap();
        assert!(canonical.ends_with("trimmed"));
        assert!(dir.join("trimmed").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_new_folder_uses_path_directly() {
        let (home, dir) = unique_test_dir("empty");
        let subdir = dir.join("existing");
        fs::create_dir_all(&subdir).unwrap();
        let result = validate_spawn_path(subdir.to_str().unwrap(), "", &home);
        assert!(result.is_ok());
        let canonical = result.unwrap();
        assert!(canonical.ends_with("existing"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn returns_canonicalized_path() {
        let (home, dir) = unique_test_dir("canon");
        let subdir = dir.join("sub");
        fs::create_dir_all(&subdir).unwrap();
        let non_canonical = format!("{}/./sub", dir.to_str().unwrap());
        let result = validate_spawn_path(&non_canonical, "", &home);
        assert!(result.is_ok());
        let canonical = result.unwrap();
        assert!(!canonical.to_str().unwrap().contains("/./"));
        assert!(canonical.ends_with("sub"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_traversal_with_dotdot_caught() {
        let (_, dir) = unique_test_dir("dotdot");
        let subdir = dir.join("sub");
        fs::create_dir_all(&subdir).unwrap();
        let escape = format!("{}/../../etc", subdir.to_str().unwrap());
        let result = validate_spawn_path(&escape, "", &dir);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn new_folder_creates_nested_dirs() {
        let (home, dir) = unique_test_dir("nested");
        let result = validate_spawn_path(dir.to_str().unwrap(), "a/b/c", &home);
        assert!(result.is_ok());
        assert!(dir.join("a/b/c").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn whitespace_only_new_folder_treated_as_empty() {
        let (home, dir) = unique_test_dir("wsonly");
        let result = validate_spawn_path(dir.to_str().unwrap(), "   ", &home);
        assert!(result.is_ok());
        let _ = fs::remove_dir_all(&dir);
    }
}
