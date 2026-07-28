import { randomUUID } from "node:crypto";
import type {
  TerminalSessionActivityEvent,
  TerminalSessionSnapshot,
  TerminalSessionSubscriber,
} from "../electron/terminal-session-manager.js";
import { cleanTerminalText } from "./protocol.js";
import {
  AgentBridgeRequestError,
  DEFAULT_AGENT_WAIT_MS,
  type AgentBridgeError,
  type AgentProfileSummary,
  type AgentTaskResponse,
  type AgentTaskStatus,
} from "./types.js";

export interface AgentTaskLaunchOptions {
  profileKey: string;
  cwd?: string;
  showTerminal: boolean;
  initialPrompt: string;
}

export interface AgentTaskLaunchResult {
  terminalSessionId: string;
  provider: "claude" | "codex";
  initialPromptSubmitted?: boolean;
}

export interface AgentTaskTerminalAdapter {
  launch: (options: AgentTaskLaunchOptions) => Promise<AgentTaskLaunchResult>;
  attach: (terminalSessionId: string, subscriber: TerminalSessionSubscriber) => () => void;
  sendInput: (terminalSessionId: string, data: string) => void;
  close: (terminalSessionId: string, reason: string) => Promise<void>;
  getSnapshot: (terminalSessionId: string) => TerminalSessionSnapshot | undefined;
}

export interface AgentTaskManagerDependencies {
  terminal: AgentTaskTerminalAdapter;
  listProfiles: () => AgentProfileSummary[];
  isProfileBlocked: (profileKey: string) => boolean;
  getConcurrencyLimit: () => number;
  readLastAssistantText: (sessionFile: string) => Promise<string>;
  now?: () => number;
}

interface AgentTaskRecord {
  sessionId: string;
  terminalSessionId: string;
  provider: "claude" | "codex";
  profileKey: string;
  status: AgentTaskStatus;
  assistantText: string;
  question: string | null;
  terminalOutput: string;
  error: AgentBridgeError | null;
  providerSessionId?: string;
  sessionFile?: string;
  disposeTerminal: () => void;
  waiters: Set<() => void>;
  pendingInitialInput: AgentTaskInput | null;
  startupQuietTimer?: ReturnType<typeof setTimeout>;
  startupDeadlineTimer?: ReturnType<typeof setTimeout>;
  pendingSubmitTimer?: ReturnType<typeof setTimeout>;
  turnNumber: number;
  completedTurnNumber: number;
  updatedAt: number;
}

const MAX_TERMINAL_OUTPUT_CHARS = 64_000;
const MAX_TERMINAL_TAIL_CHARS = 8_000;
const STARTUP_INPUT_QUIET_MS = 1_000;
const STARTUP_READY_TIMEOUT_MS = 60_000;
const PASTED_INPUT_SUBMIT_DELAY_MS = 25;
const CLI_READY_PROMPT_PATTERN = /(?:^|\n)\s*[›❯]\s+[^\n]*(?:\n|$)/;
const INTERACTIVE_PROMPT_PATTERN =
  /(?:do you want to proceed|would you like to|allow (?:this|once|always)|approve (?:this|once|always)|enter to confirm|press enter|continue\?|proceed\?|\(y\/n\)|\[y\/n\]|是否(?:允许|继续|确认)|需要(?:授权|确认)|请选择)/i;

interface AgentTaskInput {
  data: string;
  submitSeparately: boolean;
}

function normalizeInput(prompt: string): AgentTaskInput {
  const normalized = prompt
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return normalized.includes("\n")
    ? { data: "\x1b[200~" + normalized + "\x1b[201~", submitSeparately: true }
    : { data: normalized, submitSeparately: true };
}

function occupiedStatus(status: AgentTaskStatus): boolean {
  return status === "starting" || status === "running" || status === "awaiting_input";
}

function waitingStatus(status: AgentTaskStatus): boolean {
  return status === "starting" || status === "running";
}

export class AgentTaskManager {
  private readonly tasks = new Map<string, AgentTaskRecord>();
  private readonly terminalToTask = new Map<string, string>();
  private readonly now: () => number;
  private pendingLaunches = 0;

  constructor(private readonly dependencies: AgentTaskManagerDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
  }

  listProfiles(): { profiles: AgentProfileSummary[]; capacity: { running: number; limit: number } } {
    return {
      profiles: this.dependencies.listProfiles().filter(
        (profile) => !this.dependencies.isProfileBlocked(profile.profile_key),
      ),
      capacity: {
        running: this.countRunningTasks(),
        limit: this.getConcurrencyLimit(),
      },
    };
  }

  async run(options: {
    profileKey: string;
    prompt: string;
    cwd?: string;
    waitMs?: number;
    showTerminal?: boolean;
  }): Promise<AgentTaskResponse> {
    if (this.dependencies.isProfileBlocked(options.profileKey)) {
      throw new AgentBridgeRequestError("profile_blocked", "该 Profile 已被代理接口黑名单禁用。");
    }
    const profile = this.dependencies.listProfiles().find(
      (candidate) => candidate.profile_key === options.profileKey,
    );
    if (!profile) {
      throw new AgentBridgeRequestError("profile_not_found", "Profile 不存在或不可用于代理调用。");
    }
    if (this.countRunningTasks() >= this.getConcurrencyLimit()) {
      throw new AgentBridgeRequestError("capacity_exceeded", "代理任务已达到并发上限。", true);
    }

    let launched: AgentTaskLaunchResult;
    this.pendingLaunches += 1;
    try {
      launched = await this.dependencies.terminal.launch({
        profileKey: options.profileKey,
        cwd: options.cwd,
        showTerminal: options.showTerminal === true,
        initialPrompt: options.prompt,
      });
    } catch (error) {
      if (error instanceof AgentBridgeRequestError) {
        throw error;
      }
      throw new AgentBridgeRequestError(
        "launch_failed",
        error instanceof Error ? error.message : "启动受监控终端失败。",
      );
    } finally {
      this.pendingLaunches -= 1;
    }

    const sessionId = randomUUID();
    const pendingInitialInput = launched.initialPromptSubmitted
      ? null
      : normalizeInput(options.prompt);
    const task: AgentTaskRecord = {
      sessionId,
      terminalSessionId: launched.terminalSessionId,
      provider: launched.provider,
      profileKey: options.profileKey,
      status: pendingInitialInput ? "starting" : "running",
      assistantText: "",
      question: null,
      terminalOutput: "",
      error: null,
      disposeTerminal: () => undefined,
      waiters: new Set(),
      pendingInitialInput,
      turnNumber: 1,
      completedTurnNumber: 0,
      updatedAt: this.now(),
    };
    this.tasks.set(sessionId, task);
    this.terminalToTask.set(task.terminalSessionId, sessionId);
    task.disposeTerminal = this.dependencies.terminal.attach(task.terminalSessionId, {
      onOutput: (chunk) => this.handleOutput(task, chunk),
      onStatus: (snapshot) => this.handleTerminalStatus(task, snapshot),
    });
    if (pendingInitialInput) {
      task.startupDeadlineTimer = setTimeout(
        () => this.failStartup(task),
        STARTUP_READY_TIMEOUT_MS,
      );
      this.scheduleInitialInput(task);
    }
    this.notify(task);
    return this.waitForTask(task, options.waitMs);
  }

  async continue(
    sessionId: string,
    prompt: string,
    waitMs?: number,
  ): Promise<AgentTaskResponse> {
    const task = this.requireTask(sessionId);
    if (this.dependencies.isProfileBlocked(task.profileKey)) {
      throw new AgentBridgeRequestError("profile_blocked", "该 Profile 已被代理接口黑名单禁用。");
    }
    const snapshot = this.dependencies.terminal.getSnapshot(task.terminalSessionId);
    if (!snapshot || snapshot.status !== "running") {
      throw new AgentBridgeRequestError("session_not_running", "代理会话已停止，无法继续。");
    }
    if (waitingStatus(task.status)) {
      throw new AgentBridgeRequestError("session_busy", "代理会话仍在处理上一轮输入。", true);
    }
    if (!occupiedStatus(task.status) && this.countRunningTasks() >= this.getConcurrencyLimit()) {
      throw new AgentBridgeRequestError("capacity_exceeded", "代理任务已达到并发上限。", true);
    }
    task.turnNumber += 1;
    task.status = "running";
    task.assistantText = "";
    task.question = null;
    task.terminalOutput = "";
    task.error = null;
    task.updatedAt = this.now();
    this.sendTaskInput(task, normalizeInput(prompt));
    this.notify(task);
    return this.waitForTask(task, waitMs);
  }

  status(sessionId: string): AgentTaskResponse {
    return this.toResponse(this.requireTask(sessionId));
  }

  async wait(sessionId: string, waitMs?: number): Promise<AgentTaskResponse> {
    return this.waitForTask(this.requireTask(sessionId), waitMs);
  }

  async cancel(sessionId: string): Promise<AgentTaskResponse> {
    const task = this.requireTask(sessionId);
    if (task.status !== "cancelled") {
      this.clearStartupTimers(task);
      task.pendingInitialInput = null;
      task.status = "cancelled";
      task.question = null;
      task.updatedAt = this.now();
      await this.dependencies.terminal.close(task.terminalSessionId, "agent_cancelled");
      task.disposeTerminal();
      this.terminalToTask.delete(task.terminalSessionId);
      this.notify(task);
    }
    return this.toResponse(task);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.tasks.values()].map(async (task) => {
      this.clearStartupTimers(task);
      task.pendingInitialInput = null;
      const snapshot = this.dependencies.terminal.getSnapshot(task.terminalSessionId);
      if (snapshot?.status === "running") {
        await this.dependencies.terminal.close(task.terminalSessionId, "agent_bridge_shutdown")
          .catch(() => undefined);
      }
      task.disposeTerminal();
      task.waiters.clear();
    }));
    this.terminalToTask.clear();
  }

  handleActivityChange(event: TerminalSessionActivityEvent): void {
    const task = this.findByTerminal(event.sessionId);
    if (!task) {
      return;
    }
    if (event.reason === "turn_started") {
      task.status = "running";
      task.question = null;
      task.updatedAt = this.now();
      this.notify(task);
      return;
    }
    if (event.reason === "turn_completed") {
      void this.completeTurn(task);
    }
  }

  associateProviderSession(
    terminalSessionId: string,
    providerSessionId: string,
    sessionFile: string,
  ): void {
    const task = this.findByTerminal(terminalSessionId);
    if (!task) {
      return;
    }
    task.providerSessionId = providerSessionId;
    task.sessionFile = sessionFile;
  }

  private async completeTurn(task: AgentTaskRecord): Promise<void> {
    const turnNumber = task.turnNumber;
    if (task.completedTurnNumber === turnNumber) {
      return;
    }
    let assistantText = "";
    if (task.sessionFile) {
      for (let attempt = 0; attempt < 5 && !assistantText; attempt += 1) {
        if (attempt > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        assistantText = await this.dependencies.readLastAssistantText(task.sessionFile)
          .catch(() => "");
      }
    }
    if (task.status === "cancelled" || task.turnNumber !== turnNumber) {
      return;
    }
    task.assistantText = assistantText;
    task.completedTurnNumber = turnNumber;
    task.status = "completed";
    task.question = null;
    task.updatedAt = this.now();
    this.notify(task);
  }

  private handleOutput(task: AgentTaskRecord, chunk: string): void {
    task.terminalOutput = (task.terminalOutput + chunk).slice(-MAX_TERMINAL_OUTPUT_CHARS);
    task.updatedAt = this.now();
    if (task.pendingInitialInput) {
      this.scheduleInitialInput(task);
      return;
    }
    if (!waitingStatus(task.status)) {
      return;
    }
    const visibleTail = cleanTerminalText(task.terminalOutput.slice(-4_000));
    if (INTERACTIVE_PROMPT_PATTERN.test(visibleTail)) {
      task.status = "awaiting_input";
      task.question = visibleTail.slice(-1_000);
      this.notify(task);
    }
  }

  private handleTerminalStatus(task: AgentTaskRecord, snapshot: TerminalSessionSnapshot): void {
    if (snapshot.status === "running" || task.status === "cancelled") {
      return;
    }
    this.clearStartupTimers(task);
    task.pendingInitialInput = null;
    if (task.status !== "completed" && task.status !== "failed") {
      task.status = "failed";
      task.error = {
        code: "process_exited",
        message: snapshot.exitCode === undefined
          ? "代理 CLI 进程已退出。"
          : "代理 CLI 进程已退出，代码 " + snapshot.exitCode + "。",
        retryable: false,
      };
    }
    task.disposeTerminal();
    this.terminalToTask.delete(task.terminalSessionId);
    task.updatedAt = this.now();
    this.notify(task);
  }

  private scheduleInitialInput(task: AgentTaskRecord): void {
    if (!task.pendingInitialInput || task.status !== "starting") {
      return;
    }
    if (task.startupQuietTimer) {
      clearTimeout(task.startupQuietTimer);
      task.startupQuietTimer = undefined;
    }
    const visibleTail = cleanTerminalText(task.terminalOutput.slice(-8_000));
    if (!CLI_READY_PROMPT_PATTERN.test(visibleTail)) {
      return;
    }
    task.startupQuietTimer = setTimeout(
      () => this.flushInitialInput(task),
      STARTUP_INPUT_QUIET_MS,
    );
  }

  private flushInitialInput(task: AgentTaskRecord): void {
    task.startupQuietTimer = undefined;
    const input = task.pendingInitialInput;
    const snapshot = this.dependencies.terminal.getSnapshot(task.terminalSessionId);
    if (!input || task.status !== "starting" || snapshot?.status !== "running") {
      return;
    }
    task.pendingInitialInput = null;
    this.clearStartupTimers(task);
    task.status = "running";
    task.question = null;
    task.terminalOutput = "";
    task.updatedAt = this.now();
    this.sendTaskInput(task, input);
    this.notify(task);
  }

  private sendTaskInput(task: AgentTaskRecord, input: AgentTaskInput): void {
    this.dependencies.terminal.sendInput(task.terminalSessionId, input.data);
    if (!input.submitSeparately) {
      return;
    }
    task.pendingSubmitTimer = setTimeout(() => {
      task.pendingSubmitTimer = undefined;
      const snapshot = this.dependencies.terminal.getSnapshot(task.terminalSessionId);
      if (task.status === "running" && snapshot?.status === "running") {
        this.dependencies.terminal.sendInput(task.terminalSessionId, "\r");
      }
    }, PASTED_INPUT_SUBMIT_DELAY_MS);
  }

  private failStartup(task: AgentTaskRecord): void {
    task.startupDeadlineTimer = undefined;
    if (!task.pendingInitialInput || task.status !== "starting") {
      return;
    }
    task.pendingInitialInput = null;
    this.clearStartupTimers(task);
    task.status = "failed";
    task.error = {
      code: "cli_not_ready",
      message: "代理 CLI 在 60 秒内未进入可输入状态。",
      retryable: true,
    };
    task.updatedAt = this.now();
    this.notify(task);
    void this.dependencies.terminal.close(task.terminalSessionId, "agent_cli_not_ready")
      .catch(() => undefined);
  }

  private clearStartupTimers(task: AgentTaskRecord): void {
    if (task.startupQuietTimer) {
      clearTimeout(task.startupQuietTimer);
      task.startupQuietTimer = undefined;
    }
    if (task.startupDeadlineTimer) {
      clearTimeout(task.startupDeadlineTimer);
      task.startupDeadlineTimer = undefined;
    }
    if (task.pendingSubmitTimer) {
      clearTimeout(task.pendingSubmitTimer);
      task.pendingSubmitTimer = undefined;
    }
  }

  private waitForTask(task: AgentTaskRecord, waitMs = DEFAULT_AGENT_WAIT_MS): Promise<AgentTaskResponse> {
    if (!waitingStatus(task.status) || waitMs <= 0) {
      return Promise.resolve(this.toResponse(task));
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled || waitingStatus(task.status)) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        task.waiters.delete(finish);
        resolve(this.toResponse(task));
      };
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        task.waiters.delete(finish);
        resolve(this.toResponse(task));
      }, waitMs);
      task.waiters.add(finish);
      finish();
    });
  }

  private notify(task: AgentTaskRecord): void {
    for (const waiter of [...task.waiters]) {
      waiter();
    }
  }

  private toResponse(task: AgentTaskRecord): AgentTaskResponse {
    return {
      ok: task.status !== "failed",
      status: task.status,
      session_id: task.sessionId,
      provider: task.provider,
      profile_key: task.profileKey,
      assistant_text: task.assistantText,
      question: task.question,
      terminal_tail: cleanTerminalText(task.terminalOutput).slice(-MAX_TERMINAL_TAIL_CHARS),
      error: task.error,
    };
  }

  private findByTerminal(terminalSessionId: string): AgentTaskRecord | undefined {
    const sessionId = this.terminalToTask.get(terminalSessionId);
    return sessionId ? this.tasks.get(sessionId) : undefined;
  }

  private requireTask(sessionId: string): AgentTaskRecord {
    const task = this.tasks.get(sessionId);
    if (!task) {
      throw new AgentBridgeRequestError("session_not_found", "代理会话不存在。");
    }
    return task;
  }

  private countRunningTasks(): number {
    return this.pendingLaunches
      + [...this.tasks.values()].filter((task) => occupiedStatus(task.status)).length;
  }

  private getConcurrencyLimit(): number {
    return Math.max(1, Math.min(32, Math.floor(this.dependencies.getConcurrencyLimit()) || 4));
  }
}
