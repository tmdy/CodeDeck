import type { ProfileKey } from "./types.js";
import { normalizeProvider } from "./types.js";
import { normalizeKeyWithFallback, splitKey } from "./keys-internal.js";

export interface ProfileGroup {
  id: string;
  name: string;
  profile_keys: ProfileKey[];
  collapsed: boolean;
}

export interface ProfileOrganization {
  groups: ProfileGroup[];
  ungrouped_profile_keys: ProfileKey[];
  ungrouped_collapsed: boolean;
}

export function defaultProfileOrganization(): ProfileOrganization {
  return {
    groups: [],
    ungrouped_profile_keys: [],
    ungrouped_collapsed: false,
  };
}

export function normalizeProfileOrganization(
  value: unknown,
  providerID: string,
  fallbackKeys: ProfileKey[] = [],
): ProfileOrganization {
  const provider = normalizeProvider(providerID);
  const record = asRecord(value);
  const rawGroups = Array.isArray(record?.groups) ? record.groups : [];
  const groups: ProfileGroup[] = [];
  const seenGroupIds = new Set<string>();
  const seenGroupNames = new Set<string>();
  const assignedKeys = new Set<ProfileKey>();

  for (const rawGroup of rawGroups) {
    const groupRecord = asRecord(rawGroup);
    const id = typeof groupRecord?.id === "string" ? groupRecord.id.trim() : "";
    const name = typeof groupRecord?.name === "string" ? groupRecord.name.trim() : "";
    const normalizedName = name.toLocaleLowerCase();
    if (!id || !name || seenGroupIds.has(id) || seenGroupNames.has(normalizedName)) {
      continue;
    }
    seenGroupIds.add(id);
    seenGroupNames.add(normalizedName);

    const profileKeys = normalizeProfileKeys(
      groupRecord?.profile_keys,
      provider,
      assignedKeys,
    );
    groups.push({
      id,
      name,
      profile_keys: profileKeys,
      collapsed: groupRecord?.collapsed === true,
    });
  }

  const ungroupedProfileKeys = normalizeProfileKeys(
    record?.ungrouped_profile_keys,
    provider,
    assignedKeys,
  );
  for (const key of fallbackKeys) {
    const normalizedKey = normalizeProfileKey(key, provider);
    if (normalizedKey && !assignedKeys.has(normalizedKey)) {
      assignedKeys.add(normalizedKey);
      ungroupedProfileKeys.push(normalizedKey);
    }
  }

  return {
    groups,
    ungrouped_profile_keys: ungroupedProfileKeys,
    ungrouped_collapsed: record?.ungrouped_collapsed === true,
  };
}

export function flattenProfileOrganization(organization: ProfileOrganization): ProfileKey[] {
  return [
    ...organization.ungrouped_profile_keys,
    ...organization.groups.flatMap((group) => group.profile_keys),
  ];
}

export function cloneProfileOrganization(
  organization: ProfileOrganization,
): ProfileOrganization {
  return {
    groups: organization.groups.map((group) => ({
      ...group,
      profile_keys: [...group.profile_keys],
    })),
    ungrouped_profile_keys: [...organization.ungrouped_profile_keys],
    ungrouped_collapsed: organization.ungrouped_collapsed,
  };
}

export function moveProfileInOrganization(
  organization: ProfileOrganization,
  profileKey: ProfileKey,
  targetGroupId: string | null,
  targetIndex: number,
): ProfileOrganization {
  const next = cloneProfileOrganization(organization);
  const source = findProfileLocation(next, profileKey);
  removeProfileKey(next, profileKey);
  const targetKeys = targetGroupId === null
    ? next.ungrouped_profile_keys
    : next.groups.find((group) => group.id === targetGroupId)?.profile_keys;
  if (!targetKeys) {
    return organization;
  }
  const adjustedIndex = source?.groupId === targetGroupId && source.index < targetIndex
    ? targetIndex - 1
    : targetIndex;
  targetKeys.splice(Math.max(0, Math.min(adjustedIndex, targetKeys.length)), 0, profileKey);
  return next;
}

export function moveProfileGroup(
  organization: ProfileOrganization,
  groupId: string,
  targetIndex: number,
): ProfileOrganization {
  const next = cloneProfileOrganization(organization);
  const sourceIndex = next.groups.findIndex((group) => group.id === groupId);
  if (sourceIndex < 0) {
    return organization;
  }
  const [moved] = next.groups.splice(sourceIndex, 1);
  const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.groups.splice(Math.max(0, Math.min(adjustedIndex, next.groups.length)), 0, moved);
  return next;
}

function normalizeProfileKeys(
  value: unknown,
  provider: string,
  assignedKeys: Set<ProfileKey>,
): ProfileKey[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const keys: ProfileKey[] = [];
  for (const valueItem of value) {
    const key = normalizeProfileKey(valueItem, provider);
    if (!key || assignedKeys.has(key)) {
      continue;
    }
    assignedKeys.add(key);
    keys.push(key);
  }
  return keys;
}

function findProfileLocation(
  organization: ProfileOrganization,
  profileKey: ProfileKey,
): { groupId: string | null; index: number } | null {
  const ungroupedIndex = organization.ungrouped_profile_keys.indexOf(profileKey);
  if (ungroupedIndex >= 0) {
    return { groupId: null, index: ungroupedIndex };
  }
  for (const group of organization.groups) {
    const index = group.profile_keys.indexOf(profileKey);
    if (index >= 0) {
      return { groupId: group.id, index };
    }
  }
  return null;
}

function removeProfileKey(organization: ProfileOrganization, profileKey: ProfileKey): void {
  organization.ungrouped_profile_keys = organization.ungrouped_profile_keys
    .filter((key) => key !== profileKey);
  organization.groups = organization.groups.map((group) => ({
    ...group,
    profile_keys: group.profile_keys.filter((key) => key !== profileKey),
  }));
}

function normalizeProfileKey(value: unknown, provider: string): ProfileKey {
  if (typeof value !== "string") {
    return "";
  }
  const key = normalizeKeyWithFallback(value, provider);
  const [keyProvider] = splitKey(key);
  return normalizeProvider(keyProvider) === provider ? key : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
