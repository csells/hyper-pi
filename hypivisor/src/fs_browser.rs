use std::{fs, path::PathBuf};

/// List visible (non-hidden) subdirectories at `target`, enforcing
/// that the resolved path stays within `home_dir`.
pub fn list_directories(
    target: &PathBuf,
    home_dir: &PathBuf,
) -> Result<(String, Vec<String>), String> {
    let canonical = fs::canonicalize(target).map_err(|e| format!("Invalid path: {}", e))?;

    if !canonical.starts_with(home_dir) {
        return Err("Path resolves outside home directory".into());
    }

    let mut directories = Vec::new();
    let entries = fs::read_dir(&canonical).map_err(|e| format!("Cannot read directory: {}", e))?;

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }

        // Symlink safety: verify target is within $HOME
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            let Ok(resolved) = fs::canonicalize(entry.path()) else {
                continue;
            };
            if !resolved.starts_with(home_dir) {
                continue;
            }
        }

        directories.push(name_str.to_string());
    }
    directories.sort();

    Ok((canonical.to_string_lossy().to_string(), directories))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a uniquely-named test directory under $HOME to avoid collisions
    /// when tests run in parallel.
    fn unique_test_dir(suffix: &str) -> (PathBuf, PathBuf) {
        let home = dirs::home_dir().unwrap_or_else(|| std::env::temp_dir());
        let dir = home.join(format!(".hypi_test_fb_{}", suffix));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (home, dir)
    }

    #[test]
    fn lists_subdirectories() {
        let (home, tmp) = unique_test_dir("list");
        fs::create_dir_all(tmp.join("visible")).unwrap();
        fs::create_dir_all(tmp.join(".hidden")).unwrap();
        fs::write(tmp.join("file.txt"), "hello").unwrap();

        let (current, dirs) = list_directories(&tmp, &home).unwrap();
        assert!(current.contains(".hypi_test_fb_list"));
        assert!(dirs.contains(&"visible".to_string()));
        assert!(!dirs.contains(&".hidden".to_string()));
        assert!(!dirs.contains(&"file.txt".to_string()));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn rejects_path_outside_home() {
        let home = PathBuf::from("/tmp/fakehome");
        let target = PathBuf::from("/usr");
        let result = list_directories(&target, &home);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside home"));
    }

    #[test]
    fn returns_sorted_directories() {
        let (home, tmp) = unique_test_dir("sorted");
        fs::create_dir_all(tmp.join("zebra")).unwrap();
        fs::create_dir_all(tmp.join("alpha")).unwrap();
        fs::create_dir_all(tmp.join("middle")).unwrap();

        let (_, dirs) = list_directories(&tmp, &home).unwrap();
        assert_eq!(dirs, vec!["alpha", "middle", "zebra"]);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn empty_directory_returns_empty_vec() {
        let (home, tmp) = unique_test_dir("empty");

        let (_, dirs) = list_directories(&tmp, &home).unwrap();
        assert!(dirs.is_empty());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn nonexistent_path_returns_error() {
        let home = dirs::home_dir().unwrap_or_else(|| std::env::temp_dir());
        let target = home.join(".hypi_nonexistent_path_test");
        let result = list_directories(&target, &home);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid path"));
    }

    #[test]
    fn skips_files_only_returns_dirs() {
        let (home, tmp) = unique_test_dir("files");
        fs::write(tmp.join("file1.txt"), "content").unwrap();
        fs::write(tmp.join("file2.rs"), "content").unwrap();
        fs::create_dir_all(tmp.join("realdir")).unwrap();

        let (_, dirs) = list_directories(&tmp, &home).unwrap();
        assert_eq!(dirs, vec!["realdir"]);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn returns_canonical_current_path() {
        let (home, tmp) = unique_test_dir("canonical");
        // Use a path with /./
        let non_canonical = tmp.join(".");

        let (current, _) = list_directories(&non_canonical, &home).unwrap();
        // Should not contain /./
        assert!(!current.contains("/./"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn multiple_hidden_dirs_all_skipped() {
        let (home, tmp) = unique_test_dir("hidden");
        fs::create_dir_all(tmp.join(".git")).unwrap();
        fs::create_dir_all(tmp.join(".vscode")).unwrap();
        fs::create_dir_all(tmp.join(".pi")).unwrap();
        fs::create_dir_all(tmp.join("src")).unwrap();

        let (_, dirs) = list_directories(&tmp, &home).unwrap();
        assert_eq!(dirs, vec!["src"]);

        let _ = fs::remove_dir_all(&tmp);
    }
}
