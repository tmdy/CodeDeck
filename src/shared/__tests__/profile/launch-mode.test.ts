// Launch mode 测试

import { describe, it, expect } from "vitest";
import { normalizeLaunchMode } from "../../profile/launch-mode.js";

describe("normalizeLaunchMode", () => {
  it("should return direct for default/empty", () => {
    expect(normalizeLaunchMode("")).toBe("direct");
    expect(normalizeLaunchMode("unknown")).toBe("direct");
  });

  it("should return continue", () => {
    expect(normalizeLaunchMode("continue")).toBe("continue");
    expect(normalizeLaunchMode("  continue  ")).toBe("continue");
  });

  it("should return resume_selected", () => {
    expect(normalizeLaunchMode("resume_selected")).toBe("resume_selected");
  });
});