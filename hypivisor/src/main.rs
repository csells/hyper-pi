mod auth;
mod cleanup;
mod fs_browser;
mod rpc;
mod spawn;
mod state;

use auth::{extract_token_from_query, is_authorized};
use asupersync::channel::broadcast;
use asupersync::net::websocket::{
    Frame, FrameCodec, HttpRequest, Message, Opcode, ServerHandshake,
};
use asupersync::runtime::builder::RuntimeBuilder;
use asupersync::types::{Budget, RegionId, TaskId};
use asupersync::Cx;
use chrono::Utc;
use clap::Parser;
use state::{AppState, NodeInfo, Registry};
use std::{
    collections::HashMap,
    env, io,
    net::TcpStream as StdTcpStream,
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};
use tracing::{error, info, warn};

#[derive(Parser, Debug)]
#[command(name = "hypivisor", version, about = "Hyper-Pi central registry")]
struct Args {
    #[arg(short, long, default_value_t = 31415)]
    port: u16,

    #[arg(short = 't', long, default_value_t = 3600)]
    node_ttl: u64,
}

/// Create an ephemeral Cx for use outside the runtime's region system.
pub fn ephemeral_cx() -> Cx {
    Cx::new(
        RegionId::new_ephemeral(),
        TaskId::new_ephemeral(),
        Budget::INFINITE,
    )
}

fn main() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
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

    let (tx, _rx) = broadcast::channel::<String>(256);
    let state: Registry = Arc::new(AppState {
        nodes: RwLock::new(HashMap::new()),
        tx,
        secret_token,
        home_dir,
        node_ttl: args.node_ttl,
    });

    // Stale node cleanup task
    let cleanup_state = state.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        let cx = ephemeral_cx();
        cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
    });

    // Use std::net::TcpListener for the accept loop (synchronous, simple)
    let addr = format!("0.0.0.0:{}", args.port);
    let listener = std::net::TcpListener::bind(&addr)
        .unwrap_or_else(|e| panic!("Failed to bind {addr}: {e}"));

    info!(port = args.port, "Hypivisor online");

    for incoming in listener.incoming() {
        let stream = match incoming {
            Ok(s) => s,
            Err(e) => {
                error!(error = %e, "Accept failed");
                continue;
            }
        };

        let peer_addr = stream.peer_addr().unwrap_or_else(|_| "0.0.0.0:0".parse().unwrap());
        let state = state.clone();

        std::thread::spawn(move || {
            handle_connection(stream, peer_addr, state);
        });
    }
}

fn handle_connection(
    mut stream: StdTcpStream,
    peer_addr: std::net::SocketAddr,
    state: Registry,
) {
    use io::{Read, Write};

    // Read the initial HTTP request bytes for WebSocket upgrade
    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        Ok(_) => return,
        Err(e) => {
            warn!(peer = %peer_addr, error = %e, "Failed to read initial request");
            return;
        }
    };
    let request_bytes = &buf[..n];

    // Parse enough of the HTTP request to check the path and auth
    let request_str = String::from_utf8_lossy(request_bytes);
    let first_line = request_str.lines().next().unwrap_or("");
    let uri = first_line.split_whitespace().nth(1).unwrap_or("/");

    // Only accept /ws path
    let path = uri.split('?').next().unwrap_or("/");
    if path != "/ws" {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found");
        return;
    }

    // Auth check
    let token = extract_token_from_query(uri);
    if !is_authorized(token.as_deref(), &state.secret_token) {
        let _ = stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 12\r\n\r\nUnauthorized");
        return;
    }

    // WebSocket handshake using asupersync's protocol implementation
    let http_req = match HttpRequest::parse(request_bytes) {
        Ok(r) => r,
        Err(e) => {
            warn!(peer = %peer_addr, error = %e, "Invalid HTTP request for WS upgrade");
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request");
            return;
        }
    };

    let handshake = ServerHandshake::new();
    let accept_response = match handshake.accept(&http_req) {
        Ok(r) => r,
        Err(e) => {
            warn!(peer = %peer_addr, error = %e, "WebSocket handshake failed");
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request");
            return;
        }
    };

    // Send 101 Switching Protocols response
    let response_bytes = accept_response.response_bytes();
    if stream.write_all(&response_bytes).is_err() {
        return;
    }

    handle_websocket(stream, peer_addr, state);
}

/// Encode a text message as a WebSocket frame and write it.
fn ws_send_text(stream: &mut StdTcpStream, codec: &mut FrameCodec, text: &str) -> io::Result<()> {
    use asupersync::bytes::BytesMut;
    use asupersync::codec::Encoder;
    use io::Write;

    let frame = Frame::from(Message::text(text));
    let mut buf = BytesMut::with_capacity(text.len() + 14);
    codec
        .encode(frame, &mut buf)
        .map_err(|e| io::Error::other(format!("WS encode: {e}")))?;
    stream.write_all(&buf)?;
    Ok(())
}

/// Read and decode one WebSocket message (blocking).
fn ws_recv(
    stream: &mut StdTcpStream,
    codec: &mut FrameCodec,
    read_buf: &mut asupersync::bytes::BytesMut,
) -> io::Result<Option<Message>> {
    use asupersync::codec::Decoder;
    use io::Read;

    loop {
        // Try to decode a frame from the buffer
        match codec.decode(read_buf) {
            Ok(Some(frame)) => match frame.opcode {
                Opcode::Text => {
                    let text = String::from_utf8_lossy(&frame.payload).to_string();
                    return Ok(Some(Message::Text(text)));
                }
                Opcode::Close => return Ok(None),
                Opcode::Ping => {
                    // Send pong — reuse the write codec (server role, no masking)
                    // For simplicity, we send pong inline
                    let mut write_codec = FrameCodec::server();
                    let pong = Frame::pong(frame.payload);
                    let mut pong_buf = asupersync::bytes::BytesMut::with_capacity(128);
                    let _ = asupersync::codec::Encoder::encode(
                        &mut write_codec,
                        pong,
                        &mut pong_buf,
                    );
                    let _ = io::Write::write_all(stream, &pong_buf);
                    continue;
                }
                _ => continue, // Ignore pong, binary, continuation
            },
            Ok(None) => {
                // Need more data
                let mut tmp = [0u8; 4096];
                let n = stream.read(&mut tmp)?;
                if n == 0 {
                    return Ok(None); // EOF
                }
                read_buf.extend_from_slice(&tmp[..n]);
            }
            Err(e) => {
                return Err(io::Error::other(format!("WS decode: {e}")));
            }
        }
    }
}

fn handle_websocket(stream: StdTcpStream, peer_addr: std::net::SocketAddr, state: Registry) {
    // The stream is shared between the read thread (this thread) and
    // the write thread (broadcast forwarder). We use a Mutex for safe sharing.
    let write_stream = Arc::new(Mutex::new(stream.try_clone().expect("Failed to clone TcpStream")));
    let mut read_stream = stream;

    // Set read timeout so ws_recv doesn't block forever —
    // this lets us periodically check for shutdown/drain broadcasts.
    let _ = read_stream.set_read_timeout(Some(Duration::from_millis(100)));

    let mut read_codec = FrameCodec::server();
    let mut read_buf = asupersync::bytes::BytesMut::with_capacity(8192);

    // Send init event with current node list
    {
        let nodes: Vec<NodeInfo> = state
            .nodes
            .read()
            .expect("nodes lock poisoned")
            .values()
            .cloned()
            .collect();
        let init = serde_json::json!({
            "event": "init",
            "nodes": nodes,
            "protocol_version": "1"
        });
        let mut write_codec = FrameCodec::server();
        let mut ws = write_stream.lock().unwrap();
        if ws_send_text(&mut ws, &mut write_codec, &init.to_string()).is_err() {
            return;
        }
    }

    // Broadcast forwarder: subscribes to broadcast events and writes them
    // to the WebSocket via the shared write stream.
    let mut rx = state.tx.subscribe();
    let broadcast_write = write_stream.clone();
    let broadcast_running = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let br = broadcast_running.clone();

    let broadcast_handle = std::thread::spawn(move || {
        let rt = RuntimeBuilder::new()
            .worker_threads(1)
            .build()
            .expect("broadcast runtime");

        rt.block_on(async {
            let cx = ephemeral_cx();
            let mut write_codec = FrameCodec::server();
            while let Ok(event) = rx.recv(&cx).await {
                if !br.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                let mut ws = broadcast_write.lock().unwrap();
                if ws_send_text(&mut ws, &mut write_codec, &event).is_err() {
                    break;
                }
            }
        });
    });

    // Read loop
    let mut registered_node_id: Option<String> = None;
    let cx = ephemeral_cx();

    loop {
        match ws_recv(&mut read_stream, &mut read_codec, &mut read_buf) {
            Ok(Some(Message::Text(text))) => {
                if let Ok(req) = serde_json::from_str::<rpc::RpcRequest>(&text) {
                    if req.method == "register" {
                        if let Some(ref params) = req.params {
                            if let Ok(node) = serde_json::from_value::<NodeInfo>(params.clone()) {
                                registered_node_id = Some(node.id.clone());
                            }
                        }
                    }
                    let response = rpc::dispatch(&cx, req, &state);
                    let out = serde_json::to_string(&response).unwrap();
                    let mut write_codec = FrameCodec::server();
                    let mut ws = write_stream.lock().unwrap();
                    if ws_send_text(&mut ws, &mut write_codec, &out).is_err() {
                        break;
                    }
                }
            }
            Ok(None) => break, // Close or EOF
            Ok(Some(_)) => {}  // Binary, etc.
            Err(e) => {
                if e.kind() == io::ErrorKind::WouldBlock || e.kind() == io::ErrorKind::TimedOut {
                    continue; // Read timeout — loop back and try again
                }
                warn!(peer = %peer_addr, error = %e, "WebSocket receive error");
                break;
            }
        }
    }

    // Mark node offline on disconnect BEFORE stopping the broadcast forwarder,
    // so other clients receive the node_offline event.
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
        let _ = state.tx.send(&cx, event);
    }

    // Give the broadcast forwarder a moment to flush the offline event
    std::thread::sleep(Duration::from_millis(50));

    // Stop broadcast forwarder
    broadcast_running.store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = broadcast_handle.join();
}
