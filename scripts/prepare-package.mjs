import path from "node:path";
import { promises as fs } from "node:fs";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = process.cwd();
const buildRoot = path.join(root, "build");
const workspaceSeedRoot = path.join(buildRoot, "workspace-seed");

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  // Stale seeds from older builds must never influence a release package.
  await fs.rm(workspaceSeedRoot, { recursive: true, force: true });
  await ensureDirectory(buildRoot);

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
