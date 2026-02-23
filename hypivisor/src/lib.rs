pub mod auth;
pub mod cleanup;
pub mod fs_browser;
pub mod handlers;
pub mod rpc;
pub mod spawn;
pub mod state;

use auth::{extract_token_from_query, is_authorized};
use asupersync::channel::broadcast;
use asupersync::net::websocket::{
    Frame, FrameCodec, HttpRequest, Message, Opcode, ServerHandshake,
};
use asupersync::runtime::builder::RuntimeBuilder;
use asupersync::types::{Budget, RegionId, TaskId};
use asupersync::Cx;
use state::{AppState, NodeInfo, Registry};
use std::{
    collections::HashMap,
    io,
    net::{TcpListener, TcpStream as StdTcpStream, ToSocketAddrs},
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};
use tracing::{error, warn};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_state_with_default_config() {
        let config = ServerConfig {
            port: 0,
            node_ttl: 30,
            secret_token: "test".to_string(),
        };
        let state = create_state(&config);
        assert_eq!(state.secret_token, "test");
        assert_eq!(state.node_ttl, 30);
        assert!(state.nodes.read().unwrap().is_empty());
    }

    #[test]
    fn create_state_empty_token() {
        let config = ServerConfig {
            port: 0,
            node_ttl: 60,
            secret_token: String::new(),
        };
        let state = create_state(&config);
        assert!(state.secret_token.is_empty());
    }

    #[test]
    fn bind_random_port() {
        let listener = bind(0);
        let addr = listener.local_addr().unwrap();
        assert!(addr.port() > 0);
    }

    #[test]
    fn ephemeral_cx_is_valid() {
        let cx = ephemeral_cx();
        // Just verify it doesn't panic
        let _ = cx;
    }
}

/// Create an ephemeral Cx for use outside the runtime's region system.
pub fn ephemeral_cx() -> Cx {
    Cx::new(
        RegionId::new_ephemeral(),
        TaskId::new_ephemeral(),
        Budget::INFINITE,
    )
}

/// Server configuration.
pub struct ServerConfig {
    pub port: u16,
    pub node_ttl: u64,
    pub secret_token: String,
}

/// Create app state from config.
pub fn create_state(config: &ServerConfig) -> Registry {
    let home_dir = dirs::home_dir().unwrap_or_else(|| {
        warn!("Could not determine home directory, falling back to '.'");
        ".".into()
    });

    let (tx, _rx) = broadcast::channel::<String>(256);
    Arc::new(AppState {
        nodes: RwLock::new(HashMap::new()),
        tx,
        secret_token: config.secret_token.clone(),
        home_dir,
        node_ttl: config.node_ttl,
    })
}

/// Bind to the given port and return the listener.
pub fn bind(port: u16) -> TcpListener {
    let addr = format!("0.0.0.0:{port}");
    TcpListener::bind(&addr).unwrap_or_else(|e| panic!("Failed to bind {addr}: {e}"))
}

/// Start the cleanup thread.
pub fn start_cleanup_thread(state: &Registry) {
    let cleanup_state = state.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        let cx = ephemeral_cx();
        cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
    });
}

/// Run the server accept loop. Blocks forever unless the listener is closed.
pub fn serve(listener: TcpListener, state: Registry) {
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
    let (uri, path) = handlers::parse_request_uri(&request_str);

    // Auth check (applies to all WebSocket paths)
    let token = extract_token_from_query(uri);
    if !is_authorized(token.as_deref(), &state.secret_token) {
        let _ = stream
            .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 12\r\n\r\nUnauthorized");
        return;
    }

    // Route: /ws = registry, /ws/agent/{nodeId} = proxy
    match handlers::match_route(path) {
        handlers::RouteMatch::Registry => {
            if let Some(ws_stream) = upgrade_websocket(&mut stream, request_bytes, peer_addr) {
                handle_registry_ws(ws_stream, peer_addr, state);
            }
        }
        handlers::RouteMatch::AgentProxy(node_id) => {
            let node_id = node_id.to_string();
            if let Some(ws_stream) = upgrade_websocket(&mut stream, request_bytes, peer_addr) {
                handle_proxy_ws(ws_stream, peer_addr, &node_id, &state);
            }
        }
        handlers::RouteMatch::BadRequest(_) => {
            let _ = stream.write_all(
                b"HTTP/1.1 400 Bad Request\r\nContent-Length: 15\r\n\r\nMissing node ID",
            );
        }
        handlers::RouteMatch::NotFound => {
            let _ = stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found");
        }
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

    Some(
        stream
            .try_clone()
            .expect("Failed to clone stream after handshake"),
    )
}

// ── Shared WebSocket writer ──────────────────────────────────────────────────

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

    fn shutdown(&mut self) {
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
    }
}

// ── Read-only WebSocket frame decoder ────────────────────────────────────────

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
                _ => continue,
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

fn handle_registry_ws(stream: StdTcpStream, peer_addr: std::net::SocketAddr, state: Registry) {
    let writer = Arc::new(Mutex::new(WsWriter::new(
        stream.try_clone().expect("clone for writer"),
    )));
    let mut read_stream = stream;
    let _ = read_stream.set_read_timeout(Some(Duration::from_millis(2000)));

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
        let init = handlers::build_init_event(&nodes);
        let mut w = writer.lock().unwrap();
        if w.send_text(&init).is_err() {
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
                if let Some((response_json, new_node_id)) = handlers::process_registry_message(
                    &cx,
                    &text,
                    &state,
                    registered_node_id.as_deref(),
                ) {
                    if let Some(nid) = new_node_id {
                        registered_node_id = Some(nid);
                    }
                    let mut w = writer.lock().unwrap();
                    if w.send_text(&response_json).is_err() {
                        break;
                    }
                }
            }
            Ok(Some(ReadResult::Ping(payload))) => {
                if let Some(ref node_id) = registered_node_id {
                    handlers::update_heartbeat(&state, node_id);
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
    if let Some(ref node_id) = registered_node_id {
        handlers::mark_node_offline(&cx, &state, node_id);
    }

    broadcast_running.store(false, std::sync::atomic::Ordering::Relaxed);
    writer.lock().unwrap().shutdown();
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
        let lookup = handlers::lookup_proxy_target(&nodes, node_id);
        match lookup {
            handlers::ProxyLookup::Found { host, port } => (host, port),
            _ => {
                drop(nodes);
                let mut w = WsWriter::new(stream);
                let err = handlers::proxy_error_json(&lookup).unwrap();
                let _ = w.send_text(&err);
                return;
            }
        }
    };

    // Connect to the agent's local WebSocket
    let agent_addr = format!("{agent_host}:{agent_port}");
    let socket_addr = match agent_addr.to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(addr) => addr,
            None => {
                warn!(node_id, addr = %agent_addr, "No addresses resolved for agent");
                let mut w = WsWriter::new(stream);
                let err =
                    serde_json::json!({ "error": "Cannot resolve agent address" }).to_string();
                let _ = w.send_text(&err);
                return;
            }
        },
        Err(e) => {
            warn!(node_id, addr = %agent_addr, error = %e, "Failed to resolve agent address");
            let mut w = WsWriter::new(stream);
            let err = serde_json::json!({ "error": format!("Cannot resolve agent: {e}") })
                .to_string();
            let _ = w.send_text(&err);
            return;
        }
    };
    let mut agent_stream =
        match StdTcpStream::connect_timeout(&socket_addr, Duration::from_secs(5)) {
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
        let key = handlers::base64_ws_key();
        let req = handlers::build_agent_handshake_request(&agent_addr, &key);
        if agent_stream.write_all(req.as_bytes()).is_err() {
            return;
        }
        let mut resp_buf = [0u8; 1024];
        let n = match agent_stream.read(&mut resp_buf) {
            Ok(n) if n > 0 => n,
            _ => {
                let mut w = WsWriter::new(stream);
                let err =
                    serde_json::json!({ "error": "Agent handshake failed: no response" })
                        .to_string();
                let _ = w.send_text(&err);
                return;
            }
        };

        let resp_str = String::from_utf8_lossy(&resp_buf[..n]);
        if !handlers::validate_agent_handshake(&resp_str) {
            warn!(
                node_id,
                "Agent handshake validation failed: response does not contain 101"
            );
            let mut w = WsWriter::new(stream);
            let err =
                serde_json::json!({ "error": "Agent handshake failed: invalid response" })
                    .to_string();
            let _ = w.send_text(&err);
            return;
        }
    }

    // Bidirectional relay: dashboard ↔ agent
    let dashboard_read = stream;
    let dashboard_writer = Arc::new(Mutex::new(WsWriter::new(
        dashboard_read
            .try_clone()
            .expect("clone dashboard for write"),
    )));

    let agent_writer = Arc::new(Mutex::new(WsWriter::new(
        agent_stream.try_clone().expect("clone agent for write"),
    )));

    let mut dash_read = dashboard_read;
    let _ = dash_read.set_read_timeout(Some(Duration::from_millis(2000)));
    let _ = agent_stream.set_read_timeout(Some(Duration::from_millis(2000)));

    let agent_shutdown_handle = agent_stream.try_clone().expect("clone agent for shutdown");

    let dash_writer_for_agent = dashboard_writer.clone();
    let agent_writer_for_agent = agent_writer.clone();
    let peer = peer_addr;

    // Thread: agent → dashboard
    let agent_to_dash = std::thread::spawn(move || {
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

    use std::net::Shutdown;
    let _ = agent_shutdown_handle.shutdown(Shutdown::Both);
    let _ = agent_to_dash.join();
}
