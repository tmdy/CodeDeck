import path from "node:path";
import { promises as fs } from "node:fs";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = process.cwd();
const buildRoot = path.join(root, "build");
const workspaceSeedRoot = path.join(buildRoot, "workspace-seed");
const excludedDirectoryNames = new Set([
  ".git",
  ".venv",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "release",
  "artifacts",
  "logs",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyTreeFiltered(sourcePath, targetPath) {
  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) {
    if (excludedDirectoryNames.has(path.basename(sourcePath))) {
      return;
    }

    await ensureDirectory(targetPath);
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyTreeFiltered(
        path.join(sourcePath, entry.name),
        path.join(targetPath, entry.name),
      );
    }
    return;
  }

  await ensureDirectory(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function main() {
  await fs.rm(workspaceSeedRoot, { recursive: true, force: true });
  await ensureDirectory(path.join(workspaceSeedRoot, "app-data"));
  await ensureDirectory(buildRoot);

  const librarySource = path.join(root, "library");
  if (await exists(librarySource)) {
    await copyTreeFiltered(librarySource, path.join(workspaceSeedRoot, "library"));
  }

  const translationsSource = path.join(root, "app-data", "translations.json");
  if (await exists(translationsSource)) {
    await fs.copyFile(
      translationsSource,
      path.join(workspaceSeedRoot, "app-data", "translations.json"),
    );
  }

  const iconSource = path.join(root, "src", "assets", "hero.png");
  const iconPngTarget = path.join(buildRoot, "icon.png");
  const iconIcoTarget = path.join(buildRoot, "icon.ico");
  await sharp(iconSource)
    .resize(256, 256, {
      fit: "contain",
      background: { r: 242, g: 239, b: 231, alpha: 1 },
    })
    .png()
    .toFile(iconPngTarget);
  const squareIcoBuffer = await pngToIco(iconPngTarget);
  await fs.writeFile(iconIcoTarget, squareIcoBuffer);
}

await main();
