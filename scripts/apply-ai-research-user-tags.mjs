import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillsManagerService, resolveDefaultPaths } from "../dist-electron/src/shared/skills-service.js";
import { buildAiResearchTagPlan } from "../dist-electron/src/shared/user-tag-bulk-match.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourceListPath = process.env.CODEDECK_AI_RESEARCH_LIST
  ?? process.env.SKILLS_MANAGER_AI_RESEARCH_LIST
  ?? path.join(os.homedir(), "Downloads", "ai-research-skills.txt");

async function readSkillList(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main() {
  const service = new SkillsManagerService(resolveDefaultPaths(projectRoot));
  const scan = await service.scanEnvironment();
  const lines = await readSkillList(sourceListPath);

  const summary = {};

  for (const host of ["codex", "claude"]) {
    const records = scan.records.filter((record) => record.host === host);
    const plan = buildAiResearchTagPlan(records, lines);

    for (const skillId of plan.matchedSkillIds) {
      await service.updateSkillUserTags(skillId, ["AI研究"]);
    }

    summary[host] = {
      matchedCount: plan.matchedSkillIds.length,
      matchedSkillIds: plan.matchedSkillIds,
      unmatchedCount: plan.unmatchedItems.length,
      unmatchedItems: plan.unmatchedItems,
      ambiguousCount: plan.ambiguousItems.length,
      ambiguousItems: plan.ambiguousItems,
    };
  }

  console.log(JSON.stringify({
    sourceListPath,
    tagApplied: "AI研究",
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
