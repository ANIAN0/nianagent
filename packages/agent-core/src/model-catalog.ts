import modelConfig from "../config/models.json";
import { MODEL_SELECTION_CONTEXT_PREFIX } from "./model-selection";

export const AGENT_IDS = ["knowledge-base", "work-assistant"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type ModelCatalogEntry = {
  readonly id: string;
  readonly label: string;
  readonly providerModelId: string;
  readonly contextWindowTokens: number;
  readonly agents: readonly AgentId[];
};

export type PublicModelCatalogEntry = Pick<ModelCatalogEntry, "id" | "label">;

function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && AGENT_IDS.includes(value as AgentId);
}

function parseModelCatalog(): readonly ModelCatalogEntry[] {
  if (!Array.isArray(modelConfig.models) || modelConfig.models.length === 0) {
    throw new Error("packages/agent-core/config/models.json 必须至少配置一个模型。");
  }

  const ids = new Set<string>();
  const models = modelConfig.models.map((model, index) => {
    if (
      typeof model.id !== "string" ||
      model.id.length === 0 ||
      typeof model.label !== "string" ||
      model.label.length === 0 ||
      typeof model.providerModelId !== "string" ||
      model.providerModelId.length === 0 ||
      !Number.isSafeInteger(model.contextWindowTokens) ||
      model.contextWindowTokens <= 0 ||
      !Array.isArray(model.agents) ||
      model.agents.length === 0 ||
      !model.agents.every(isAgentId)
    ) {
      throw new Error(
        `packages/agent-core/config/models.json 中第 ${index + 1} 个模型配置无效。`,
      );
    }
    if (ids.has(model.id)) {
      throw new Error(
        `packages/agent-core/config/models.json 中存在重复模型 ID：${model.id}`,
      );
    }
    ids.add(model.id);

    return model as ModelCatalogEntry;
  });

  if (!ids.has(modelConfig.defaultModelId)) {
    throw new Error(
      "packages/agent-core/config/models.json 的 defaultModelId 必须指向已配置模型。",
    );
  }

  const defaultModel = models.find((model) => model.id === modelConfig.defaultModelId)!;
  if (!AGENT_IDS.every((agentId) => defaultModel.agents.includes(agentId))) {
    throw new Error(
      "packages/agent-core/config/models.json 的默认模型必须对所有 Agent 可用。",
    );
  }

  for (const agentId of AGENT_IDS) {
    if (!models.some((model) => model.agents.includes(agentId))) {
      throw new Error(`Agent ${agentId} 没有可用模型。`);
    }
  }

  return models;
}

const catalog = parseModelCatalog();

export function getDefaultModel(): ModelCatalogEntry {
  return catalog.find((model) => model.id === modelConfig.defaultModelId)!;
}

export function getModelForAgent(
  agentId: AgentId,
  modelId: string | null | undefined,
): ModelCatalogEntry | undefined {
  return catalog.find((model) => model.id === modelId && model.agents.includes(agentId));
}

export function getPublicModelsForAgent(
  agentId: AgentId,
): readonly PublicModelCatalogEntry[] {
  return catalog
    .filter((model) => model.agents.includes(agentId))
    .map(({ id, label }) => ({ id, label }));
}

export function modelIdFromMessages(
  messages: readonly { readonly content: unknown }[],
): string | undefined {
  for (const message of [...messages].reverse()) {
    if (typeof message.content !== "string") continue;
    if (message.content.startsWith(MODEL_SELECTION_CONTEXT_PREFIX)) {
      return message.content.slice(MODEL_SELECTION_CONTEXT_PREFIX.length);
    }
  }
  return undefined;
}
