import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLastAssistantTextFromSessionFile } from "../../services/session-service.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { recursive: true, force: true })
  ));
});

describe("agent session output extraction", () => {
  it("returns the last complete assistant message without tool payloads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-session-output-"));
    cleanupPaths.push(directory);
    const filePath = path.join(directory, "session.jsonl");
    const records = [
      { type: "user", message: { role: "user", content: "question" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "first" }] } },
      { type: "assistant", message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "shell", input: { secret: "ignore" } },
          { type: "text", text: "final answer" },
        ],
      } },
    ];
    await writeFile(filePath, records.map((record) => JSON.stringify(record)).join("\n"), "utf8");
    await expect(readLastAssistantTextFromSessionFile(filePath)).resolves.toBe("final answer");
  });
});
