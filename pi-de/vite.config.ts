import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: true,
  },
  resolve: {
    alias: {
      // pi-ai bundles Node-only providers that import "stream" — stub it.
      stream: "stream-browserify",
    },
    // Lit's development exports throw on class-field-shadowing (a check
    // that pi-web-ui's AgentInterface fails). The production build handles
    // it gracefully via _$E_(). Use production Lit in dev mode.
    conditions: ["browser", "default"],
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
    // pre-bundled for the browser. Its CJS transitive deps need explicit
    // inclusion for ESM named imports to work at runtime.
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
      "@lmstudio/lms-isomorphic",
    ],
    esbuildOptions: {
      // esnext preserves native class fields — no __publicField helpers.
      target: "esnext",
    },
  },
});
