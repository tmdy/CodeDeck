import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createWriteStream, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getHeapStatistics } from "node:v8";

const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}
const label = option("--label", "current");
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error("Invalid benchmark label");
const buildRoot = path.join(root, "release", "performance-audit", label);
const output = path.resolve(option("--output", path.join(buildRoot, "electron.json")));
const sampleMs = Number(option("--sample-ms", "5000"));
const idleMs = Number(option("--idle-ms", "10000"));
const churnCount = Number(option("--churn", "20"));
if (!(sampleMs >= 1000 && sampleMs <= 60000 && idleMs >= 0 && idleMs <= 43200000
  && Number.isInteger(churnCount) && churnCount >= 0 && churnCount <= 500)) throw new Error("Invalid scenario bounds");

if (!process.versions.electron) {
  await mkdir(buildRoot, { recursive: true });
  await mkdir(path.dirname(output), { recursive: true });
  if (!args.includes("--reuse-build")) {
    execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", path.join(root, "tsconfig.node.json"), "--outDir", path.join(buildRoot, "dist-electron")], { cwd: root, stdio: "inherit", windowsHide: true });
    execFileSync(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build", "--config", path.join(root, "scripts/performance/vite.config.ts"), "--outDir", path.join(buildRoot, "dist")], { cwd: root, stdio: "inherit", windowsHide: true });
    await writeFile(path.join(buildRoot, "package.json"), JSON.stringify({ type: "module", name: "codedeck-performance-audit" }));
    const mainFile = path.join(buildRoot, "dist-electron/electron/main.js");
    const facade = `\nexport const performanceAudit = {
      terminalSessionManager, createTerminalWindow, ensureNodePtyLoaded, scheduleTerminalTitleResolution,
      get mainWindow() { return mainWindow; },
      flushLog: () => appLogger.flush(),
      resources: () => ({
        sessions: terminalSessionManager.sessions.size,
        bufferedChars: [...terminalSessionManager.sessions.values()].reduce((n, s) => n + (s.outputBuffer?.length ?? s.snapshot.output.length), 0),
        subscribers: [...terminalSessionManager.sessions.values()].reduce((n, s) => n + s.subscribers.size, 0),
        windows: terminalWindows.size, attachments: terminalAttachmentDisposers.size,
        titleTimers: terminalTitlePollTimers.size, lifecycleWatchers: terminalLifecycleWatchers.size,
        identityBindings: codexTerminalBindings.size,
        identitySources: [...codexTerminalBindings.values()].reduce((n, b) => n + b.resolver.sources.size, 0)
      })
    };\n`;
    await writeFile(path.join(buildRoot, "dist-electron/electron/main.perf.js"), (await readFile(mainFile, "utf8")) + facade);
    const sourceHashes = {};
    for (const file of ["electron/main.ts", "src/TerminalApp.tsx", "src/shared/electron/terminal-session-manager.ts", "src/shared/electron/terminal-activity.ts", "src/shared/electron/session-list-cache.ts"]) {
      sourceHashes[file] = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
    }
    await writeFile(path.join(buildRoot, "build-evidence.json"), JSON.stringify({ builtAt: new Date().toISOString(), sourceHashes }, null, 2));
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "codedeck-electron-perf-"));
  const isolatedHome = path.join(temporary, "home");
  const workspace = path.join(temporary, "workspace");
  await mkdir(isolatedHome, { recursive: true });
  await mkdir(workspace, { recursive: true });
  // The portable-workspace file precedes the env override in the actual startup resolver.
  await writeFile(path.join(buildRoot, "CodeDeck.project-root.txt"), workspace);
  await mkdir(path.join(buildRoot, "build"), { recursive: true });
  await copyFile(path.join(root, "build/icon.png"), path.join(buildRoot, "build/icon.png"));
  const instrumentedMain = path.join(buildRoot, "dist-electron/electron/main.perf.js");
  const instrumentedCode = await readFile(instrumentedMain, "utf8");
  if (!instrumentedCode.includes("get workspaceRoot()")) {
    await writeFile(instrumentedMain, instrumentedCode.replace("get mainWindow()", "get workspaceRoot() { return projectRoot; }, get mainWindow()"));
  }
  const env = { ...process.env, USERPROFILE: isolatedHome, CODEDECK_PROJECT_ROOT: workspace,
    CLAUDE_CONFIG_DIR: path.join(isolatedHome, ".claude"), CODEX_HOME: path.join(isolatedHome, ".codex"),
    CODEDECK_PERF_TEMP: temporary, CODEDECK_PERF_FIXTURE: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const electron = createRequire(import.meta.url)("electron");
  const child = spawn(electron, [`--user-data-dir=${path.join(temporary, "userData")}`, script,
    "--label", label, "--output", output, "--sample-ms", String(sampleMs), "--idle-ms", String(idleMs),
    "--churn", String(churnCount), "--node-path", process.execPath], {
    cwd: buildRoot, env, stdio: ["inherit", "inherit", "pipe"], windowsHide: true,
  });
  const stderrPath = `${output}.stderr.log`;
  const stderrSaved = pipeline(child.stderr, createWriteStream(stderrPath));
  const sampler = spawn("pwsh", ["-NoProfile", "-File", path.join(root, "scripts/performance/measure-process-tree.ps1"),
    "-RootProcessId", String(child.pid), "-DurationSeconds", String(Math.ceil(120 + churnCount * 2 + idleMs / 1000 + sampleMs * 13 / 1000)),
    "-OutputPath", `${output}.processes.json`], { cwd: root, stdio: "inherit", windowsHide: true });
  const sampled = new Promise((resolve, reject) => { sampler.once("error", reject); sampler.once("exit", resolve); });
  const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  await stderrSaved;
  await sampled;
  if (exitCode !== 0) throw new Error(`Electron benchmark exited ${exitCode}; stderr: ${stderrPath}; isolated evidence: ${temporary}`);
  const report = JSON.parse(await readFile(output, "utf8"));
  if (report.partial) throw new Error(`Incomplete Electron benchmark: ${output}; stderr: ${stderrPath}`);
  const stderr = await readFile(stderrPath, "utf8");
  const diagnostics = { stderrPath, stderrBytes: Buffer.byteLength(stderr), attachConsoleFailures: (stderr.match(/AttachConsole failed/g) ?? []).length };
  await writeFile(output, JSON.stringify({ ...report, diagnostics }, null, 2));
  console.log(JSON.stringify({ output, buildRoot, isolatedWorkspace: temporary, diagnostics }));
} else {
  const { app, BrowserWindow, ipcMain, session } = createRequire(import.meta.url)("electron");
  const temporary = process.env.CODEDECK_PERF_TEMP;
  if (!temporary || path.resolve(os.homedir()) !== path.join(temporary, "home")) throw new Error("Home isolation failed");
  mkdirSync(path.join(temporary, "userData"), { recursive: true });
  mkdirSync(path.join(temporary, "home", "Downloads"), { recursive: true });
  app.setPath("userData", path.join(temporary, "userData"));
  app.setPath("downloads", path.join(temporary, "home", "Downloads"));
  app.commandLine.appendSwitch("enable-precise-memory-info");
  // Electron emits ready only after its ESM entry module has finished evaluating.
  void runElectronBenchmark().catch((error) => { console.error(error); process.exit(1); });
  async function runElectronBenchmark() {
  console.log(`performance main PID: ${process.pid}`);
  const ipc = { statusEvents: 0, statusChars: 0, outputEvents: 0, outputChars: 0, resizeCalls: 0 };
  const handlers = new Map();
  const register = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, callback) => {
    handlers.set(channel, callback);
    register(channel, (event, ...values) => {
      if (channel === "terminal:resize") ipc.resizeCalls += 1;
      return callback(event, ...values);
    });
  };
  app.on("web-contents-created", (_event, contents) => {
    const send = contents.send.bind(contents);
    contents.send = (channel, ...values) => {
      if (channel === "terminal:status") {
        ipc.statusEvents += 1;
        ipc.statusChars += (values[0].output?.length ?? 0) + JSON.stringify({ ...values[0], output: "" }).length;
      }
      if (channel === "terminal:output") { ipc.outputEvents += 1; ipc.outputChars += values[1].length; }
      return send(channel, ...values);
    };
  });
  const stages = [];
  const operations = [];
  const startup = performance.now();
  let audit;
  let blockedNetworkRequests = 0;
  // Only fixture data is used; no remote HTTP request is needed for any scenario.
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => {
    blockedNetworkRequests += 1; callback({ cancel: true });
  });
  const waitFor = async (check, description, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await check()) return; await delay(50); }
    throw new Error(`Timed out: ${description}`);
  };
  const rendererState = async (window) => window.webContents.executeJavaScript(`(() => {
    const observed = window.__codedeckPerf;
    const buffer = observed?.terminal.buffer.active;
    return { domNodes: document.getElementsByTagName('*').length, visibilityState: document.visibilityState,
      heapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      bufferLines: buffer?.length ?? null, fitCalls: observed?.fits ?? null,
      outputComplete: buffer ? Array.from({length: Math.min(8, buffer.length)}, (_, i) => buffer.getLine(buffer.length - 1 - i)?.translateToString()).join('\\n').includes('PERF_DONE 中文') : null };
  })()`, true);
  async function capture(name, duration = sampleMs, workload) {
    console.log(`performance stage: ${name}`);
    const cpuBefore = process.cpuUsage();
    const ipcBefore = { ...ipc };
    const start = performance.now();
    const startedAt = new Date().toISOString();
    app.getAppMetrics();
    if (workload) await workload();
    await delay(Math.max(0, duration - (performance.now() - start)));
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuBefore);
    const metrics = app.getAppMetrics();
    const renderers = [];
    for (const window of BrowserWindow.getAllWindows()) {
      renderers.push({ id: window.id, pid: window.webContents.getOSProcessId(), visible: window.isVisible(), minimized: window.isMinimized(), ...(await rendererState(window)) });
    }
    stages.push({ name, startedAt, elapsedMs, mainCpuMs: (cpu.user + cpu.system) / 1000,
      mainCpuOneCorePercent: ((cpu.user + cpu.system) / 1000) / elapsedMs * 100,
      metrics, mainMemory: await process.getProcessMemoryInfo(), mainHeap: process.memoryUsage(),
      mainHeapStatistics: getHeapStatistics(), resources: audit.resources(),
      activeResources: process.getActiveResourcesInfo(),
      ipcDelta: Object.fromEntries(Object.keys(ipc).map((key) => [key, ipc[key] - ipcBefore[key]])),
      renderers,
    });
    await writeFile(output, JSON.stringify({ schemaVersion: 1, partial: true, stages, operations }, null, 2));
  }
  async function openTerminal() {
    const start = performance.now();
    const startedAt = new Date();
    const id = randomUUID();
    const home = process.env.CODEX_HOME;
    const snapshot = await audit.terminalSessionManager.createSession({
      provider: "codex", cwd: process.env.CODEDECK_PROJECT_ROOT, commandExecutable: option("--node-path", "node.exe"),
      commandArgs: [path.join(root, "scripts/performance/pty-fixture.mjs"), home, id],
      env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
      autoContinue: { enabled: false, limit: 1, prompt: "continue", keywords: [] },
    });
    audit.scheduleTerminalTitleResolution(snapshot, { env: { CODEX_HOME: home }, sessionId: id }, startedAt);
    const window = await audit.createTerminalWindow(snapshot);
    await waitFor(async () => (await rendererState(window)).bufferLines !== null, "xterm ready");
    await waitFor(() => audit.terminalSessionManager.getSnapshot(snapshot.sessionId)?.output.includes("PERF_READY"), "PTY ready");
    operations.push({ name: "openTerminal", elapsedMs: performance.now() - start });
    return { id: snapshot.sessionId, window };
  }
  try {
    await mkdir(path.dirname(output), { recursive: true });
    ({ performanceAudit: audit } = await import(pathToFileURL(path.join(buildRoot, "dist-electron/electron/main.perf.js")).href));
    await waitFor(() => audit.mainWindow && !audit.mainWindow.webContents.isLoading(), "main window loaded");
    if (path.resolve(audit.workspaceRoot) !== path.resolve(process.env.CODEDECK_PROJECT_ROOT)) throw new Error("Workspace isolation failed");
    await waitFor(() => handlers.has("profile:initialize-without-passphrase"), "initialization IPC");
    operations.push({ name: "startupMainLoad", elapsedMs: performance.now() - startup });
    // Use the actual initialization service, then reload into its automatic-unlock path.
    await handlers.get("profile:initialize-without-passphrase")({ sender: audit.mainWindow.webContents });
    audit.mainWindow.reload();
    await delay(2000);
    await waitFor(() => !audit.mainWindow.webContents.isLoading(), "unlocked main load");
    await capture("startup_no_sessions");
    await capture("main_open_idle");
    audit.mainWindow.minimize();
    await capture("main_minimized");
    audit.mainWindow.hide();
    await capture("main_hidden");
    audit.mainWindow.show();
    audit.mainWindow.restore();
    await audit.ensureNodePtyLoaded();
    const terminals = [await openTerminal()];
    await capture("one_monitored_session");
    for (let index = 0; index < 3; index += 1) terminals.push(await openTerminal());
    await capture("four_monitored_sessions");
    await capture("continuous_output", sampleMs, async () => {
      for (const terminal of terminals) audit.terminalSessionManager.sendInput(terminal.id, "flood\r");
      await waitFor(async () => (await Promise.all(terminals.map((item) => rendererState(item.window)))).every((state) => state.outputComplete), "all xterm output drained", 60000);
    });
    await capture("switch_sessions", sampleMs, async () => {
      for (let round = 0; round < 5; round += 1) for (const terminal of terminals) { terminal.window.focus(); await delay(25); }
    });
    for (const terminal of terminals) audit.terminalSessionManager.sendInput(terminal.id, "exit\r");
    await waitFor(() => terminals.every((terminal) => audit.terminalSessionManager.getSnapshot(terminal.id)?.status === "exited"), "natural exits");
    await capture("exited_history_windows");
    for (const terminal of terminals) terminal.window.close();
    await capture("closed_history_windows");
    const churnStart = performance.now();
    for (let index = 0; index < churnCount; index += 1) {
      const terminal = await openTerminal();
      terminal.window.close();
      await delay(50);
    }
    operations.push({ name: "terminalChurn", count: churnCount, elapsedMs: performance.now() - churnStart });
    await capture("after_terminal_churn");
    audit.mainWindow.hide();
    const idleStart = performance.now();
    while (performance.now() - idleStart < idleMs) await delay(Math.min(1000, idleMs - (performance.now() - idleStart)));
    await capture("idle_recovery", sampleMs, async () => { audit.mainWindow.show(); audit.mainWindow.restore(); });
    await audit.flushLog();
    const report = {
      schemaVersion: 1, partial: false, measuredAt: new Date().toISOString(), electron: process.versions.electron,
      node: process.versions.node, rootPid: process.pid, logicalCpus: os.availableParallelism(),
      build: JSON.parse(await readFile(path.join(buildRoot, "build-evidence.json"), "utf8")),
      kind: "actual isolated CodeDeck main/preload/renderer and ConPTY; external CLIs are deterministic Node fixtures",
      memoryUnit: "Electron process memory fields are KiB; renderer heap fields are bytes",
      forcedGc: false, idleMs, blockedNetworkRequests, stages, operations,
      limitations: "No real Claude/Codex model request. Long-term behavior only covers idleMs. Electron getAppMetrics excludes external fixture processes; use measure-process-tree.ps1 separately. Native/renderer timer and listener totals are not available; activeResources is Node main only.",
    };
    await writeFile(output, JSON.stringify(report, null, 2));
  } catch (error) {
    await writeFile(output, JSON.stringify({ partial: true, error: String(error), stages, operations }, null, 2));
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.quit();
  }
  }
}
