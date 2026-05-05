import { describe, expect, it } from "vitest";
import type { BalanceCheckState } from "../../balance/types.js";
import {
  buildBalanceListEntry,
  getBalanceStateForProfile,
  summarizeBalanceState,
} from "../../balance/presentation.js";

function makeState(overrides: Partial<BalanceCheckState> = {}): BalanceCheckState {
  return {
    provider: "codex",
    profile_name: "Relay",
    base_url: "https://relay.example.com",
    running: false,
    supported: true,
    success: true,
    message: "",
    items: [
      {
        label: "USD",
        remaining: 12.34,
        total: 20,
        used: 7.66,
        unit: "$",
      },
    ],
    endpoint: "https://relay.example.com/api/user/self",
    finished_at_display: "2026/05/05 12:00:00",
    ...overrides,
  };
}

describe("balance presentation helpers", () => {
  it("returns the cached state for the selected profile key", () => {
    const first = makeState({ profile_name: "First" });
    const second = makeState({ profile_name: "Second", items: [{ label: "USD", remaining: 9, total: 9, used: 0, unit: "$" }] });

    expect(getBalanceStateForProfile({ "codex::First": first, "codex::Second": second }, "codex::Second")).toBe(second);
    expect(getBalanceStateForProfile({ "codex::First": first }, "codex::Missing")).toBeNull();
  });

  it("builds concise success summaries for the selected profile and list rows", () => {
    const state = makeState();

    expect(summarizeBalanceState(state)).toBe("$12.34 剩余");
    expect(buildBalanceListEntry(state)).toEqual({
      label: "余额 $12.34",
      status: "success",
    });
  });

  it("falls back to the success message when a balance check has no numeric items", () => {
    const state = makeState({
      message: "无限额度",
      items: [],
    });

    expect(summarizeBalanceState(state)).toBe("无限额度");
    expect(buildBalanceListEntry(state)).toEqual({
      label: "无限额度",
      status: "success",
    });
  });

  it("maps unsupported and failed states to lightweight list labels", () => {
    expect(
      buildBalanceListEntry(
        makeState({
          supported: false,
          success: false,
          message: "该站点暂不支持余额查询",
          items: [],
        }),
      ),
    ).toEqual({
      label: "N/A",
      status: "unsupported",
    });

    expect(
      buildBalanceListEntry(
        makeState({
          success: false,
          message: "余额接口鉴权失败，请检查 API Key",
          items: [],
        }),
      ),
    ).toEqual({
      label: "失败",
      status: "fail",
    });
  });
});
