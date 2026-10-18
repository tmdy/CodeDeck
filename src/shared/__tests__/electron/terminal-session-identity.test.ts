import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexTerminalIdentityResolver, TerminalIdentityHintParser } from "../../electron/terminal-session-identity.js";

const id = "01234567-89ab-cdef-0123-456789abcdef";
const prefix = id.slice(0, 29);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const metadata = (value = id) => JSON.stringify({ type: "session_meta", payload: { id: value } }) + "\n";
const lifecycle = (phase = "task_started") => JSON.stringify({
  timestamp: "2026-10-10T00:00:01.000Z", type: "event_msg", payload: { type: phase, turn_id: "test-turn" },
}) + "\n";
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codedeck-identity-test-"));
  roots.push(home);
  const dir = path.join(home, "sessions", "2026", "10", "10");
  await fs.mkdir(dir, { recursive: true });
  const resolver = new CodexTerminalIdentityResolver(home, Date.parse("2026-10-10T00:00:00.000Z"));
  return { dir, resolver };
}

describe("TerminalIdentityHintParser", () => {
  it.each(["\x07", "\x1b\\"])("parses OSC 0/2 across every split with terminator %j", (end) => {
    for (const selector of ["0", "2"]) {
      const frame = `\x1b]${selector};${prefix}... ⠋${end}`;
      for (let split = 0; split < frame.length; split++) {
        const parser = new TerminalIdentityHintParser();
        expect([...parser.processChunk(frame.slice(0, split)), ...parser.processChunk(frame.slice(split))]).toEqual([prefix]);
      }
    }
  });
  it("accepts full UUIDs and ignores UUID prose, unknown shape, selector 8 and malformed frames", () => {
    const parser = new TerminalIdentityHintParser();
    expect(parser.processChunk(`${id}\x1b]8;${id}\x07\x1b]0;${id} title\x07\x1b]0;${id}\x07`)).toEqual([id]);
    expect(parser.processChunk("\x1b]0;" + "a".repeat(5_000))).toEqual([]);
    expect(parser.processChunk(`\x1b]2;${id}\x07`)).toEqual([id]);
  });
});

describe("CodexTerminalIdentityResolver", () => {
  it("waits for metadata and binds regardless of filename and title", async () => {
    const { dir, resolver } = await fixture();
    expect(await resolver.resolve(prefix)).toBeUndefined();
    const file = path.join(dir, "unrelated-name.jsonl");
    await fs.writeFile(file, metadata());
    expect(await resolver.resolve(prefix)).toEqual({ sessionId: id, filePath: file, sourceCount: 1 });
  });
  it("does not bind an ambiguous prefix or an invalid metadata UUID", async () => {
    const { dir, resolver } = await fixture();
    await fs.writeFile(path.join(dir, "one.jsonl"), metadata());
    await fs.writeFile(path.join(dir, "two.jsonl"), metadata(prefix + "0000000"));
    await fs.writeFile(path.join(dir, "bad.jsonl"), metadata("bad"));
    expect(await resolver.resolve(prefix)).toBeUndefined();
  });
  it("requires new correlated lifecycle growth to select among same-UUID static copies", async () => {
    const { dir, resolver } = await fixture();
    const live = path.join(dir, "live.jsonl");
    const copy = path.join(dir, "copy.jsonl");
    await fs.writeFile(live, metadata() + lifecycle());
    await fs.writeFile(copy, metadata() + lifecycle());
    expect(await resolver.resolve(prefix)).toEqual({ sessionId: id, sourceCount: 2, filePath: undefined });
    await fs.appendFile(live, lifecycle("task_complete"));
    expect((await resolver.resolve(prefix))?.filePath).toBe(live);
    await fs.appendFile(copy, lifecycle("task_complete"));
    expect((await resolver.resolve(prefix))?.filePath).toBeUndefined();
  });
  it("detects deletion and replacement of a bound source", async () => {
    const { dir, resolver } = await fixture();
    const file = path.join(dir, "live.jsonl");
    await fs.writeFile(file, metadata());
    expect((await resolver.resolve(prefix))?.filePath).toBe(file);
    await fs.rm(file);
    expect(await resolver.resolve(prefix)).toBeUndefined();
    await fs.writeFile(file, metadata("aaaaaaaa-89ab-cdef-0123-456789abcdef"));
    expect(await resolver.resolve(prefix)).toBeUndefined();
  });
  it("rebinds a changed PTY hint without retaining the previous source", async () => {
    const { dir, resolver } = await fixture();
    await fs.writeFile(path.join(dir, "one.jsonl"), metadata());
    const other = "aaaaaaaa-89ab-cdef-0123-456789abcdef";
    await fs.writeFile(path.join(dir, "two.jsonl"), metadata(other));
    expect((await resolver.resolve(prefix))?.sessionId).toBe(id);
    expect((await resolver.resolve(other))?.sessionId).toBe(other);
  });
});
