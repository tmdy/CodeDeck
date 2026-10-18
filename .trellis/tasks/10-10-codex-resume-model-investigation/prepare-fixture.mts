import { appendFile } from "node:fs/promises";
import { prepareCodexProviderResumeRepair } from "../../../src/shared/services/codex-provider-resume-repair.ts";

const filePath = process.argv[2];
const sessionId = process.argv[3];
const plan = await prepareCodexProviderResumeRepair({ filePath, sessionId, targetProvider: "openai_http" });
if (!plan) throw new Error("Expected the synthetic fixture to require repair");
// This helper only receives the newly created temporary fixture, never a real rollout.
await appendFile(filePath, plan.appendText);
console.log(JSON.stringify({ removed: plan.removedReasoningItems, preserved: plan.preservedHistoryItems }));
