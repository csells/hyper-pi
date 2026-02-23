# Hypivisor Rust unit test gaps (spawn.rs, fs_browser.rs)

Add unit tests for `spawn.rs` and expand `fs_browser.rs` tests. These modules have business-critical path validation logic with 0 and 2 tests respectively.

**Files to modify:**
- `hypivisor/src/spawn.rs` — add `#[cfg(test)] mod tests` (~80 lines)
- `hypivisor/src/fs_browser.rs` — extend existing `mod tests` (~60 lines)

**spawn.rs tests (6-8 tests):**
1. `spawn_agent` rejects path outside home directory → returns Err
2. `spawn_agent` rejects non-existent path when no new_folder → returns Err("Path does not exist")
3. `spawn_agent` creates new_folder subdirectory when specified
4. `spawn_agent` with new_folder trims whitespace
5. `spawn_agent` with empty new_folder and existing path proceeds (uses path directly)
6. `spawn_agent` returns canonicalized path on success
7. Path traversal with `..` is caught by canonicalize + starts_with check

**Note:** The actual `Command::new("pi").spawn()` call will fail in CI since `pi` may not be installed. Tests should focus on the validation logic up to the point of spawning. Use temp directories within $HOME for tests that need valid paths.

**fs_browser.rs additional tests (4-5 tests):**
1. Empty directory returns empty vec
2. Directory with only hidden entries returns empty vec
3. Files (not directories) are excluded
4. Non-existent path returns error
5. Deeply nested directory works correctly

**Acceptance criteria:**
- ~12 new Rust tests
- Tests pass with `cd hypivisor && cargo test`
- All path validation edge cases covered
