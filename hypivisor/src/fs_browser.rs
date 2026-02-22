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

    #[test]
    fn lists_subdirectories() {
        let home = dirs::home_dir().unwrap_or_else(|| std::env::temp_dir());
        let tmp = home.join(".hypi_test_list");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("visible")).unwrap();
        fs::create_dir_all(tmp.join(".hidden")).unwrap();
        fs::write(tmp.join("file.txt"), "hello").unwrap();

        let (current, dirs) = list_directories(&tmp, &home).unwrap();
        assert!(current.contains("hypi_test_list"));
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
}
