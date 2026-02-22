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
      "@mariozechner/pi-web-ui",
      "@mariozechner/mini-lit",
      "@lit/reactive-element",
      "lit",
      "lit-html",
      "lit-element",
      "@aws-sdk/client-bedrock-runtime",
      "@smithy/node-http-handler",
    ],
    include: [
      "@mariozechner/pi-ai > partial-json",
      "@mariozechner/pi-ai > p-retry",
      "@mariozechner/pi-ai > ajv",
      "@mariozechner/pi-ai > ajv-formats",
      "@mariozechner/pi-web-ui > @lmstudio/sdk",
      "@mariozechner/pi-web-ui > docx-preview",
      "@mariozechner/pi-web-ui > jszip",
      "@mariozechner/pi-web-ui > lucide",
      "@mariozechner/pi-web-ui > xlsx",
      "highlight.js",
      "highlight.js/lib/core",
      "highlight.js/lib/languages/bash",
      "highlight.js/lib/languages/css",
      "highlight.js/lib/languages/javascript",
      "highlight.js/lib/languages/json",
      "highlight.js/lib/languages/python",
      "highlight.js/lib/languages/sql",
      "highlight.js/lib/languages/typescript",
      "highlight.js/lib/languages/xml",
    ],

  },
});
