use crate::state::Registry;
use asupersync::Cx;
use chrono::Utc;
use tracing::{info, warn};

/// Remove stale nodes: offline nodes past TTL, and "active" ghosts whose
/// heartbeat (last_seen) is older than 3× TTL (i.e. 3 missed heartbeat windows).
pub fn cleanup_stale_nodes(cx: &Cx, state: &Registry) {
    let now = Utc::now().timestamp();
    let ttl = state.node_ttl as i64;
    let active_ttl = ttl * 3; // active ghosts get more grace (3 missed heartbeats)
    let mut to_remove = vec![];

    {
        let nodes = state.nodes.read().expect("nodes lock poisoned in cleanup");
        for (id, node) in nodes.iter() {
            let stale = match node.status.as_str() {
                "offline" => node
                    .offline_since
                    .is_some_and(|since| now - since > ttl),
                "active" => node
                    .last_seen
                    .is_some_and(|seen| now - seen > active_ttl),
                _ => false,
            };
            if stale {
                to_remove.push(id.clone());
            }
        }
    }

    if !to_remove.is_empty() {
        let mut nodes = state.nodes.write().expect("nodes lock poisoned in cleanup");
        for id in &to_remove {
            // Re-check: node may have changed between read and write locks
            let still_stale = nodes.get(id).is_some_and(|n| match n.status.as_str() {
                "offline" => n.offline_since.is_some_and(|since| now - since > ttl),
                "active" => n.last_seen.is_some_and(|seen| now - seen > active_ttl),
                _ => false,
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
    fn active_node_with_recent_heartbeat_not_removed() {
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
                last_seen: Some(Utc::now().timestamp()),
            },
        );
        cleanup_stale_nodes(&cx, &reg);
        assert!(reg.nodes.read().unwrap().contains_key("n1"));
    }

    #[test]
    fn active_node_without_last_seen_not_removed() {
        // Nodes that registered before heartbeat was added have no last_seen
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
                last_seen: None,
            },
        );
        cleanup_stale_nodes(&cx, &reg);
        assert!(reg.nodes.read().unwrap().contains_key("n1"));
    }

    #[test]
    fn active_ghost_with_stale_heartbeat_removed() {
        let cx = crate::ephemeral_cx();
        let reg = make_registry(30); // TTL=30s, active_ttl=90s
        reg.nodes.write().unwrap().insert(
            "n1".into(),
            NodeInfo {
                id: "n1".into(),
                machine: "host".into(),
                cwd: "/tmp".into(),
                port: 8080,
                status: "active".into(),
                offline_since: None,
                last_seen: Some(Utc::now().timestamp() - 200), // well past 3×TTL
            },
        );
        cleanup_stale_nodes(&cx, &reg);
        assert!(!reg.nodes.read().unwrap().contains_key("n1"));
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
                last_seen: None,
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
                last_seen: None,
            },
        );
        cleanup_stale_nodes(&cx, &reg);
        assert!(!reg.nodes.read().unwrap().contains_key("n1"));
    }

    #[test]
    fn reactivated_node_not_removed() {
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
                last_seen: None,
            },
        );

        // Simulate reactivation between read and write locks
        {
            let mut nodes = reg.nodes.write().unwrap();
            let node = nodes.get_mut("n1").unwrap();
            node.status = "active".to_string();
            node.offline_since = None;
            node.last_seen = Some(Utc::now().timestamp());
        }
        cleanup_stale_nodes(&cx, &reg);
        assert!(reg.nodes.read().unwrap().contains_key("n1"));
    }
}
