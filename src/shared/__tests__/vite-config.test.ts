import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import viteConfig from "../../../vite.config.ts";

describe("vite config", () => {
  it("uses a relative base so Electron file:// windows can load assets", () => {
    expect(viteConfig.base).toBe("./");
  });

  it("ignores runtime data directories during dev server watching", () => {
    const ignored = viteConfig.server?.watch?.ignored;

    expect(Array.isArray(ignored)).toBe(true);
    expect(ignored).toContain("**/app-data/**");
    expect(ignored).toContain("**/dist-electron/**");
    expect(ignored).toContain("**/release/**");
  });

  it("warms the renderer startup modules in dev", () => {
    expect(viteConfig.server?.warmup?.clientFiles).toEqual(
      expect.arrayContaining(["./src/main.tsx", "./src/App.tsx"]),
    );
  });

  it("prewarms renderer startup modules before launching Electron in dev", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const script = packageJson.scripts["dev:electron"];

    expect(script).toContain("http-get://localhost:5173/src/main.tsx");
    expect(script).toContain("http-get://localhost:5173/src/App.tsx");
    expect(script.indexOf("http-get://localhost:5173/src/App.tsx")).toBeLessThan(
      script.indexOf("electron ./dist-electron/electron/main.js"),
    );
  });
});
