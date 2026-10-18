import { randomUUID } from "node:crypto";
import {
  TerminalAutoContinueController,
  type TerminalAutoContinueConfig,
  type TerminalAutoContinueConfigPatch,
  type TerminalAutoContinueDiagnostic,
  type TerminalAutoContinueSnapshot,
} from "./terminal-auto-continue.js";
import {
  TerminalActivityDetector,
  type TerminalActivity,
  type TerminalActivityObservation,
  type TerminalActivityReason,
} from "./terminal-activity.js";
import type {
  TerminalTurnLifecycleError,
  TerminalTurnLifecyclePhase,
  TerminalTurnLifecycleEvent,
} from "./terminal-turn-lifecycle.js";
import { TerminalIdentityHintParser } from "./terminal-session-identity.js";
import { TerminalInputClassifier } from "./terminal-input.js";
import { TerminalOutputBuffer } from "./terminal-output-buffer.js";

export interface PtyProcessExitEvent {
  exitCode: number;
  signal?: number;
}

export interface PtyProcess {
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (listener: (data: string) => void) => (() => void) | void;
  onExit: (listener: (event: PtyProcessExitEvent) => void) => (() => void) | void;
}

export interface CreatePtyProcessOptions {
  filePath: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface CreateTerminalSessionOptions {
  sessionId?: string;
  provider: string;
  cwd: string;
  commandExecutable: string;
  commandArgs: string[];
  spawnFilePath?: string;
  spawnArgs?: string[];
  env: Record<string, string>;
  autoContinue: TerminalAutoContinueConfig;
  cols?: number;
  rows?: number;
}

export interface TerminalAutoContinueSchedule {
  delayMs: number;
  queuedAtMs: number;
  dueAtMs: number;
  phase: "waiting" | "waiting_for_renderer" | "send_failed";
  error?: string;
}

export interface TerminalSessionSnapshot {
  sessionId: string;
  provider: string;
  cwd: string;
  pid: number;
  commandExecutable: string;
  commandArgs: string[];
  status: "running" | "exited" | "closed";
  activity: TerminalActivity;
  output: string;
  displayTitle?: string;
  exitCode?: number;
  closeReason?: string;
  autoContinue: TerminalAutoContinueSnapshot;
  autoContinueSchedule?: TerminalAutoContinueSchedule;
}

export interface TerminalSessionSubscriber {
  onOutput: (chunk: string) => void;
  onStatus: (snapshot: TerminalSessionSnapshot) => void;
}

export interface TerminalSessionAutoContinueEvent {
  sessionId: string;
  phase: "matched" | "skipped" | "queued" | "flushed";
  reason?:
    | TerminalAutoContinueDiagnostic["reason"]
    | "not_running"
    | "pending_input"
    | "waiting_for_renderer"
    | "send_failed";
  keyword?: string;
  matchCount?: number;
  remaining?: number;
  visibleExcerpt?: string;
  failureEpisodeId?: number;
  failureState?: TerminalAutoContinueDiagnostic["failureState"];
  prompt?: string;
  delayMs?: number;
  subscriberCount?: number;
}

export interface TerminalSessionManagerDependencies {
  createPtyProcess: (options: CreatePtyProcessOptions) => PtyProcess;
  onAutoContinueEvent?: (event: TerminalSessionAutoContinueEvent) => void;
  onActivityChange?: (event: TerminalSessionActivityEvent) => void;
  onProviderIdentityHint?: (sessionId: string, hint: string) => void;
}

export interface TerminalSessionActivityEvent {
  sessionId: string;
  provider: string;
  previousActivity: TerminalActivity;
  activity: TerminalActivity;
  reason: TerminalActivityReason;
  error?: TerminalTurnLifecycleError;
}

interface ManagedSession {
  snapshot: TerminalSessionSnapshot;
  pty: PtyProcess;
  controller: TerminalAutoContinueController;
  activityDetector: TerminalActivityDetector;
  identityParser: TerminalIdentityHintParser;
  inputClassifier: TerminalInputClassifier;
  settled: boolean;
  turnGeneration: number;
  submittedAtMs?: number;
  turnId?: string;
  lifecycleStartedAtMs?: number;
  notifiedTerminalEvents: Set<string>;
  pendingAutoContinueGeneration?: number;
  outputBuffer: TerminalOutputBuffer;
  outputEnded: boolean;
  lastNotifiedStatus: TerminalSessionSnapshot;
  subscribers: Set<TerminalSessionSubscriber>;
  pendingAutoContinueInput?: string;
  pendingAutoContinueTimer?: ReturnType<typeof setTimeout>;
  pendingIdlePromptTimer?: ReturnType<typeof setTimeout>;
  disposeData?: () => void;
  disposeExit?: () => void;
}

const MAX_BUFFERED_OUTPUT_CHARS = 64_000;
const IDLE_PROMPT_SETTLE_MS = 250;

function cloneSnapshot(snapshot: TerminalSessionSnapshot): TerminalSessionSnapshot {
  return {
    ...snapshot,
    commandArgs: [...snapshot.commandArgs],
    autoContinue: {
      ...snapshot.autoContinue,
      keywords: [...snapshot.autoContinue.keywords],
    },
    ...(snapshot.autoContinueSchedule ? { autoContinueSchedule: { ...snapshot.autoContinueSchedule } } : {}),
  };
}

function sameStatus(left: TerminalSessionSnapshot, right: TerminalSessionSnapshot): boolean {
  const a = left.autoContinue;
  const b = right.autoContinue;
  return left.status === right.status
    && left.activity === right.activity
    && left.displayTitle === right.displayTitle
    && left.exitCode === right.exitCode
    && left.closeReason === right.closeReason
    && left.autoContinueSchedule?.delayMs === right.autoContinueSchedule?.delayMs
    && left.autoContinueSchedule?.queuedAtMs === right.autoContinueSchedule?.queuedAtMs
    && left.autoContinueSchedule?.dueAtMs === right.autoContinueSchedule?.dueAtMs
    && left.autoContinueSchedule?.phase === right.autoContinueSchedule?.phase
    && left.autoContinueSchedule?.error === right.autoContinueSchedule?.error
    && a.enabled === b.enabled && a.limit === b.limit && a.matchCount === b.matchCount
    && a.remaining === b.remaining && a.lastMatchedKeyword === b.lastMatchedKeyword
    && a.paused === b.paused && a.intervalMs === b.intervalMs
    && a.intervalMode === b.intervalMode && a.intervalStdDevMs === b.intervalStdDevMs
    && a.keywords.length === b.keywords.length
    && a.keywords.every((keyword, index) => keyword === b.keywords[index]);
}

function normalizeDisposer(disposer: (() => void) | void): (() => void) | undefined {
  return typeof disposer === "function" ? disposer : undefined;
}

function isPtyAlreadyExitedError(error: unknown): boolean {
  return error instanceof Error && /already exited/i.test(error.message);
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(private readonly dependencies: TerminalSessionManagerDependencies) {}

  async createSession(options: CreateTerminalSessionOptions): Promise<TerminalSessionSnapshot> {
    const sessionId = options.sessionId ?? randomUUID();
    const pty = this.dependencies.createPtyProcess({
      filePath: options.spawnFilePath ?? options.commandExecutable,
      args: options.spawnArgs ?? options.commandArgs,
      cwd: options.cwd,
      env: options.env,
      cols: options.cols ?? 120,
      rows: options.rows ?? 40,
    });
    const controller = new TerminalAutoContinueController(options.autoContinue, {
      onDiagnostic: (diagnostic) => {
        this.emitAutoContinueEvent({
          sessionId,
          ...diagnostic,
        });
      },
    });
    const snapshot: TerminalSessionSnapshot = {
      sessionId,
      provider: options.provider,
      cwd: options.cwd,
      pid: pty.pid,
      commandExecutable: options.commandExecutable,
      commandArgs: [...options.commandArgs],
      status: "running",
      activity: "idle",
      output: "",
      autoContinue: controller.snapshot(),
    };
    const session: ManagedSession = {
      snapshot,
      pty,
      controller,
      activityDetector: new TerminalActivityDetector(),
      identityParser: new TerminalIdentityHintParser(),
      inputClassifier: new TerminalInputClassifier(),
      settled: false,
      turnGeneration: 0,
      notifiedTerminalEvents: new Set(),
      outputBuffer: new TerminalOutputBuffer(MAX_BUFFERED_OUTPUT_CHARS),
      outputEnded: false,
      lastNotifiedStatus: cloneSnapshot(snapshot),
      subscribers: new Set(),
    };

    session.disposeData = normalizeDisposer(pty.onData((chunk) => {
      if (session.snapshot.status === "closed" || session.outputEnded) {
        return;
      }
      session.outputBuffer.append(chunk);
      session.inputClassifier.observeOutput(chunk);
      if (session.snapshot.provider === "codex") {
        for (const hint of session.identityParser.processChunk(chunk)) {
          this.dependencies.onProviderIdentityHint?.(sessionId, hint);
        }
      }
      const running = session.snapshot.status === "running";
      const activityObservation = running && !session.settled ? session.activityDetector.observeOutput(chunk) : null;
      const action = running && session.snapshot.provider !== "codex" ? session.controller.processChunk(chunk) : null;
      session.snapshot.autoContinue = session.controller.snapshot();
      this.notifyOutput(session, chunk);
      this.cancelPendingIdlePrompt(session);
      this.observeActivity(session, activityObservation);
      if (action) {
        this.enqueueAutoContinue(session, action.input, action.delayMs);
      }
      this.notifyStatus(session);
    }));
    session.disposeExit = normalizeDisposer(pty.onExit((event) => {
      if (session.snapshot.status === "closed" || session.outputEnded) {
        return;
      }
      session.outputEnded = true;
      this.cancelPendingAutoContinue(session);
      this.cancelPendingIdlePrompt(session);
      session.snapshot.status = "exited";
      session.snapshot.exitCode = event.exitCode;
      session.snapshot.autoContinue = session.controller.snapshot();
      session.activityDetector.resetOutput();
      this.disposePtyListeners(session);
      this.applyActivity(session, "idle", "process_exit");
      this.notifyStatus(session);
    }));

    this.sessions.set(sessionId, session);
    return cloneSnapshot(snapshot);
  }

  attachSession(sessionId: string, subscriber: TerminalSessionSubscriber): () => void {
    const session = this.requireSession(sessionId);
    session.subscribers.add(subscriber);
    const snapshot = this.createSnapshot(session);
    if (snapshot.output) {
      subscriber.onOutput(snapshot.output);
    }
    subscriber.onStatus(snapshot);
    this.flushPendingAutoContinue(session);
    return () => {
      // Completed Bridge task records may retain this disposer. Do not retain ManagedSession.
      this.sessions.get(sessionId)?.subscribers.delete(subscriber);
    };
  }

  sendInput(sessionId: string, data: string): void {
    const session = this.requireSession(sessionId);
    if (session.snapshot.status !== "running") {
      return;
    }
    const classified = session.inputClassifier.classify(data);
    if (classified.cancelAutoContinue && (session.pendingAutoContinueInput || session.pendingAutoContinueTimer || session.snapshot.autoContinueSchedule)) {
      this.cancelPendingAutoContinue(session);
    }
    if (classified.cancelAutoContinue) this.cancelPendingIdlePrompt(session);
    if (classified.userInput) {
      session.controller.recordInput(classified.userInput);
      this.observeActivity(session, session.activityDetector.recordInput(classified.userInput));
    }
    session.pty.write(data);
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.requireSession(sessionId);
    if (session.snapshot.status !== "running") {
      return;
    }
    try {
      session.pty.resize(cols, rows);
    } catch (error) {
      if (!isPtyAlreadyExitedError(error)) {
        throw error;
      }
      this.cancelPendingAutoContinue(session);
      session.snapshot.status = "exited";
      session.snapshot.autoContinue = session.controller.snapshot();
      this.notifyStatus(session);
    }
  }

  async closeSession(sessionId: string, reason = "closed"): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.snapshot.status === "closed") {
      return;
    }
    const previousStatus = session.snapshot.status;
    // A synchronous onExit during kill must not turn closed back into exited.
    session.snapshot.status = "closed";
    try {
      // node-pty's ConPTY worker can outlive process exit. Closing must also
      // run its native cleanup for an exited terminal whose history stayed open.
      session.pty.kill();
    } catch (error) {
      if (!isPtyAlreadyExitedError(error)) {
        session.snapshot.status = previousStatus;
        throw error;
      }
    }
    this.cancelPendingAutoContinue(session);
    this.cancelPendingIdlePrompt(session);
    session.snapshot.closeReason = reason;
    try {
      this.disposePtyListeners(session);
      this.applyActivity(session, "idle", "session_closed");
      this.notifyStatus(session);
    } finally {
      session.subscribers.clear();
      session.outputBuffer.clear();
      session.activityDetector.resetOutput();
      this.sessions.delete(sessionId);
    }
  }

  getSnapshot(sessionId: string): TerminalSessionSnapshot | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.createSnapshot(session) : undefined;
  }

  updateDisplayTitle(sessionId: string, displayTitle?: string): void {
    const session = this.requireSession(sessionId);
    const normalizedTitle = displayTitle?.trim() || undefined;
    session.snapshot.displayTitle = normalizedTitle;
    this.notifyStatus(session);
  }

  updateAutoContinueConfig(sessionId: string, patch: TerminalAutoContinueConfigPatch): void {
    const session = this.requireSession(sessionId);
    session.controller.updateConfig(patch);
    if (patch.enabled === false || patch.paused === true) {
      this.cancelPendingAutoContinue(session);
    }
    session.snapshot.autoContinue = session.controller.snapshot();
    this.notifyStatus(session);
  }

  reportTurnLifecycle(
    sessionId: string,
    phase: TerminalTurnLifecyclePhase,
    error?: TerminalTurnLifecycleError,
    identity: Pick<TerminalTurnLifecycleEvent, "turnId" | "timestampMs"> = {},
  ): void {
    const session = this.requireSession(sessionId);
    if (session.snapshot.status !== "running") {
      return;
    }
    const { turnId, timestampMs } = identity;
    if (timestampMs !== undefined && session.submittedAtMs !== undefined
      && timestampMs < session.submittedAtMs) {
      return;
    }
    if (phase !== "started" && turnId && session.turnId && turnId !== session.turnId) {
      return;
    }
    if (phase !== "started" && turnId && !session.turnId && session.submittedAtMs !== undefined) {
      return;
    }
    const key = `${session.turnGeneration}:${turnId ?? ""}:${phase}`;
    if (session.notifiedTerminalEvents.has(key)) {
      return;
    }
    session.inputClassifier.resetQueries();
    if (phase === "started") {
      if (turnId && session.turnId === turnId) {
        return;
      }
      if (session.settled) {
        this.openTurn(session);
      }
      session.turnId = turnId;
      session.lifecycleStartedAtMs = timestampMs;
      this.cancelPendingAutoContinue(session);
      session.controller.resetFailure();
    } else {
      // Even if prompt fallback already made activity idle, emit authority once.
      session.notifiedTerminalEvents.add(key);
      session.settled = true;
      session.activityDetector.resetOutput();
      this.cancelPendingAutoContinue(session);
      session.controller.resetFailure();
    }
    this.cancelPendingIdlePrompt(session);
    this.applyActivity(
      session,
      phase === "started" ? "busy" : "idle",
      phase === "started"
        ? "turn_started"
        : phase === "completed" ? "turn_completed" : "turn_failed",
      phase !== "started",
      error,
    );
    if (phase === "failed" && error?.retryable && session.snapshot.provider === "codex") {
      const action = session.controller.processFailure(error.message);
      session.snapshot.autoContinue = session.controller.snapshot();
      if (action) {
        this.enqueueAutoContinue(session, action.input, action.delayMs);
      }
      this.notifyStatus(session);
    }
  }

  resetProviderSession(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.inputClassifier.resetQueries();
    this.cancelPendingAutoContinue(session);
    this.cancelPendingIdlePrompt(session);
    session.controller.resetFailure();
    session.activityDetector.resetOutput();
    session.turnId = undefined;
    session.submittedAtMs = undefined;
    session.lifecycleStartedAtMs = undefined;
    session.notifiedTerminalEvents.clear();
    session.settled = true;
    session.turnGeneration += 1;
    // A thread switch is not a successful completion of the previous thread.
    this.applyActivity(session, "idle", "session_changed");
  }

  private openTurn(session: ManagedSession, resetFailure = true): void {
    session.inputClassifier.resetQueries();
    this.cancelPendingAutoContinue(session);
    if (resetFailure) {
      session.controller.resetFailure();
    }
    session.settled = false;
    session.turnGeneration += 1;
    session.turnId = undefined;
    session.lifecycleStartedAtMs = undefined;
    session.notifiedTerminalEvents.clear();
  }

  private requireSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`终端会话不存在：${sessionId}`);
    }
    return session;
  }

  private createSnapshot(session: ManagedSession): TerminalSessionSnapshot {
    return { ...cloneSnapshot(session.snapshot), output: session.outputBuffer.toString() };
  }

  private disposePtyListeners(session: ManagedSession): void {
    const disposeData = session.disposeData;
    const disposeExit = session.disposeExit;
    session.disposeData = undefined;
    session.disposeExit = undefined;
    try {
      disposeData?.();
    } finally {
      disposeExit?.();
    }
  }

  private notifyOutput(session: ManagedSession, chunk: string): void {
    for (const subscriber of session.subscribers) {
      subscriber.onOutput(chunk);
    }
  }

  private notifyStatus(session: ManagedSession): void {
    if (sameStatus(session.lastNotifiedStatus, session.snapshot)) {
      return;
    }
    // output is delivered by onOutput; retain only lightweight metadata for comparisons.
    session.lastNotifiedStatus = cloneSnapshot(session.snapshot);
    if (session.subscribers.size === 0) {
      return;
    }
    const snapshot = this.createSnapshot(session);
    for (const subscriber of session.subscribers) {
      subscriber.onStatus(snapshot);
    }
  }

  private emitAutoContinueEvent(event: TerminalSessionAutoContinueEvent): void {
    this.dependencies.onAutoContinueEvent?.(event);
  }

  private observeActivity(
    session: ManagedSession,
    observation: TerminalActivityObservation | null,
  ): void {
    if (!observation) {
      return;
    }
    if (observation.reason === "submitted_input") {
      this.openTurn(session);
      session.submittedAtMs = Date.now();
      this.applyActivity(session, "busy", observation.reason);
      return;
    }
    if (session.settled) {
      return;
    }
    if (observation.reason === "busy_output") {
      this.applyActivity(session, "busy", observation.reason);
      return;
    }
    if (observation.reason === "idle_prompt") {
      session.pendingIdlePromptTimer = setTimeout(() => {
        session.pendingIdlePromptTimer = undefined;
        if (session.snapshot.status !== "running") {
          return;
        }
        this.applyActivity(session, "idle", observation.reason, true);
        this.cancelPendingAutoContinue(session);
        session.settled = true;
        session.activityDetector.resetOutput();
      }, IDLE_PROMPT_SETTLE_MS);
    }
  }

  private applyActivity(
    session: ManagedSession,
    activity: TerminalActivity,
    reason: TerminalActivityReason,
    emitWhenUnchanged = false,
    error?: TerminalTurnLifecycleError,
  ): void {
    const previousActivity = session.snapshot.activity;
    if (previousActivity === activity) {
      if (emitWhenUnchanged || reason === "process_exit" || reason === "session_closed") {
        this.dependencies.onActivityChange?.({
          sessionId: session.snapshot.sessionId,
          provider: session.snapshot.provider,
          previousActivity,
          activity,
          reason,
          ...(error ? { error } : {}),
        });
      }
      return;
    }
    session.snapshot.activity = activity;
    this.dependencies.onActivityChange?.({
      sessionId: session.snapshot.sessionId,
      provider: session.snapshot.provider,
      previousActivity,
      activity,
      reason,
      ...(error ? { error } : {}),
    });
    this.notifyStatus(session);
  }

  private cancelPendingIdlePrompt(session: ManagedSession): void {
    if (session.pendingIdlePromptTimer) {
      clearTimeout(session.pendingIdlePromptTimer);
      session.pendingIdlePromptTimer = undefined;
    }
  }

  private enqueueAutoContinue(session: ManagedSession, input: string, delayMs: number): void {
    if (session.snapshot.status !== "running") {
      this.emitAutoContinueEvent({
        sessionId: session.snapshot.sessionId,
        phase: "skipped",
        reason: "not_running",
        subscriberCount: session.subscribers.size,
      });
      return;
    }
    if (session.pendingAutoContinueInput || session.pendingAutoContinueTimer) {
      this.emitAutoContinueEvent({
        sessionId: session.snapshot.sessionId,
        phase: "skipped",
        reason: "pending_input",
        subscriberCount: session.subscribers.size,
      });
      return;
    }
    this.emitAutoContinueEvent({
      sessionId: session.snapshot.sessionId,
      phase: "queued",
      prompt: input.replace(/\r$/, ""),
      delayMs,
      subscriberCount: session.subscribers.size,
    });
    const generation = session.turnGeneration;
    session.pendingAutoContinueGeneration = generation;
    const queuedAtMs = Date.now();
    session.snapshot.autoContinueSchedule = {
      delayMs, queuedAtMs, dueAtMs: queuedAtMs + delayMs, phase: "waiting",
    };
    this.notifyStatus(session);
    if (delayMs <= 0) {
      session.pendingAutoContinueInput = input;
      this.flushPendingAutoContinue(session);
      return;
    }
    session.pendingAutoContinueTimer = setTimeout(() => {
      session.pendingAutoContinueTimer = undefined;
      if (session.snapshot.status !== "running") {
        return;
      }
      if (session.turnGeneration !== generation || session.pendingAutoContinueGeneration !== generation) {
        return;
      }
      const autoContinue = session.controller.snapshot();
      if (!autoContinue.enabled || autoContinue.paused) {
        return;
      }
      session.pendingAutoContinueInput = input;
      this.flushPendingAutoContinue(session);
    }, delayMs);
  }

  private cancelPendingAutoContinue(session: ManagedSession): void {
    if (session.pendingAutoContinueTimer) {
      clearTimeout(session.pendingAutoContinueTimer);
      session.pendingAutoContinueTimer = undefined;
    }
    session.pendingAutoContinueInput = undefined;
    session.pendingAutoContinueGeneration = undefined;
    if (session.snapshot.autoContinueSchedule) {
      session.snapshot.autoContinueSchedule = undefined;
      this.notifyStatus(session);
    }
  }

  private flushPendingAutoContinue(session: ManagedSession): void {
    // Reattachment may have no input to flush (including a completed failed
    // write). Preserve that outcome until an actual cancellation/new turn.
    if (!session.pendingAutoContinueInput) {
      return;
    }
    const config = session.controller.snapshot();
    if (!config.enabled || config.paused || session.pendingAutoContinueGeneration !== session.turnGeneration) {
      this.cancelPendingAutoContinue(session);
      return;
    }
    if (
      session.snapshot.status !== "running"
      || !session.pendingAutoContinueInput
    ) {
      if (session.pendingAutoContinueInput) {
        this.emitAutoContinueEvent({
          sessionId: session.snapshot.sessionId,
          phase: "skipped",
          reason: "not_running",
          subscriberCount: session.subscribers.size,
        });
      }
      return;
    }
    if (session.subscribers.size === 0) {
      if (session.snapshot.autoContinueSchedule) {
        session.snapshot.autoContinueSchedule = { ...session.snapshot.autoContinueSchedule, phase: "waiting_for_renderer" };
        this.notifyStatus(session);
      }
      this.emitAutoContinueEvent({
        sessionId: session.snapshot.sessionId,
        phase: "skipped",
        reason: "waiting_for_renderer",
        subscriberCount: session.subscribers.size,
      });
      return;
    }
    const input = session.pendingAutoContinueInput;
    session.pendingAutoContinueInput = undefined;
    try {
      session.pty.write(input);
    } catch (error) {
      session.pendingAutoContinueGeneration = undefined;
      if (session.snapshot.autoContinueSchedule) {
        session.snapshot.autoContinueSchedule = {
          ...session.snapshot.autoContinueSchedule, phase: "send_failed",
          error: error instanceof Error ? error.message : "写入终端失败",
        };
      }
      this.notifyStatus(session);
      this.emitAutoContinueEvent({ sessionId: session.snapshot.sessionId, phase: "skipped", reason: "send_failed" });
      return;
    }
    this.cancelPendingAutoContinue(session);
    session.controller.recordInput(input, { source: "auto" });
    if (session.activityDetector.recordInput(input)) {
      this.openTurn(session, false);
      session.submittedAtMs = Date.now();
      this.applyActivity(session, "busy", "submitted_input");
    }
    this.emitAutoContinueEvent({
      sessionId: session.snapshot.sessionId,
      phase: "flushed",
      prompt: input.replace(/\r$/, ""),
      subscriberCount: session.subscribers.size,
    });
  }
}
