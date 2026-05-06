import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeClaudeProjectPath,
  type ListSessionsRequest,
  listClaudeSessions,
  listCodexSessions,
  listSessionsForProvider,
} from "../../services/session-service.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeJsonl(filePath: string, lines: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
}

async function setFileTime(filePath: string, isoTime: string): Promise<void> {
  const time = new Date(isoTime);
  await utimes(filePath, time, time);
}

describe("session-service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("encodes Claude project directories from cwd", () => {
    expect(encodeClaudeProjectPath("C:/Users/example/Sync/projects/skills-manager"))
      .toBe("C--Users-example-Sync-projects-skills-manager");
  });

  it("reads Claude sessions from ~/.claude/projects/<encoded-project>/*.jsonl", async () => {
    const claudeRoot = await createTempDir("skills-manager-claude-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-a";
    const encoded = encodeClaudeProjectPath(cwd);
    const filePath = path.join(claudeRoot, "projects", encoded, "session-a.jsonl");
    await writeJsonl(filePath, [
      {
        type: "user",
        cwd,
        message: { content: "修复 Profiles 启动逻辑" },
      },
    ]);
    await setFileTime(filePath, "2026-05-04T10:00:00.000Z");

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd,
    }, claudeRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "claude",
      session_id: "session-a",
      cwd,
      preview: "修复 Profiles 启动逻辑",
    });
  });

  it("reads Claude legacy sessions/<id>.jsonl layout", async () => {
    const claudeRoot = await createTempDir("skills-manager-claude-legacy-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-b";
    const encoded = encodeClaudeProjectPath(cwd);
    const filePath = path.join(claudeRoot, "projects", encoded, "sessions", "legacy-session.jsonl");
    await writeJsonl(filePath, [
      {
        type: "user",
        cwd,
        message: { content: "旧结构会话" },
      },
    ]);

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd,
    }, claudeRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.session_id).toBe("legacy-session");
  });

  it("returns an empty Claude session list when cwd does not match the encoded project dir", async () => {
    const claudeRoot = await createTempDir("skills-manager-claude-mismatch-");
    tempDirs.push(claudeRoot);
    const filePath = path.join(
      claudeRoot,
      "projects",
      encodeClaudeProjectPath("C:/workspace/project-a"),
      "session-a.jsonl",
    );
    await writeJsonl(filePath, [
      {
        type: "user",
        cwd: "C:/workspace/project-a",
        message: { content: "project-a" },
      },
    ]);

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd: "C:/workspace/project-b",
    }, claudeRoot);

    expect(sessions).toEqual([]);
  });

  it("returns recent Claude sessions in global_recent scope", async () => {
    const claudeRoot = await createTempDir("skills-manager-claude-recent-");
    tempDirs.push(claudeRoot);
    const olderFile = path.join(
      claudeRoot,
      "projects",
      encodeClaudeProjectPath("C:/workspace/project-a"),
      "older.jsonl",
    );
    const newerFile = path.join(
      claudeRoot,
      "projects",
      encodeClaudeProjectPath("C:/workspace/project-b"),
      "newer.jsonl",
    );
    await writeJsonl(olderFile, [{ type: "user", cwd: "C:/workspace/project-a", message: { content: "older" } }]);
    await writeJsonl(newerFile, [{ type: "user", cwd: "C:/workspace/project-b", message: { content: "newer" } }]);
    await setFileTime(olderFile, "2026-05-04T09:00:00.000Z");
    await setFileTime(newerFile, "2026-05-04T10:00:00.000Z");

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "global_recent",
    }, claudeRoot);

    expect(sessions.map((session) => session.session_id)).toEqual(["newer", "older"]);
    expect(sessions.every((session) => session.provider === "claude")).toBe(true);
  });

  it("reads Codex sessions from session_index.jsonl and filters by cwd using session headers when needed", async () => {
    const codexRoot = await createTempDir("skills-manager-codex-");
    tempDirs.push(codexRoot);
    const indexPath = path.join(codexRoot, "session_index.jsonl");
    await mkdir(codexRoot, { recursive: true });
    await writeFile(
      indexPath,
      [
        JSON.stringify({
          id: "019df0ff-0001",
          thread_name: "当前项目会话",
          updated_at: "2026-05-04T10:30:00.000Z",
        }),
        JSON.stringify({
          id: "019df0ff-0002",
          thread_name: "其他项目会话",
          updated_at: "2026-05-04T10:20:00.000Z",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-30-00-019df0ff-0001.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "019df0ff-0001",
            cwd: "C:/workspace/current-project",
          },
        },
      ],
    );
    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-20-00-019df0ff-0002.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "019df0ff-0002",
            cwd: "C:/workspace/other-project",
          },
        },
      ],
    );

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "project",
      cwd: "C:/workspace/current-project",
    }, codexRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "codex",
      session_id: "019df0ff-0001",
      cwd: "C:/workspace/current-project",
      preview: "当前项目会话",
    });
  });

  it("returns an empty Codex session list when cwd does not match", async () => {
    const codexRoot = await createTempDir("skills-manager-codex-empty-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      `${JSON.stringify({
        id: "019df0ff-0100",
        thread_name: "只属于别处",
        updated_at: "2026-05-04T10:30:00.000Z",
      })}\n`,
      "utf-8",
    );
    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-30-00-019df0ff-0100.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "019df0ff-0100",
            cwd: "C:/workspace/other-project",
          },
        },
      ],
    );

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "project",
      cwd: "C:/workspace/current-project",
    }, codexRoot);

    expect(sessions).toEqual([]);
  });

  it("returns recent Codex sessions in global_recent scope", async () => {
    const codexRoot = await createTempDir("skills-manager-codex-recent-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "019df0ff-1001",
          thread_name: "较新会话",
          updated_at: "2026-05-04T10:30:00.000Z",
          cwd: "C:/workspace/newer",
        }),
        JSON.stringify({
          id: "019df0ff-1000",
          thread_name: "较旧会话",
          updated_at: "2026-05-04T10:20:00.000Z",
          cwd: "C:/workspace/older",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);

    expect(sessions.map((session) => session.session_id)).toEqual([
      "019df0ff-1001",
      "019df0ff-1000",
    ]);
    expect(sessions.every((session) => session.provider === "codex")).toBe(true);
  });

  it("skips a bad JSONL file without affecting other sessions", async () => {
    const claudeRoot = await createTempDir("skills-manager-claude-bad-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-a";
    const encoded = encodeClaudeProjectPath(cwd);
    const validPath = path.join(claudeRoot, "projects", encoded, "good.jsonl");
    const badPath = path.join(claudeRoot, "projects", encoded, "bad.jsonl");
    await writeJsonl(validPath, [{ type: "user", cwd, message: { content: "有效会话" } }]);
    await mkdir(path.dirname(badPath), { recursive: true });
    await writeFile(badPath, "{not-json}\n", "utf-8");

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd,
    }, claudeRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.session_id).toBe("good");
  });

  it("requires cwd in project scope", async () => {
    const request: ListSessionsRequest = {
      provider: "claude",
      scope: "project",
    };

    await expect(listSessionsForProvider(request)).rejects.toThrow("cwd");
  });

  it("delegates to the correct provider-specific session loader", async () => {
    const listClaude = vi.fn().mockResolvedValue([
      {
        provider: "claude",
        session_id: "claude-1",
        cwd: "C:/repo",
        updated_at: "2026-05-04T10:00:00.000Z",
        preview: "Claude 会话",
      },
    ]);
    const listCodex = vi.fn().mockResolvedValue([]);

    const request: ListSessionsRequest = {
      provider: "claude",
      scope: "project",
      cwd: "C:/repo",
    };

    const result = await listSessionsForProvider(request, {
      listClaudeSessions: listClaude,
      listCodexSessions: listCodex,
    });

    expect(listClaude).toHaveBeenCalledWith(request);
    expect(listCodex).not.toHaveBeenCalled();
    expect(result[0]?.session_id).toBe("claude-1");
  });
});
