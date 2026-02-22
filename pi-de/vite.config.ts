import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: true,
  },
  // pi-ai bundles Node-only providers (AWS Bedrock, etc.) that import
  // "stream", "tls", etc. These are unused in the browser — stub them out.
  resolve: {
    alias: {
      stream: "stream-browserify",
    },
  },
  build: {
    rollupOptions: {
      // Treat Node builtins as external — they're never called in browser
      external: (id) => {
        if (
          id === "stream" ||
          id === "tls" ||
          id === "net" ||
          id === "fs" ||
          id === "path" ||
          id === "util" ||
          id === "os" ||
          id === "crypto" ||
          id === "http" ||
          id === "https" ||
          id === "http2" ||
          id === "zlib" ||
          id === "dns" ||
          id === "child_process" ||
          id.startsWith("node:")
        ) {
          return true;
        }
        return false;
      },
    },
  },
  optimizeDeps: {
    // pi-ai imports Node-only packages (AWS SDK, etc.) that can't be
    // pre-bundled for the browser. But some of its transitive deps are
    // CJS-only and need pre-bundling for ESM named imports to work.
    // Solution: exclude the Node-heavy packages, include the CJS deps.
    exclude: [
      "@mariozechner/pi-ai",
      "@aws-sdk/client-bedrock-runtime",
      "@smithy/node-http-handler",
    ],
    include: [
      "@mariozechner/pi-ai > partial-json",
      "@mariozechner/pi-ai > p-retry",
      "@mariozechner/pi-ai > ajv",
      "@mariozechner/pi-ai > ajv-formats",
    ],
  },
});
