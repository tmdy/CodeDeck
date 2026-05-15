// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../../../App.jsx";
import UnlockApp from "../../../UnlockApp.jsx";

describe("App unlock route", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("should render the unlock screen on the first paint for the unlock route", () => {
    window.history.replaceState(null, "", "/#/unlock");

    const html = renderToStaticMarkup(<UnlockApp />);

    expect(html).toContain('class="unlock-screen"');
    expect(html).toContain("Skills Manager");
    expect(html).toContain('type="password"');
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

    expect(css).toContain(".app-shell-v2 {\n  padding: 12px 14px;\n  display: grid;\n  gap: 10px;");
    expect(css).toContain(".hero-v2 {\n  border: 1px solid var(--app-border);");
    expect(css).toContain("  background: var(--app-surface);");
    expect(css).toContain("  padding: 10px 16px;");
    expect(css).toContain(".hero-v2 h1 {\n  margin: 0;\n  font-size: 1.22rem;");
  });

  it("should route Skills tab feedback into the Skills panel status strip", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "App.tsx"), "utf8");

    expect(source).toContain("const skillsStatusMessage");
    expect(source).toContain("{errorMessage && activeTab !== \"skills\" && (");
    expect(source).toContain("{successMessage && activeTab !== \"skills\" && (");
    expect(source).toContain("statusMessage={skillsStatusMessage}");
  });

  it("should split the unlock route away from the main app bundle", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "main.tsx"), "utf8");

    expect(source).not.toContain('import App from "./App.js"');
    expect(source).toContain('import("./UnlockApp.js")');
    expect(source).toContain('import("./App.js")');
    expect(source).toContain('window.location.hash.includes("/unlock")');
  });
});
