import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Prevent Vite from clearing the terminal so Tauri logs remain visible
  clearScreen: false,

  server: {
    // Tauri expects a fixed port; fail if it's already in use
    port: 1420,
    strictPort: true,
    // Bind to localhost for security — only the local Tauri shell should connect
    host: "127.0.0.1",
  },

  // Produce relative asset paths so the Tauri webview can load them correctly
  build: {
    // Tauri uses Chromium on Windows & WebKit on macOS/Linux
    target: "esnext",
    // Raise the chunk-size warning limit (Tauri bundles everything locally)
    chunkSizeWarningLimit: 1600,
  },
});
