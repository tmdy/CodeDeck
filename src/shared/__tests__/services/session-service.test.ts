import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeClaudeProjectPath,
  importCodexSessionToRuntimeHome,
  type ListSessionsRequest,
  type SessionSummary,
  listClaudeSessions,
  listCodexSessions,
  listCodexSessionsFromHomes,
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

  it("keeps Claude project sessions when any historical cwd matches the requested cwd", async () => {
    const claudeRoot = await createTempDir("skills-manager-claude-history-cwd-");
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
    const claudeRoot = await createTempDir("skills-manager-claude-page-");
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
    const claudeRoot = await createTempDir("skills-manager-claude-prompts-");
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
    const claudeRoot = await createTempDir("skills-manager-claude-excerpts-");
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

  it("does not parse Codex project index entries beyond the requested page", async () => {
    const codexRoot = await createTempDir("skills-manager-codex-project-page-");
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

  it("falls back to scanning Codex session files in global_recent scope when session_index is missing", async () => {
    const codexRoot = await createTempDir("skills-manager-codex-no-index-");
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

  it("merges Codex session files with an existing stale session_index", async () => {
    const codexRoot = await createTempDir("skills-manager-codex-stale-index-");
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
    const codexRoot = await createTempDir("skills-manager-codex-project-file-");
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
    const codexRoot = await createTempDir("skills-manager-codex-prompts-");
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
    const codexRoot = await createTempDir("skills-manager-codex-scaffold-");
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
    const codexRoot = await createTempDir("skills-manager-codex-preview-scaffold-");
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
    const codexRoot = await createTempDir("skills-manager-codex-excerpts-");
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

  it("merges app runtime and global Codex sessions with app runtime taking precedence", async () => {
    const appHome = await createTempDir("skills-manager-codex-app-");
    const globalHome = await createTempDir("skills-manager-codex-global-");
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

  it("uses Codex session_index for global recent pagination without reading session files", async () => {
    const codexRoot = await createTempDir("skills-manager-codex-index-fast-");
    tempDirs.push(codexRoot);
    await writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      Array.from({ length: 25 }, (_, index) => JSON.stringify({
        id: `indexed-${String(index + 1).padStart(2, "0")}`,
        updated_at: `2026-05-04T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
        cwd: "C:/workspace/indexed",
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

  it("applies offset after merging Codex app runtime and global homes", async () => {
    const appHome = await createTempDir("skills-manager-codex-app-page-");
    const globalHome = await createTempDir("skills-manager-codex-global-page-");
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
    const appHome = await createTempDir("skills-manager-codex-app-project-");
    const globalHome = await createTempDir("skills-manager-codex-global-project-");
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
    const runtimeHome = await createTempDir("skills-manager-codex-runtime-import-");
    const globalHome = await createTempDir("skills-manager-codex-global-import-");
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

    await importCodexSessionToRuntimeHome({
      sessionId: "global-session",
      sourceHome: globalHome,
      runtimeHome,
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

  it("rejects importing a global Codex session when the source jsonl file is missing", async () => {
    const runtimeHome = await createTempDir("skills-manager-codex-runtime-missing-");
    const globalHome = await createTempDir("skills-manager-codex-global-missing-");
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

    await expect(importCodexSessionToRuntimeHome({
      sessionId: "missing-file-session",
      sourceHome: globalHome,
      runtimeHome,
    })).rejects.toThrow("全局 .codex 中未找到该会话文件，无法导入恢复。");
  });

  it("writes a minimal runtime index when importing a global Codex session without source index", async () => {
    const runtimeHome = await createTempDir("skills-manager-codex-runtime-file-import-");
    const globalHome = await createTempDir("skills-manager-codex-global-file-import-");
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

    await importCodexSessionToRuntimeHome({
      sessionId: "global-file-only",
      sourceHome: globalHome,
      runtimeHome,
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
