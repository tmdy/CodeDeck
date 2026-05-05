import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/shared/**/*.test.ts", "src/shared/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
