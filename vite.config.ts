import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "frontend",
  // Reown AppKit's WalletConnect connector expects Node's Buffer/global to exist -- Vite
  // doesn't polyfill Node builtins itself (unlike Webpack/CRA), so without this its modal
  // injection throws "Buffer is not defined" at runtime.
  plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true } }), react()],
  resolve: {
    alias: {
      "@artifacts": path.resolve(__dirname, "artifacts/contracts"),
      "@contracts": path.resolve(__dirname, "contracts"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
