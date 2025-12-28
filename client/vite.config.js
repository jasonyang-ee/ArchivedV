import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from 'fs'
import path from 'path'

// Read version from root package.json
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  define: {
  	__APP_VERSION__: JSON.stringify(packageJson.version),
  },

  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
