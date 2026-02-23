use crate::state::{NodeInfo, Registry};
use crate::{fs_browser, spawn};
use asupersync::Cx;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tracing::{info, warn};

#[derive(Deserialize)]
pub struct RpcRequest {
    pub id: Option<String>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Serialize)]
pub struct RpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Dispatch an RPC request to the appropriate handler.
pub fn dispatch(cx: &Cx, req: RpcRequest, state: &Registry) -> RpcResponse {
    let id = req.id.clone();
    match req.method.as_str() {
        "register" => handle_register(cx, id, req.params, state),
        "deregister" => handle_deregister(cx, id, req.params, state),
        "list_nodes" => handle_list_nodes(id, state),
        "list_directories" => handle_list_directories(id, req.params, state),
        "spawn_agent" => handle_spawn_agent(id, req.params, state),
        "ping" => handle_ping(id, state),
        other => {
            warn!(method = other, "Unknown RPC method");
            RpcResponse {
                id,
                result: None,
                error: Some(format!("Method not found: {}", other)),
            }
        }
    }
}

fn handle_register(
    cx: &Cx,
    id: Option<String>,
    params: Option<Value>,
    state: &Registry,
) -> RpcResponse {
    let Some(params) = params else {
        return RpcResponse {
            id,
            result: None,
            error: Some("Missing params".into()),
        };
    };
    let Ok(mut node) = serde_json::from_value::<NodeInfo>(params) else {
        return RpcResponse {
            id,
            result: None,
            error: Some("Invalid node info".into()),
        };
    };
    node.status = "active".to_string();
    node.offline_since = None;
    let evicted: Vec<String>;
    {
        let mut nodes = state
            .nodes
            .write()
            .expect("nodes lock poisoned in register");
        // Evict stale nodes on the same machine + port. A port on a machine
        // can only belong to one process, so any prior registration with the
        // same machine:port is stale (e.g., session switch within the same pi).
        evicted = nodes
            .iter()
            .filter(|(id, n)| {
                *id != &node.id && n.machine == node.machine && n.port == node.port
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &evicted {
            nodes.remove(id);
        }
        nodes.insert(node.id.clone(), node.clone());
    }
    for id in &evicted {
        info!(node_id = %id, "Evicted stale node (same machine:port)");
        let event =
            serde_json::json!({ "event": "node_removed", "id": id }).to_string();
        let _ = state.tx.send(cx, event);
    }
    info!(node_id = %node.id, port = node.port, "Node joined");
    let event = serde_json::json!({ "event": "node_joined", "node": node }).to_string();
    let _ = state.tx.send(cx, event);
    RpcResponse {
        id,
        result: Some(serde_json::json!({ "status": "registered" })),
        error: None,
    }
}

fn handle_deregister(
    cx: &Cx,
    id: Option<String>,
    params: Option<Value>,
    state: &Registry,
) -> RpcResponse {
    let node_id = params
        .as_ref()
        .and_then(|p| p.get("id"))
        .and_then(|v| v.as_str());
    let Some(node_id) = node_id else {
        return RpcResponse {
            id,
            result: None,
            error: Some("Missing params.id".into()),
        };
    };
    let removed = {
        let mut nodes = state
            .nodes
            .write()
            .expect("nodes lock poisoned in deregister");
        nodes.remove(node_id).is_some()
    };
    if removed {
        info!(node_id, "Node deregistered");
        let event = serde_json::json!({ "event": "node_removed", "id": node_id }).to_string();
        let _ = state.tx.send(cx, event);
    }
    RpcResponse {
        id,
        result: Some(serde_json::json!({ "status": if removed { "deregistered" } else { "not_found" } })),
        error: None,
    }
}

fn handle_list_nodes(id: Option<String>, state: &Registry) -> RpcResponse {
    let nodes: Vec<NodeInfo> = state
        .nodes
        .read()
        .expect("nodes lock poisoned in list_nodes")
        .values()
        .cloned()
        .collect();
    RpcResponse {
        id,
        result: Some(serde_json::to_value(nodes).unwrap()),
        error: None,
    }
}

fn handle_list_directories(
    id: Option<String>,
    params: Option<Value>,
    state: &Registry,
) -> RpcResponse {
    let target = params
        .and_then(|p| p.get("path").and_then(|v| v.as_str().map(String::from)))
        .map(PathBuf::from)
        .unwrap_or_else(|| state.home_dir.clone());

    match fs_browser::list_directories(&target, &state.home_dir) {
        Ok((current, directories)) => RpcResponse {
            id,
            result: Some(serde_json::json!({ "current": current, "directories": directories })),
            error: None,
        },
        Err(e) => RpcResponse {
            id,
            result: None,
            error: Some(e),
        },
    }
}

fn handle_spawn_agent(id: Option<String>, params: Option<Value>, state: &Registry) -> RpcResponse {
    let Some(params) = params else {
        return RpcResponse {
            id,
            result: None,
            error: Some("Missing params".into()),
        };
    };
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let new_folder = params
        .get("new_folder")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match spawn::spawn_agent(path_str, new_folder, &state.home_dir) {
        Ok(resolved_path) => RpcResponse {
            id,
            result: Some(serde_json::json!({ "status": "spawning", "path": resolved_path })),
            error: None,
        },
        Err(e) => RpcResponse {
            id,
            result: None,
            error: Some(e),
        },
    }
}

fn handle_ping(id: Option<String>, state: &Registry) -> RpcResponse {
    let node_count = state
        .nodes
        .read()
        .expect("nodes lock poisoned in ping")
        .len();
    RpcResponse {
        id,
        result: Some(serde_json::json!({
            "status": "healthy",
            "nodes": node_count,
            "version": env!("CARGO_PKG_VERSION"),
        })),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use asupersync::channel::broadcast;
    use std::{
        collections::HashMap,
        sync::{Arc, RwLock},
    };

    fn make_registry() -> Registry {
        let (tx, _) = broadcast::channel::<String>(16);
        Arc::new(AppState {
            nodes: RwLock::new(HashMap::new()),
            tx,
            secret_token: String::new(),
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp")),
            node_ttl: 3600,
        })
    }

    #[test]
    fn register_adds_node() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let req = RpcRequest {
            id: Some("1".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "test-node", "machine": "host", "cwd": "/tmp",
                "port": 8080, "status": "active"
            })),
        };
        let resp = dispatch(&cx, req, &reg);
        assert!(resp.error.is_none());
        assert!(reg.nodes.read().unwrap().contains_key("test-node"));
    }

    #[test]
    fn list_nodes_returns_registered() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let req = RpcRequest {
            id: Some("1".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "n1", "machine": "h", "cwd": "/tmp", "port": 80, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);

        let req = RpcRequest {
            id: Some("2".into()),
            method: "list_nodes".into(),
            params: None,
        };
        let resp = dispatch(&cx, req, &reg);
        let nodes: Vec<NodeInfo> = serde_json::from_value(resp.result.unwrap()).unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "n1");
    }

    #[test]
    fn register_same_id_new_port_overwrites() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        // Session registers on port 8082
        let req = RpcRequest {
            id: Some("1".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "session-uuid", "machine": "host", "cwd": "/project",
                "port": 8082, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);
        assert_eq!(reg.nodes.read().unwrap()["session-uuid"].port, 8082);

        // Same session re-registers on port 8080 (after reload)
        let req = RpcRequest {
            id: Some("2".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "session-uuid", "machine": "host", "cwd": "/project",
                "port": 8080, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);
        assert_eq!(reg.nodes.read().unwrap().len(), 1);
        assert_eq!(reg.nodes.read().unwrap()["session-uuid"].port, 8080);
    }

    #[test]
    fn register_evicts_stale_node_same_machine_port() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        // Old session registers on machine "host", port 8082
        let req = RpcRequest {
            id: Some("1".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "host-old-session", "machine": "host", "cwd": "/project",
                "port": 8082, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);
        assert!(reg.nodes.read().unwrap().contains_key("host-old-session"));

        // Same machine, same port, new session ID → old entry evicted
        let req = RpcRequest {
            id: Some("2".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "host-new-session", "machine": "host", "cwd": "/project",
                "port": 8082, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);
        assert!(!reg.nodes.read().unwrap().contains_key("host-old-session"));
        assert!(reg.nodes.read().unwrap().contains_key("host-new-session"));
    }

    #[test]
    fn register_keeps_different_port_same_machine() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        // Two agents on same machine, different ports = both valid
        let req = RpcRequest {
            id: Some("1".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "host-session-a", "machine": "host", "cwd": "/project-a",
                "port": 8081, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);

        let req = RpcRequest {
            id: Some("2".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "host-session-b", "machine": "host", "cwd": "/project-a",
                "port": 8082, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);
        assert_eq!(reg.nodes.read().unwrap().len(), 2);
    }

    #[test]
    fn deregister_removes_node() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        // Register a node
        let req = RpcRequest {
            id: Some("1".into()),
            method: "register".into(),
            params: Some(serde_json::json!({
                "id": "dereg-node", "machine": "h", "cwd": "/tmp", "port": 80, "status": "active"
            })),
        };
        dispatch(&cx, req, &reg);
        assert_eq!(reg.nodes.read().unwrap().len(), 1);

        // Deregister it
        let req = RpcRequest {
            id: Some("2".into()),
            method: "deregister".into(),
            params: Some(serde_json::json!({ "id": "dereg-node" })),
        };
        let resp = dispatch(&cx, req, &reg);
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["status"], "deregistered");
        assert_eq!(reg.nodes.read().unwrap().len(), 0);
    }

    #[test]
    fn deregister_nonexistent_returns_not_found() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let req = RpcRequest {
            id: Some("1".into()),
            method: "deregister".into(),
            params: Some(serde_json::json!({ "id": "ghost" })),
        };
        let resp = dispatch(&cx, req, &reg);
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["status"], "not_found");
    }

    #[test]
    fn unknown_method_returns_error() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry();
        let req = RpcRequest {
            id: Some("1".into()),
            method: "bogus".into(),
            params: None,
        };
        let resp = dispatch(&cx, req, &reg);
        assert!(resp.error.is_some());
        assert!(resp.error.unwrap().contains("Method not found"));
    }
}
