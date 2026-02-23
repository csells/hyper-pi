import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: true,
  },
  build: {
    rollupOptions: {
      // Node builtins are never called in browser — treat as external.
      external: (id) =>
        ["stream", "tls", "net", "fs", "path", "util", "os", "crypto",
         "http", "https", "http2", "zlib", "dns", "child_process",
        ].includes(id) || id.startsWith("node:"),
    },
  },
  optimizeDeps: {
    // Only exclude packages that import Node builtins and crash esbuild.
    // Everything else (pi-ai, pi-web-ui, mini-lit, highlight.js, etc.)
    // gets pre-bundled with proper CJS-to-ESM interop.
    exclude: [
      "@aws-sdk/client-bedrock-runtime",
      "@smithy/node-http-handler",
      "@smithy/eventstream-serde-node",
      "@smithy/util-stream",
      "socks",
    ],
  },
});
