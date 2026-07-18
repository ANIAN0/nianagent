import { timingSafeEqual } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  getEveInstalledWorld,
  getEveRuntimeModule,
  preflightWorkflowWorld,
  WorkflowDebugWorldError,
} from "./workflow-debug-world";

export const WORKFLOW_DEBUG_SECRET_HEADER = "x-nianagent-workflow-debug-secret";
export const WORKFLOW_DEBUG_SECRET_ENV = "NIANAGENT_WORKFLOW_DEBUG_SECRET";

export const WORKFLOW_DEBUG_READ_METHODS = [
  "fetchRuns",
  "fetchRun",
  "fetchSteps",
  "fetchStep",
  "fetchEvents",
  "fetchEvent",
  "fetchEventsByCorrelationId",
  "fetchHooks",
  "fetchHook",
  "fetchStreams",
  "fetchWorkflowsManifest",
  "getPublicServerConfig",
] as const;

export const WORKFLOW_DEBUG_WRITE_METHODS = [
  "cancelRun",
  "recreateRun",
  "reenqueueRun",
  "wakeUpRun",
  "resumeHook",
  "runHealthCheck",
] as const;

export type WorkflowDebugMethod =
  | (typeof WORKFLOW_DEBUG_READ_METHODS)[number]
  | (typeof WORKFLOW_DEBUG_WRITE_METHODS)[number];

const ALL_METHODS = new Set<string>([
  ...WORKFLOW_DEBUG_READ_METHODS,
  ...WORKFLOW_DEBUG_WRITE_METHODS,
]);

export type ServerActionError = {
  message: string;
  layer: "server" | "API";
  cause?: string;
  request?: {
    operation: string;
    params: Record<string, unknown>;
  };
};

export type ServerActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: ServerActionError };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WorldAny = any;

function ok<T>(data: T): ServerActionResult<T> {
  return { success: true, data };
}

function fail<T>(
  error: unknown,
  operation: string,
  params: Record<string, unknown> = {},
): ServerActionResult<T> {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  return {
    success: false,
    error: {
      message,
      layer: "API",
      cause: message,
      request: { operation, params },
    },
  };
}

export function assertWorkflowDebugSecret(
  provided: string | null | undefined,
): void {
  const expected = process.env[WORKFLOW_DEBUG_SECRET_ENV]?.trim();
  if (!expected) {
    throw new Error(
      `缺少环境变量 ${WORKFLOW_DEBUG_SECRET_ENV}。请在 .env 中配置内部调试密钥。`,
    );
  }
  // 长度不一致时直接拒绝；等长时用 timingSafeEqual，避免密钥逐字节比较泄漏。
  if (!provided) {
    throw new Error("Workflow debug 内部密钥无效。");
  }
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Workflow debug 内部密钥无效。");
  }
}

/**
 * 执行 allowlist 内 RPC；World 仅来自 Eve getWorld()。
 */
export async function executeWorkflowDebugMethod(
  method: string,
  params: Record<string, unknown> = {},
): Promise<ServerActionResult<unknown>> {
  if (!ALL_METHODS.has(method)) {
    return {
      success: false,
      error: {
        message: `未知或未授权的 RPC method：${method}`,
        layer: "server",
        request: { operation: method, params },
      },
    };
  }

  try {
    await preflightWorkflowWorld();
  } catch (err) {
    if (err instanceof WorkflowDebugWorldError) {
      return {
        success: false,
        error: {
          message: err.message,
          layer: "server",
          request: { operation: "preflight", params: { code: err.code } },
        },
      };
    }
    throw err;
  }

  const world = (await getEveInstalledWorld()) as WorldAny;
  const runtime = await getEveRuntimeModule();

  try {
    switch (method as WorkflowDebugMethod) {
      case "fetchRuns": {
        const p = params as {
          cursor?: string;
          sortOrder?: "asc" | "desc";
          limit?: number;
          workflowName?: string;
          status?: string;
        };
        const result = world.analytics
          ? await world.analytics.runs.list({
              ...(p.workflowName ? { workflowName: p.workflowName } : {}),
              ...(p.status ? { status: p.status } : {}),
              pagination: {
                cursor: p.cursor,
                limit: p.limit ?? 10,
                sortOrder: p.sortOrder ?? "desc",
              },
            })
          : await world.runs.list({
              ...(p.workflowName ? { workflowName: p.workflowName } : {}),
              ...(p.status ? { status: p.status } : {}),
              pagination: {
                cursor: p.cursor,
                limit: p.limit ?? 10,
                sortOrder: p.sortOrder ?? "desc",
              },
              resolveData: "none",
            });
        return ok({
          data: result.data,
          cursor: result.cursor ?? undefined,
          hasMore: result.hasMore,
        });
      }
      case "fetchRun": {
        const runId = String(params.runId ?? "");
        const resolveData = (params.resolveData as "none" | "all") ?? "all";
        const run = await world.runs.get(runId, { resolveData });
        return ok(run);
      }
      case "fetchSteps": {
        const runId = String(params.runId ?? "");
        const pagination = {
          cursor: params.cursor as string | undefined,
          limit: (params.limit as number | undefined) ?? 100,
          sortOrder: (params.sortOrder as "asc" | "desc" | undefined) ?? "asc",
        };
        const result = world.analytics
          ? await world.analytics.steps.list({ runId, pagination })
          : await world.steps.list({
              runId,
              pagination,
              resolveData: "none",
            });
        return ok({
          data: result.data,
          cursor: result.cursor ?? undefined,
          hasMore: result.hasMore,
        });
      }
      case "fetchStep": {
        const step = await world.steps.get(
          String(params.runId ?? ""),
          String(params.stepId ?? ""),
          { resolveData: (params.resolveData as "none" | "all") ?? "all" },
        );
        return ok(step);
      }
      case "fetchEvents": {
        const runId = String(params.runId ?? "");
        const pagination = {
          cursor: params.cursor as string | undefined,
          limit: (params.limit as number | undefined) ?? 100,
          sortOrder: (params.sortOrder as "asc" | "desc" | undefined) ?? "asc",
        };
        const result = world.analytics
          ? await world.analytics.events.list({ runId, pagination })
          : await world.events.list({ runId, pagination });
        return ok({
          data: result.data,
          cursor: result.cursor ?? undefined,
          hasMore: result.hasMore,
        });
      }
      case "fetchEvent": {
        const event = await world.events.get(
          String(params.runId ?? ""),
          String(params.eventId ?? ""),
          { resolveData: (params.resolveData as "none" | "all") ?? "all" },
        );
        return ok(event);
      }
      case "fetchEventsByCorrelationId": {
        const correlationId = String(params.correlationId ?? "");
        const pagination = {
          cursor: params.cursor as string | undefined,
          limit: (params.limit as number | undefined) ?? 100,
          sortOrder: (params.sortOrder as "asc" | "desc" | undefined) ?? "asc",
        };
        const result = world.analytics
          ? await world.analytics.events.listByCorrelationId({
              correlationId,
              pagination,
            })
          : await world.events.listByCorrelationId({
              correlationId,
              pagination,
            });
        return ok({
          data: result.data,
          cursor: result.cursor ?? undefined,
          hasMore: result.hasMore,
        });
      }
      case "fetchHooks": {
        const listParams = {
          ...(params.runId ? { runId: String(params.runId) } : {}),
          pagination: {
            cursor: params.cursor as string | undefined,
            limit: (params.limit as number | undefined) ?? 50,
            sortOrder:
              (params.sortOrder as "asc" | "desc" | undefined) ?? "desc",
          },
        };
        const result = world.analytics
          ? await world.analytics.hooks.list(listParams)
          : await world.hooks.list(listParams);
        return ok({
          data: result.data,
          cursor: result.cursor ?? undefined,
          hasMore: result.hasMore,
        });
      }
      case "fetchHook": {
        const hook = await world.hooks.get(String(params.hookId ?? ""), {
          resolveData: (params.resolveData as "none" | "all") ?? "all",
        });
        return ok(hook);
      }
      case "fetchStreams": {
        const streams = await world.streams.list(String(params.runId ?? ""));
        return ok(streams);
      }
      case "fetchWorkflowsManifest": {
        const manifest = await discoverWorkflowsManifest();
        return ok(manifest);
      }
      case "getPublicServerConfig": {
        return ok({
          backendDisplayName: "Local (Eve World)",
          backendId: "local",
          publicEnv: {},
          sensitiveEnvKeys: [],
          displayInfo: {
            "local.note": "Agent-owned Eve Workflow World（同一 getWorld 实例）",
            "local.cwd": process.cwd(),
          },
        });
      }
      case "cancelRun": {
        const runId = String(params.runId ?? "");
        if (!runId) {
          return fail(new Error("cancelRun 需要 runId"), "cancelRun", params);
        }
        // World 必须为第一参数（runtime/runs.d.ts）
        if (typeof runtime.cancelRun === "function") {
          await runtime.cancelRun(world, runId, {
            cancelReason:
              typeof params.cancelReason === "string"
                ? params.cancelReason
                : undefined,
          });
        } else {
          await world.events.create(runId, {
            eventType: "run_cancelled",
          });
        }
        return ok(null);
      }
      case "recreateRun": {
        const runId = String(params.runId ?? "");
        if (typeof runtime.recreateRunFromExisting !== "function") {
          return fail(
            new Error("当前 Eve runtime 未导出 recreateRunFromExisting"),
            "recreateRun",
            params,
          );
        }
        const data = await runtime.recreateRunFromExisting(world, runId, {
          deploymentId: params.deploymentId,
          namespace: params.namespace ?? "eve",
        });
        return ok(data);
      }
      case "reenqueueRun": {
        const runId = String(params.runId ?? "");
        if (typeof runtime.reenqueueRun !== "function") {
          return fail(
            new Error("当前 Eve runtime 未导出 reenqueueRun"),
            "reenqueueRun",
            params,
          );
        }
        await runtime.reenqueueRun(world, runId, {
          namespace: params.namespace ?? "eve",
        });
        return ok(null);
      }
      case "wakeUpRun": {
        const runId = String(params.runId ?? "");
        if (typeof runtime.wakeUpRun !== "function") {
          return fail(
            new Error("当前 Eve runtime 未导出 wakeUpRun"),
            "wakeUpRun",
            params,
          );
        }
        const data = await runtime.wakeUpRun(world, runId, {
          ...(typeof params.options === "object" && params.options
            ? (params.options as Record<string, unknown>)
            : {}),
          namespace:
            (params.options as { namespace?: string } | undefined)?.namespace ??
            "eve",
        });
        return ok(data);
      }
      case "resumeHook": {
        const token = String(params.token ?? "");
        if (typeof runtime.resumeHook !== "function") {
          return fail(
            new Error("当前 Eve runtime 未导出 resumeHook"),
            "resumeHook",
            params,
          );
        }
        const data = await runtime.resumeHook(token, params.payload);
        return ok(data);
      }
      case "runHealthCheck": {
        // 端点仅允许 'workflow' | 'step'（helpers.d.ts），禁止 'world'
        const rawEndpoint = String(params.endpoint ?? "workflow");
        const endpoint: "workflow" | "step" =
          rawEndpoint === "step" ? "step" : "workflow";
        if (typeof runtime.healthCheck === "function") {
          try {
            const data = await runtime.healthCheck(world, endpoint, {
              ...(typeof params.options === "object" && params.options
                ? (params.options as Record<string, unknown>)
                : {}),
              namespace:
                (params.options as { namespace?: string } | undefined)
                  ?.namespace ?? "eve",
            });
            // 与上游一致：success=true 包装，healthy 字段表达结果
            return ok(data);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return ok({
              healthy: false,
              error: errorMessage,
              latencyMs: undefined,
            });
          }
        }
        // 无 healthCheck helper 时：以同 World 可读 runs 为可达性证明
        await world.runs.list({
          pagination: { limit: 1, sortOrder: "desc" },
          resolveData: "none",
        });
        return ok({
          healthy: true,
          message: "World reachable via getWorld()",
        });
      }
      default:
        return fail(new Error(`未实现 method：${method}`), method, params);
    }
  } catch (error) {
    return fail(error, method, params);
  }
}

/**
 * 读取 stream 二进制 chunk（二进制透传）。
 * readStream(world, runId, streamId, options) — World 为第一参数。
 */
export async function readWorkflowDebugStream(input: {
  readonly runId: string;
  readonly streamId: string;
  readonly startIndex?: number;
}): Promise<ReadableStream<Uint8Array> | Uint8Array | null> {
  await preflightWorkflowWorld();
  const world = (await getEveInstalledWorld()) as WorldAny;
  const runtime = await getEveRuntimeModule();

  if (typeof runtime.readStream === "function") {
    const result = await runtime.readStream(
      world,
      input.runId,
      input.streamId,
      { startIndex: input.startIndex ?? 0 },
    );
    return result as ReadableStream<Uint8Array> | Uint8Array | null;
  }
  if (typeof world.streams?.get === "function") {
    return (await world.streams.get(
      input.runId,
      input.streamId,
      input.startIndex ?? 0,
    )) as ReadableStream<Uint8Array> | Uint8Array | null;
  }
  throw new Error("当前 World 不支持 streams 读取。");
}

/**
 * 对齐上游 workflow-server-actions.fetchWorkflowsManifest：
 * 按优先级扫描 Agent 构建产物与配置路径，读取 build-time graph manifest。
 * 禁止硬编码空 stub 跳过发现。
 */
export async function discoverWorkflowsManifest(): Promise<{
  version: string;
  steps: Record<string, unknown>;
  workflows: Record<string, unknown>;
  sourcePath?: string;
}> {
  const cwd = process.cwd();
  const resolvePath = (p: string) =>
    path.isAbsolute(p) ? p : path.join(cwd, p);

  const manifestPaths: string[] = [];

  // 1. 显式配置
  if (process.env.WORKFLOW_MANIFEST_PATH) {
    manifestPaths.push(resolvePath(process.env.WORKFLOW_MANIFEST_PATH));
  }

  // 2. 本地 world 数据目录
  const dataDir =
    process.env.WORKFLOW_LOCAL_DATA_DIR?.trim() ||
    path.join(cwd, ".eve", ".workflow-data");
  manifestPaths.push(path.join(resolvePath(dataDir), "manifest.json"));

  // 3. 标准 Next app-router 路径
  manifestPaths.push(
    path.join(cwd, "app", ".well-known", "workflow", "v1", "manifest.json"),
    path.join(cwd, "src", "app", ".well-known", "workflow", "v1", "manifest.json"),
  );

  // 4. Eve Agent 构建产物常见位置
  manifestPaths.push(
    path.join(cwd, ".output", "public", ".well-known", "workflow", "v1", "manifest.json"),
    path.join(cwd, ".output", ".well-known", "workflow", "v1", "manifest.json"),
    path.join(cwd, "public", ".well-known", "workflow", "v1", "manifest.json"),
    path.join(cwd, ".eve", "compile", "workflow-manifest.json"),
  );

  // 5. 扫描 .eve/builds/*/output/public/.well-known/workflow/v1/manifest.json
  const buildsRoot = path.join(cwd, ".eve", "builds");
  try {
    await access(buildsRoot);
    const entries = await readdir(buildsRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      manifestPaths.push(
        path.join(
          buildsRoot,
          ent.name,
          "output",
          "public",
          ".well-known",
          "workflow",
          "v1",
          "manifest.json",
        ),
      );
    }
  } catch {
    // 无 builds 目录则跳过
  }

  // 6. 兼容 EMBEDDED
  if (process.env.WORKFLOW_EMBEDDED_DATA_DIR) {
    manifestPaths.push(
      path.join(resolvePath(process.env.WORKFLOW_EMBEDDED_DATA_DIR), "manifest.json"),
    );
  }

  for (const manifestPath of manifestPaths) {
    try {
      const content = await readFile(manifestPath, "utf-8");
      const parsed = JSON.parse(content) as {
        version?: string;
        steps?: Record<string, unknown>;
        workflows?: Record<string, unknown> | unknown[];
      };
      // 规范化为 UI 可消费的 { version, steps, workflows: Record }
      let workflows: Record<string, unknown> = {};
      if (parsed.workflows && !Array.isArray(parsed.workflows)) {
        workflows = parsed.workflows as Record<string, unknown>;
      } else if (Array.isArray(parsed.workflows)) {
        for (const item of parsed.workflows) {
          if (item && typeof item === "object") {
            const o = item as Record<string, unknown>;
            const key = String(o.workflowName ?? o.name ?? o.id ?? "");
            if (key) workflows[key] = o;
          }
        }
      }
      return {
        version: parsed.version ?? "1.0.0",
        steps: (parsed.steps as Record<string, unknown>) ?? {},
        workflows,
        sourcePath: manifestPath,
      };
    } catch {
      // 尝试下一路径
    }
  }

  // 发现完成但无文件：返回与上游一致的空 manifest 结构（非跳过发现的硬编码捷径）
  return {
    version: "1.0.0",
    steps: {},
    workflows: {},
  };
}
