import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const generatedRoot = path.join(projectRoot, "app-data", "generated-translations");
const targetPath = path.join(projectRoot, "app-data", "translations.json");

async function readJsonIfExists(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function stripTranslatedTags(file) {
  if (!file?.entries) {
    return file;
  }

  const entries = Object.fromEntries(
    Object.entries(file.entries).map(([skillId, entry]) => {
      const { translatedTags, ...rest } = entry ?? {};
      void translatedTags;
      return [skillId, rest];
    }),
  );

  return {
    ...file,
    entries,
  };
}

async function main() {
  const codexPath = path.join(generatedRoot, "codex.translations.json");
  const claudePath = path.join(generatedRoot, "claude.translations.json");
  const codex = stripTranslatedTags(await readJsonIfExists(codexPath));
  const claude = stripTranslatedTags(await readJsonIfExists(claudePath));

  const entries = {
    ...(codex?.entries ?? {}),
    ...(claude?.entries ?? {}),
  };

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        targetPath,
        codexCount: Object.keys(codex?.entries ?? {}).length,
        claudeCount: Object.keys(claude?.entries ?? {}).length,
        mergedCount: Object.keys(entries).length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
