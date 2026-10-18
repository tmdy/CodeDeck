import os from "node:os";
import path from "node:path";
import { appendFile, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCanonicalCodexSessionSource,
  encodeClaudeProjectPath,
  findMonitoredTerminalSessionTitle,
  readCodexSessionTitle,
  getCodexSessionDetail,
  copyCodexSessionBetweenHomes,
  invalidateCodexSessionCache,
  type ListSessionsRequest,
  type SessionSummary,
  listClaudeSessions,
  listCodexSessions,
  listCodexSessionsFromHomes,
  listSessionsForProvider,
  resolveCodexSessionTransferHomes,
  resolveMonitoredTerminalSessionFile,
  scanCodexSessionCatalog,
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

  it("keeps the last valid appended title through duplicate UUIDs, bad lines and partial writes", async () => {
    const home = await createTempDir("codex-title-regression-");
    tempDirs.push(home);
    const id = "01234567-89ab-cdef-0123-456789abcdef";
    const index = path.join(home, "session_index.jsonl");
    const entry = (title: string) => ({ id, thread_name: title, cwd: "C:/test", updated_at: "2026-10-10T00:00:00Z" });
    await writeJsonl(index, [entry("old")]);
    expect(await readCodexSessionTitle(home, id)).toBe("old");
    await appendFile(index, JSON.stringify(entry("renamed")) + "\n{bad}\n{\"id\":");
    expect(await readCodexSessionTitle(home, id)).toBe("renamed");
    expect((await listCodexSessions({ provider: "codex", scope: "global_recent" }, home)).map((s) => s.preview)).toEqual(["renamed"]);
    await appendFile(index, JSON.stringify(id) + ',"thread_name":"latest"}\n');
    expect(await readCodexSessionTitle(home, id)).toBe("latest");
    await appendFile(index, JSON.stringify(entry("")) + "\n");
    expect(await readCodexSessionTitle(home, id)).toBe("latest");
  });

  it("routes Codex session transfers into the App Runtime home", () => {
    expect(resolveCodexSessionTransferHomes({
      sourceKind: "app_runtime",
      appRuntimeHome: "C:/codex/runtime",
      globalHome: "C:/codex/global",
    })).toEqual({
      sourceHome: "C:/codex/runtime",
      targetHome: "C:/codex/runtime",
    });
    expect(resolveCodexSessionTransferHomes({
      sourceKind: "global_codex",
      appRuntimeHome: "C:/codex/runtime",
      globalHome: "C:/codex/global",
    })).toEqual({
      sourceHome: "C:/codex/global",
      targetHome: "C:/codex/runtime",
    });
  });

  it("rejects an unknown Codex session source", () => {
    expect(() => resolveCodexSessionTransferHomes({
      sourceKind: "C:/arbitrary/home",
      appRuntimeHome: "C:/codex/runtime",
      globalHome: "C:/codex/global",
    })).toThrow("Codex 会话来源无效，请刷新会话列表后重试。");
  });

  it("rejects stale App Runtime sources even when a session id may also exist globally", () => {
    expect(() => assertCanonicalCodexSessionSource("app_runtime"))
      .toThrow("旧 App Runtime 会话不可用");
    expect(() => assertCanonicalCodexSessionSource("global_codex")).not.toThrow();
    expect(() => assertCanonicalCodexSessionSource(undefined)).not.toThrow();
  });

  afterEach(async () => {
    invalidateCodexSessionCache();
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("encodes Claude project directories from cwd", () => {
    expect(encodeClaudeProjectPath("C:/Users/example/Sync/projects/codedeck"))
      .toBe("C--Users-example-Sync-projects-codedeck");
  });

  it("encodes Claude project directories by replacing underscores and dots with hyphens", () => {
    expect(encodeClaudeProjectPath("C:/Users/example/Downloads/thesis_round11_ch3_4_rewritten_no_pdf"))
      .toBe("C--Users-example-Downloads-thesis-round11-ch3-4-rewritten-no-pdf");
    expect(encodeClaudeProjectPath("C:/Users/example/Sync/XJTU-thesis-1.2.8（2025年更新）"))
      .toBe("C--Users-example-Sync-XJTU-thesis-1-2-8-2025----");
  });

  it("reads Claude sessions from ~/.claude/projects/<encoded-project>/*.jsonl", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-");
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

  it("keeps Claude project sessions when any historical cwd matches the requested cwd", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-history-cwd-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-a";
    const subdir = "C:/workspace/project-a/subdir";
    const encoded = encodeClaudeProjectPath(cwd);
    const filePath = path.join(claudeRoot, "projects", encoded, "session-with-subdir.jsonl");
    await writeJsonl(filePath, [
      {
        type: "user",
        cwd,
        message: { content: "从项目根目录开始" },
      },
      {
        type: "user",
        cwd: subdir,
        message: { content: "后来切到子目录" },
      },
    ]);

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd,
    }, claudeRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      session_id: "session-with-subdir",
      cwd,
      preview: "从项目根目录开始",
    });
  });

  it("applies Claude project session pagination before returning results", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-page-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-a";
    const encoded = encodeClaudeProjectPath(cwd);
    const projectDir = path.join(claudeRoot, "projects", encoded);

    for (let index = 0; index < 5; index += 1) {
      const filePath = path.join(projectDir, `session-${index + 1}.jsonl`);
      await writeJsonl(filePath, [
        {
          type: "user",
          cwd,
          message: { content: `Session ${index + 1}` },
        },
      ]);
      await setFileTime(filePath, `2026-05-04T10:${String(59 - index).padStart(2, "0")}:00.000Z`);
    }

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd,
      limit: 2,
      offset: 1,
    }, claudeRoot);

    expect(sessions.map((session) => session.session_id)).toEqual([
      "session-2",
      "session-3",
    ]);
  });

  it("collects the first four Claude user prompts for session disambiguation", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-prompts-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-prompts";
    const encoded = encodeClaudeProjectPath(cwd);
    const filePath = path.join(claudeRoot, "projects", encoded, "session-prompts.jsonl");
    await writeJsonl(filePath, [
      { type: "assistant", cwd, message: { content: "ignored assistant" } },
      { type: "user", cwd, message: { content: "第一条用户提问" } },
      { type: "user", cwd, message: { content: "第二条用户提问" } },
      { type: "user", cwd, message: { content: "   " } },
      { type: "user", cwd, content: [{ text: "第三条用户提问" }] },
      { type: "user", cwd, message: { content: "第四条用户提问" } },
      { type: "user", cwd, message: { content: "第五条不应显示" } },
    ]);

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd,
    }, claudeRoot);

    expect(sessions[0]).toMatchObject({
      preview: "ignored assistant",
      user_prompts: [
        "第一条用户提问",
        "第二条用户提问",
        "第三条用户提问",
        "第四条用户提问",
      ],
    });
  });

  it("collects Claude opening conversation excerpts with user and assistant roles", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-excerpts-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-excerpts";
    const encoded = encodeClaudeProjectPath(cwd);
    const filePath = path.join(claudeRoot, "projects", encoded, "session-excerpts.jsonl");
    await writeJsonl(filePath, [
      { type: "user", cwd, message: { content: "请分析这个历史会话入口问题" } },
      { type: "assistant", cwd, message: { content: "可以，先看会话列表的数据来源。" } },
      { type: "user", cwd, message: { content: "再看一下 UI 风格怎么统一" } },
      { type: "assistant", cwd, message: { content: "建议保留列表形态，但降低边框层级。" } },
    ]);

    const sessions = await listClaudeSessions({
      provider: "claude",
      scope: "project",
      cwd,
    }, claudeRoot);

    expect(sessions[0]?.conversation_excerpts).toEqual([
      { role: "user", text: "请分析这个历史会话入口问题" },
      { role: "assistant", text: "可以，先看会话列表的数据来源。" },
      { role: "user", text: "再看一下 UI 风格怎么统一" },
      { role: "assistant", text: "建议保留列表形态，但降低边框层级。" },
    ]);
  });

  it("reads Claude legacy sessions/<id>.jsonl layout", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-legacy-");
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
    const claudeRoot = await createTempDir("codedeck-claude-mismatch-");
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
    const claudeRoot = await createTempDir("codedeck-claude-recent-");
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
    const codexRoot = await createTempDir("codedeck-codex-");
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

  it("does not parse Codex project index entries beyond the requested page", async () => {
    const codexRoot = await createTempDir("codedeck-codex-project-page-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "019df0ff-page-01",
          thread_name: "First page 1",
          updated_at: "2026-05-04T10:59:00.000Z",
          cwd: "C:/workspace/current-project",
        }),
        JSON.stringify({
          id: "019df0ff-page-02",
          thread_name: "First page 2",
          updated_at: "2026-05-04T10:58:00.000Z",
          cwd: "C:/workspace/current-project",
        }),
        JSON.stringify({
          id: "019df0ff-page-bad",
          updated_at: "2026-05-04T10:57:00.000Z",
          cwd: "C:/workspace/current-project",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );
    const badFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-57-00-019df0ff-page-bad.jsonl",
    );
    await mkdir(path.dirname(badFile), { recursive: true });
    await writeFile(badFile, "{not valid jsonl\n", "utf-8");

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "project",
      cwd: "C:/workspace/current-project",
      limit: 2,
      offset: 0,
    }, codexRoot);

    expect(sessions.map((session) => session.session_id)).toEqual([
      "019df0ff-page-01",
      "019df0ff-page-02",
    ]);
  });

  it("returns an empty Codex session list when cwd does not match", async () => {
    const codexRoot = await createTempDir("codedeck-codex-empty-");
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
    const codexRoot = await createTempDir("codedeck-codex-recent-");
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

  it("classifies complete Codex index entries and collects enough visible page candidates", async () => {
    const codexRoot = await createTempDir("codedeck-codex-index-subagents-");
    tempDirs.push(codexRoot);
    const indexedSessions = [
      { id: "visible-new", updatedAt: "2026-05-04T10:40:00.000Z" },
      { id: "hidden", updatedAt: "2026-05-04T10:30:00.000Z", subagent: "review" },
      { id: "visible-old", updatedAt: "2026-05-04T10:20:00.000Z" },
    ];
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      `${indexedSessions.map((session) => JSON.stringify({
        id: session.id,
        thread_name: session.id,
        updated_at: session.updatedAt,
        cwd: "C:/workspace/project",
      })).join("\n")}\n`,
      "utf-8",
    );
    for (const session of indexedSessions) {
      await writeJsonl(
        path.join(
          codexRoot,
          "sessions",
          "2026",
          "05",
          "04",
          `rollout-${session.id}.jsonl`,
        ),
        [{
          type: "session_meta",
          payload: {
            id: session.id,
            cwd: "C:/workspace/project",
            updated_at: session.updatedAt,
            thread_name: session.id,
            source: session.subagent ? { subagent: session.subagent } : { originator: "codex_cli_rs" },
          },
        }],
      );
    }

    const hiddenGlobal = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
      limit: 2,
      hide_subagent_sessions: true,
    }, codexRoot);
    const hiddenProject = await listCodexSessions({
      provider: "codex",
      scope: "project",
      cwd: "C:/workspace/project",
      limit: 2,
      hide_subagent_sessions: true,
    }, codexRoot);
    const visible = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
      limit: 3,
      hide_subagent_sessions: false,
    }, codexRoot);

    expect(hiddenGlobal.map((session) => session.session_id)).toEqual(["visible-new", "hidden", "visible-old"]);
    expect(hiddenProject.map((session) => session.session_id)).toEqual(["visible-new", "hidden", "visible-old"]);
    expect(hiddenGlobal.find((session) => session.session_id === "hidden")?.is_subagent).toBe(true);
    expect(hiddenProject.find((session) => session.session_id === "hidden")?.is_subagent).toBe(true);
    expect(visible.map((session) => session.session_id)).toEqual(["visible-new", "hidden", "visible-old"]);
  });

  it("falls back to scanning Codex session files in global_recent scope when session_index is missing", async () => {
    const codexRoot = await createTempDir("codedeck-codex-no-index-");
    tempDirs.push(codexRoot);
    const olderFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-20-00-019df0ff-2000.jsonl",
    );
    const newerFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-30-00-019df0ff-2001.jsonl",
    );
    await writeJsonl(olderFile, [
      {
        type: "session_meta",
        payload: {
          id: "019df0ff-2000",
          cwd: "C:/workspace/older",
        },
      },
      {
        type: "response_item",
        payload: { message: "较旧 fallback 会话" },
      },
    ]);
    await writeJsonl(newerFile, [
      {
        type: "session_meta",
        payload: {
          id: "019df0ff-2001",
          cwd: "C:/workspace/newer",
        },
      },
      {
        type: "response_item",
        payload: { message: "较新 fallback 会话" },
      },
    ]);
    await setFileTime(olderFile, "2026-05-04T10:20:00.000Z");
    await setFileTime(newerFile, "2026-05-04T10:30:00.000Z");

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);

    expect(sessions.map((session) => session.session_id)).toEqual([
      "019df0ff-2001",
      "019df0ff-2000",
    ]);
    expect(sessions[0]).toMatchObject({
      provider: "codex",
      cwd: "C:/workspace/newer",
      preview: "较新 fallback 会话",
    });
  });

  it("classifies Codex sub-agent metadata in full and fast session summaries", async () => {
    const codexRoot = await createTempDir("codedeck-codex-subagents-");
    tempDirs.push(codexRoot);
    const records = [
      { id: "ordinary", source: { originator: "codex_cli_rs" } },
      { id: "string-subagent", source: { subagent: "review" } },
      { id: "object-subagent", source: { subagent: { thread_spawn: { depth: 1 } } } },
    ];
    for (const [index, payload] of records.entries()) {
      await writeJsonl(
        path.join(codexRoot, "sessions", "2026", "08", "11", `rollout-${payload.id}.jsonl`),
        [{
          type: "session_meta",
          payload: {
            ...payload,
            cwd: "C:/workspace/project",
            updated_at: `2026-08-11T10:0${index}:00.000Z`,
          },
        }],
      );
    }

    const full = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);
    const fast = (await scanCodexSessionCatalog(codexRoot)).map((entry) => entry.summary);

    for (const summaries of [full, fast]) {
      expect(summaries.find((session) => session.session_id === "ordinary")?.is_subagent).toBeUndefined();
      expect(summaries.find((session) => session.session_id === "string-subagent")?.is_subagent).toBe(true);
      expect(summaries.find((session) => session.session_id === "object-subagent")?.is_subagent).toBe(true);
    }
  });

  it("reuses cached Codex fallback scans until the session cache is invalidated", async () => {
    const codexRoot = await createTempDir("codedeck-codex-fallback-cache-");
    tempDirs.push(codexRoot);
    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-20-00-cached-1.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "cached-1",
            cwd: "C:/workspace/cache",
            updated_at: "2026-05-04T10:20:00.000Z",
            thread_name: "Cached first",
          },
        },
      ],
    );

    const first = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);
    expect(first.map((session) => session.session_id)).toEqual(["cached-1"]);

    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-30-00-cached-2.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "cached-2",
            cwd: "C:/workspace/cache",
            updated_at: "2026-05-04T10:30:00.000Z",
            thread_name: "Cached second",
          },
        },
      ],
    );

    const cached = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);
    expect(cached.map((session) => session.session_id)).toEqual(["cached-1"]);

    invalidateCodexSessionCache(codexRoot);

    const refreshed = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);
    expect(refreshed.map((session) => session.session_id)).toEqual(["cached-2", "cached-1"]);
  });

  it("merges Codex session files with an existing stale session_index", async () => {
    const codexRoot = await createTempDir("codedeck-codex-stale-index-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      `${JSON.stringify({
        id: "indexed-old",
        thread_name: "Indexed old",
        updated_at: "2026-05-04T10:20:00.000Z",
        cwd: "C:/workspace/indexed",
      })}\n`,
      "utf-8",
    );
    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-40-00-file-new.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "file-new",
            cwd: "C:/workspace/file",
            updated_at: "2026-05-04T10:40:00.000Z",
            thread_name: "File new",
          },
        },
      ],
    );

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);

    expect(sessions.map((session) => session.session_id)).toEqual([
      "file-new",
      "indexed-old",
    ]);
    expect(sessions[0]).toMatchObject({
      cwd: "C:/workspace/file",
      preview: "File new",
    });
  });

  it("finds Codex project sessions from files when session_index has no matching entry", async () => {
    const codexRoot = await createTempDir("codedeck-codex-project-file-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      `${JSON.stringify({
        id: "indexed-other",
        thread_name: "Indexed other",
        updated_at: "2026-05-04T10:20:00.000Z",
        cwd: "C:/workspace/other",
      })}\n`,
      "utf-8",
    );
    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-40-00-file-current.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "file-current",
            cwd: "C:/workspace/current",
            updated_at: "2026-05-04T10:40:00.000Z",
            thread_name: "File current",
          },
        },
      ],
    );

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "project",
      cwd: "C:/workspace/current",
    }, codexRoot);

    expect(sessions.map((session) => session.session_id)).toEqual(["file-current"]);
    expect(sessions[0]).toMatchObject({
      cwd: "C:/workspace/current",
      preview: "File current",
    });
  });

  it("collects the first four Codex user prompts when reading session files", async () => {
    const codexRoot = await createTempDir("codedeck-codex-prompts-");
    tempDirs.push(codexRoot);
    const sessionFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-30-00-019df0ff-prompts.jsonl",
    );
    await writeJsonl(sessionFile, [
      {
        type: "session_meta",
        payload: {
          id: "019df0ff-prompts",
          cwd: "C:/workspace/codex-prompts",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "第一条 Codex 提问" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "ignored assistant" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "第二条 Codex 提问" }],
        },
      },
      {
        type: "user",
        payload: {
          message: "第三条 Codex 提问",
        },
      },
      {
        role: "user",
        content: [{ text: "第四条 Codex 提问" }],
      },
      {
        role: "user",
        content: [{ text: "第五条不应显示" }],
      },
    ]);

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);

    expect(sessions[0]).toMatchObject({
      session_id: "019df0ff-prompts",
      user_prompts: [
        "第一条 Codex 提问",
        "第二条 Codex 提问",
        "第三条 Codex 提问",
        "第四条 Codex 提问",
      ],
    });
  });

  it("skips Codex environment context scaffolding when collecting user prompts", async () => {
    const codexRoot = await createTempDir("codedeck-codex-scaffold-");
    tempDirs.push(codexRoot);
    const sessionFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-40-00-019df0ff-scaffold.jsonl",
    );
    await writeJsonl(sessionFile, [
      {
        type: "session_meta",
        payload: {
          id: "019df0ff-scaffold",
          cwd: "C:/workspace/codex-scaffold",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>\n  <cwd>C:/workspace/codex-scaffold</cwd>\n</environment_context>" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "真正的第一条用户提问" }],
        },
      },
    ]);

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);

    expect(sessions[0]?.user_prompts).toEqual(["真正的第一条用户提问"]);
  });

  it("uses the first real Codex user prompt as the preview when leading records are scaffold text", async () => {
    const codexRoot = await createTempDir("codedeck-codex-preview-scaffold-");
    tempDirs.push(codexRoot);
    const sessionFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-35-00-019df0ff-preview-scaffold.jsonl",
    );
    await writeJsonl(sessionFile, [
      {
        type: "session_meta",
        payload: {
          id: "019df0ff-preview-scaffold",
          cwd: "C:/workspace/codex-preview",
        },
      },
      {
        type: "event_msg",
        payload: {
          message: "<permissions instructions>\nFilesystem sandboxing defines which files can be read.",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "当前软件启动codex的会话记录是在那里？" }],
        },
      },
    ]);

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);

    expect(sessions[0]).toMatchObject({
      session_id: "019df0ff-preview-scaffold",
      preview: "当前软件启动codex的会话记录是在那里？",
    });
  });

  it("collects Codex opening conversation excerpts while skipping scaffold prompts", async () => {
    const codexRoot = await createTempDir("codedeck-codex-excerpts-");
    tempDirs.push(codexRoot);
    const sessionFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-50-00-019df0ff-excerpts.jsonl",
    );
    await writeJsonl(sessionFile, [
      {
        type: "session_meta",
        payload: {
          id: "019df0ff-excerpts",
          cwd: "C:/workspace/codex-excerpts",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>\n  <cwd>C:/workspace/codex-excerpts</cwd>\n</environment_context>" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "先看历史记录展示问题" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "我会检查 SessionPicker 和 session-service。" }],
        },
      },
    ]);

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, codexRoot);

    expect(sessions[0]?.conversation_excerpts).toEqual([
      { role: "user", text: "先看历史记录展示问题" },
      { role: "assistant", text: "我会检查 SessionPicker 和 session-service。" },
    ]);
  });

  it("resolves a monitored Codex terminal title from the newest session after launch", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-title-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "old-session",
          thread_name: "旧会话不应绑定",
          updated_at: "2026-05-04T09:59:00.000Z",
          cwd,
        }),
        JSON.stringify({
          id: "new-session",
          thread_name: "监控窗口标题",
          updated_at: "2026-05-04T10:00:03.000Z",
          cwd,
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const title = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      codexHome: codexRoot,
    });

    expect(title).toEqual({
      status: "resolved",
      title: "监控窗口标题",
      sessionId: "new-session",
      candidateCount: 1,
    });
  });

  it("does not reuse a session title created shortly before a monitored launch", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-no-lookback-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      JSON.stringify({
        id: "other-session",
        thread_name: "其他窗口标题",
        updated_at: "2026-05-04T09:59:50.000Z",
        cwd,
      }) + "\n",
      "utf-8",
    );

    const title = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      codexHome: codexRoot,
    });

    expect(title).toEqual({ status: "pending", candidateCount: 0 });
  });

  it("keeps the generic title when concurrent launches create ambiguous candidates", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-ambiguous-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "new-session-a",
          thread_name: "并发窗口 A",
          updated_at: "2026-05-04T10:00:03.000Z",
          cwd,
        }),
        JSON.stringify({
          id: "new-session-b",
          thread_name: "并发窗口 B",
          updated_at: "2026-05-04T10:00:04.000Z",
          cwd,
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const title = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      codexHome: codexRoot,
    });

    expect(title).toEqual({ status: "ambiguous", candidateCount: 2 });
  });

  it("waits for the monitored Codex session whose first prompt matches the launch prompt", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-expected-preview-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";
    const initialPrompt = `绑定这个新会话 ${"x".repeat(140)}`;
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      `${JSON.stringify({
        id: "unrelated-active-session",
        thread_name: "同目录中的其他活跃会话",
        updated_at: "2026-05-04T10:00:03.000Z",
        cwd,
      })}\n`,
      "utf-8",
    );

    const pending = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      expectedPreview: initialPrompt,
      codexHome: codexRoot,
    });
    expect(pending).toEqual({ status: "pending", candidateCount: 0 });

    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-00-04-matching-session.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "matching-session",
            cwd,
            updated_at: "2026-05-04T10:00:04.000Z",
            thread_name: "生成后的会话标题",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: `${initialPrompt}不同的截断后内容` }],
          },
        },
      ],
    );

    const resolved = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      expectedPreview: initialPrompt,
      codexHome: codexRoot,
    });

    expect(resolved).toEqual({
      status: "resolved",
      title: "生成后的会话标题",
      sessionId: "matching-session",
      candidateCount: 1,
    });
  });

  it("keeps duplicate monitored Codex prompt matches ambiguous", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-expected-ambiguous-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";
    const initialPrompt = "执行相同的委托任务";
    for (const [sessionId, title, updatedAt] of [
      ["matching-session-a", "匹配会话 A", "2026-05-04T10:00:03.000Z"],
      ["matching-session-b", "匹配会话 B", "2026-05-04T10:00:04.000Z"],
    ]) {
      await writeJsonl(
        path.join(codexRoot, "sessions", "2026", "05", "04", `rollout-${sessionId}.jsonl`),
        [
          {
            type: "session_meta",
            payload: { id: sessionId, cwd, updated_at: updatedAt, thread_name: title },
          },
          {
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: initialPrompt }],
            },
          },
        ],
      );
    }

    const title = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      expectedPreview: initialPrompt,
      codexHome: codexRoot,
    });

    expect(title).toEqual({ status: "ambiguous", candidateCount: 2 });
  });

  it("refreshes Codex fallback sessions between monitored title lookup attempts", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-refresh-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";

    const missingTitle = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      codexHome: codexRoot,
    });
    expect(missingTitle).toEqual({ status: "pending", candidateCount: 0 });

    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-00-03-monitor-refresh.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "monitor-refresh",
            cwd,
            updated_at: "2026-05-04T10:00:03.000Z",
            thread_name: "稍后写入的标题",
          },
        },
      ],
    );

    const title = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      codexHome: codexRoot,
    });

    expect(title).toEqual({
      status: "resolved",
      title: "稍后写入的标题",
      sessionId: "monitor-refresh",
      candidateCount: 1,
    });
  });

  it("finds a live Codex session before it appears in an existing session index", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-live-fallback-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      JSON.stringify({
        id: "old-indexed-session",
        thread_name: "旧索引会话",
        updated_at: "2026-05-04T09:00:00.000Z",
        cwd,
      }) + "\n",
      "utf-8",
    );
    const liveFile = path.join(
      codexRoot,
      "sessions",
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-00-03-live-session.jsonl",
    );
    await writeJsonl(liveFile, [{
      type: "session_meta",
      payload: {
        id: "live-session",
        cwd,
        updated_at: "2026-05-04T10:00:03.000Z",
        thread_name: "实时会话标题",
      },
    }]);
    await setFileTime(liveFile, "2026-05-04T10:00:03.000Z");

    const title = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      codexHome: codexRoot,
    });

    expect(title).toEqual({
      status: "resolved",
      title: "实时会话标题",
      sessionId: "live-session",
      candidateCount: 1,
    });
  });

  it("prefers the selected Codex resume session id even when it is older than launch", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-resume-");
    tempDirs.push(codexRoot);
    const cwd = "C:/workspace/current-project";
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "selected-session",
          thread_name: "恢复的旧会话",
          updated_at: "2026-05-04T09:00:00.000Z",
          cwd,
        }),
        JSON.stringify({
          id: "other-new-session",
          thread_name: "不应抢占恢复窗口",
          updated_at: "2026-05-04T10:00:03.000Z",
          cwd,
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const title = await findMonitoredTerminalSessionTitle({
      provider: "codex",
      cwd,
      sessionId: "selected-session",
      startedAt: "2026-05-04T10:00:00.000Z",
      codexHome: codexRoot,
    });

    expect(title).toEqual({
      status: "resolved",
      title: "恢复的旧会话",
      sessionId: "selected-session",
      candidateCount: 1,
    });
  });

  it("resolves a monitored Claude terminal title from project session history", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-monitor-title-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-a";
    const encoded = encodeClaudeProjectPath(cwd);
    const oldFile = path.join(claudeRoot, "projects", encoded, "old-session.jsonl");
    const newFile = path.join(claudeRoot, "projects", encoded, "new-session.jsonl");
    await writeJsonl(oldFile, [{ type: "user", cwd, message: { content: "旧 Claude 会话" } }]);
    await writeJsonl(newFile, [{ type: "user", cwd, message: { content: "Claude 监控标题" } }]);
    await setFileTime(oldFile, "2026-05-04T09:59:00.000Z");
    await setFileTime(newFile, "2026-05-04T10:00:03.000Z");

    const title = await findMonitoredTerminalSessionTitle({
      provider: "claude",
      cwd,
      startedAt: "2026-05-04T10:00:00.000Z",
      claudeHome: claudeRoot,
    });

    expect(title).toEqual({
      status: "resolved",
      title: "Claude 监控标题",
      sessionId: "new-session",
      candidateCount: 1,
    });
  });

  it("merges app runtime and global Codex sessions with app runtime taking precedence", async () => {
    const appHome = await createTempDir("codedeck-codex-app-");
    const globalHome = await createTempDir("codedeck-codex-global-");
    tempDirs.push(appHome, globalHome);

    await writeFile(
      path.join(appHome, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "shared-session",
          thread_name: "App runtime wins",
          updated_at: "2026-05-04T10:40:00.000Z",
          cwd: "C:/workspace/app",
        }),
        JSON.stringify({
          id: "app-only",
          thread_name: "App only",
          updated_at: "2026-05-04T10:20:00.000Z",
          cwd: "C:/workspace/app",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );
    await writeFile(
      path.join(globalHome, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "shared-session",
          thread_name: "Global duplicate",
          updated_at: "2026-05-04T10:50:00.000Z",
          cwd: "C:/workspace/global",
        }),
        JSON.stringify({
          id: "global-only",
          thread_name: "Global only",
          updated_at: "2026-05-04T10:30:00.000Z",
          cwd: "C:/workspace/global",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const sessions = await listCodexSessionsFromHomes({
      provider: "codex",
      scope: "global_recent",
    }, [
      { kind: "app_runtime", home: appHome },
      { kind: "global_codex", home: globalHome },
    ]);

    expect(sessions.map((session) => session.session_id)).toEqual([
      "shared-session",
      "global-only",
      "app-only",
    ]);
    expect(sessions.find((session) => session.session_id === "shared-session")).toMatchObject({
      preview: "App runtime wins",
      source_kind: "app_runtime",
      source_home: appHome,
    });
    expect(sessions.find((session) => session.session_id === "global-only")).toMatchObject({
      preview: "Global only",
      source_kind: "global_codex",
      source_home: globalHome,
    });
  });

  it("resolves Codex detail only from the supplied canonical home and normalizes source metadata", async () => {
    const canonicalHome = await createTempDir("codedeck-codex-canonical-detail-");
    const runtimeHome = await createTempDir("codedeck-codex-runtime-detail-");
    tempDirs.push(canonicalHome, runtimeHome);
    for (const [home, title] of [[canonicalHome, "Canonical"], [runtimeHome, "Legacy runtime"]] as const) {
      await writeJsonl(
        path.join(home, "sessions", "2026", "08", "16", "rollout-shared-detail.jsonl"),
        [{
          type: "session_meta",
          payload: {
            id: "shared-detail",
            cwd: "C:/workspace/project",
            updated_at: "2026-08-16T10:00:00.000Z",
            thread_name: title,
          },
        }],
      );
    }

    const detail = await getCodexSessionDetail({
      provider: "codex",
      scope: "global_recent",
      session_id: "shared-detail",
      source_kind: "app_runtime",
      source_home: runtimeHome,
    }, canonicalHome);

    expect(detail).toMatchObject({
      preview: "Canonical",
      source_kind: "global_codex",
      source_home: canonicalHome,
    });
  });

  it("uses Codex session_index entries without cwd for global pagination without reading session files", async () => {
    const codexRoot = await createTempDir("codedeck-codex-index-fast-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      Array.from({ length: 25 }, (_, index) => JSON.stringify({
        id: `indexed-${String(index + 1).padStart(2, "0")}`,
        updated_at: `2026-05-04T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
      })).join("\n") + "\n",
      "utf-8",
    );
    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-59-00-indexed-01.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "indexed-01",
            cwd: "C:/workspace/indexed",
            thread_name: "Should not be read from jsonl",
          },
        },
      ],
    );

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
      limit: 20,
      offset: 0,
    }, codexRoot);

    expect(sessions).toHaveLength(20);
    expect(sessions[0]).toMatchObject({
      session_id: "indexed-01",
      preview: "indexed-01",
    });
    expect(sessions.map((session) => session.session_id)).not.toContain("indexed-21");
  });

  it("reads only newly appended Codex index records on the next page refresh", async () => {
    const codexRoot = await createTempDir("codedeck-codex-index-append-");
    tempDirs.push(codexRoot);
    const indexPath = path.join(codexRoot, "session_index.jsonl");
    await writeFile(indexPath, `${JSON.stringify({
      id: "indexed-old",
      thread_name: "Old",
      updated_at: "2026-05-04T10:00:00.000Z",
    })}\n`, "utf-8");

    await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
      limit: 20,
      offset: 0,
    }, codexRoot);
    await appendFile(indexPath, `${JSON.stringify({
      id: "indexed-new",
      thread_name: "New",
      updated_at: "2026-05-04T11:00:00.000Z",
    })}\n`, "utf-8");

    const refreshed = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
      limit: 20,
      offset: 0,
    }, codexRoot);
    expect(refreshed.map((session) => session.session_id)).toEqual(["indexed-new", "indexed-old"]);
  });

  it("keeps complete Codex index summaries from being overwritten by fallback files", async () => {
    const codexRoot = await createTempDir("codedeck-codex-index-only-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      `${JSON.stringify({
        id: "indexed-fast",
        thread_name: "Index preview",
        updated_at: "2026-05-04T10:00:00.000Z",
        cwd: "C:/workspace/indexed",
      })}\n`,
      "utf-8",
    );
    await writeJsonl(
      path.join(codexRoot, "sessions", "2026", "05", "04", "rollout-2026-05-04T11-00-00-indexed-fast.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "indexed-fast",
            cwd: "C:/workspace/indexed",
            updated_at: "2026-05-04T11:00:00.000Z",
            thread_name: "Fallback file should not win",
          },
        },
      ],
    );

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
      limit: 1,
      offset: 0,
    }, codexRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      session_id: "indexed-fast",
      preview: "Index preview",
      updated_at: "2026-05-04T10:00:00.000Z",
    });
  });

  it("applies offset after merging Codex app runtime and global homes", async () => {
    const appHome = await createTempDir("codedeck-codex-app-page-");
    const globalHome = await createTempDir("codedeck-codex-global-page-");
    tempDirs.push(appHome, globalHome);
    await writeFile(
      path.join(appHome, "session_index.jsonl"),
      Array.from({ length: 15 }, (_, index) => JSON.stringify({
        id: `app-${String(index + 1).padStart(2, "0")}`,
        thread_name: `App ${index + 1}`,
        updated_at: `2026-05-04T11:${String(59 - index).padStart(2, "0")}:00.000Z`,
        cwd: "C:/workspace/app",
      })).join("\n") + "\n",
      "utf-8",
    );
    await writeFile(
      path.join(globalHome, "session_index.jsonl"),
      Array.from({ length: 15 }, (_, index) => JSON.stringify({
        id: `global-${String(index + 1).padStart(2, "0")}`,
        thread_name: `Global ${index + 1}`,
        updated_at: `2026-05-04T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
        cwd: "C:/workspace/global",
      })).join("\n") + "\n",
      "utf-8",
    );

    const sessions = await listCodexSessionsFromHomes({
      provider: "codex",
      scope: "global_recent",
      limit: 20,
      offset: 20,
    }, [
      { kind: "app_runtime", home: appHome },
      { kind: "global_codex", home: globalHome },
    ]);

    expect(sessions).toHaveLength(10);
    expect(sessions[0]?.session_id).toBe("global-06");
  });

  it("filters merged Codex homes by cwd in project scope", async () => {
    const appHome = await createTempDir("codedeck-codex-app-project-");
    const globalHome = await createTempDir("codedeck-codex-global-project-");
    tempDirs.push(appHome, globalHome);

    await writeFile(
      path.join(appHome, "session_index.jsonl"),
      `${JSON.stringify({
        id: "app-match",
        thread_name: "App match",
        updated_at: "2026-05-04T10:20:00.000Z",
        cwd: "C:/workspace/current",
      })}\n`,
      "utf-8",
    );
    await writeFile(
      path.join(globalHome, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "global-match",
          thread_name: "Global match",
          updated_at: "2026-05-04T10:30:00.000Z",
          cwd: "C:/workspace/current",
        }),
        JSON.stringify({
          id: "global-other",
          thread_name: "Global other",
          updated_at: "2026-05-04T10:40:00.000Z",
          cwd: "C:/workspace/other",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const sessions = await listCodexSessionsFromHomes({
      provider: "codex",
      scope: "project",
      cwd: "C:/workspace/current",
    }, [
      { kind: "app_runtime", home: appHome },
      { kind: "global_codex", home: globalHome },
    ]);

    expect(sessions.map((session) => session.session_id)).toEqual([
      "global-match",
      "app-match",
    ]);
  });

  it("starts loading all Codex homes before awaiting merged results", async () => {
    let resolveApp!: (value: SessionSummary[]) => void;
    let resolveGlobal!: (value: SessionSummary[]) => void;
    const loadSessions = vi.fn((_request: ListSessionsRequest, home?: string) => {
      if (home === "C:/codex/app") {
        return new Promise<SessionSummary[]>((resolve) => {
          resolveApp = resolve;
        });
      }
      if (home === "C:/codex/global") {
        return new Promise<SessionSummary[]>((resolve) => {
          resolveGlobal = resolve;
        });
      }
      throw new Error(`unexpected home: ${home}`);
    });

    const pending = listCodexSessionsFromHomes({
      provider: "codex",
      scope: "global_recent",
    }, [
      { kind: "app_runtime", home: "C:/codex/app" },
      { kind: "global_codex", home: "C:/codex/global" },
    ], {
      listCodexSessions: loadSessions,
    });

    await Promise.resolve();

    expect(loadSessions).toHaveBeenCalledTimes(2);

    resolveGlobal([
      {
        provider: "codex",
        session_id: "global-1",
        cwd: "C:/workspace/global",
        updated_at: "2026-05-15T11:00:00.000Z",
        preview: "global-1",
      },
    ]);
    resolveApp([
      {
        provider: "codex",
        session_id: "app-1",
        cwd: "C:/workspace/app",
        updated_at: "2026-05-15T12:00:00.000Z",
        preview: "app-1",
      },
    ]);

    await expect(pending).resolves.toMatchObject([
      { session_id: "app-1" },
      { session_id: "global-1" },
    ]);
  });

  it("imports a global Codex session into the runtime home before restore", async () => {
    const runtimeHome = await createTempDir("codedeck-codex-runtime-import-");
    const globalHome = await createTempDir("codedeck-codex-global-import-");
    tempDirs.push(runtimeHome, globalHome);
    await writeFile(
      path.join(globalHome, "session_index.jsonl"),
      `${JSON.stringify({
        id: "global-session",
        thread_name: "Global session",
        updated_at: "2026-05-04T10:30:00.000Z",
        cwd: "C:/workspace/global",
      })}\n`,
      "utf-8",
    );
    await writeJsonl(
      path.join(globalHome, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-30-00-global-session.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "global-session",
            cwd: "C:/workspace/global",
          },
        },
      ],
    );

    await copyCodexSessionBetweenHomes({
      sessionId: "global-session",
      sourceHome: globalHome,
      targetHome: runtimeHome,
    });

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, runtimeHome);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      session_id: "global-session",
      preview: "Global session",
    });
  });

  it("copies a Codex session between explicit homes", async () => {
    const runtimeHome = await createTempDir("codedeck-codex-runtime-export-");
    const globalHome = await createTempDir("codedeck-codex-global-export-");
    tempDirs.push(runtimeHome, globalHome);
    await writeJsonl(
      path.join(runtimeHome, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-30-00-runtime-session.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "runtime-session",
            cwd: "C:/workspace/runtime",
            updated_at: "2026-05-04T10:30:00.000Z",
            thread_name: "Runtime session",
          },
        },
      ],
    );

    await expect(copyCodexSessionBetweenHomes({
      sessionId: "runtime-session",
      sourceHome: runtimeHome,
      targetHome: globalHome,
    })).resolves.toBe("copied");

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, globalHome);
    expect(sessions).toMatchObject([{
      session_id: "runtime-session",
      preview: "Runtime session",
    }]);
  });

  it("does not overwrite an existing target Codex session", async () => {
    const sourceHome = await createTempDir("codedeck-codex-source-existing-");
    const targetHome = await createTempDir("codedeck-codex-target-existing-");
    tempDirs.push(sourceHome, targetHome);
    const relativePath = path.join(
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-30-00-shared-session.jsonl",
    );
    const sourcePath = path.join(sourceHome, "sessions", relativePath);
    const targetPath = path.join(targetHome, "sessions", relativePath);
    await writeJsonl(sourcePath, [{
      type: "session_meta",
      payload: { id: "shared-session", thread_name: "Source version" },
    }]);
    await writeJsonl(targetPath, [{
      type: "session_meta",
      payload: { id: "shared-session", thread_name: "Target version" },
    }]);

    await expect(copyCodexSessionBetweenHomes({
      sessionId: "shared-session",
      sourceHome,
      targetHome,
      sourceFileRelativePath: relativePath,
    })).resolves.toBe("already_present");

    const targetContent = await readFile(targetPath, "utf-8");
    expect(targetContent).toContain("Target version");
    expect(targetContent).not.toContain("Source version");
  });

  it("copies the rollout when the target index exists without a session file", async () => {
    const sourceHome = await createTempDir("codedeck-codex-source-index-only-");
    const targetHome = await createTempDir("codedeck-codex-target-index-only-");
    tempDirs.push(sourceHome, targetHome);
    const relativePath = path.join(
      "2026",
      "05",
      "04",
      "rollout-2026-05-04T10-30-00-index-only-session.jsonl",
    );
    await writeJsonl(path.join(sourceHome, "sessions", relativePath), [{
      type: "session_meta",
      payload: {
        id: "index-only-session",
        cwd: "C:/workspace/source",
        updated_at: "2026-05-04T10:30:00.000Z",
      },
    }]);
    await writeFile(path.join(targetHome, "session_index.jsonl"), `${JSON.stringify({
      id: "index-only-session",
      thread_name: "Missing rollout",
      updated_at: "2026-05-04T10:30:00.000Z",
      cwd: "C:/workspace/source",
    })}\n`, "utf-8");

    await expect(copyCodexSessionBetweenHomes({
      sessionId: "index-only-session",
      sourceHome,
      targetHome,
      sourceFileRelativePath: relativePath,
    })).resolves.toBe("copied");

    await expect(readFile(path.join(targetHome, "sessions", relativePath), "utf-8"))
      .resolves.toContain("index-only-session");
  });

  it("imports a global Codex session from a known relative source path before scanning fallback files", async () => {
    const runtimeHome = await createTempDir("codedeck-codex-runtime-known-import-");
    const globalHome = await createTempDir("codedeck-codex-global-known-import-");
    tempDirs.push(runtimeHome, globalHome);
    const selectedRelativePath = path.join("2026", "05", "04", "rollout-2026-05-04T10-30-00-global-known.jsonl");
    await writeJsonl(
      path.join(globalHome, "sessions", selectedRelativePath),
      [
        {
          type: "session_meta",
          payload: {
            id: "global-known",
            cwd: "C:/workspace/global",
            updated_at: "2026-05-04T10:30:00.000Z",
            thread_name: "Known source file",
          },
        },
      ],
    );
    await writeJsonl(
      path.join(globalHome, "sessions", "2026", "05", "05", "rollout-2026-05-05T10-30-00-global-known.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "global-known",
            cwd: "C:/workspace/global",
            updated_at: "2026-05-05T10:30:00.000Z",
            thread_name: "Fallback scan should not win",
          },
        },
      ],
    );

    await copyCodexSessionBetweenHomes({
      sessionId: "global-known",
      sourceHome: globalHome,
      targetHome: runtimeHome,
      sourceFileRelativePath: selectedRelativePath,
    });

    const sessions = await listCodexSessions({
      provider: "codex",
      scope: "global_recent",
    }, runtimeHome);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      session_id: "global-known",
      preview: "Known source file",
      updated_at: "2026-05-04T10:30:00.000Z",
    });
  });

  it("rejects importing a global Codex session when the source jsonl file is missing", async () => {
    const runtimeHome = await createTempDir("codedeck-codex-runtime-missing-");
    const globalHome = await createTempDir("codedeck-codex-global-missing-");
    tempDirs.push(runtimeHome, globalHome);
    await writeFile(
      path.join(globalHome, "session_index.jsonl"),
      `${JSON.stringify({
        id: "missing-file-session",
        thread_name: "Missing file",
        updated_at: "2026-05-04T10:30:00.000Z",
        cwd: "C:/workspace/global",
      })}\n`,
      "utf-8",
    );

    await expect(copyCodexSessionBetweenHomes({
      sessionId: "missing-file-session",
      sourceHome: globalHome,
      targetHome: runtimeHome,
    })).rejects.toThrow("源 Codex home 中未找到该会话文件，请刷新会话列表后重试。");
  });

  it("writes a minimal runtime index when importing a global Codex session without source index", async () => {
    const runtimeHome = await createTempDir("codedeck-codex-runtime-file-import-");
    const globalHome = await createTempDir("codedeck-codex-global-file-import-");
    tempDirs.push(runtimeHome, globalHome);
    await writeJsonl(
      path.join(globalHome, "sessions", "2026", "05", "04", "rollout-2026-05-04T10-30-00-global-file-only.jsonl"),
      [
        {
          type: "session_meta",
          payload: {
            id: "global-file-only",
            cwd: "C:/workspace/global-file",
            updated_at: "2026-05-04T10:30:00.000Z",
            thread_name: "Global file only",
          },
        },
      ],
    );

    await copyCodexSessionBetweenHomes({
      sessionId: "global-file-only",
      sourceHome: globalHome,
      targetHome: runtimeHome,
    });

    const indexContent = await readFile(path.join(runtimeHome, "session_index.jsonl"), "utf-8");
    const indexEntry = JSON.parse(indexContent.trim());

    expect(indexEntry).toMatchObject({
      id: "global-file-only",
      thread_name: "Global file only",
      updated_at: "2026-05-04T10:30:00.000Z",
      cwd: "C:/workspace/global-file",
    });
  });

  it("skips a bad JSONL file without affecting other sessions", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-bad-");
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

  it("reads Claude project summary from the leading records without parsing invalid trailing JSONL", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-summary-fast-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-a";
    const encoded = encodeClaudeProjectPath(cwd);
    const filePath = path.join(claudeRoot, "projects", encoded, "summary-fast.jsonl");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({
        type: "user",
        cwd,
        message: { content: "快速摘要只需要这一条" },
      })}\n{not-valid-json}\n`,
      "utf-8",
    );
    await setFileTime(filePath, "2026-05-04T10:00:00.000Z");

    const request = {
      provider: "claude",
      scope: "project" as const,
      cwd,
      detail: "summary" as const,
    } as ListSessionsRequest & { detail: "summary" };
    const sessions = await listClaudeSessions(request, claudeRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: "claude",
      session_id: "summary-fast",
      cwd,
      preview: "快速摘要只需要这一条",
      user_prompts: ["快速摘要只需要这一条"],
    });
  });

  it("requires cwd in project scope", async () => {
    const request: ListSessionsRequest = {
      provider: "claude",
      scope: "project",
    };

    await expect(listSessionsForProvider(request)).rejects.toThrow("cwd");
  });

  it("resolves the backing Claude monitored-session file", async () => {
    const claudeRoot = await createTempDir("codedeck-claude-monitor-file-");
    tempDirs.push(claudeRoot);
    const cwd = "C:/workspace/project-a";
    const filePath = path.join(
      claudeRoot,
      "projects",
      encodeClaudeProjectPath(cwd),
      "claude-monitor.jsonl",
    );
    await writeJsonl(filePath, [{ type: "user", cwd, message: { content: "任务" } }]);

    await expect(resolveMonitoredTerminalSessionFile({
      provider: "claude",
      cwd,
      sessionId: "claude-monitor",
      claudeHome: claudeRoot,
    })).resolves.toBe(filePath);
  });

  it("resolves the backing Codex monitored-session file", async () => {
    const codexRoot = await createTempDir("codedeck-codex-monitor-file-");
    tempDirs.push(codexRoot);
    const sessionId = "019f57b5-2c12-7a12-a4f4-0f0fc1fbcd94";
    const filePath = path.join(
      codexRoot,
      "sessions",
      "2026",
      "07",
      "13",
      `rollout-2026-07-13T04-00-00-${sessionId}.jsonl`,
    );
    await writeJsonl(filePath, [{
      type: "session_meta",
      payload: { id: sessionId, cwd: "C:/workspace/project-a" },
    }]);

    await expect(resolveMonitoredTerminalSessionFile({
      provider: "codex",
      cwd: "C:/workspace/project-a",
      sessionId,
      codexHome: codexRoot,
    })).resolves.toBe(filePath);
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
