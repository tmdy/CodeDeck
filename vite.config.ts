import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/shared/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
