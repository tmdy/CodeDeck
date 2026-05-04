// 会话服务 — 会话扫描和解析

export interface SessionSummary {
  session_id: string;
  cwd: string;
  updated_at: string;
  preview: string;
}

export async function listClaudeSessions(
  cwd: string,
  claudeHome?: string,
): Promise<SessionSummary[]> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");

  const home = claudeHome || path.join(os.homedir(), ".claude", "projects");
  const sessions: SessionSummary[] = [];

  try {
    const entries = await fs.readdir(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(home, entry.name);
      const sessionsPath = path.join(projectPath, "sessions");
      try {
        await fs.access(sessionsPath);
      } catch {
        continue;
      }

      const sessionFiles = await fs.readdir(sessionsPath);
      for (const file of sessionFiles) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(sessionsPath, file);
        const stat = await fs.stat(filePath);

        // 获取首行预览
        let preview = "";
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const lines = content.trim().split("\n");
          if (lines.length > 0) {
            const firstLine = JSON.parse(lines[0]);
            preview =
              firstLine.content?.text?.slice(0, 120) ||
              firstLine.message?.content?.slice(0, 120) ||
              "";
          }
        } catch {
          // 忽略解析错误
        }

        sessions.push({
          session_id: file.replace(".jsonl", ""),
          cwd: projectPath,
          updated_at: stat.mtime.toISOString(),
          preview,
        });
      }
    }
  } catch {
    // 目录可能不存在
  }

  // 按时间降序
  sessions.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  // 按 cwd 过滤
  if (cwd) {
    return sessions.filter(
      (s) => s.cwd.toLowerCase() === cwd.toLowerCase(),
    );
  }

  return sessions;
}

export async function listCodexSessions(
  cwd: string,
  codexHome?: string,
): Promise<SessionSummary[]> {
  // Codex 会话结构类似
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");

  const home = codexHome || path.join(os.homedir(), ".codex", "projects");
  const sessions: SessionSummary[] = [];

  try {
    const entries = await fs.readdir(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(home, entry.name);
      const sessionsPath = path.join(projectPath, "sessions");
      try {
        await fs.access(sessionsPath);
      } catch {
        continue;
      }

      const sessionFiles = await fs.readdir(sessionsPath);
      for (const file of sessionFiles) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(sessionsPath, file);
        const stat = await fs.stat(filePath);

        let preview = "";
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const lines = content.trim().split("\n");
          if (lines.length > 0) {
            const firstLine = JSON.parse(lines[0]);
            preview =
              firstLine.content?.text?.slice(0, 120) ||
              firstLine.message?.content?.slice(0, 120) ||
              "";
          }
        } catch {
          // 忽略
        }

        sessions.push({
          session_id: file.replace(".jsonl", ""),
          cwd: projectPath,
          updated_at: stat.mtime.toISOString(),
          preview,
        });
      }
    }
  } catch {
    // 目录不存在
  }

  sessions.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  if (cwd) {
    return sessions.filter(
      (s) => s.cwd.toLowerCase() === cwd.toLowerCase(),
    );
  }

  return sessions;
}