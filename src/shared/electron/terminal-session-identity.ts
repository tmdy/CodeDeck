import fs from "node:fs/promises";
import path from "node:path";
import { parseTerminalTurnLifecycleLine } from "./terminal-turn-lifecycle.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUNCATED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{5}\.\.\.$/i;

export class TerminalIdentityHintParser {
  private pending = "";

  processChunk(chunk: string): string[] {
    this.pending += chunk;
    const hints: string[] = [];
    while (this.pending) {
      const start = this.pending.indexOf("\x1b]");
      if (start < 0) {
        this.pending = this.pending.endsWith("\x1b") ? "\x1b" : "";
        break;
      }
      this.pending = this.pending.slice(start);
      const end = /\x07|\x1b\\/.exec(this.pending);
      const nested = this.pending.indexOf("\x1b]", 2);
      if (nested >= 0 && (!end || nested < end.index)) {
        this.pending = this.pending.slice(nested);
        continue;
      }
      if (!end) {
        if (this.pending.length > 4_096) {
          this.pending = this.pending.slice(2);
          continue;
        }
        break;
      }
      const frame = this.pending.slice(2, end.index);
      this.pending = this.pending.slice(end.index + end[0].length);
      const title = /^(?:0|2);(.*)$/s.exec(frame)?.[1]
        ?.trim().replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, "");
      if (title && (UUID.test(title) || TRUNCATED_UUID.test(title))) {
        hints.push(title.replace(/\.\.\.$/, "").toLowerCase());
      }
    }
    return hints;
  }
}

interface SourceState {
  size: number;
  mtimeMs: number;
  id?: string;
  active: boolean;
  remainder: string;
}

export interface CodexTerminalIdentity {
  sessionId: string;
  filePath?: string;
  sourceCount: number;
}

// One instance per PTY binding. Metadata verifies identity; filenames never do.
export class CodexTerminalIdentityResolver {
  private readonly sources = new Map<string, SourceState>();
  private resolved?: CodexTerminalIdentity;
  private hint = "";
  private readonly directories = new Map<string, { mtimeMs: number; children: Array<{ path: string; directory: boolean }> }>();

  constructor(private readonly home: string, private readonly startedAtMs: number) {}

  async resolve(hint: string): Promise<CodexTerminalIdentity | undefined> {
    if (hint !== this.hint) {
      this.hint = hint;
      this.resolved = undefined;
      this.sources.clear();
    }
    const files = await this.walk(path.join(this.home, "sessions"));
    const matches: Array<{ filePath: string; state: SourceState }> = [];
    for (const filePath of files) {
      try {
        let state = this.sources.get(filePath);
        // Once verified, immutable metadata of unrelated sessions need not be reread.
        if (this.resolved && state?.id && !state.id.startsWith(hint)) {
          continue;
        }
        const stat = await fs.stat(filePath);
        if (!state || state.size !== stat.size || state.mtimeMs !== stat.mtimeMs) {
          const handle = await fs.open(filePath, "r");
          let prefix: string;
          let added = "";
          let initialRemainder = "";
          try {
            const first = Buffer.alloc(Math.min(stat.size, 32_768));
            const headRead = await handle.read(first, 0, first.length, 0);
            prefix = first.subarray(0, headRead.bytesRead).toString("utf8");
            if (!state) {
              const last = Buffer.alloc(Math.min(stat.size, 16_384));
              const read = await handle.read(last, 0, last.length, Math.max(0, stat.size - last.length));
              initialRemainder = last.subarray(0, read.bytesRead).toString("utf8").split(/\r?\n/).at(-1) ?? "";
            }
            if (state && stat.size > state.size) {
              const offset = Math.max(state.size, stat.size - 256_000);
              const extra = Buffer.alloc(stat.size - offset);
              const read = await handle.read(extra, 0, extra.length, offset);
              added = `${offset === state.size ? state.remainder : ""}${extra.subarray(0, read.bytesRead).toString("utf8")}`;
            }
          } finally {
            await handle.close();
          }
          let id: string | undefined;
          for (const line of prefix.split(/\r?\n/).slice(0, -1)) {
            try {
              const record = JSON.parse(line);
              if (record.type === "session_meta" && typeof record.payload?.id === "string"
                && UUID.test(record.payload.id)) {
                id = record.payload.id.toLowerCase();
                break;
              }
            } catch { /* A partial metadata record remains pending. */ }
          }
          // A static old copy has no post-launch started event. Never select by mtime.
          const additions = added.split(/\r?\n/);
          const remainder = added ? additions.pop() ?? "" : initialRemainder;
          const active = Boolean(state?.active && stat.size >= state.size) || additions.some((line) => {
            const event = parseTerminalTurnLifecycleLine("codex", line);
            return event !== null && event.turnId !== undefined && event.timestampMs !== undefined
              && event.timestampMs >= this.startedAtMs;
          });
          state = { size: stat.size, mtimeMs: stat.mtimeMs, id, active, remainder };
          this.sources.set(filePath, state);
        }
        if (state.id?.startsWith(hint)) {
          matches.push({ filePath, state });
        }
      } catch { /* Missing / rotating files are retried at the next poll. */ }
    }
    const ids = new Set(matches.map((source) => source.state.id!));
    if (ids.size !== 1) {
      this.resolved = undefined;
      return undefined;
    }
    const active = matches.filter((source) => source.state.active);
    const filePath = matches.length === 1 ? matches[0].filePath
      : active.length === 1 ? active[0].filePath : undefined;
    this.resolved = { sessionId: [...ids][0], filePath, sourceCount: matches.length };
    return this.resolved;
  }

  private async walk(root: string): Promise<string[]> {
    try {
      const stat = await fs.stat(root);
      let directory = this.directories.get(root);
      if (!directory || directory.mtimeMs !== stat.mtimeMs) {
        const entries = await fs.readdir(root, { withFileTypes: true });
        directory = { mtimeMs: stat.mtimeMs, children: entries
          .filter((entry) => entry.isDirectory() || entry.isFile() && entry.name.endsWith(".jsonl"))
          .map((entry) => ({ path: path.join(root, entry.name), directory: entry.isDirectory() })) };
        this.directories.set(root, directory);
      }
      const nested = await Promise.all(directory.children.map((entry) => entry.directory
        ? this.walk(entry.path) : [entry.path]));
      return nested.flat();
    } catch {
      return [];
    }
  }
}
