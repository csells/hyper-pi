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

    /// Seconds before offline nodes are removed from the registry
    #[arg(short = 't', long, default_value_t = 30)]
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
        std::thread::sleep(Duration::from_secs(15));
        let cx = ephemeral_cx();
        cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
    });

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

        let peer_addr = stream
            .peer_addr()
            .unwrap_or_else(|_| "0.0.0.0:0".parse().unwrap());
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

    let request_str = String::from_utf8_lossy(request_bytes);
    let first_line = request_str.lines().next().unwrap_or("");
    let uri = first_line.split_whitespace().nth(1).unwrap_or("/");
    let path = uri.split('?').next().unwrap_or("/");

    // Auth check (applies to all WebSocket paths)
    let token = extract_token_from_query(uri);
    if !is_authorized(token.as_deref(), &state.secret_token) {
        let _ = stream
            .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 12\r\n\r\nUnauthorized");
        return;
    }

    // Route: /ws = registry, /ws/agent/{nodeId} = proxy
    if path == "/ws" {
        if let Some(ws_stream) = upgrade_websocket(&mut stream, request_bytes, peer_addr) {
            handle_registry_ws(ws_stream, peer_addr, state);
        }
    } else if let Some(node_id) = path.strip_prefix("/ws/agent/") {
        if node_id.is_empty() {
            let _ =
                stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 15\r\n\r\nMissing node ID");
            return;
        }
        let node_id = node_id.to_string();
        if let Some(ws_stream) = upgrade_websocket(&mut stream, request_bytes, peer_addr) {
            handle_proxy_ws(ws_stream, peer_addr, &node_id, &state);
        }
    } else {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found");
    }
}

/// Perform WebSocket upgrade handshake, returning the stream on success.
fn upgrade_websocket(
    stream: &mut StdTcpStream,
    request_bytes: &[u8],
    peer_addr: std::net::SocketAddr,
) -> Option<StdTcpStream> {
    use io::Write;

    let http_req = match HttpRequest::parse(request_bytes) {
        Ok(r) => r,
        Err(e) => {
            warn!(peer = %peer_addr, error = %e, "Invalid HTTP request for WS upgrade");
            let _ = stream
                .write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request");
            return None;
        }
    };

    let handshake = ServerHandshake::new();
    let accept_response = match handshake.accept(&http_req) {
        Ok(r) => r,
        Err(e) => {
            warn!(peer = %peer_addr, error = %e, "WebSocket handshake failed");
            let _ = stream
                .write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request");
            return None;
        }
    };

    let response_bytes = accept_response.response_bytes();
    if stream.write_all(&response_bytes).is_err() {
        return None;
    }

    Some(stream.try_clone().expect("Failed to clone stream after handshake"))
}

// ── Shared WebSocket writer ──────────────────────────────────────────────────

/// Thread-safe WebSocket writer. All writes go through this to prevent
/// frame interleaving between the read thread (pong, RPC responses) and
/// the broadcast forwarder thread.
struct WsWriter {
    stream: StdTcpStream,
    codec: FrameCodec,
}

impl WsWriter {
    fn new(stream: StdTcpStream) -> Self {
        Self {
            stream,
            codec: FrameCodec::server(),
        }
    }

    fn send_text(&mut self, text: &str) -> io::Result<()> {
        use asupersync::bytes::BytesMut;
        use asupersync::codec::Encoder;
        use io::Write;

        let frame = Frame::from(Message::text(text));
        let mut buf = BytesMut::with_capacity(text.len() + 14);
        self.codec
            .encode(frame, &mut buf)
            .map_err(|e| io::Error::other(format!("WS encode: {e}")))?;
        self.stream.write_all(&buf)
    }

    fn send_pong(&mut self, payload: Vec<u8>) -> io::Result<()> {
        use asupersync::bytes::BytesMut;
        use asupersync::codec::Encoder;
        use io::Write;

        let frame = Frame::pong(payload);
        let mut buf = BytesMut::with_capacity(128);
        self.codec
            .encode(frame, &mut buf)
            .map_err(|e| io::Error::other(format!("WS pong encode: {e}")))?;
        self.stream.write_all(&buf)
    }

    fn send_raw_bytes(&mut self, bytes: &[u8]) -> io::Result<()> {
        use io::Write;
        self.stream.write_all(bytes)
    }
}

// ── Read-only WebSocket frame decoder ────────────────────────────────────────

/// Decoded frame result from the read side.
enum ReadResult {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
}

fn ws_read(
    stream: &mut StdTcpStream,
    codec: &mut FrameCodec,
    read_buf: &mut asupersync::bytes::BytesMut,
) -> io::Result<Option<ReadResult>> {
    use asupersync::codec::Decoder;
    use io::Read;

    loop {
        match codec.decode(read_buf) {
            Ok(Some(frame)) => match frame.opcode {
                Opcode::Text => {
                    let text = String::from_utf8_lossy(&frame.payload).to_string();
                    return Ok(Some(ReadResult::Text(text)));
                }
                Opcode::Binary => return Ok(Some(ReadResult::Binary(frame.payload.to_vec()))),
                Opcode::Ping => return Ok(Some(ReadResult::Ping(frame.payload.to_vec()))),
                Opcode::Close => return Ok(None),
                _ => continue, // Pong, continuation — skip
            },
            Ok(None) => {
                let mut tmp = [0u8; 4096];
                let n = stream.read(&mut tmp)?;
                if n == 0 {
                    return Ok(None);
                }
                read_buf.extend_from_slice(&tmp[..n]);
            }
            Err(e) => return Err(io::Error::other(format!("WS decode: {e}"))),
        }
    }
}

// ── Registry WebSocket handler (/ws) ─────────────────────────────────────────

fn handle_registry_ws(
    stream: StdTcpStream,
    peer_addr: std::net::SocketAddr,
    state: Registry,
) {
    let writer = Arc::new(Mutex::new(WsWriter::new(
        stream.try_clone().expect("clone for writer"),
    )));
    let mut read_stream = stream;
    let _ = read_stream.set_read_timeout(Some(Duration::from_millis(100)));

    let mut read_codec = FrameCodec::server();
    let mut read_buf = asupersync::bytes::BytesMut::with_capacity(8192);

    // Send init event
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
        let mut w = writer.lock().unwrap();
        if w.send_text(&init.to_string()).is_err() {
            return;
        }
    }

    // Broadcast forwarder thread
    let mut rx = state.tx.subscribe();
    let broadcast_writer = writer.clone();
    let broadcast_running = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let br = broadcast_running.clone();

    let broadcast_handle = std::thread::spawn(move || {
        let rt = RuntimeBuilder::new()
            .worker_threads(1)
            .build()
            .expect("broadcast runtime");

        rt.block_on(async {
            let cx = ephemeral_cx();
            while let Ok(event) = rx.recv(&cx).await {
                if !br.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                let mut w = broadcast_writer.lock().unwrap();
                if w.send_text(&event).is_err() {
                    break;
                }
            }
        });
    });

    // Read loop
    let mut registered_node_id: Option<String> = None;
    let cx = ephemeral_cx();

    loop {
        match ws_read(&mut read_stream, &mut read_codec, &mut read_buf) {
            Ok(Some(ReadResult::Text(text))) => {
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
                    let mut w = writer.lock().unwrap();
                    if w.send_text(&out).is_err() {
                        break;
                    }
                }
            }
            Ok(Some(ReadResult::Ping(payload))) => {
                // Update last_seen on heartbeat so cleanup can detect dead agents
                if let Some(ref node_id) = registered_node_id {
                    if let Ok(mut nodes) = state.nodes.write() {
                        if let Some(node) = nodes.get_mut(node_id) {
                            node.last_seen = Some(Utc::now().timestamp());
                        }
                    }
                }
                let mut w = writer.lock().unwrap();
                if w.send_pong(payload).is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Ok(Some(_)) => {}
            Err(e) => {
                if e.kind() == io::ErrorKind::WouldBlock || e.kind() == io::ErrorKind::TimedOut {
                    continue;
                }
                warn!(peer = %peer_addr, error = %e, "WebSocket receive error");
                break;
            }
        }
    }

    // Mark node offline BEFORE stopping broadcast forwarder
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

    std::thread::sleep(Duration::from_millis(50));
    broadcast_running.store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = broadcast_handle.join();
}

// ── Agent proxy WebSocket handler (/ws/agent/{nodeId}) ───────────────────────

fn handle_proxy_ws(
    stream: StdTcpStream,
    peer_addr: std::net::SocketAddr,
    node_id: &str,
    state: &Registry,
) {
    // Look up the node's local address
    let (agent_host, agent_port) = {
        let nodes = state.nodes.read().expect("nodes lock poisoned");
        match nodes.get(node_id) {
            Some(node) if node.status == "active" => {
                // Connect to localhost since the agent is on this machine
                ("127.0.0.1".to_string(), node.port)
            }
            Some(_) => {
                let mut w = WsWriter::new(stream);
                let err = serde_json::json!({ "error": "Agent is offline" }).to_string();
                let _ = w.send_text(&err);
                return;
            }
            None => {
                let mut w = WsWriter::new(stream);
                let err = serde_json::json!({ "error": "Agent not found" }).to_string();
                let _ = w.send_text(&err);
                return;
            }
        }
    };

    // Connect to the agent's local WebSocket
    let agent_addr = format!("{agent_host}:{agent_port}");
    let mut agent_stream = match StdTcpStream::connect_timeout(
        &agent_addr.parse().unwrap(),
        Duration::from_secs(5),
    ) {
        Ok(s) => s,
        Err(e) => {
            warn!(node_id, error = %e, "Failed to connect to agent");
            let mut w = WsWriter::new(stream);
            let err =
                serde_json::json!({ "error": format!("Cannot reach agent: {e}") }).to_string();
            let _ = w.send_text(&err);
            return;
        }
    };

    // Perform client-side WebSocket handshake to the agent
    {
        use io::{Read, Write};
        let key = base64_ws_key();
        let req = format!(
            "GET / HTTP/1.1\r\n\
             Host: {agent_addr}\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Key: {key}\r\n\
             Sec-WebSocket-Version: 13\r\n\r\n"
        );
        if agent_stream.write_all(req.as_bytes()).is_err() {
            return;
        }
        let mut resp_buf = [0u8; 1024];
        let _ = agent_stream.read(&mut resp_buf);
        // Accept any 101 response — the agent is a local trusted server
    }

    // Bidirectional relay: dashboard ↔ agent
    // Two threads: one reads from dashboard and writes to agent,
    // the other reads from agent and writes to dashboard.
    let dashboard_read = stream;
    let dashboard_writer = Arc::new(Mutex::new(WsWriter::new(
        dashboard_read.try_clone().expect("clone dashboard for write"),
    )));

    let agent_writer = Arc::new(Mutex::new(WsWriter::new(
        agent_stream.try_clone().expect("clone agent for write"),
    )));

    let mut dash_read = dashboard_read;
    let _ = dash_read.set_read_timeout(Some(Duration::from_millis(100)));
    let _ = agent_stream.set_read_timeout(Some(Duration::from_millis(100)));

    let dash_writer_for_agent = dashboard_writer.clone();
    let agent_writer_for_agent = agent_writer.clone();
    let peer = peer_addr;

    // Thread: agent → dashboard
    let agent_to_dash = std::thread::spawn(move || {
        // Agent sends unmasked server frames — decode with client codec
        let mut codec = FrameCodec::client();
        let mut buf = asupersync::bytes::BytesMut::with_capacity(8192);
        loop {
            match ws_read(&mut agent_stream, &mut codec, &mut buf) {
                Ok(Some(ReadResult::Text(text))) => {
                    let mut w = dash_writer_for_agent.lock().unwrap();
                    if w.send_text(&text).is_err() {
                        break;
                    }
                }
                Ok(Some(ReadResult::Binary(data))) => {
                    let mut w = dash_writer_for_agent.lock().unwrap();
                    if w.send_raw_bytes(&data).is_err() {
                        break;
                    }
                }
                Ok(Some(ReadResult::Ping(payload))) => {
                    let mut w = agent_writer_for_agent.lock().unwrap();
                    if w.send_pong(payload).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    if e.kind() == io::ErrorKind::WouldBlock
                        || e.kind() == io::ErrorKind::TimedOut
                    {
                        continue;
                    }
                    break;
                }
            }
        }
    });

    // This thread: dashboard → agent
    let mut codec = FrameCodec::server();
    let mut buf = asupersync::bytes::BytesMut::with_capacity(8192);
    loop {
        match ws_read(&mut dash_read, &mut codec, &mut buf) {
            Ok(Some(ReadResult::Text(text))) => {
                // Forward text from dashboard to agent as a client frame (masked)
                use asupersync::codec::Encoder;

                let mut client_codec = FrameCodec::client();
                let frame = Frame::from(Message::text(&text));
                let mut out = asupersync::bytes::BytesMut::with_capacity(text.len() + 14);
                if client_codec.encode(frame, &mut out).is_ok() {
                    let mut w = agent_writer.lock().unwrap();
                    let _ = w.send_raw_bytes(&out);
                }
            }
            Ok(Some(ReadResult::Ping(payload))) => {
                let mut w = dashboard_writer.lock().unwrap();
                if w.send_pong(payload).is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Ok(Some(_)) => {}
            Err(e) => {
                if e.kind() == io::ErrorKind::WouldBlock || e.kind() == io::ErrorKind::TimedOut {
                    continue;
                }
                warn!(peer = %peer, error = %e, "Proxy read error");
                break;
            }
        }
    }

    let _ = agent_to_dash.join();
}

/// Generate a random base64-encoded WebSocket key for client handshake.
fn base64_ws_key() -> String {
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
    // Simple base64 encode
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
