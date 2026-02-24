use clap::Parser;
use std::env;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(name = "hypivisor", version, about = "Hyper-Pi central registry")]
struct Args {
    #[arg(short, long, default_value_t = 31415)]
    port: u16,

    /// Seconds before offline nodes are removed from the registry
    #[arg(short = 't', long, default_value_t = 30)]
    node_ttl: u64,
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

    let config = hypivisor::ServerConfig {
        port: args.port,
        node_ttl: args.node_ttl,
        secret_token,
    };

    let state = hypivisor::create_state(&config);
    hypivisor::start_cleanup_thread(&state);

    let listener = hypivisor::bind(config.port);
    info!(port = config.port, "Hypivisor online");
    hypivisor::log::info("hypivisor", &format!("Hypivisor online on port {}", config.port));

    hypivisor::serve(listener, state);
}
