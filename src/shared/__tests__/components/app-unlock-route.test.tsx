// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
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
    expect(html).not.toContain("Skills Manager V2");
  });

  it("should keep the main header compact", async () => {
    const css = await readFile(path.join(process.cwd(), "src", "styles.css"), "utf8");

    expect(css).toContain(".app-shell-v2 {\n  padding: 18px 20px;\n  display: grid;\n  gap: 14px;");
    expect(css).toContain(".hero-v2 {\n  border: 1px solid rgba(29, 39, 51, 0.08);");
    expect(css).toContain("  padding: 14px 24px;");
    expect(css).toContain(".hero-v2 h1 {\n  margin: 0;\n  font-size: 1.35rem;");
  });

  it("should route Skills tab feedback into the Skills panel status strip", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "App.tsx"), "utf8");

    expect(source).toContain("const skillsStatusMessage");
    expect(source).toContain("{errorMessage && activeTab !== \"skills\" && (");
    expect(source).toContain("{successMessage && activeTab !== \"skills\" && (");
    expect(source).toContain("statusMessage={skillsStatusMessage}");
  });
});
