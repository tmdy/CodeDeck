// 模型映射类型 — 新增功能
// 支持将用户友好的模型别名映射到实际 CLI 模型名

export interface ModelMappingEntry {
  id: string;
  provider: "claude" | "codex";
  /** 匹配模式，支持 * 和 ? 通配符 */
  pattern: string;
  /** 实际传给 CLI 的模型名 */
  target_model: string;
  /** UI 显示名称 */
  display_name: string;
  /** 可选描述（参数大小、速度等） */
  description?: string;
  max_tokens?: number;
  supports_vision?: boolean;
  supports_tools?: boolean;
  enabled: boolean;
  /** 匹配优先级，数字越小越优先 */
  priority: number;
}

/**
 * 将 glob 模式转换为正则表达式
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    switch (ch) {
      case "*":
        regexStr += ".*";
        break;
      case "?":
        regexStr += ".";
        break;
      // 转义正则特殊字符
      case ".":
      case "+":
      case "^":
      case "$":
      case "{":
      case "}":
      case "(":
      case ")":
      case "|":
      case "\\":
      case "[":
      case "]":
        regexStr += "\\" + ch;
        break;
      default:
        regexStr += ch;
    }
  }
  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * 解析用户输入的模型名，返回映射后的模型名
 * 按 priority 排序，返回第一个匹配的 enabled 映射
 * 如果没有匹配，返回原始模型名
 */
export function resolveModel(
  model: string,
  mappings: ModelMappingEntry[],
  provider: string,
): string {
  const candidates = mappings
    .filter((m) => m.enabled && m.provider === provider)
    .sort((a, b) => a.priority - b.priority);

  for (const entry of candidates) {
    const regex = globToRegex(entry.pattern);
    if (regex.test(model)) {
      return entry.target_model;
    }
  }

  return model;
}

/**
 * 创建新的映射条目（生成唯一 ID）
 */
export function createMappingEntry(
  partial: Omit<ModelMappingEntry, "id">,
): ModelMappingEntry {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...partial,
  };
}