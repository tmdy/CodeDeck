// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../../../App.jsx";

describe("App startup route", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("should render a lightweight startup gate before auth status is known", () => {
    window.history.replaceState(null, "", "/");

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="startup-screen"');
    expect(html).toContain("Skills Manager");
    expect(html).toContain("正在准备解锁界面");
    expect(html).not.toContain("AI CLI 工具统一管理");
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

  it("should mount a single App entry instead of routing to UnlockApp by hash", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "main.tsx"), "utf8");

    expect(source).not.toContain('import("./UnlockApp.js")');
    expect(source).toContain('import("./App.js")');
    expect(source).not.toContain('window.location.hash.includes("/unlock")');
  });

  it("should lazy-load non-default tabs from App", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "App.tsx"), "utf8");

    expect(source).toContain('import("./components/app/SessionsPage.jsx").then((module) => ({ default: module.SessionsPage }))');
    expect(source).toContain('import("./components/app/SettingsPage.jsx").then((module) => ({ default: module.SettingsPage }))');
    expect(source).toContain('import("./components/skills/SkillsPanel.jsx").then((module) => ({ default: module.SkillsPanel }))');
    expect(source).not.toContain('import { SessionsPage } from "./components/app/SessionsPage.jsx";');
    expect(source).not.toContain('import { SettingsPage } from "./components/app/SettingsPage.jsx";');
    expect(source).not.toContain('import { SkillsPanel } from "./components/skills/SkillsPanel.jsx";');
    expect(source).toContain('import { ProfilesPage } from "./components/app/ProfilesPage.jsx";');
  });

  it("should register IPC handlers before the first main window is created", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    const readyBlockStart = source.indexOf("app.whenReady().then(async () => {");
    const registerIpcIndex = source.indexOf("registerAllIpcHandlers();", readyBlockStart);
    const createMainWindowIndex = source.indexOf("await createMainWindow();", readyBlockStart);

    expect(readyBlockStart).toBeGreaterThanOrEqual(0);
    expect(registerIpcIndex).toBeGreaterThan(readyBlockStart);
    expect(createMainWindowIndex).toBeGreaterThan(registerIpcIndex);
    expect(source).not.toContain("createUnlockWindow");
    expect(source).not.toContain("isTransitioningFromUnlock");
  });

  it("should keep skills workspace initialization deferred until after the first main window", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    const readyBlockStart = source.indexOf("app.whenReady().then(async () => {");
    const createMainWindowIndex = source.indexOf("await createMainWindow();", readyBlockStart);
    const deferredSkillsIndex = source.indexOf("void ensureSkillsServiceReady();", readyBlockStart);
    const eagerSkillsIndex = source.indexOf("await initSkillsService();", readyBlockStart);

    expect(readyBlockStart).toBeGreaterThanOrEqual(0);
    expect(createMainWindowIndex).toBeGreaterThan(readyBlockStart);
    expect(deferredSkillsIndex).toBeGreaterThan(createMainWindowIndex);
    expect(eagerSkillsIndex).toBe(-1);
  });

  it("should idle-delay the initial Profiles session scan", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "App.tsx"), "utf8");

    expect(source).toContain("window.requestIdleCallback");
    expect(source).toContain("window.setTimeout(run, 800)");
    expect(source).toContain("window.cancelIdleCallback(id)");
  });
});
