// Launch mode 测试

import { describe, it, expect } from "vitest";
import { normalizeLaunchMode } from "../../profile/launch-mode.js";

describe("normalizeLaunchMode", () => {
  it("should return new for default, empty, and legacy direct values", () => {
    expect(normalizeLaunchMode("")).toBe("new");
    expect(normalizeLaunchMode("unknown")).toBe("new");
    expect(normalizeLaunchMode("direct")).toBe("new");
    expect(normalizeLaunchMode("new")).toBe("new");
  });

  it("should return continue_last for current and legacy continue values", () => {
    expect(normalizeLaunchMode("continue")).toBe("continue_last");
    expect(normalizeLaunchMode("continue_last")).toBe("continue_last");
    expect(normalizeLaunchMode("  continue_last  ")).toBe("continue_last");
  });

  it("should support all resume launch modes", () => {
    expect(normalizeLaunchMode("resume_selected")).toBe("resume_selected");
    expect(normalizeLaunchMode("resume_picker")).toBe("resume_picker");
    expect(normalizeLaunchMode("resume_picker_all")).toBe("resume_picker_all");
  });
});
