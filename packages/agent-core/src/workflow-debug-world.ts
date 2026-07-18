import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 能力/路径预检 + 仅 getWorld 接入同一 World。
 * 禁止 createWorld / createLocalWorld / getWorldFromEnv / setWorld；
 * 禁止以精确 Eve 版本号作为门槛。
 */

export class WorkflowDebugWorldError extends Error {
  readonly code:
    | "eve_unresolved"
    | "runtime_missing"
    | "import_failed"
    | "get_world_missing"
    | "world_not_ready";

  constructor(code: WorkflowDebugWorldError["code"], message: string) {
    super(message);
    this.name = "WorkflowDebugWorldError";
    this.code = code;
  }
}

/**
 * Eve vendored runtime helpers：World 始终为第一参数（与 runtime/runs.d.ts、helpers.d.ts 对齐）。
 */
export type WorkflowRuntimeModule = {
  readonly getWorld: () => Promise<unknown> | unknown;
  readonly cancelRun?: (
    world: unknown,
    runId: string,
    options?: unknown,
  ) => Promise<unknown>;
  readonly reenqueueRun?: (
    world: unknown,
    runId: string,
    options?: unknown,
  ) => Promise<unknown>;
  readonly recreateRunFromExisting?: (
    world: unknown,
    runId: string,
    options?: unknown,
  ) => Promise<unknown>;
  readonly wakeUpRun?: (
    world: unknown,
    runId: string,
    options?: unknown,
  ) => Promise<unknown>;
  readonly readStream?: (
    world: unknown,
    runId: string,
    streamId: string,
    options?: unknown,
  ) => Promise<unknown>;
  readonly resumeHook?: (
    token: string,
    payload?: unknown,
  ) => Promise<unknown>;
  readonly healthCheck?: (
    world: unknown,
    endpoint: "workflow" | "step",
    options?: unknown,
  ) => Promise<{ healthy: boolean; error?: string; latencyMs?: number }>;
  readonly start?: (...args: unknown[]) => Promise<unknown>;
};

export type WorldPreflightResult = {
  readonly eveRoot: string;
  readonly runtimePath: string;
  readonly runtime: WorkflowRuntimeModule;
};

let cached: WorldPreflightResult | null = null;

/**
 * 解析当前已安装 eve 包根目录（不检查版本号字符串）。
 */
export function resolveEvePackageRoot(fromUrl: string = import.meta.url): string {
  try {
    const require = createRequire(fromUrl);
    const pkgJson = require.resolve("eve/package.json");
    return path.dirname(pkgJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowDebugWorldError(
      "eve_unresolved",
      `无法解析当前已安装的 eve 包：${message}。请确认依赖已安装。`,
    );
  }
}

/**
 * 默认 vendored runtime 相对路径（Eve 升级后若迁移须更新此解析并重验）。
 */
export function resolveVendoredRuntimePath(eveRoot: string): string {
  return path.join(
    eveRoot,
    "dist",
    "src",
    "compiled",
    "@workflow",
    "core",
    "runtime.js",
  );
}

/**
 * 能力/路径预检（fail-closed）。通过后缓存 runtime 模块。
 * **不**把 Eve 版本号相等作为条件。
 */
export async function preflightWorkflowWorld(
  fromUrl: string = import.meta.url,
): Promise<WorldPreflightResult> {
  if (cached) return cached;

  const eveRoot = resolveEvePackageRoot(fromUrl);
  const runtimePath = resolveVendoredRuntimePath(eveRoot);

  try {
    await access(runtimePath);
  } catch {
    throw new WorkflowDebugWorldError(
      "runtime_missing",
      `Eve vendored Workflow runtime 不存在：${runtimePath}。若刚升级 Eve，请检查 vendored 路径并完成升级重验；禁止降级 createWorld。`,
    );
  }

  let mod: WorkflowRuntimeModule;
  try {
    mod = (await import(pathToFileURL(runtimePath).href)) as WorkflowRuntimeModule;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowDebugWorldError(
      "import_failed",
      `无法导入 Eve vendored runtime：${message}`,
    );
  }

  if (typeof mod.getWorld !== "function") {
    throw new WorkflowDebugWorldError(
      "get_world_missing",
      "当前 Eve 安装的 runtime 未导出可用的 getWorld()。禁止降级创建 World。",
    );
  }

  // 预检：World 须已由 Eve 启动时 setWorld；此处只探测，不缓存 World 实例（每次 RPC 再 get）
  let world: unknown;
  try {
    world = await mod.getWorld();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowDebugWorldError(
      "world_not_ready",
      `getWorld() 失败，World 未就绪：${message}。请确认 Agent 经 eve start/dev 启动且已安装 World；禁止自行 createWorld。`,
    );
  }
  if (world == null) {
    throw new WorkflowDebugWorldError(
      "world_not_ready",
      "getWorld() 返回空：Eve 尚未安装 World。请使用 eve start/dev 启动 Agent，禁止自行 createWorld。",
    );
  }

  cached = { eveRoot, runtimePath, runtime: mod };
  return cached;
}

/**
 * 取得 Eve 已 setWorld 的同一 World 实例。
 * 源码契约：本函数及其调用链不得 create/set World。
 */
export async function getEveInstalledWorld(
  fromUrl: string = import.meta.url,
): Promise<unknown> {
  const { runtime } = await preflightWorkflowWorld(fromUrl);
  const world = await runtime.getWorld();
  if (world == null) {
    throw new WorkflowDebugWorldError(
      "world_not_ready",
      "World 未就绪（getWorld 返回空）。",
    );
  }
  return world;
}

export async function getEveRuntimeModule(
  fromUrl: string = import.meta.url,
): Promise<WorkflowRuntimeModule> {
  const { runtime } = await preflightWorkflowWorld(fromUrl);
  return runtime;
}

/** 测试用：清除预检缓存。 */
export function resetWorkflowWorldCacheForTests(): void {
  cached = null;
}
