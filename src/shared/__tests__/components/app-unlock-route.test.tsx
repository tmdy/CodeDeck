// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../../../App.jsx";

describe("App unlock route", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("should render the unlock screen on the first paint for the unlock route", () => {
    window.history.replaceState(null, "", "/#/unlock");

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="unlock-screen"');
    expect(html).toContain("Skills Manager");
    expect(html).not.toContain("请输入配置密码以解锁 Profile 管理功能");
    expect(html).not.toContain("首次使用请先设置配置密码");
    expect(html).not.toContain("跳过");
    expect(html).not.toContain("使用空配置");
    expect(html).not.toContain("AI CLI 工具统一管理");
  });

  it("should not force the unlock screen outside the unlock route on the first paint", () => {
    window.history.replaceState(null, "", "/");

    const html = renderToStaticMarkup(<App />);

    expect(html).not.toContain('class="unlock-screen"');
    expect(html).toContain("AI CLI 工具统一管理");
  });
});
