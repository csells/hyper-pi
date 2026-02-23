import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * pi-web-ui's app.css bundles KaTeX CSS with relative font paths
 * (`url(fonts/KaTeX_*.woff2)`) but doesn't ship the font files.
 * They live in the katex package. This plugin rewrites font requests
 * to serve from katex/dist/fonts/ instead of pi-web-ui/dist/fonts/.
 */
function katexFontsPlugin(): Plugin {
  const from = "/node_modules/@mariozechner/pi-web-ui/dist/fonts/";
  const to = "/node_modules/katex/dist/fonts/";
  return {
    name: "katex-fonts-redirect",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith(from)) {
          req.url = req.url.replace(from, to);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), katexFontsPlugin()],
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
