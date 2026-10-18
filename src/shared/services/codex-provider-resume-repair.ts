import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;

export interface CodexProviderResumeRepairOptions {
  filePath: string;
  sessionId: string;
  targetProvider: string;
}

export interface CodexProviderResumeRepairPlan extends CodexProviderResumeRepairOptions {
  originalSize: number;
  originalMtimeMs: number;
  originalSha256: string;
  appendText: string;
  appendSha256: string;
  removedReasoningItems: number;
  preservedHistoryItems: number;
  sourceProviders: string[];
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function responseItem(value: unknown): JsonObject {
  const item = object(value);
  if (!item || typeof item.type !== "string") {
    throw new Error("会话恢复转换不支持此历史条目结构，原会话未修改。");
  }
  return item;
}

function unsupported(): Error {
  return new Error("此会话含分页、回滚或其他无法安全还原的历史状态，原会话未修改。");
}

/** Prepare an append-only checkpoint. Never change the original rollout here. */
export async function prepareCodexProviderResumeRepair(
  options: CodexProviderResumeRepairOptions,
): Promise<CodexProviderResumeRepairPlan | null> {
  if (!options.sessionId.trim() || !options.targetProvider.trim()) {
    throw new Error("会话恢复转换需要明确的会话 ID 和目标 provider。");
  }
  const before = await fs.stat(options.filePath);
  const hash = createHash("sha256");
  const stream = createReadStream(options.filePath);
  let lastByte: number | undefined;
  stream.on("data", (chunk: Buffer | string) => {
    hash.update(chunk);
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (bytes.length) lastByte = bytes[bytes.length - 1];
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let history: JsonObject[] = [];
  let metadata: JsonObject[] = [];
  let owners: string[] = [];
  let currentProvider = "";
  let compaction: JsonObject = { message: "" };
  let companionRecords: JsonObject[] = [];
  let latestTokenUsage: unknown = null;
  let resumeMetadata: JsonObject | null = null;
  let latestContext: JsonObject | undefined;
  let hasTurnBaseline = false;
  let invalidActiveHistory = false;
  let foundSession = false;
  const providers = new Set<string>();
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record: JsonObject | undefined;
      try { record = object(JSON.parse(line)); } catch {
        throw new Error("会话文件含损坏或未写完的记录，请退出会话后重试；原会话未修改。");
      }
      const payload = object(record?.payload);
      if (!record || !payload) {
        throw new Error("会话文件含无法识别的记录，原会话未修改。");
      }
      if (record.type === "session_meta") {
        if (payload.id !== options.sessionId) {
          throw new Error("会话文件中的 ID 与选中会话不一致，原会话未修改。");
        }
        foundSession = true;
        if (typeof payload.model_provider === "string") {
          currentProvider = payload.model_provider;
          providers.add(currentProvider);
        }
      } else if (record.type === "compacted") {
        // A later complete legacy checkpoint supersedes earlier history/rollback.
        if (!Array.isArray(payload.replacement_history)) {
          invalidActiveHistory = true;
          continue;
        }
        history = payload.replacement_history.map(responseItem);
        const repairedProvider = object(record.codedeck_provider_resume_repair)?.model_provider;
        if (typeof repairedProvider === "string") currentProvider = repairedProvider;
        owners = history.map(() => currentProvider);
        const checkpointMetadata = payload.replacement_history_metadata;
        if (checkpointMetadata != null && (!Array.isArray(checkpointMetadata)
          || checkpointMetadata.length !== history.length
          || checkpointMetadata.some((value) => !object(value)))) {
          throw new Error("会话压缩记录的历史元数据不匹配，原会话未修改。");
        }
        metadata = history.map((_, index) => object((checkpointMetadata as unknown[] | undefined)?.[index]) ?? {});
        compaction = payload;
        companionRecords = [];
        latestTokenUsage = payload.latest_token_usage_record ?? null;
        resumeMetadata = object(payload.resume_metadata) ? { ...object(payload.resume_metadata) } : null;
        latestContext = undefined;
        hasTurnBaseline = false;
        invalidActiveHistory = false;
      } else if (record.type === "response_item") {
        history.push(responseItem(payload));
        metadata.push(object(record.metadata) ?? {});
        owners.push(currentProvider);
        if (payload.type === "message" && payload.role === "user") hasTurnBaseline = true;
      } else if (record.type === "inter_agent_communication"
        || record.type === "inter_agent_communication_metadata") {
        invalidActiveHistory = true;
      } else if (record.type === "retained_context" || record.type === "world_state"
        || record.type === "token_usage_record") {
        companionRecords.push(record);
        if (record.type === "token_usage_record") latestTokenUsage = payload;
        if (record.type === "world_state" && payload.full === true) hasTurnBaseline = true;
      } else if (record.type === "event_msg") {
        if (payload.type === "thread_rolled_back") invalidActiveHistory = true;
        if (payload.type === "user_message") hasTurnBaseline = true;
        if ((payload.type === "task_started" || payload.type === "turn_started") && typeof payload.turn_id === "string") {
          resumeMetadata = { ...(resumeMetadata ?? {}), last_started_turn_id: payload.turn_id };
        }
        if ((payload.type === "task_complete" || payload.type === "turn_completed" || payload.type === "turn_aborted")
          && latestContext && hasTurnBaseline && latestContext.turn_id === payload.turn_id
          && typeof latestContext.model === "string") {
          resumeMetadata = { ...(resumeMetadata ?? {}), previous_turn_settings: {
            model: latestContext.model,
            ...(latestContext.cyber_access_program != null ? { cyber_access_program: latestContext.cyber_access_program } : {}),
            comp_hash: latestContext.comp_hash ?? null,
            realtime_active: latestContext.realtime_active ?? null,
          } };
          hasTurnBaseline = false;
        }
        if (["task_started", "task_complete", "turn_started", "turn_completed", "turn_aborted", "thread_settings_applied"].includes(String(payload.type))) {
          companionRecords.push(record);
        }
        if (payload.type === "thread_settings_applied") {
          const settings = object(payload.thread_settings);
          if (record.codedeck_provider_resume_repair_companion !== true
            && typeof settings?.model_provider_id === "string") {
            currentProvider = settings.model_provider_id;
            providers.add(currentProvider);
          }
        }
      } else if (record.type === "turn_context") {
        companionRecords.push(record);
        latestContext = payload;
        if (payload.multi_agent_version != null) {
          resumeMetadata = { ...(resumeMetadata ?? {}), multi_agent_version: payload.multi_agent_version };
        }
        if (record.codedeck_provider_resume_repair_companion !== true
          && typeof payload.model_provider === "string") {
          currentProvider = payload.model_provider;
          providers.add(currentProvider);
        }
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  const after = await fs.stat(options.filePath);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error("会话仍在写入，请退出所有使用该会话的终端后重试；原会话未修改。");
  }
  if (!foundSession) throw new Error("会话文件缺少可验证的会话 ID，原会话未修改。");
  const shouldRemove = (item: JsonObject, index: number) => owners[index] !== options.targetProvider
    && item.type === "reasoning" && typeof item.encrypted_content === "string" && item.encrypted_content.length > 0;
  const sanitized = history.filter((item, index) => !shouldRemove(item, index));
  const sanitizedMetadata = metadata.filter((_, index) => !shouldRemove(history[index], index));
  const removedReasoningItems = history.length - sanitized.length;
  if (removedReasoningItems === 0) return null;
  if (invalidActiveHistory) throw unsupported();
  const checkpoint = {
    timestamp: new Date().toISOString(),
    type: "compacted",
    codedeck_provider_resume_repair: { model_provider: options.targetProvider },
    payload: {
      ...compaction,
      replacement_history: sanitized,
      replacement_history_metadata: sanitizedMetadata,
      // Preserve checkpoint hints when no newer companion exists. Update them
      // from source turn boundaries before the sanitized checkpoint bounds replay.
      resume_metadata: resumeMetadata ? {
        multi_agent_version: null, last_started_turn_id: null, previous_turn_settings: null,
        ...resumeMetadata,
      } : null,
      compaction_response_id: null,
      latest_token_usage_record: latestTokenUsage,
    },
  };
  const appendText = (lastByte === 10 ? "" : "\n")
    + [checkpoint, ...companionRecords.map((record) => ({ ...record, codedeck_provider_resume_repair_companion: true }))]
      .map((record) => JSON.stringify(record)).join("\n") + "\n";
  return {
    ...options,
    originalSize: before.size,
    originalMtimeMs: before.mtimeMs,
    originalSha256: hash.digest("hex"),
    appendText,
    appendSha256: createHash("sha256").update(appendText).digest("hex"),
    removedReasoningItems,
    preservedHistoryItems: sanitized.length,
    sourceProviders: Array.from(providers),
  };
}
