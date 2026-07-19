import { describe, expect, it } from "vitest";
import { formatCheckinReward } from "../../checkin/presentation.js";

describe("formatCheckinReward", () => {
  it("converts New API raw quota rewards to USD", () => {
    expect(formatCheckinReward("614271")).toBe("$1.23");
    expect(formatCheckinReward("250000")).toBe("$0.5");
  });

  it("preserves non-numeric reward text", () => {
    expect(formatCheckinReward("奖励券 x1")).toBe("奖励券 x1");
  });
});
