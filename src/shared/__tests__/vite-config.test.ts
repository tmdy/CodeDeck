import { describe, expect, it } from "vitest";
import viteConfig from "../../../vite.config.ts";

describe("vite config", () => {
  it("uses a relative base so Electron file:// windows can load assets", () => {
    expect(viteConfig.base).toBe("./");
  });
});
