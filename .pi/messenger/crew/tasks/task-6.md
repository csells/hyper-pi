# Fix hypivisor proxy: validate handshake, use node.machine, URL-decode token

## Problem
1. Proxy hardcodes `127.0.0.1` instead of using `node.machine` — breaks multi-machine (R-CC-5/6/7)
2. Proxy doesn't validate 101 handshake response — failed connections enter relay loop silently
3. Token not URL-decoded in auth.rs — fails with special characters when client uses encodeURIComponent

## Files
- `hypivisor/src/main.rs` (proxy section)
- `hypivisor/src/auth.rs`

## Changes
1. Use `node.machine.clone()` instead of `"127.0.0.1".to_string()` in `handle_proxy_ws`
2. After reading handshake response, verify it contains "101". If not, send error to dashboard and return.
3. In `auth.rs`, URL-decode the extracted token before comparison using `percent_encoding::percent_decode_str` or manual decode

## Tests
- Add unit test for URL-decoded token matching in auth.rs
- Add integration test: proxy returns error for offline agent (not hang)
- Verify existing proxy-relay tests pass
