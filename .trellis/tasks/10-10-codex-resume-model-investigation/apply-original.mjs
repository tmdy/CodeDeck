import { prepareCodexProviderResumeRepair } from "../../../dist-electron/src/shared/services/codex-provider-resume-repair.js";
import { appendCodexResumeRepairExclusively } from "../../../dist-electron/src/shared/electron/codex-resume-repair-writer.js";

const sessionId = "01a11575-7532-7270-b4e8-608d760775c0";
const filePath = `C:/Users/you/.codex/sessions/2026/10/07/rollout-2026-10-07T16-23-04-${sessionId}.jsonl`;
const request = { filePath, sessionId, targetProvider: "openai_http" };
const plan = await prepareCodexProviderResumeRepair(request);
if (!plan) throw new Error("Original session does not need the expected repair");
await appendCodexResumeRepairExclusively(plan, "D:/CodeDeck/app-data/codex-resume-recovery");
const next = await prepareCodexProviderResumeRepair(request);
if (next !== null) throw new Error("Repair was not idempotent");
console.log(JSON.stringify({ sessionId, removed: plan.removedReasoningItems, preserved: plan.preservedHistoryItems, originalSize: plan.originalSize, appendedBytes: Buffer.byteLength(plan.appendText), idempotent: true }));
