import { randomUUID } from "node:crypto";
import {
  TerminalAutoContinueController,
  type TerminalAutoContinueConfig,
  type TerminalAutoContinueDiagnostic,
  type TerminalAutoContinueSnapshot,
} from "./terminal-auto-continue.js";

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

export interface TerminalSessionSnapshot {
  sessionId: string;
  provider: string;
  cwd: string;
  pid: number;
  commandExecutable: string;
  commandArgs: string[];
  status: "running" | "exited" | "closed";
  output: string;
  exitCode?: number;
  closeReason?: string;
  autoContinue: TerminalAutoContinueSnapshot;
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
    | "waiting_for_renderer";
  keyword?: string;
  matchCount?: number;
  remaining?: number;
  visibleExcerpt?: string;
  prompt?: string;
  subscriberCount?: number;
}

export interface TerminalSessionManagerDependencies {
  createPtyProcess: (options: CreatePtyProcessOptions) => PtyProcess;
  onAutoContinueEvent?: (event: TerminalSessionAutoContinueEvent) => void;
}

interface ManagedSession {
  snapshot: TerminalSessionSnapshot;
  pty: PtyProcess;
  controller: TerminalAutoContinueController;
  outputChunks: string[];
  subscribers: Set<TerminalSessionSubscriber>;
  pendingAutoContinueInput?: string;
  disposeData?: () => void;
  disposeExit?: () => void;
}

const MAX_BUFFERED_OUTPUT_CHARS = 64_000;

function cloneSnapshot(snapshot: TerminalSessionSnapshot): TerminalSessionSnapshot {
  return {
    ...snapshot,
    commandArgs: [...snapshot.commandArgs],
    autoContinue: { ...snapshot.autoContinue },
  };
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
    const sessionId = randomUUID();
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
      output: "",
      autoContinue: controller.snapshot(),
    };
    const session: ManagedSession = {
      snapshot,
      pty,
      controller,
      outputChunks: [],
      subscribers: new Set(),
    };

    session.disposeData = normalizeDisposer(pty.onData((chunk) => {
      this.appendOutput(session, chunk);
      const action = session.controller.processChunk(chunk);
      session.snapshot.autoContinue = session.controller.snapshot();
      this.notifyOutput(session, chunk);
      if (action) {
        this.enqueueAutoContinue(session, action.input);
      }
      this.notifyStatus(session);
    }));
    session.disposeExit = normalizeDisposer(pty.onExit((event) => {
      session.snapshot.status = "exited";
      session.snapshot.exitCode = event.exitCode;
      session.snapshot.autoContinue = session.controller.snapshot();
      this.notifyStatus(session);
    }));

    this.sessions.set(sessionId, session);
    return cloneSnapshot(snapshot);
  }

  attachSession(sessionId: string, subscriber: TerminalSessionSubscriber): () => void {
    const session = this.requireSession(sessionId);
    session.subscribers.add(subscriber);
    if (session.snapshot.output) {
      subscriber.onOutput(session.snapshot.output);
    }
    subscriber.onStatus(cloneSnapshot(session.snapshot));
    this.flushPendingAutoContinue(session);
    return () => {
      session.subscribers.delete(subscriber);
    };
  }

  sendInput(sessionId: string, data: string): void {
    const session = this.requireSession(sessionId);
    if (session.snapshot.status !== "running") {
      return;
    }
    session.controller.recordInput(data);
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
      session.snapshot.status = "exited";
      session.snapshot.autoContinue = session.controller.snapshot();
      this.notifyStatus(session);
    }
  }

  async closeSession(sessionId: string, reason = "closed"): Promise<void> {
    const session = this.requireSession(sessionId);
    if (session.snapshot.status !== "closed") {
      session.snapshot.status = "closed";
      session.snapshot.closeReason = reason;
      session.pty.kill();
      session.disposeData?.();
      session.disposeExit?.();
      this.notifyStatus(session);
    }
  }

  getSnapshot(sessionId: string): TerminalSessionSnapshot | undefined {
    const session = this.sessions.get(sessionId);
    return session ? cloneSnapshot(session.snapshot) : undefined;
  }

  private requireSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`终端会话不存在：${sessionId}`);
    }
    return session;
  }

  private appendOutput(session: ManagedSession, chunk: string): void {
    session.outputChunks.push(chunk);
    let output = session.outputChunks.join("");
    if (output.length > MAX_BUFFERED_OUTPUT_CHARS) {
      output = output.slice(-MAX_BUFFERED_OUTPUT_CHARS);
      session.outputChunks = [output];
    }
    session.snapshot.output = output;
  }

  private notifyOutput(session: ManagedSession, chunk: string): void {
    for (const subscriber of session.subscribers) {
      subscriber.onOutput(chunk);
    }
  }

  private notifyStatus(session: ManagedSession): void {
    const snapshot = cloneSnapshot(session.snapshot);
    for (const subscriber of session.subscribers) {
      subscriber.onStatus(snapshot);
    }
  }

  private emitAutoContinueEvent(event: TerminalSessionAutoContinueEvent): void {
    this.dependencies.onAutoContinueEvent?.(event);
  }

  private enqueueAutoContinue(session: ManagedSession, input: string): void {
    if (session.snapshot.status !== "running") {
      this.emitAutoContinueEvent({
        sessionId: session.snapshot.sessionId,
        phase: "skipped",
        reason: "not_running",
        subscriberCount: session.subscribers.size,
      });
      return;
    }
    if (session.pendingAutoContinueInput) {
      this.emitAutoContinueEvent({
        sessionId: session.snapshot.sessionId,
        phase: "skipped",
        reason: "pending_input",
        subscriberCount: session.subscribers.size,
      });
      return;
    }
    session.pendingAutoContinueInput = input;
    this.emitAutoContinueEvent({
      sessionId: session.snapshot.sessionId,
      phase: "queued",
      prompt: input.replace(/\r$/, ""),
      subscriberCount: session.subscribers.size,
    });
    this.flushPendingAutoContinue(session);
  }

  private flushPendingAutoContinue(session: ManagedSession): void {
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
    session.controller.recordInput(input, { source: "auto" });
    session.pty.write(input);
    this.emitAutoContinueEvent({
      sessionId: session.snapshot.sessionId,
      phase: "flushed",
      prompt: input.replace(/\r$/, ""),
      subscriberCount: session.subscribers.size,
    });
  }
}
