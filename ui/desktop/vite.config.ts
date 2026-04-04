import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { 
    port: 5173,
    host: '127.0.0.1'  // Force IPv4 for Electron compatibility
  },
  base: './',  // Use relative paths for Electron file:// protocol
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true
  }
});
