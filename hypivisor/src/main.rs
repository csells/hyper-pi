mod auth;
mod cleanup;
mod fs_browser;
mod rpc;
mod spawn;
mod state;

use auth::{is_authorized, WsAuth};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use chrono::Utc;
use clap::Parser;
use state::{AppState, NodeInfo, Registry};
use std::{
    collections::HashMap,
    env,
    sync::{Arc, RwLock},
};
use tokio::{net::TcpListener, signal, sync::broadcast, time};
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(name = "hypivisor", version, about = "Hyper-Pi central registry")]
struct Args {
    #[arg(short, long, default_value_t = 31415)]
    port: u16,

    #[arg(short = 't', long, default_value_t = 3600)]
    node_ttl: u64,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hypivisor=info".into()),
        )
        .init();

    let args = Args::parse();
    let secret_token = env::var("HYPI_TOKEN").unwrap_or_default();

    if secret_token.is_empty() {
        warn!("HYPI_TOKEN not set — running without authentication");
    }

    let home_dir = dirs::home_dir().unwrap_or_else(|| {
        warn!("Could not determine home directory, falling back to '.'");
        ".".into()
    });

    let (tx, _rx) = broadcast::channel(256);
    let state: Registry = Arc::new(AppState {
        nodes: RwLock::new(HashMap::new()),
        tx,
        secret_token,
        home_dir,
        node_ttl: args.node_ttl,
    });

    // Stale node cleanup task
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            cleanup::cleanup_stale_nodes(&cleanup_state);
        }
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", args.port);
    let listener = TcpListener::bind(&addr).await.unwrap();
    info!(port = args.port, "Hypivisor online");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler")
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
    info!("Shutdown signal received, draining connections");
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(auth): Query<WsAuth>,
    State(state): State<Registry>,
) -> impl IntoResponse {
    if !is_authorized(auth.token.as_deref(), &state.secret_token) {
        return (axum::http::StatusCode::UNAUTHORIZED, "Invalid token").into_response();
    }
    ws.on_upgrade(|socket| handle_socket(socket, state))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: Registry) {
    let mut rx = state.tx.subscribe();
    let mut registered_node_id: Option<String> = None;

    // Send init event
    {
        let nodes: Vec<NodeInfo> = state
            .nodes
            .read()
            .expect("nodes lock poisoned in handle_socket")
            .values()
            .cloned()
            .collect();
        let init = serde_json::json!({
            "event": "init",
            "nodes": nodes,
            "protocol_version": "1"
        });
        if socket
            .send(Message::Text(init.to_string().into()))
            .await
            .is_err()
        {
            return;
        }
    }

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(req) = serde_json::from_str::<rpc::RpcRequest>(&text) {
                            if req.method == "register" {
                                if let Some(ref params) = req.params {
                                    if let Ok(node) = serde_json::from_value::<NodeInfo>(params.clone()) {
                                        registered_node_id = Some(node.id.clone());
                                    }
                                }
                            }
                            let response = rpc::dispatch(req, &state);
                            let out = serde_json::to_string(&response).unwrap();
                            if socket.send(Message::Text(out.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => {
                        warn!(error = %e, "WebSocket receive error");
                        break;
                    }
                    _ => {}
                }
            }
            Ok(event) = rx.recv() => {
                if socket.send(Message::Text(event.into())).await.is_err() {
                    break;
                }
            }
        }
    }

    // Mark node offline on disconnect
    if let Some(node_id) = registered_node_id {
        let mut nodes = state
            .nodes
            .write()
            .expect("nodes lock poisoned on disconnect");
        if let Some(node) = nodes.get_mut(&node_id) {
            node.status = "offline".to_string();
            node.offline_since = Some(Utc::now().timestamp());
            info!(node_id = %node_id, "Node offline");
        }
        drop(nodes);
        let event = serde_json::json!({ "event": "node_offline", "id": node_id }).to_string();
        let _ = state.tx.send(event);
    }
}
