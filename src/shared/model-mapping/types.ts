const PROVIDER_CLAUDE = "claude";
const PROVIDER_CODEX = "codex";

function normalizeProvider(providerID: string): string {
  return providerID.trim().toLowerCase() === PROVIDER_CODEX ? PROVIDER_CODEX : PROVIDER_CLAUDE;
}

export const PROFILE_MODEL_SLOT_IDS = [
  "default",
  "claude-opus",
  "claude-sonnet",
  "claude-haiku",
  "cc-default",
  "cc-opus",
  "cc-sonnet",
  "cc-haiku",
] as const;

export type ModelSlotId = (typeof PROFILE_MODEL_SLOT_IDS)[number];
export type ModelCatalogAuthScheme = "bearer" | "x-api-key";

export interface ProfileModelMapping {
  auth_scheme: ModelCatalogAuthScheme;
  slots: Record<ModelSlotId, string>;
  fetched_models: string[];
  fetched_at?: string;
}

export const PROFILE_MODEL_SLOT_LABELS: Record<ModelSlotId, string> = {
  default: "Default",
  "claude-opus": "Claude Opus",
  "claude-sonnet": "Claude Sonnet",
  "claude-haiku": "Claude Haiku",
  "cc-default": "cc default",
  "cc-opus": "cc opus",
  "cc-sonnet": "cc sonnet",
  "cc-haiku": "cc haiku",
};

export function createEmptyModelSlots(): Record<ModelSlotId, string> {
  return {
    default: "",
    "claude-opus": "",
    "claude-sonnet": "",
    "claude-haiku": "",
    "cc-default": "",
    "cc-opus": "",
    "cc-sonnet": "",
    "cc-haiku": "",
  };
}

export function createEmptyProfileModelMapping(): ProfileModelMapping {
  return {
    auth_scheme: "bearer",
    slots: createEmptyModelSlots(),
    fetched_models: [],
  };
}

export function normalizeProfileModelMapping(
  mapping?: Partial<ProfileModelMapping> | null,
): ProfileModelMapping {
  const defaults = createEmptyProfileModelMapping();
  const authScheme = mapping?.auth_scheme === "x-api-key" ? "x-api-key" : "bearer";

  return {
    auth_scheme: authScheme,
    slots: {
      ...defaults.slots,
      ...Object.fromEntries(
        PROFILE_MODEL_SLOT_IDS.map((slotId) => [
          slotId,
          (mapping?.slots?.[slotId] ?? "").trim(),
        ]),
      ) as Record<ModelSlotId, string>,
    },
    fetched_models: Array.from(
      new Set((mapping?.fetched_models ?? []).map((item) => item.trim()).filter(Boolean)),
    ),
    fetched_at: mapping?.fetched_at?.trim() || undefined,
  };
}

export function cloneProfileModelMapping(
  mapping?: Partial<ProfileModelMapping> | null,
): ProfileModelMapping {
  return normalizeProfileModelMapping(mapping);
}

export function detectModelSlot(providerID: string, model: string): ModelSlotId {
  const normalizedProvider = normalizeProvider(providerID);
  const normalizedModel = model.trim().toLowerCase();

  if (!normalizedModel || normalizedModel === "default") {
    return "default";
  }

  if (normalizedProvider === PROVIDER_CLAUDE) {
    if (normalizedModel.includes("opus")) return "claude-opus";
    if (normalizedModel.includes("sonnet")) return "claude-sonnet";
    if (normalizedModel.includes("haiku")) return "claude-haiku";
    return "default";
  }

  if (normalizedProvider === PROVIDER_CODEX) {
    if (normalizedModel.includes("opus")) return "cc-opus";
    if (normalizedModel.includes("sonnet")) return "cc-sonnet";
    if (normalizedModel.includes("haiku")) return "cc-haiku";
    return "cc-default";
  }

  return "default";
}

export function resolveProfileModel(
  providerID: string,
  slotModel: string,
  mapping?: Partial<ProfileModelMapping> | null,
): string {
  const normalizedModel = slotModel.trim();
  const resolvedMapping = normalizeProfileModelMapping(mapping);
  const slotId = detectModelSlot(providerID, normalizedModel);
  const target = resolvedMapping.slots[slotId]?.trim() ?? "";
  return target || normalizedModel;
}
