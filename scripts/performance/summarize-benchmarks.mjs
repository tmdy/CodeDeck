import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback;
const directory = path.resolve(option("--directory", "release/performance-audit"));
const output = path.resolve(option("--output", path.join(directory, "summary.json")));
const read = async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"));
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, min: sorted[0], p50: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}
const counts = (items) => items.reduce((result, item) => { result[item] = (result[item] ?? 0) + 1; return result; }, {});
const sum = (items, key) => items.reduce((total, item) => total + (item[key] ?? 0), 0);

function core(data) {
  return {
    measuredAt: data.measuredAt, node: data.node, hashes: data.hashes, compiledBuild: data.compiledBuild ?? null,
    forcedGc: data.forcedGc, trials: data.trials.length,
    stream: { ...data.trials[0].stream.result,
      identicalOutput: data.trials.every((trial) => trial.stream.result.identicalOutput),
      elapsedMs: stats(data.trials.map((trial) => trial.stream.elapsedMs)),
      cpuMs: stats(data.trials.map((trial) => trial.stream.cpuMs)),
      sampledRssBytes: stats(data.trials.map((trial) => trial.stream.memoryAfter.rss)),
      sampledHeapUsedBytes: stats(data.trials.map((trial) => trial.stream.memoryAfter.heapUsed)) },
    churn: data.trials.map((trial) => ({ ...trial.churn.result, elapsedMs: trial.churn.elapsedMs,
      sampledHeapUsedBytes: trial.churn.memoryAfter.heapUsed, sampledRssBytes: trial.churn.memoryAfter.rss })),
    exitedHistory: data.trials.map((trial) => trial.exitedHistory.result),
    cache: data.trials.map((trial) => ({ ...trial.cache.result, elapsedMs: trial.cache.elapsedMs,
      sampledHeapUsedBytes: trial.cache.memoryAfter.heapUsed })),
    index: data.trials.map((trial) => trial.index.result),
  };
}

function processGroups(stage, samples) {
  const start = Date.parse(stage.startedAt);
  const end = start + stage.elapsedMs;
  const frames = new Map();
  for (const sample of samples) {
    const time = Date.parse(sample.timestampUtc);
    if (time < start || time >= end) continue;
    const frame = frames.get(sample.elapsedSeconds) ?? [];
    frame.push(sample);
    frames.set(sample.elapsedSeconds, frame);
  }
  return Object.fromEntries(["codedeck", "external", "pty_support"].map((group) => {
    const framesForGroup = [...frames.values()].map((frame) => frame.filter((process) => process.group === group));
    return [group, {
      sampledFrames: frames.size, maxProcesses: Math.max(0, ...framesForGroup.map((frame) => frame.length)),
      workingSetBytes: stats(framesForGroup.map((frame) => sum(frame, "workingSetBytes"))),
      privateCommitBytes: stats(framesForGroup.map((frame) => sum(frame, "privateCommitBytes"))),
      cpuOneCorePercent: stats(framesForGroup.filter((frame) => !frame.length || frame.some((p) => p.cpuOneCorePercent !== null))
        .map((frame) => sum(frame, "cpuOneCorePercent"))),
      readTransferBytes: sum(framesForGroup.flat(), "readTransferBytesDelta"),
      writeTransferBytes: sum(framesForGroup.flat(), "writeTransferBytesDelta"),
    }];
  }));
}

function electron(data, samples) {
  if (data.partial) throw new Error("Incomplete Electron evidence cannot be summarized as a successful run");
  return {
    measuredAt: data.measuredAt, electron: data.electron, node: data.node, logicalCpus: data.logicalCpus,
    build: data.build, idleMs: data.idleMs, forcedGc: data.forcedGc,
    blockedNetworkRequests: data.blockedNetworkRequests,
    diagnostics: data.diagnostics && { stderrBytes: data.diagnostics.stderrBytes, attachConsoleFailures: data.diagnostics.attachConsoleFailures },
    operations: { startupMainLoadMs: data.operations.find((operation) => operation.name === "startupMainLoad")?.elapsedMs,
      openTerminalMs: stats(data.operations.filter((operation) => operation.name === "openTerminal").map((operation) => operation.elapsedMs)),
      terminalChurn: data.operations.find((operation) => operation.name === "terminalChurn") },
    stages: data.stages.map((stage) => {
      const roles = {};
      for (const metric of stage.metrics) {
        const role = roles[metric.type] ??= { count: 0, workingSetKiB: 0, privateCommitKiB: 0 };
        role.count += 1;
        role.workingSetKiB += metric.memory.workingSetSize;
        role.privateCommitKiB += metric.memory.privateBytes ?? 0;
      }
      return {
        name: stage.name, elapsedMs: stage.elapsedMs, mainCpuMs: stage.mainCpuMs, mainCpuOneCorePercent: stage.mainCpuOneCorePercent,
        mainMemoryKiB: stage.mainMemory, mainHeapBytes: stage.mainHeap, mainHeapStatistics: stage.mainHeapStatistics,
        roles, applicationWorkingSetKiB: sum(Object.values(roles), "workingSetKiB"),
        applicationPrivateCommitKiB: sum(Object.values(roles), "privateCommitKiB"),
        resources: stage.resources, nodeResourceCounts: counts(stage.activeResources), ipc: stage.ipcDelta,
        renderers: stage.renderers.map(({ visible, minimized, visibilityState, heapUsedBytes, bufferLines, fitCalls, outputComplete }) =>
          ({ visible, minimized, visibilityState, heapUsedBytes, bufferLines, fitCalls, outputComplete })),
        processGroups: processGroups(stage, samples),
      };
    }),
  };
}

const names = (await readdir(directory)).sort();
const include = new Set(option("--include", "").split(",").map((name) => name.trim()).filter(Boolean));
const runs = {};
const paired = { before: [], after: [] };
for (const name of names) {
  if (include.size && !include.has(name)) continue;
  if (/^(before|after)(?:-final)?-(core|settled)\.json$/.test(name) || /^paired-\d+-(before|after)\.json$/.test(name)) {
    const data = await read(name);
    runs[name] = core(data);
    const pair = name.match(/^paired-\d+-(before|after)\.json$/);
    if (pair) paired[pair[1]].push(...data.trials.map((trial) => trial.stream));
  } else if (/^(before|after)(?:-final)?-electron(?:-[a-z0-9]+)?\.json$/.test(name)) {
    runs[name] = electron(await read(name), (await read(`${name}.processes.json`)).samples);
  }
}
const existing = names.includes("existing-data.json") ? await read("existing-data.json") : null;
const summary = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  notes: ["No forced GC. Logical retained characters and OS memory are separate metrics.",
    "Electron memory fields are KiB. CIM and V8 fields are bytes. Working set sums may duplicate shared pages.",
    "CIM transfer counters include pipe/network I/O; they are not disk-only measurements. One-second sampling can miss short-lived helpers.",
    "Browser=Main, Tab=Renderer, GPU/Utility=application auxiliary processes. External fixture CLIs and ConPTY support stay separate.",
    "Node active-resource counts include the benchmark's own timer and stdio. They do not count Chromium timers or all JS listeners.",
    ...(names.includes("after-final-electron.json")
      ? ["Intermediate after-electron runs precede the final native-worker cleanup correction. Use after-final-electron runs for acceptance."] : [])],
  pairedActiveStream: Object.fromEntries(Object.entries(paired).map(([label, trials]) => [label,
    { elapsedMs: stats(trials.map((trial) => trial.elapsedMs)), cpuMs: stats(trials.map((trial) => trial.cpuMs)),
      identicalOutput: trials.length > 0 && trials.every((trial) => trial.result.identicalOutput) }])),
  existingReadOnly: existing && { measuredAt: existing.measuredAt, indexBytes: existing.indexBytes,
    sessionList: existing.sessionList, historicalLogs: { bytes: existing.logs.bytes, records: existing.logs.records,
      firstTime: existing.logs.firstTime, lastTime: existing.logs.lastTime, autoContinueSkipped: existing.logs.events.auto_continue_skipped,
      timings: existing.logs.timings } },
  runs,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ output, runs: Object.keys(runs).length, pairedActiveStream: summary.pairedActiveStream }));
