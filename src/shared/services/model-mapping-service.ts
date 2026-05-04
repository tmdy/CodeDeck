// 模型映射服务

import type { ModelMappingEntry } from "../model-mapping/types.js";
import { resolveModel, createMappingEntry } from "../model-mapping/types.js";
import { cloneLocalState } from "../state/store.js";
import type { LocalStateAccessor } from "./profile-service.js";

export class ModelMappingService {
  private stateAccessor: LocalStateAccessor;

  constructor(stateAccessor: LocalStateAccessor) {
    this.stateAccessor = stateAccessor;
  }

  list(): ModelMappingEntry[] {
    return [...this.stateAccessor.get().model_mappings];
  }

  async add(entry: Omit<ModelMappingEntry, "id">): Promise<ModelMappingEntry> {
    const st = cloneLocalState(this.stateAccessor.get());
    const newEntry = createMappingEntry(entry);
    st.model_mappings.push(newEntry);
    await this.stateAccessor.save(st);
    return newEntry;
  }

  async update(id: string, update: Partial<ModelMappingEntry>): Promise<ModelMappingEntry | null> {
    const st = cloneLocalState(this.stateAccessor.get());
    const idx = st.model_mappings.findIndex((m) => m.id === id);
    if (idx < 0) return null;

    st.model_mappings[idx] = { ...st.model_mappings[idx], ...update };
    await this.stateAccessor.save(st);
    return st.model_mappings[idx];
  }

  async delete(id: string): Promise<boolean> {
    const st = cloneLocalState(this.stateAccessor.get());
    const idx = st.model_mappings.findIndex((m) => m.id === id);
    if (idx < 0) return false;

    st.model_mappings.splice(idx, 1);
    await this.stateAccessor.save(st);
    return true;
  }

  resolve(provider: string, model: string): string {
    const mappings = this.list();
    return resolveModel(model, mappings, provider);
  }
}