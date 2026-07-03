// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ParameterSettingsPanel } from "../../../components/settings/ParameterSettingsPanel.jsx";
import { defaultParameterSettings } from "../../parameter/types.js";

describe("ParameterSettingsPanel", () => {
  it("should not render obsolete launch timeout or Claude permission mode inputs", () => {
    const html = renderToStaticMarkup(
      <ParameterSettingsPanel
        settings={defaultParameterSettings()}
        onChange={vi.fn()}
      />,
    );

    expect(html).not.toContain("启动超时");
    expect(html).not.toContain("权限模式");
    expect(html).toContain("余额检测超时");
    expect(html).toContain("Setting Sources");
    expect(html).toContain("Wire API");
    expect(html).toContain("跳过 Git 仓库检查");
  });
});
