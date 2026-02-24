use crate::rpc::{self, RpcRequest};
use crate::state::{NodeInfo, NodeStatus, Registry};
use asupersync::Cx;
use chrono::Utc;
use serde_json;
use std::collections::HashMap;
use tracing::info;

// ── Request routing ──────────────────────────────────────────────────────────

/// Result of matching an incoming HTTP request path to a handler.
#[derive(Debug, PartialEq, Eq)]
pub enum RouteMatch<'a> {
    /// Dashboard/agent WebSocket (/ws)
    Registry,
    /// Proxy relay to a specific agent (/ws/agent/{nodeId})
    AgentProxy(&'a str),
    /// No matching route
    NotFound,
    /// Bad request (e.g. /ws/agent/ with empty node ID)
    BadRequest(&'static str),
}

/// Parse the URI path and query string from a raw HTTP request's first line.
/// Returns (full_uri, path_only). Falls back to ("/", "/") on invalid input.
pub fn parse_request_uri(request_str: &str) -> (&str, &str) {
    let first_line = request_str.lines().next().unwrap_or("");
    let uri = first_line.split_whitespace().nth(1).unwrap_or("/");
    let path = uri.split('?').next().unwrap_or("/");
    (uri, path)
}

/// Match a request path to a route.
pub fn match_route<'a>(path: &'a str) -> RouteMatch<'a> {
    if path == "/ws" {
        RouteMatch::Registry
    } else if let Some(node_id) = path.strip_prefix("/ws/agent/") {
        if node_id.is_empty() {
            RouteMatch::BadRequest("Missing node ID")
        } else {
            RouteMatch::AgentProxy(node_id)
        }
    } else {
        RouteMatch::NotFound
    }
}

// ── Registry handler logic ───────────────────────────────────────────────────

/// Build the JSON init event sent to newly connected registry WebSocket clients.
pub fn build_init_event(nodes: &[NodeInfo]) -> String {
    serde_json::json!({
        "event": "init",
        "nodes": nodes,
        "protocol_version": "1"
    })
    .to_string()
}

/// Process an incoming text message on the registry WebSocket.
///
/// Parses the JSON as an RPC request, dispatches it, and returns:
/// - `Some((response_json, maybe_new_node_id))` on success
/// - `None` if the text is not valid JSON-RPC
///
/// If the RPC method is "register" and the params contain a valid node,
/// the node's ID is returned so the caller can track which node this
/// connection represents.
pub fn process_registry_message(
    cx: &Cx,
    text: &str,
    state: &Registry,
    registered_node_id: Option<&str>,
) -> Option<(String, Option<String>)> {
    let req: RpcRequest = serde_json::from_str(text).ok()?;

    let new_node_id = if req.method == "register" {
        req.params
            .as_ref()
            .and_then(|p| serde_json::from_value::<NodeInfo>(p.clone()).ok())
            .map(|n| n.id.clone())
    } else {
        None
    };

    let response = rpc::dispatch(cx, req, state, registered_node_id);
    let json = serde_json::to_string(&response).unwrap();
    Some((json, new_node_id))
}

/// Mark a node as offline and broadcast the event.
/// Returns the broadcast event JSON, or None if the node wasn't found.
pub fn mark_node_offline(cx: &Cx, state: &Registry, node_id: &str) -> Option<String> {
    let mut nodes = state
        .nodes
        .write()
        .expect("nodes lock poisoned on disconnect");
    if let Some(node) = nodes.get_mut(node_id) {
        node.status = NodeStatus::Offline;
        node.offline_since = Some(Utc::now().timestamp());
        info!(node_id = %node_id, "Node offline");
        drop(nodes);
        let event = serde_json::json!({ "event": "node_offline", "id": node_id }).to_string();
        let _ = state.tx.send(cx, event.clone());
        Some(event)
    } else {
        None
    }
}

/// Update the last_seen timestamp for a node (called on heartbeat ping).
pub fn update_heartbeat(state: &Registry, node_id: &str) {
    if let Ok(mut nodes) = state.nodes.write() {
        if let Some(node) = nodes.get_mut(node_id) {
            node.last_seen = Some(Utc::now().timestamp());
        }
    }
}

// ── Proxy handler logic ──────────────────────────────────────────────────────

/// Result of looking up a proxy target node.
#[derive(Debug, PartialEq, Eq)]
pub enum ProxyLookup {
    /// Node is active and reachable at (host, port).
    Found { host: String, port: u16 },
    /// Node exists but is offline.
    Offline,
    /// No node with this ID in the registry.
    NotFound,
}

/// Look up the agent connection info for a proxy request.
pub fn lookup_proxy_target(nodes: &HashMap<String, NodeInfo>, node_id: &str) -> ProxyLookup {
    match nodes.get(node_id) {
        Some(node) if node.status == NodeStatus::Active => ProxyLookup::Found {
            host: node.machine.clone(),
            port: node.port,
        },
        Some(_) => ProxyLookup::Offline,
        None => ProxyLookup::NotFound,
    }
}

/// Build the error JSON for a proxy lookup failure.
pub fn proxy_error_json(lookup: &ProxyLookup) -> Option<String> {
    match lookup {
        ProxyLookup::Offline => {
            Some(serde_json::json!({ "error": "Agent is offline" }).to_string())
        }
        ProxyLookup::NotFound => {
            Some(serde_json::json!({ "error": "Agent not found" }).to_string())
        }
        ProxyLookup::Found { .. } => None,
    }
}

/// Validate a WebSocket handshake response from the agent.
/// Returns true if the response contains "101 Switching Protocols".
pub fn validate_agent_handshake(response: &str) -> bool {
    response.contains("101")
}

// ── Utility ──────────────────────────────────────────────────────────────────

/// Generate a random base64-encoded WebSocket key for client handshake.
pub fn base64_ws_key() -> String {
    use std::time::SystemTime;
    let seed = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let bytes: [u8; 16] = {
        let mut b = [0u8; 16];
        for (i, byte) in b.iter_mut().enumerate() {
            *byte = ((seed >> (i * 4)) & 0xFF) as u8;
        }
        b
    };
    base64_encode_16(&bytes)
}

/// Base64-encode exactly 16 bytes (produces 24-char output with padding).
pub fn base64_encode_16(bytes: &[u8; 16]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(24);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Build the client-side WebSocket upgrade request for connecting to an agent.
pub fn build_agent_handshake_request(agent_addr: &str, ws_key: &str) -> String {
    format!(
        "GET / HTTP/1.1\r\n\
         Host: {agent_addr}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: {ws_key}\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use asupersync::channel::broadcast;
    use std::path::PathBuf;
    use std::sync::{Arc, RwLock};

    fn make_registry() -> Registry {
        let (tx, _) = broadcast::channel::<String>(16);
        Arc::new(AppState {
            nodes: RwLock::new(HashMap::new()),
            tx,
            secret_token: String::new(),
            home_dir: PathBuf::from("/tmp"),
            node_ttl: 3600,
        })
    }

    fn make_node(id: &str, status: NodeStatus) -> NodeInfo {
        NodeInfo {
            id: id.to_string(),
            machine: "localhost".to_string(),
            cwd: "/tmp".to_string(),
            port: 8080,
            status,
            offline_since: None,
            last_seen: Some(Utc::now().timestamp()),
            pid: None,
        }
    }

    // ── parse_request_uri tests ──

    #[test]
    fn parse_uri_standard_get() {
        let (uri, path) = parse_request_uri("GET /ws HTTP/1.1\r\nHost: localhost\r\n");
        assert_eq!(uri, "/ws");
        assert_eq!(path, "/ws");
    }

    #[test]
    fn parse_uri_with_query_string() {
        let (uri, path) =
            parse_request_uri("GET /ws?token=abc123 HTTP/1.1\r\nHost: localhost\r\n");
        assert_eq!(uri, "/ws?token=abc123");
        assert_eq!(path, "/ws");
    }

    #[test]
    fn parse_uri_agent_proxy_path() {
        let (uri, path) =
            parse_request_uri("GET /ws/agent/node-42?token=x HTTP/1.1\r\nHost: localhost\r\n");
        assert_eq!(uri, "/ws/agent/node-42?token=x");
        assert_eq!(path, "/ws/agent/node-42");
    }

    #[test]
    fn parse_uri_empty_input() {
        let (uri, path) = parse_request_uri("");
        assert_eq!(uri, "/");
        assert_eq!(path, "/");
    }

    #[test]
    fn parse_uri_garbage() {
        let (uri, path) = parse_request_uri("not a real http request");
        // "not" has no second whitespace-delimited token for uri
        assert_eq!(uri, "a");
        assert_eq!(path, "a");
    }

    // ── match_route tests ──

    #[test]
    fn route_registry() {
        assert_eq!(match_route("/ws"), RouteMatch::Registry);
    }

    #[test]
    fn route_agent_proxy() {
        assert_eq!(
            match_route("/ws/agent/abc-123"),
            RouteMatch::AgentProxy("abc-123")
        );
    }

    #[test]
    fn route_agent_proxy_empty_id() {
        assert_eq!(
            match_route("/ws/agent/"),
            RouteMatch::BadRequest("Missing node ID")
        );
    }

    #[test]
    fn route_not_found() {
        assert_eq!(match_route("/"), RouteMatch::NotFound);
        assert_eq!(match_route("/health"), RouteMatch::NotFound);
        assert_eq!(match_route("/ws/"), RouteMatch::NotFound);
    }

    #[test]
    fn route_ws_subpath_not_agent() {
        assert_eq!(match_route("/ws/other"), RouteMatch::NotFound);
    }

    // ── build_init_event tests ──

    #[test]
    fn init_event_empty_nodes() {
        let json = build_init_event(&[]);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["event"], "init");
        assert_eq!(parsed["protocol_version"], "1");
        assert!(parsed["nodes"].as_array().unwrap().is_empty());
    }

    #[test]
    fn init_event_with_nodes() {
        let nodes = vec![
            make_node("n1", NodeStatus::Active),
            make_node("n2", NodeStatus::Offline),
        ];
        let json = build_init_event(&nodes);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let arr = parsed["nodes"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["id"], "n1");
        assert_eq!(arr[1]["id"], "n2");
    }

    // ── lookup_proxy_target tests ──

    #[test]
    fn proxy_lookup_active_node() {
        let mut nodes = HashMap::new();
        nodes.insert("n1".to_string(), make_node("n1", NodeStatus::Active));
        assert_eq!(
            lookup_proxy_target(&nodes, "n1"),
            ProxyLookup::Found {
                host: "localhost".to_string(),
                port: 8080
            }
        );
    }

    #[test]
    fn proxy_lookup_offline_node() {
        let mut nodes = HashMap::new();
        nodes.insert("n1".to_string(), make_node("n1", NodeStatus::Offline));
        assert_eq!(lookup_proxy_target(&nodes, "n1"), ProxyLookup::Offline);
    }

    #[test]
    fn proxy_lookup_missing_node() {
        let nodes = HashMap::new();
        assert_eq!(lookup_proxy_target(&nodes, "n1"), ProxyLookup::NotFound);
    }

    // ── proxy_error_json tests ──

    #[test]
    fn proxy_error_offline() {
        let json = proxy_error_json(&ProxyLookup::Offline).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["error"], "Agent is offline");
    }

    #[test]
    fn proxy_error_not_found() {
        let json = proxy_error_json(&ProxyLookup::NotFound).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["error"], "Agent not found");
    }

    #[test]
    fn proxy_error_found_returns_none() {
        assert!(proxy_error_json(&ProxyLookup::Found {
            host: "h".into(),
            port: 1
        })
        .is_none());
    }

    // ── validate_agent_handshake tests ──

    #[test]
    fn handshake_valid_101() {
        assert!(validate_agent_handshake(
            "HTTP/1.1 101 Switching Protocols\r\n"
        ));
    }

    #[test]
    fn handshake_missing_101() {
        assert!(!validate_agent_handshake(
            "HTTP/1.1 400 Bad Request\r\n"
        ));
    }

    // ── process_registry_message tests ──

    #[test]
    fn process_register_extracts_node_id() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let msg = serde_json::json!({
            "id": "req-1",
            "method": "register",
            "params": {
                "id": "node-42", "machine": "host", "cwd": "/tmp",
                "port": 8080, "status": "active"
            }
        })
        .to_string();

        let (json, new_id) = process_registry_message(&cx, &msg, &reg, None).unwrap();
        assert!(new_id.is_some());
        assert_eq!(new_id.unwrap(), "node-42");
        // Response should contain "registered"
        assert!(json.contains("registered"));
    }

    #[test]
    fn process_list_nodes_returns_none_new_id() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let msg = serde_json::json!({
            "id": "req-1",
            "method": "list_nodes"
        })
        .to_string();

        let (_, new_id) = process_registry_message(&cx, &msg, &reg, None).unwrap();
        assert!(new_id.is_none());
    }

    #[test]
    fn process_invalid_json_returns_none() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let result = process_registry_message(&cx, "not json", &reg, None);
        assert!(result.is_none());
    }

    #[test]
    fn process_register_with_registered_node_id() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();

        // First register node-1
        let msg1 = serde_json::json!({
            "id": "req-1",
            "method": "register",
            "params": {
                "id": "node-1", "machine": "host", "cwd": "/tmp",
                "port": 8080, "status": "active"
            }
        })
        .to_string();
        process_registry_message(&cx, &msg1, &reg, None);

        // Now list_nodes as node-1
        let msg2 = serde_json::json!({
            "id": "req-2",
            "method": "list_nodes"
        })
        .to_string();
        let (json, _) = process_registry_message(&cx, &msg2, &reg, Some("node-1")).unwrap();
        assert!(json.contains("node-1"));
    }

    // ── mark_node_offline tests ──

    #[test]
    fn mark_offline_existing_node() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        {
            let mut nodes = reg.nodes.write().unwrap();
            nodes.insert("n1".to_string(), make_node("n1", NodeStatus::Active));
        }

        let event = mark_node_offline(&cx, &reg, "n1");
        assert!(event.is_some());
        let parsed: serde_json::Value = serde_json::from_str(&event.unwrap()).unwrap();
        assert_eq!(parsed["event"], "node_offline");
        assert_eq!(parsed["id"], "n1");

        let nodes = reg.nodes.read().unwrap();
        assert_eq!(nodes["n1"].status, NodeStatus::Offline);
        assert!(nodes["n1"].offline_since.is_some());
    }

    #[test]
    fn mark_offline_missing_node() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let event = mark_node_offline(&cx, &reg, "ghost");
        assert!(event.is_none());
    }

    // ── update_heartbeat tests ──

    #[test]
    fn heartbeat_updates_last_seen() {
        let reg = make_registry();
        let old_ts = 1000i64;
        {
            let mut nodes = reg.nodes.write().unwrap();
            let mut node = make_node("n1", NodeStatus::Active);
            node.last_seen = Some(old_ts);
            nodes.insert("n1".to_string(), node);
        }

        update_heartbeat(&reg, "n1");

        let nodes = reg.nodes.read().unwrap();
        let new_ts = nodes["n1"].last_seen.unwrap();
        assert!(new_ts > old_ts);
    }

    #[test]
    fn heartbeat_missing_node_is_noop() {
        let reg = make_registry();
        update_heartbeat(&reg, "ghost"); // Should not panic
    }

    // ── base64_ws_key tests ──

    #[test]
    fn ws_key_is_24_chars() {
        let key = base64_ws_key();
        assert_eq!(key.len(), 24);
    }

    #[test]
    fn ws_key_valid_base64_chars() {
        let key = base64_ws_key();
        for ch in key.chars() {
            assert!(
                ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=',
                "Invalid base64 char: {}",
                ch
            );
        }
    }

    #[test]
    fn base64_encode_known_input() {
        // All zeros should produce "AAAAAAAAAAAAAAAAAAAAAA=="
        let bytes = [0u8; 16];
        let encoded = base64_encode_16(&bytes);
        assert_eq!(encoded.len(), 24);
        // First 22 chars should be 'A', last 2 '='
        assert!(encoded.starts_with("AAAAAAAAAAAAAAAAAAAAAA"));
        assert!(encoded.ends_with("=="));
    }

    #[test]
    fn base64_encode_all_ff() {
        let bytes = [0xFFu8; 16];
        let encoded = base64_encode_16(&bytes);
        assert_eq!(encoded.len(), 24);
        // All valid base64 characters
        for ch in encoded.chars() {
            assert!(
                ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=',
                "Invalid base64 char: {}",
                ch
            );
        }
        // 16 bytes = 24 base64 chars with padding
        assert!(encoded.ends_with("=="));
    }

    // ── build_agent_handshake_request tests ──

    #[test]
    fn handshake_request_format() {
        let req = build_agent_handshake_request("localhost:8080", "dGVzdGtleQ==");
        assert!(req.starts_with("GET / HTTP/1.1\r\n"));
        assert!(req.contains("Host: localhost:8080\r\n"));
        assert!(req.contains("Upgrade: websocket\r\n"));
        assert!(req.contains("Sec-WebSocket-Key: dGVzdGtleQ==\r\n"));
        assert!(req.contains("Sec-WebSocket-Version: 13\r\n"));
        assert!(req.ends_with("\r\n\r\n"));
    }
}
