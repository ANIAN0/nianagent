export const MODEL_SELECTION_HEADER = "x-nianagent-model-id";
export const MODEL_SELECTION_CONTEXT_PREFIX = "[nianagent:model-selection]";

export function modelSelectionContext(modelId: string): string {
  return `${MODEL_SELECTION_CONTEXT_PREFIX}${modelId}`;
}
