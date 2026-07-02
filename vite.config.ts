import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEV_SERVER_WATCH_IGNORED = [
  "**/app-data/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/release/**",
];

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    warmup: {
      clientFiles: ["./src/main.tsx", "./src/App.tsx"],
    },
    watch: {
      ignored: DEV_SERVER_WATCH_IGNORED,
    },
  },
  test: {
    environment: "node",
    include: ["src/shared/**/*.test.ts", "src/shared/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
