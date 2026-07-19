function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const phraseTranslations: Array<[RegExp, string]> = [
  [/\buse when\b/gi, "适用于"],
  [/\bused when\b/gi, "适用于"],
  [/\bused for\b/gi, "用于"],
  [/\bsupports\b/gi, "支持"],
  [/\bsupport\b/gi, "支持"],
  [/\bprovides\b/gi, "提供"],
  [/\bprovide\b/gi, "提供"],
  [/\benables\b/gi, "支持"],
  [/\benable\b/gi, "启用"],
  [/\bhelps\b/gi, "帮助"],
  [/\bhelp\b/gi, "帮助"],
  [/\bcreates\b/gi, "创建"],
  [/\bcreate\b/gi, "创建"],
  [/\bbuilds\b/gi, "构建"],
  [/\bbuild\b/gi, "构建"],
  [/\bmanages\b/gi, "管理"],
  [/\bmanage\b/gi, "管理"],
  [/\binstalls\b/gi, "安装"],
  [/\binstall\b/gi, "安装"],
  [/\bruns\b/gi, "运行"],
  [/\brun\b/gi, "运行"],
  [/\bdebugs\b/gi, "调试"],
  [/\bdebug\b/gi, "调试"],
  [/\btests\b/gi, "测试"],
  [/\btest\b/gi, "测试"],
  [/\breviews\b/gi, "审查"],
  [/\breview\b/gi, "审查"],
  [/\btranslates\b/gi, "翻译"],
  [/\btranslate\b/gi, "翻译"],
  [/\bgenerates\b/gi, "生成"],
  [/\bgenerate\b/gi, "生成"],
  [/\bexplains\b/gi, "解释"],
  [/\bexplain\b/gi, "解释"],
  [/\banalyzes\b/gi, "分析"],
  [/\banalyze\b/gi, "分析"],
  [/\bworkflow\b/gi, "工作流"],
  [/\bskill\b/gi, "技能"],
  [/\bskills\b/gi, "技能"],
  [/\bplugin\b/gi, "插件"],
  [/\bplugins\b/gi, "插件"],
  [/\bsummary\b/gi, "摘要"],
  [/\bsummary-only\b/gi, "仅摘要"],
  [/\bresearch\b/gi, "研究"],
  [/\bpaper\b/gi, "论文"],
  [/\bpapers\b/gi, "论文"],
  [/\bpresentation\b/gi, "演示文稿"],
  [/\bpresentations\b/gi, "演示文稿"],
  [/\bcodebase\b/gi, "代码库"],
  [/\bcode\b/gi, "代码"],
  [/\bfrontend\b/gi, "前端"],
  [/\bbackend\b/gi, "后端"],
  [/\bdesktop app\b/gi, "桌面应用"],
  [/\bdesktop\b/gi, "桌面"],
  [/\blocal\b/gi, "本地"],
  [/\bdirectory\b/gi, "目录"],
  [/\bdirectories\b/gi, "目录"],
  [/\bfile\b/gi, "文件"],
  [/\bfiles\b/gi, "文件"],
  [/\bbatch\b/gi, "批量"],
  [/\brollback\b/gi, "回滚"],
  [/\bscan\b/gi, "扫描"],
  [/\bpreview\b/gi, "预览"],
  [/\bconfiguration\b/gi, "配置"],
  [/\bconfig\b/gi, "配置"],
  [/\bcommand line\b/gi, "命令行"],
  [/\bcli\b/gi, "命令行"],
  [/\bapi\b/gi, "API"],
];

const tagTranslations = new Map<string, string>([
  ["Autonomous Research", "自主研究"],
  ["Two-Loop Architecture", "双循环架构"],
  ["Experiment Orchestration", "实验编排"],
  ["Frontend", "前端"],
  ["Backend", "后端"],
  ["Testing", "测试"],
  ["Debugging", "调试"],
  ["Documentation", "文档"],
  ["Research", "研究"],
  ["Writing", "写作"],
  ["Automation", "自动化"],
  ["Data Processing", "数据处理"],
  ["Observability", "可观测性"],
]);

function preserveCaseReplacement(original: string, translated: string): string {
  return /^[A-Z][A-Z\s-]+$/.test(original) ? translated.toUpperCase() : translated;
}

function localizeEnglishText(value: string): string {
  let next = normalizeWhitespace(value);
  for (const [pattern, replacement] of phraseTranslations) {
    next = next.replace(pattern, (match) => preserveCaseReplacement(match, replacement));
  }

  next = next
    .replace(/\bfor\b/gi, "用于")
    .replace(/\bwith\b/gi, "配合")
    .replace(/\band\b/gi, "与")
    .replace(/\bor\b/gi, "或")
    .replace(/\bto\b/gi, "以")
    .replace(/\bof\b/gi, "的")
    .replace(/\bwhen starting\b/gi, "在开始时")
    .replace(/\bwhen working with\b/gi, "在处理时")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  return next;
}

function localizeTag(tag: string): string {
  return tagTranslations.get(tag) ?? localizeEnglishText(tag);
}

function extractFirstSentence(content: string): string {
  const plain = normalizeWhitespace(
    content
      .replace(/^#+\s+/gm, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/[*_>~-]/g, " "),
  );

  const match = plain.match(/[^。！？.!?]+[。！？.!?]?/u);
  return match?.[0]?.trim() ?? "";
}

export function buildSummary(input: {
  directoryName: string;
  description?: string;
  tags?: string[];
  title?: string;
  body?: string;
  isSpecialDir?: boolean;
}): string {
  if (input.isSpecialDir) {
    if (input.description) {
      return localizeEnglishText(input.description);
    }
    return "系统/共享目录，V1 不允许移动";
  }

  const tags = (input.tags ?? []).filter(Boolean).slice(0, 3);
  const normalizedDescription = normalizeWhitespace(input.description ?? "");
  if (normalizedDescription) {
    const localizedDescription = localizeEnglishText(normalizedDescription);
    const compact =
      localizedDescription.length > 90 ? `${localizedDescription.slice(0, 87)}...` : localizedDescription;
    const localizedTags = tags.map((tag) => localizeTag(tag));
    return localizedTags.length > 0 ? `${compact} [${localizedTags.join(" / ")}]` : compact;
  }

  const title = normalizeWhitespace(input.title ?? "");
  if (title) {
    return `${input.directoryName}: ${title}`;
  }

  const firstSentence = extractFirstSentence(input.body ?? "");
  if (firstSentence) {
    return `${input.directoryName}: ${localizeEnglishText(firstSentence)}`;
  }

  return "无可提取说明";
}
