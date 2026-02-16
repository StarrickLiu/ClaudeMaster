// Vite 配置：开发代理、构建输出
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8420",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
