use asupersync::channel::broadcast;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, RwLock},
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeInfo {
    pub id: String,
    pub machine: String,
    pub cwd: String,
    pub port: u16,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline_since: Option<i64>,
    /// Last time this node was seen alive (register or heartbeat ping).
    /// Used by cleanup to detect "active" ghosts with dead TCP connections.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<i64>,
}

pub struct AppState {
    pub nodes: RwLock<HashMap<String, NodeInfo>>,
    pub tx: broadcast::Sender<String>,
    pub secret_token: String,
    pub home_dir: PathBuf,
    pub node_ttl: u64,
}

pub type Registry = Arc<AppState>;
