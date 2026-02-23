use crate::state::Registry;
use asupersync::Cx;
use chrono::Utc;
use tracing::{info, warn};

/// Remove nodes that have been offline longer than the configured TTL.
pub fn cleanup_stale_nodes(cx: &Cx, state: &Registry) {
    let now = Utc::now().timestamp();
    let ttl = state.node_ttl as i64;
    let mut to_remove = vec![];

    {
        let nodes = state.nodes.read().expect("nodes lock poisoned in cleanup");
        for (id, node) in nodes.iter() {
            if node.status == "offline" {
                if let Some(offline_since) = node.offline_since {
                    if now - offline_since > ttl {
                        to_remove.push(id.clone());
                    }
                }
            }
        }
    }

    if !to_remove.is_empty() {
        let mut nodes = state.nodes.write().expect("nodes lock poisoned in cleanup");
        for id in &to_remove {
            // Re-check: node may have been reactivated between read and write locks
            let still_stale = nodes.get(id).is_some_and(|n| {
                n.status == "offline"
                    && n.offline_since
                        .is_some_and(|since| now - since > ttl)
            });
            if still_stale {
                nodes.remove(id);
                info!(node_id = %id, "Stale node removed");
                let event =
                    serde_json::json!({ "event": "node_removed", "id": id }).to_string();
                if state.tx.send(cx, event).is_err() {
                    warn!("No receivers for node_removed broadcast");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AppState, NodeInfo};
    use asupersync::channel::broadcast;
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{Arc, RwLock},
    };

    fn make_registry(ttl: u64) -> Registry {
        let (tx, _) = broadcast::channel::<String>(16);
        Arc::new(AppState {
            nodes: RwLock::new(HashMap::new()),
            tx,
            secret_token: String::new(),
            home_dir: PathBuf::from("/tmp"),
            node_ttl: ttl,
        })
    }

    #[test]
    fn active_nodes_not_removed() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry(60);
        reg.nodes.write().unwrap().insert(
            "n1".into(),
            NodeInfo {
                id: "n1".into(),
                machine: "host".into(),
                cwd: "/tmp".into(),
                port: 8080,
                status: "active".into(),
                offline_since: None,
            },
        );
        cleanup_stale_nodes(&cx, &reg);
        assert!(reg.nodes.read().unwrap().contains_key("n1"));
    }

    #[test]
    fn recent_offline_not_removed() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry(3600);
        reg.nodes.write().unwrap().insert(
            "n1".into(),
            NodeInfo {
                id: "n1".into(),
                machine: "host".into(),
                cwd: "/tmp".into(),
                port: 8080,
                status: "offline".into(),
                offline_since: Some(Utc::now().timestamp()),
            },
        );
        cleanup_stale_nodes(&cx, &reg);
        assert!(reg.nodes.read().unwrap().contains_key("n1"));
    }

    #[test]
    fn expired_offline_removed() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry(60);
        reg.nodes.write().unwrap().insert(
            "n1".into(),
            NodeInfo {
                id: "n1".into(),
                machine: "host".into(),
                cwd: "/tmp".into(),
                port: 8080,
                status: "offline".into(),
                offline_since: Some(Utc::now().timestamp() - 120),
            },
        );
        cleanup_stale_nodes(&cx, &reg);
        assert!(!reg.nodes.read().unwrap().contains_key("n1"));
    }

    #[test]
    fn reactivated_node_not_removed() {
        // Simulates TOCTOU: node was offline+stale when read, but reactivated
        // before write lock acquired. The re-check under write lock saves it.
        let cx = crate::ephemeral_cx();
        let reg = make_registry(60);
        reg.nodes.write().unwrap().insert(
            "n1".into(),
            NodeInfo {
                id: "n1".into(),
                machine: "host".into(),
                cwd: "/tmp".into(),
                port: 8080,
                status: "offline".into(),
                offline_since: Some(Utc::now().timestamp() - 120),
            },
        );

        // Manually simulate what happens: collect stale IDs, then reactivate,
        // then run cleanup. Since cleanup re-checks, the node should survive.
        // We test by making the node active before cleanup runs.
        {
            let mut nodes = reg.nodes.write().unwrap();
            let node = nodes.get_mut("n1").unwrap();
            node.status = "active".to_string();
            node.offline_since = None;
        }
        cleanup_stale_nodes(&cx, &reg);
        assert!(reg.nodes.read().unwrap().contains_key("n1"));
    }
}
