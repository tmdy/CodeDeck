import { randomBytes, randomUUID } from "node:crypto";
import type {
  TerminalSessionActivityEvent,
  TerminalSessionSnapshot,
  TerminalSessionSubscriber,
} from "../electron/terminal-session-manager.js";
import {
  containsBusyTerminalOutput,
  containsInteractiveTerminalPrompt,
} from "../electron/terminal-activity.js";
import { cleanTerminalText } from "./protocol.js";
import {
  normalizeClaudeReasoningEffort,
  normalizeCodexReasoningEffort,
} from "../profile/types.js";
import {
  AgentBridgeRequestError,
  DEFAULT_AGENT_WAIT_MS,
  type AgentBridgeError,
  type AgentProfileSummary,
  type AgentTaskResponse,
  type AgentTaskStatus,
  type AgentDeliveryStatus,
  type AgentReturnPolicy,
} from "./types.js";

export interface AgentTaskLaunchOptions {
  profileKey: string;
  cwd?: string;
  showTerminal: boolean;
  initialPrompt: string;
  orchestrator: boolean;
  model?: string;
  reasoningEffort?: string;
  childTaskId: string;
  callbackToken?: string;
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
  verifyParentContext: (terminalSessionId: string, token: string) => boolean;
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
  completingTurnNumber?: number;
  interruptedTurnNumber?: number;
  busyTurnNumber?: number;
  interactiveResponseTurnNumber?: number;
  updatedAt: number;
  parentSessionId: string | null;
  returnPolicy: AgentReturnPolicy;
  deliveryStatus: AgentDeliveryStatus;
  deliveryError: string | null;
  deliveredTurnNumber: number;
  pendingDeliveries: AgentPendingDelivery[];
  deliverySubmitTimer?: ReturnType<typeof setTimeout>;
  callbackToken?: string;
  orchestrator: boolean;
}

interface AgentPendingDelivery {
  turnNumber: number;
  assistantText: string;
}

const MAX_TERMINAL_OUTPUT_CHARS = 256_000;
const MAX_TERMINAL_TAIL_CHARS = 8_000;
const STARTUP_INPUT_QUIET_MS = 1_000;
const STARTUP_READY_TIMEOUT_MS = 60_000;
const PASTED_INPUT_SUBMIT_DELAY_MS = 250;
const MAX_DELIVERY_PROMPT_CHARS = 64_000;
const CLI_READY_PROMPT_PATTERN = /(?:^|\n)\s*[›❯]\s+[^\n]*(?:\n|$)/;
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
  private readonly callbackTokens = new Map<string, string>();
  private readonly launchingChildByParent = new Set<string>();
  private readonly activeDeliveryByParent = new Map<
    string,
    { sessionId: string; turnNumber: number; submitted: boolean }
  >();
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
    orchestrator?: boolean;
    model?: string;
    reasoningEffort?: string;
    parentSessionId?: string;
    parentToken?: string;
    returnPolicy?: AgentReturnPolicy;
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
    const reasoningEffort = this.validateReasoningEffort(profile.provider, options.reasoningEffort);
    const parentSessionId = options.parentSessionId?.trim() || null;
    if (options.orchestrator && parentSessionId) {
      throw new AgentBridgeRequestError(
        "invalid_parent",
        "编排父会话不能再绑定上级终端。",
      );
    }
    const trackedParent = parentSessionId ? this.findByTerminal(parentSessionId) : undefined;
    if (
      parentSessionId
      && (
        (trackedParent !== undefined && !trackedParent.orchestrator)
        || !this.dependencies.terminal.verifyParentContext(
          parentSessionId,
          options.parentToken?.trim() ?? "",
        )
      )
    ) {
      throw new AgentBridgeRequestError("invalid_parent", "父终端身份无效或已停止。");
    }
    if (
      parentSessionId
      && trackedParent?.orchestrator
      && (
        this.launchingChildByParent.has(parentSessionId)
        || this.hasLiveBoundChild(parentSessionId)
      )
    ) {
      throw new AgentBridgeRequestError(
        "child_already_bound",
        "编排父会话已有一个存活的代理会话。",
        true,
      );
    }
    if (!parentSessionId && options.returnPolicy && options.returnPolicy !== "manual") {
      throw new AgentBridgeRequestError("invalid_parent", "自动回传策略必须绑定受监控父终端。");
    }
    const sessionId = randomUUID();
    const callbackToken = parentSessionId ? randomBytes(32).toString("base64url") : undefined;
    if (this.countRunningTasks() >= this.getConcurrencyLimit()) {
      throw new AgentBridgeRequestError("capacity_exceeded", "代理任务已达到并发上限。", true);
    }

    const reservedOrchestratorParent = parentSessionId && trackedParent?.orchestrator
      ? parentSessionId
      : null;
    if (reservedOrchestratorParent) {
      this.launchingChildByParent.add(reservedOrchestratorParent);
    }
    let launched: AgentTaskLaunchResult;
    this.pendingLaunches += 1;
    try {
      launched = await this.dependencies.terminal.launch({
        profileKey: options.profileKey,
        cwd: options.cwd,
        showTerminal: options.showTerminal === true,
        initialPrompt: options.prompt,
        orchestrator: options.orchestrator === true,
        ...(options.model?.trim() ? { model: options.model.trim() } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        childTaskId: sessionId,
        ...(callbackToken ? { callbackToken } : {}),
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
      if (reservedOrchestratorParent) {
        this.launchingChildByParent.delete(reservedOrchestratorParent);
      }
    }

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
      parentSessionId,
      returnPolicy: parentSessionId ? options.returnPolicy ?? "once" : "manual",
      deliveryStatus: "not_requested",
      deliveryError: null,
      deliveredTurnNumber: 0,
      pendingDeliveries: [],
      callbackToken,
      orchestrator: options.orchestrator === true,
    };
    this.tasks.set(sessionId, task);
    this.terminalToTask.set(task.terminalSessionId, sessionId);
    if (callbackToken) this.callbackTokens.set(callbackToken, sessionId);
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
    returnPolicy?: AgentReturnPolicy,
    parentSessionId?: string,
    parentToken?: string,
  ): Promise<AgentTaskResponse> {
    const task = this.requireTask(sessionId);
    if (this.dependencies.isProfileBlocked(task.profileKey)) {
      throw new AgentBridgeRequestError("profile_blocked", "该 Profile 已被代理接口黑名单禁用。");
    }
    if (
      task.parentSessionId
      && (
        task.parentSessionId !== parentSessionId
        || !this.dependencies.terminal.verifyParentContext(
          parentSessionId ?? "",
          parentToken?.trim() ?? "",
        )
      )
    ) {
      throw new AgentBridgeRequestError("unauthorized", "只能继续当前父终端创建的代理会话。");
    }
    const snapshot = this.dependencies.terminal.getSnapshot(task.terminalSessionId);
    if (!snapshot || snapshot.status !== "running") {
      throw new AgentBridgeRequestError("session_not_running", "代理会话已停止，无法继续。");
    }
    const acceptsUnobservedCodexTrustResponse = task.provider === "codex"
      && task.status === "running"
      && task.turnNumber === 1
      && task.completedTurnNumber === 0
      && !task.providerSessionId
      && !task.terminalOutput
      && task.busyTurnNumber !== task.turnNumber
      && snapshot.activity === "idle"
      && prompt.trim() === "1";
    if (waitingStatus(task.status) && !acceptsUnobservedCodexTrustResponse) {
      throw new AgentBridgeRequestError("session_busy", "代理会话仍在处理上一轮输入。", true);
    }
    if (returnPolicy) {
      this.setReturnPolicy(task, returnPolicy);
    }
    if (!occupiedStatus(task.status) && this.countRunningTasks() >= this.getConcurrencyLimit()) {
      throw new AgentBridgeRequestError("capacity_exceeded", "代理任务已达到并发上限。", true);
    }
    const resumesInteractivePrompt = task.status === "awaiting_input"
      || acceptsUnobservedCodexTrustResponse;
    if (!resumesInteractivePrompt) {
      task.turnNumber += 1;
    }
    task.status = "running";
    task.busyTurnNumber = undefined;
    task.interactiveResponseTurnNumber = resumesInteractivePrompt
      ? task.turnNumber
      : undefined;
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
      this.clearQueuedDeliveries(task);
      task.pendingInitialInput = null;
      task.status = "cancelled";
      task.question = null;
      task.updatedAt = this.now();
      await this.dependencies.terminal.close(task.terminalSessionId, "agent_cancelled");
      task.disposeTerminal();
      this.terminalToTask.delete(task.terminalSessionId);
      if (task.callbackToken) this.callbackTokens.delete(task.callbackToken);
      this.notify(task);
    }
    return this.toResponse(task);
  }

  interruptChild(
    sessionId: string,
    parentSessionId?: string,
    parentToken?: string,
  ): AgentTaskResponse {
    const task = this.requireTask(sessionId);
    if (task.parentSessionId && (
      task.parentSessionId !== parentSessionId
      || !this.dependencies.terminal.verifyParentContext(
        parentSessionId ?? "",
        parentToken?.trim() ?? "",
      )
    )) {
      throw new AgentBridgeRequestError("unauthorized", "只能中断当前父终端创建的代理会话。");
    }
    this.interruptTerminal(task.terminalSessionId, "代理会话当前没有可中断的运行轮次。");
    task.interruptedTurnNumber = task.turnNumber;
    task.updatedAt = this.now();
    this.notify(task);
    return this.toResponse(task);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.tasks.values()].map(async (task) => {
      this.clearStartupTimers(task);
      if (task.deliverySubmitTimer) {
        clearTimeout(task.deliverySubmitTimer);
        task.deliverySubmitTimer = undefined;
      }
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
    this.callbackTokens.clear();
    this.launchingChildByParent.clear();
    this.activeDeliveryByParent.clear();
  }

  scopedPolicy(token: string, returnPolicy?: AgentReturnPolicy): AgentTaskResponse {
    const task = this.requireScopedTask(token);
    if (returnPolicy) this.setReturnPolicy(task, returnPolicy);
    return this.toResponse(task);
  }

  scopedStatusParent(token: string): AgentTaskResponse {
    return this.toResponse(this.requireScopedParentTask(token));
  }

  async scopedContinueParent(token: string, prompt: string): Promise<AgentTaskResponse> {
    const parentTask = this.requireScopedParentTask(token);
    const snapshot = this.dependencies.terminal.getSnapshot(parentTask.terminalSessionId);
    if (!snapshot || snapshot.status !== "running") {
      throw new AgentBridgeRequestError("session_not_running", "父会话已停止，无法继续。", false);
    }
    if (snapshot.activity === "busy" || waitingStatus(parentTask.status)) {
      throw new AgentBridgeRequestError("session_busy", "父会话仍在处理上一轮输入。", true);
    }
    return this.continue(parentTask.sessionId, prompt, 0);
  }

  scopedInterruptParent(token: string): AgentTaskResponse {
    const task = this.requireScopedTask(token);
    if (!task.parentSessionId) {
      throw new AgentBridgeRequestError("invalid_parent", "该代理会话没有父终端绑定。");
    }
    this.interruptTerminal(task.parentSessionId, "父会话当前没有可中断的运行轮次。");
    const parentTask = this.findByTerminal(task.parentSessionId);
    if (parentTask) {
      parentTask.interruptedTurnNumber = parentTask.turnNumber;
      parentTask.updatedAt = this.now();
      this.notify(parentTask);
    }
    task.updatedAt = this.now();
    this.notify(task);
    return this.toResponse(task);
  }

  handleActivityChange(event: TerminalSessionActivityEvent): void {
    if (event.activity === "busy" && event.reason === "submitted_input") {
      this.finishEarlyDeliverySubmission(event.sessionId);
    }
    const completedActivity = event.activity === "idle"
      && (event.reason === "turn_completed" || event.reason === "idle_prompt");
    if (completedActivity) {
      const activeDelivery = this.activeDeliveryByParent.get(event.sessionId);
      if (!activeDelivery || activeDelivery.submitted) {
        this.activeDeliveryByParent.delete(event.sessionId);
        this.flushDeliveriesForParent(event.sessionId);
      }
    } else if (event.reason === "process_exit" || event.reason === "session_closed") {
      this.activeDeliveryByParent.delete(event.sessionId);
      this.failDeliveriesForParent(event.sessionId);
    }
    const task = this.findByTerminal(event.sessionId);
    if (!task) {
      return;
    }
    if (
      event.activity === "busy"
      && (
        event.reason === "submitted_input"
        || event.reason === "busy_output"
        || event.reason === "turn_started"
      )
    ) {
      if (
        event.reason === "submitted_input"
        && task.interactiveResponseTurnNumber === task.turnNumber
      ) {
        task.interactiveResponseTurnNumber = undefined;
        task.status = "running";
        task.question = null;
        task.updatedAt = this.now();
        this.notify(task);
        return;
      }
      const resumedFromPrompt = task.status === "awaiting_input";
      const startsNewTurn = task.status === "completed"
        || (
          task.status === "running"
          && task.completingTurnNumber === task.turnNumber
          && (event.reason === "submitted_input" || event.reason === "turn_started")
        );
      if (
        startsNewTurn
        && (event.reason === "submitted_input" || event.reason === "turn_started")
      ) {
        task.turnNumber += 1;
        task.assistantText = "";
        task.terminalOutput = "";
        task.error = null;
      }
      if (task.status === "completed" && event.reason === "busy_output") {
        return;
      }
      task.status = "running";
      task.busyTurnNumber = task.turnNumber;
      task.interactiveResponseTurnNumber = undefined;
      task.question = null;
      if (resumedFromPrompt) {
        task.terminalOutput = "";
      }
      task.updatedAt = this.now();
      this.notify(task);
      return;
    }
    if (
      event.reason === "turn_completed"
      || (
        event.reason === "idle_prompt"
        && task.status === "running"
        && (
          task.busyTurnNumber === task.turnNumber
          || task.interruptedTurnNumber === task.turnNumber
        )
      )
    ) {
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
    if (
      task.completedTurnNumber === turnNumber
      || task.completingTurnNumber === turnNumber
    ) {
      return;
    }
    task.completingTurnNumber = turnNumber;
    let assistantText = "";
    try {
      if (task.sessionFile && task.interruptedTurnNumber !== turnNumber) {
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
      if (task.interruptedTurnNumber === turnNumber) {
        task.interruptedTurnNumber = undefined;
      }
      task.updatedAt = this.now();
      this.notify(task);
      await this.scheduleDelivery(task, turnNumber);
    } finally {
      if (task.completingTurnNumber === turnNumber) {
        task.completingTurnNumber = undefined;
      }
    }
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
    const visibleTail = cleanTerminalText(task.terminalOutput).slice(-4_000);
    if (
      containsInteractiveTerminalPrompt(visibleTail)
      && !containsBusyTerminalOutput(visibleTail)
    ) {
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
    if (task.callbackToken) this.callbackTokens.delete(task.callbackToken);
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
    const visibleTail = cleanTerminalText(task.terminalOutput).slice(-8_000);
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
      parent_session_id: task.parentSessionId,
      return_policy: task.returnPolicy,
      delivery_status: task.deliveryStatus,
      delivery_error: task.deliveryError,
    };
  }

  private findByTerminal(terminalSessionId: string): AgentTaskRecord | undefined {
    const sessionId = this.terminalToTask.get(terminalSessionId);
    return sessionId ? this.tasks.get(sessionId) : undefined;
  }

  private hasLiveBoundChild(parentSessionId: string): boolean {
    return [...this.tasks.values()].some((task) =>
      task.parentSessionId === parentSessionId
      && this.dependencies.terminal.getSnapshot(task.terminalSessionId)?.status === "running");
  }

  private requireTask(sessionId: string): AgentTaskRecord {
    const task = this.tasks.get(sessionId);
    if (!task) {
      throw new AgentBridgeRequestError("session_not_found", "代理会话不存在。");
    }
    return task;
  }

  private requireScopedTask(token: string): AgentTaskRecord {
    const sessionId = this.callbackTokens.get(token);
    if (!sessionId) {
      throw new AgentBridgeRequestError("unauthorized", "作用域回传凭据无效或已过期。");
    }
    return this.requireTask(sessionId);
  }

  private requireScopedParentTask(token: string): AgentTaskRecord {
    const childTask = this.requireScopedTask(token);
    if (!childTask.parentSessionId) {
      throw new AgentBridgeRequestError("invalid_parent", "该代理会话没有父终端绑定。");
    }
    const parentTask = [...this.tasks.values()].find(
      (task) => task.terminalSessionId === childTask.parentSessionId,
    );
    if (!parentTask?.orchestrator) {
      throw new AgentBridgeRequestError(
        "invalid_parent",
        "绑定父终端不是可续接的编排会话。",
      );
    }
    return parentTask;
  }

  private interruptTerminal(terminalSessionId: string, idleMessage: string): void {
    const snapshot = this.dependencies.terminal.getSnapshot(terminalSessionId);
    if (!snapshot || snapshot.status !== "running") {
      throw new AgentBridgeRequestError("session_not_running", "目标会话已停止，无法中断。", false);
    }
    if (snapshot.activity !== "busy") {
      throw new AgentBridgeRequestError("session_idle", idleMessage, false);
    }
    this.dependencies.terminal.sendInput(terminalSessionId, "\x1b");
  }

  private countRunningTasks(): number {
    return this.pendingLaunches
      + [...this.tasks.values()].filter((task) => occupiedStatus(task.status)).length;
  }

  private getConcurrencyLimit(): number {
    return Math.max(1, Math.min(32, Math.floor(this.dependencies.getConcurrencyLimit()) || 4));
  }

  private validateReasoningEffort(
    provider: "claude" | "codex",
    value?: string,
  ): string | undefined {
    const normalizedInput = value?.trim();
    if (!normalizedInput) return undefined;
    const normalized = provider === "claude"
      ? normalizeClaudeReasoningEffort(normalizedInput)
      : normalizeCodexReasoningEffort(normalizedInput);
    if (!normalized) {
      throw new AgentBridgeRequestError(
        "invalid_reasoning_effort",
        `${provider} 不支持 reasoning_effort=${normalizedInput}。`,
      );
    }
    return normalized;
  }

  private setReturnPolicy(task: AgentTaskRecord, policy: AgentReturnPolicy): void {
    if (!task.parentSessionId && policy !== "manual") {
      throw new AgentBridgeRequestError("invalid_parent", "该代理会话没有父终端绑定。");
    }
    task.returnPolicy = policy;
    if (policy === "manual") {
      this.clearQueuedDeliveries(task);
    }
    task.updatedAt = this.now();
    this.notify(task);
  }

  private async scheduleDelivery(task: AgentTaskRecord, turnNumber: number): Promise<void> {
    if (!task.parentSessionId || task.returnPolicy === "manual" || !task.assistantText) return;
    if (
      task.deliveredTurnNumber >= turnNumber
      || task.pendingDeliveries.some((delivery) => delivery.turnNumber === turnNumber)
      || (task.returnPolicy === "once" && task.pendingDeliveries.length > 0)
    ) return;
    task.pendingDeliveries.push({ turnNumber, assistantText: task.assistantText });
    task.deliveryStatus = "pending";
    task.deliveryError = null;
    const parent = this.dependencies.terminal.getSnapshot(task.parentSessionId);
    if (!parent || parent.status !== "running") {
      this.failDelivery(task, "父终端已退出或关闭，无法自动回传。");
      return;
    }
    if (parent.activity === "idle") this.flushDeliveriesForParent(task.parentSessionId);
    else this.notify(task);
  }

  private flushDeliveriesForParent(parentSessionId: string): void {
    if (this.activeDeliveryByParent.has(parentSessionId)) return;
    for (const task of this.tasks.values()) {
      if (
        task.parentSessionId === parentSessionId
        && task.deliveryStatus === "pending"
        && task.pendingDeliveries.length > 0
      ) {
        this.deliver(task, task.pendingDeliveries[0]);
        return;
      }
    }
  }

  private failDeliveriesForParent(parentSessionId: string): void {
    for (const task of this.tasks.values()) {
      if (task.parentSessionId === parentSessionId && task.pendingDeliveries.length > 0) {
        this.failDelivery(task, "父终端已退出或关闭，无法自动回传。");
      }
    }
  }

  private deliver(task: AgentTaskRecord, delivery: AgentPendingDelivery): void {
    if (!task.parentSessionId || task.deliveredTurnNumber >= delivery.turnNumber) return;
    const parent = this.dependencies.terminal.getSnapshot(task.parentSessionId);
    if (!parent || parent.status !== "running" || parent.activity !== "idle") return;
    this.activeDeliveryByParent.set(task.parentSessionId, {
      sessionId: task.sessionId,
      turnNumber: delivery.turnNumber,
      submitted: false,
    });
    const text = delivery.assistantText.length > MAX_DELIVERY_PROMPT_CHARS
      ? delivery.assistantText.slice(0, MAX_DELIVERY_PROMPT_CHARS) + "\n[内容过长，已截断；完整回答可通过 status 查询]"
      : delivery.assistantText;
    const prompt = [
      `[[CodeDeck delegated opinion: ${task.profileKey} / ${task.sessionId}]]`,
      text,
      "[[End delegated opinion]]",
      "请审阅以上代理意见并继续当前任务。",
    ].join("\n\n");
    const input = normalizeInput(prompt);
    try {
      this.dependencies.terminal.sendInput(task.parentSessionId, input.data);
    } catch {
      this.failDelivery(task, "父终端输入失败，无法自动回传。");
      return;
    }
    task.deliverySubmitTimer = setTimeout(() => {
      task.deliverySubmitTimer = undefined;
      const parentSessionId = task.parentSessionId;
      const activeDelivery = parentSessionId
        ? this.activeDeliveryByParent.get(parentSessionId)
        : undefined;
      if (
        !parentSessionId
        || activeDelivery?.sessionId !== task.sessionId
        || activeDelivery.turnNumber !== delivery.turnNumber
      ) return;
      const latestParent = this.dependencies.terminal.getSnapshot(parentSessionId);
      if (latestParent?.status !== "running") {
        this.failDelivery(task, "父终端已退出或关闭，无法自动回传。");
        return;
      }
      try {
        if (input.submitSeparately) {
          activeDelivery.submitted = true;
          this.dependencies.terminal.sendInput(parentSessionId, "\r");
        }
      } catch {
        this.failDelivery(task, "父终端输入失败，无法自动回传。");
        return;
      }
      this.finishDeliverySubmission(task, delivery);
    }, PASTED_INPUT_SUBMIT_DELAY_MS);
  }

  private finishEarlyDeliverySubmission(parentSessionId: string): void {
    const activeDelivery = this.activeDeliveryByParent.get(parentSessionId);
    if (!activeDelivery || activeDelivery.submitted) return;
    const task = this.tasks.get(activeDelivery.sessionId);
    const delivery = task?.pendingDeliveries.find(
      (candidate) => candidate.turnNumber === activeDelivery.turnNumber,
    );
    if (!task || !delivery) return;
    activeDelivery.submitted = true;
    this.finishDeliverySubmission(task, delivery);
  }

  private finishDeliverySubmission(task: AgentTaskRecord, delivery: AgentPendingDelivery): void {
    if (task.deliverySubmitTimer) {
      clearTimeout(task.deliverySubmitTimer);
      task.deliverySubmitTimer = undefined;
    }
    task.pendingDeliveries = task.pendingDeliveries.filter(
      (pending) => pending.turnNumber !== delivery.turnNumber,
    );
    task.deliveredTurnNumber = Math.max(task.deliveredTurnNumber, delivery.turnNumber);
    task.deliveryError = null;
    if (task.returnPolicy === "once") {
      task.returnPolicy = "manual";
      task.pendingDeliveries = [];
    }
    task.deliveryStatus = task.pendingDeliveries.length > 0 ? "pending" : "delivered";
    task.updatedAt = this.now();
    this.notify(task);
  }

  private failDelivery(task: AgentTaskRecord, message: string): void {
    if (task.deliverySubmitTimer) {
      clearTimeout(task.deliverySubmitTimer);
      task.deliverySubmitTimer = undefined;
    }
    if (task.parentSessionId) {
      const activeDelivery = this.activeDeliveryByParent.get(task.parentSessionId);
      if (activeDelivery?.sessionId === task.sessionId) {
        this.activeDeliveryByParent.delete(task.parentSessionId);
      }
    }
    task.deliveryStatus = "failed";
    task.deliveryError = message;
    task.pendingDeliveries = [];
    task.updatedAt = this.now();
    this.notify(task);
  }

  private clearQueuedDeliveries(task: AgentTaskRecord): void {
    const activeDelivery = task.parentSessionId
      ? this.activeDeliveryByParent.get(task.parentSessionId)
      : undefined;
    task.pendingDeliveries = activeDelivery?.sessionId === task.sessionId
      ? task.pendingDeliveries.filter(
          (delivery) => delivery.turnNumber === activeDelivery.turnNumber,
        )
      : [];
    if (task.pendingDeliveries.length === 0 && task.deliveryStatus === "pending") {
      task.deliveryStatus = "not_requested";
      task.deliveryError = null;
    }
  }
}
