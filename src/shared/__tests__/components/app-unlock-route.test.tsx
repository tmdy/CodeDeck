// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../../../App.jsx";

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

describe("App startup route", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("should render a lightweight startup gate before auth status is known", () => {
    window.history.replaceState(null, "", "/");

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="startup-screen"');
    expect(html).toContain('class="startup-progress"');
    expect(html).toContain("CodeDeck");
    expect(html).toContain("正在准备解锁界面");
    expect(html).not.toContain("AI CLI 工具统一管理");
  });

  it("should render the static startup gate before the renderer bundle executes", async () => {
    const html = normalizeNewlines(await readFile(path.join(process.cwd(), "index.html"), "utf8"));

    expect(html).toContain("window.__CODEDECK_STARTUP_THEME__");
    expect(html).toContain("document.documentElement.dataset.theme = startupTheme.effectiveTheme");
    expect(html).toContain('<body class="unlock-route">');
    expect(html).toContain('<div id="root">');
    expect(html).toContain('class="startup-screen"');
    expect(html).toContain('class="startup-progress"');
    expect(html).toContain("正在准备解锁界面");
    expect(html).toContain("@keyframes startup-progress-slide");
    expect(html).toContain(':root[data-theme="dark"]');
  });

  it("should pass the startup theme snapshot into the renderer before loading the app", async () => {
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"));
    const createWindowStart = source.indexOf("async function createMainWindow(): Promise<void> {");
    const createWindowEnd = source.indexOf("// ---- 注册所有 IPC 处理器 ----", createWindowStart);
    const createWindowBlock = source.slice(createWindowStart, createWindowEnd);
    const devLoadIndex = createWindowBlock.indexOf("await browserWindow.loadURL(devServerUrl);");
    const distLoadIndex = createWindowBlock.indexOf("await browserWindow.loadFile(resolveDistIndexPath());");
    const additionalArgsIndex = createWindowBlock.indexOf("additionalArguments");

    expect(source).toContain("await syncNativeThemeFromLocalState();");
    expect(source).toContain("getStartupThemeArgument()");
    expect(source).toContain("additionalArguments");
    expect(additionalArgsIndex).toBeGreaterThanOrEqual(0);
    expect(additionalArgsIndex).toBeLessThan(devLoadIndex);
    expect(additionalArgsIndex).toBeLessThan(distLoadIndex);
  });

  it("should show an inline startup shell before loading the real renderer", async () => {
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"));
    const createWindowStart = source.indexOf("async function createMainWindow(): Promise<void> {");
    const createWindowEnd = source.indexOf("// ---- 注册所有 IPC 处理器 ----", createWindowStart);
    const createWindowBlock = source.slice(createWindowStart, createWindowEnd);
    const mainWindowAssignedIndex = createWindowBlock.indexOf("mainWindow = browserWindow;");
    const shellLoadIndex = createWindowBlock.indexOf("await showStartupShell(browserWindow);");
    const devLoadIndex = createWindowBlock.indexOf("await browserWindow.loadURL(devServerUrl);");
    const distLoadIndex = createWindowBlock.indexOf("await browserWindow.loadFile(resolveDistIndexPath());");

    // show: true 让窗口在渲染器冷启动期间立即显示纯色背景（与 shell 同色），
    // 避免 app ready 后数秒无窗口反馈；startup shell 仍在真实 renderer 之前加载。
    expect(createWindowBlock).toContain("show: true,");
    expect(createWindowBlock).toContain("title: APP_NAME,");
    expect(source).toContain('APP_NAME,\n  CODEDECK_PROJECT_ROOT_ENV,');
    expect(source).toContain("function createStartupShellHtml(");
    expect(source).toContain("function showStartupShell(");
    expect(source).toContain('class="startup-screen"');
    expect(source).toContain('class="startup-progress"');
    expect(source).toContain("正在准备解锁界面");
    expect(shellLoadIndex).toBeGreaterThan(mainWindowAssignedIndex);
    expect(shellLoadIndex).toBeLessThan(devLoadIndex);
    expect(shellLoadIndex).toBeLessThan(distLoadIndex);
  });

  it("should keep the main header compact", async () => {
    const css = normalizeNewlines(await readFile(path.join(process.cwd(), "src", "styles.css"), "utf8"));

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
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "src", "main.tsx"), "utf8"));

    expect(source).not.toContain('import("./UnlockApp');
    expect(source).toMatch(/import\("\.\/App(?:\.js)?"\)/);
    expect(source).not.toContain('window.location.hash.includes("/unlock")');
    expect(source).toContain('rootElement.innerHTML = createStartupShell("正在准备解锁界面...")');
    expect(source).toContain('class="startup-progress"');
    expect(source).toContain("正在准备解锁界面");
  });

  it("should lazy-load app pages and schedule Profiles page preload after the unlock gate renders", async () => {
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "src", "App.tsx"), "utf8"));

    expect(source).toContain("function preloadProfilesPageModule()");
    expect(source).toContain("function scheduleProfilesPagePreload()");
    expect(source).toContain('const LazyProfilesPage = lazy(() =>');
    expect(source).toContain('preloadProfilesPageModule().then((module) => ({ default: module.ProfilesPage }))');
    expect(source).toMatch(/import\("\.\/components\/app\/SessionsPage\.(?:tsx|jsx|js)"\)\.then/);
    expect(source).toMatch(/import\("\.\/components\/app\/SettingsPage\.(?:tsx|jsx|js)"\)\.then/);
    expect(source).toMatch(/import\("\.\/components\/skills\/SkillsPanel\.(?:tsx|jsx|js)"\)\.then/);
    expect(source).toContain('if (startupPhase !== "locked")');
    expect(source).toContain("return scheduleProfilesPagePreload();");
    expect(source).not.toContain("\nvoid preloadProfilesPageModule();\nconst LazyProfilesPage");
    expect(source).not.toContain("await preloadProfilesPageModule();");
    expect(source).not.toContain('import { SessionsPage } from "./components/app/SessionsPage');
    expect(source).not.toContain('import { SettingsPage } from "./components/app/SettingsPage');
    expect(source).not.toContain('import { SkillsPanel } from "./components/skills/SkillsPanel');
    expect(source).not.toContain('import { ProfilesPage } from "./components/app/ProfilesPage');
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
    expect(source).not.toContain("void ensureSkillsServiceReady();");
    expect(source).not.toContain("await initSkillsService();");
  });

  it("should start profile storage warmup after IPC registration without blocking window creation", async () => {
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"));
    const readyBlockStart = source.indexOf("app.whenReady().then(async () => {");
    const readyBlockEnd = source.indexOf('app.on("activate"', readyBlockStart);
    const readyBlock = source.slice(readyBlockStart, readyBlockEnd);
    const registerIpcIndex = readyBlock.indexOf("registerAllIpcHandlers();");
    const warmupIndex = readyBlock.indexOf("warmProfileStoresInBackground();");
    const createWindowIndex = readyBlock.indexOf("await createMainWindow();");

    expect(readyBlock).not.toContain("await initProfileServices();");
    expect(readyBlock).not.toContain("await ensureProfileStoresReady();");
    expect(warmupIndex).toBeGreaterThan(registerIpcIndex);
    expect(warmupIndex).toBeLessThan(createWindowIndex);
  });

  it("should expose a dedicated bootstrap API for unlock-time hydration", async () => {
    const preloadSource = await readFile(path.join(process.cwd(), "electron", "preload.ts"), "utf8");
    const mainSource = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");

    expect(preloadSource).toContain("bootstrap: (): Promise<unknown>");
    expect(preloadSource).toContain('ipcRenderer.invoke("profile:bootstrap")');
    expect(mainSource).toContain('handleIpc("profile:bootstrap"');
  });
});
