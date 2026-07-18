import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type Database } from "@tursodatabase/database";
import { AGENT_IDS, type AgentId } from "./model-catalog";
import {
  type CreateBindingRequest,
  type CreateBindingResponse,
  type RecentRootSetPublic,
  type WorkspaceBindingRecord,
  type WorkspaceRoot,
  WorkspaceStoreError,
} from "./workspace-binding";

export { WorkspaceStoreError } from "./workspace-binding";
import {
  WORKSPACE_SCHEMA_V1_SQL,
  WORKSPACE_SCHEMA_V2_SQL,
  WORKSPACE_SCHEMA_V3_SQL,
  WORKSPACE_SCHEMA_VERSION,
} from "./workspace-schema";

const BUSY_TIMEOUT_MS = 5_000;

/**
 * 解析 nianagent 仓库根（含 `.workflow-data/nianagent.db`）。
 * 必须兼容：源码 import、Eve 打包后的 .output 运行时、以及 cwd 在 agents/<id> 下。
 * 禁止仅依赖 import.meta.url 相对 ../../..（打包后会落到 agents/ 等错误目录）。
 */
export function resolveNianagentRoot(): string {
  const candidates: string[] = [];

  // 1) process.cwd() 及其祖先
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2) import.meta.url 所在目录及其祖先（源码与部分 bundle 场景）
  try {
    let here = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      candidates.push(here);
      const parent = path.dirname(here);
      if (parent === here) break;
      here = parent;
    }
  } catch {
    // ignore
  }

  // 3) agents/<name> → 上两级到 monorepo 根旁的 nianagent
  const cwd = path.resolve(process.cwd());
  if (/[\\/]agents[\\/][^\\/]+$/i.test(cwd)) {
    candidates.unshift(path.resolve(cwd, "../.."));
  }

  for (const c of candidates) {
    // 已有产品库
    if (existsSync(path.join(c, ".workflow-data", "nianagent.db"))) {
      return c;
    }
    // package.json name === nianagent
    const pkgPath = path.join(c, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "nianagent") return c;
      } catch {
        // continue
      }
    }
  }

  // 兜底：cwd 上两级（agents/x 场景）或 cwd
  if (/[\\/]agents[\\/][^\\/]+$/i.test(cwd)) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

export function defaultWorkspaceDbPath(): string {
  const fromEnv = process.env.NIANAGENT_WORKSPACE_DB?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(resolveNianagentRoot(), ".workflow-data", "nianagent.db");
}

function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);
}

/** 256-bit URL-safe capability；库中仅存 SHA-256 digest。 */
export function generateCapability(): string {
  return randomBytes(32).toString("base64url");
}

export function digestCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

/**
 * 规范化 Windows 路径为可比较的 canonical 形态（保留盘符，统一分隔符与大小写）。
 * 真实存在性用 realpath 复核；不存在的路径拒绝创建 binding。
 */
export function normalizeWindowsPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new WorkspaceStoreError("invalid_roots", "工作目录路径不能为空。");
  }
  // 拒绝相对路径与 Unix 风格根（本产品契约为 Windows 绝对路径）
  if (!path.win32.isAbsolute(trimmed)) {
    throw new WorkspaceStoreError(
      "invalid_roots",
      `工作目录必须是 Windows 绝对路径：${trimmed}`,
    );
  }
  // 拒绝 UNC / 设备路径
  if (trimmed.startsWith("\\\\") || /^[\\/]{2}/.test(trimmed)) {
    throw new WorkspaceStoreError(
      "invalid_roots",
      `不支持 UNC 或设备路径：${trimmed}`,
    );
  }
  const resolved = path.win32.resolve(trimmed);
  // 统一为 path.win32 形式，并去掉尾随分隔符（盘符根除外）
  const normalized = path.win32.normalize(resolved);
  if (/^[A-Za-z]:\\$/.test(normalized)) return normalized;
  return normalized.replace(/[\\/]+$/, "");
}

function comparablePath(p: string): string {
  return normalizeWindowsPath(p).toLowerCase();
}

/** 判断 a 是否为 b 的祖先路径（或相等）。 */
function isAncestorOrEqual(ancestor: string, child: string): boolean {
  const a = comparablePath(ancestor);
  const c = comparablePath(child);
  if (a === c) return true;
  const prefix = a.endsWith("\\") ? a : `${a}\\`;
  return c.startsWith(prefix);
}

function makeAlias(baseName: string, used: Set<string>): string {
  let raw = baseName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!raw) raw = "root";
  if (raw.length > 48) raw = raw.slice(0, 48);
  let alias = raw;
  let n = 2;
  while (used.has(alias)) {
    alias = `${raw}-${n}`;
    n += 1;
  }
  used.add(alias);
  return alias;
}

/**
 * 规范化多根：绝对路径、存在且为目录、去重、拒绝父子重叠；生成稳定 alias。
 */
export async function normalizeBindingRoots(
  roots: readonly string[],
): Promise<readonly WorkspaceRoot[]> {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new WorkspaceStoreError(
      "invalid_roots",
      "至少需要一个工作目录。",
    );
  }

  const canonicals: string[] = [];
  for (const raw of roots) {
    if (typeof raw !== "string") {
      throw new WorkspaceStoreError("invalid_roots", "工作目录必须是字符串路径。");
    }
    const normalized = normalizeWindowsPath(raw);
    let real: string;
    try {
      const st = await stat(normalized);
      if (!st.isDirectory()) {
        throw new WorkspaceStoreError(
          "directory_unavailable",
          `路径不是目录：${normalized}`,
        );
      }
      real = await realpath(normalized);
    } catch (err) {
      if (err instanceof WorkspaceStoreError) throw err;
      throw new WorkspaceStoreError(
        "directory_unavailable",
        `目录不可用或不存在：${normalized}`,
      );
    }
    // realpath 可能返回不同大小写；再走一次 Windows 规范化
    canonicals.push(normalizeWindowsPath(real));
  }

  // 去重（按 comparable）
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const c of canonicals) {
    const key = comparablePath(c);
    if (seen.has(key)) {
      throw new WorkspaceStoreError(
        "overlapping_roots",
        `重复的工作目录根：${c}`,
      );
    }
    seen.add(key);
    unique.push(c);
  }

  // 父子/重叠：任意一对存在祖先关系则拒绝
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i]!;
      const b = unique[j]!;
      if (isAncestorOrEqual(a, b) || isAncestorOrEqual(b, a)) {
        throw new WorkspaceStoreError(
          "overlapping_roots",
          `工作目录存在父子或重叠关系，无法绑定：${a} 与 ${b}`,
        );
      }
    }
  }

  const usedAliases = new Set<string>();
  return unique.map((canonicalPath) => {
    const base = path.win32.basename(canonicalPath) || "root";
    const alias = makeAlias(base, usedAliases);
    return {
      alias,
      canonicalPath,
      displayPath: canonicalPath,
    };
  });
}

type DbRow = {
  workspace_id: string;
  agent_id: string;
  roots_json: string;
  capability_digest: string;
  created_at: string;
  revoked_at: string | null;
};

function rowToRecord(row: DbRow): WorkspaceBindingRecord {
  if (!isAgentId(row.agent_id)) {
    throw new WorkspaceStoreError(
      "database_error",
      `数据库中的 agent_id 无效：${row.agent_id}`,
    );
  }
  let roots: WorkspaceRoot[];
  try {
    const parsed = JSON.parse(row.roots_json) as WorkspaceRoot[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("empty");
    }
    roots = parsed.map((r) => ({
      alias: String(r.alias),
      canonicalPath: String(r.canonicalPath),
      displayPath: String(r.displayPath),
    }));
  } catch {
    throw new WorkspaceStoreError(
      "database_error",
      "workspace_bindings.roots_json 无法解析。",
    );
  }
  return {
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    roots,
    capabilityDigest: row.capability_digest,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

async function openDatabase(
  dbPath: string,
  mode: "readwrite" | "readonly",
): Promise<Database> {
  await mkdir(path.dirname(dbPath), { recursive: true });
  try {
    // Windows + Turso 0.4.4：connect({ readonly: true }) 会在 step 时报
    // "Resource is read-only"。产品语义上 Agent 仍只做 SELECT（见 getBinding*），
    // 连接层统一用可写句柄；migration / INSERT 仍仅走 withWritableDb。
    const db = await connect(dbPath, {
      timeout: BUSY_TIMEOUT_MS,
    });
    await db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    if (mode === "readwrite") {
      await db.exec("PRAGMA journal_mode = WAL;");
    }
    return db;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    throw new WorkspaceStoreError(
      "database_error",
      `无法打开 Turso 数据库（${dbPath}）：${message}。请确认已安装 @tursodatabase/database@0.4.4 与 Windows native binding。`,
    );
  }
}

async function closeDatabaseQuietly(db: Database): Promise<void> {
  try {
    await db.close();
  } catch {
    // 关闭失败不掩盖业务结果
  }
}

/**
 * Next 写路径：每次操作短连接。
 * 禁止进程内长连接：Turso 0.4.4 多进程下长连接会导致写入对其它进程（Agent）不可见，
 * 甚至在外部 checkpoint 后出现“写成功但库内查无”的分叉视图。
 * 供 tool-trust-store 等 Next 独占写模块复用。
 */
export async function withWritableDb<T>(
  dbPath: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await openDatabase(dbPath, "readwrite");
  try {
    await migrateWorkspaceSchema(db);
    const result = await fn(db);
    // 将 WAL 合并进主库，便于 Agent 进程读到最新 binding
    try {
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // checkpoint 失败不回滚已提交写入
    }
    return result;
  } finally {
    await closeDatabaseQuietly(db);
  }
}

/**
 * Agent / 查询路径：每次 SELECT 短连接并关闭。
 * 避免缓存连接停留在过期快照上。
 * 供 tool-trust-store 等只读查询复用；不执行 migration。
 */
export async function withReadableDb<T>(
  dbPath: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  try {
    await stat(dbPath);
  } catch {
    throw new WorkspaceStoreError(
      "database_error",
      `工作区数据库尚不存在（${dbPath}）。请先通过 Next 的 binding API 创建 binding。`,
    );
  }
  const db = await openDatabase(dbPath, "readonly");
  try {
    return await fn(db);
  } finally {
    await closeDatabaseQuietly(db);
  }
}

/**
 * v3 内容唯一索引前：去掉同内容重复行（保留 created_at 最早的一条）。
 * 避免历史随机 id 直插产生的重复块死 UNIQUE INDEX。
 */
async function dedupeToolTrustRulesBeforeV3(db: Database): Promise<void> {
  const rows = (await db
    .prepare(
      `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
              ifnull(logical_cwd, '') AS cwd_key, created_at
       FROM tool_trust_rules
       ORDER BY created_at ASC, id ASC`,
    )
    .all()) as Array<{
    id: string;
    workspace_id: string;
    agent_id: string;
    tool_name: string;
    match_type: string;
    pattern: string;
    cwd_key: string;
    created_at: string;
  }>;

  const seen = new Set<string>();
  const dropIds: string[] = [];
  for (const row of rows) {
    const key = [
      row.workspace_id,
      row.agent_id,
      row.tool_name,
      row.match_type,
      row.pattern,
      row.cwd_key,
    ].join("\0");
    if (seen.has(key)) {
      dropIds.push(row.id);
    } else {
      seen.add(key);
    }
  }
  if (dropIds.length === 0) return;
  const del = db.prepare(`DELETE FROM tool_trust_rules WHERE id = ?`);
  for (const id of dropIds) {
    await del.run(id);
  }
}

export async function migrateWorkspaceSchema(db: Database): Promise<void> {
  const migrate = db.transaction(async () => {
    await db.exec(WORKSPACE_SCHEMA_V1_SQL);
    await db.exec(WORKSPACE_SCHEMA_V2_SQL);

    // v3：先去重再建内容唯一索引与 epoch 表
    const v3Applied = (await db
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(3)) as { version: number } | undefined;
    if (!v3Applied) {
      try {
        await dedupeToolTrustRulesBeforeV3(db);
      } catch (err) {
        // 表尚不存在时跳过（纯新库随后 CREATE IF NOT EXISTS）
        const message = err instanceof Error ? err.message : String(err);
        if (!/no such table/i.test(message)) throw err;
      }
      await db.exec(WORKSPACE_SCHEMA_V3_SQL);
    } else {
      // 已登记 v3 时仍保证对象存在（幂等 exec）
      await db.exec(WORKSPACE_SCHEMA_V3_SQL);
    }

    // 逐版本登记，便于从 v1 库升级到当前版本
    const appliedAt = new Date().toISOString();
    for (let version = 1; version <= WORKSPACE_SCHEMA_VERSION; version++) {
      const row = (await db
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get(version)) as { version: number } | undefined;
      if (!row) {
        await db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(version, appliedAt);
      }
    }
  });
  try {
    await migrate();
  } catch (err) {
    if (err instanceof WorkspaceStoreError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkspaceStoreError(
      "database_error",
      `工作区数据库迁移失败：${message}`,
    );
  }
}

export async function createWorkspaceBinding(
  request: CreateBindingRequest,
  options?: { readonly dbPath?: string },
): Promise<CreateBindingResponse> {
  if (!isAgentId(request.agentId)) {
    throw new WorkspaceStoreError(
      "invalid_agent",
      `无效的 agentId：${String(request.agentId)}`,
    );
  }
  const roots = await normalizeBindingRoots(request.roots);
  const capability = generateCapability();
  const capabilityDigest = digestCapability(capability);
  const workspaceId = randomBytes(16).toString("hex");
  const createdAt = new Date().toISOString();
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();

  try {
    await withWritableDb(dbPath, async (db) => {
      const insert = db.transaction(async () => {
        await db
          .prepare(
            `INSERT INTO workspace_bindings
              (workspace_id, agent_id, roots_json, capability_digest, created_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            workspaceId,
            request.agentId,
            JSON.stringify(roots),
            capabilityDigest,
            createdAt,
          );
      });
      await insert();
    });
  } catch (err) {
    if (err instanceof WorkspaceStoreError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkspaceStoreError(
      "database_error",
      `创建 workspace binding 失败：${message}`,
    );
  }

  return {
    workspaceId,
    agentId: request.agentId,
    roots: roots.map(({ alias, displayPath }) => ({ alias, displayPath })),
    capability,
  };
}

async function getBindingRow(
  mode: "readwrite" | "readonly",
  sql: string,
  param: string,
  dbPath?: string,
): Promise<WorkspaceBindingRecord | null> {
  const pathToUse = dbPath ?? defaultWorkspaceDbPath();
  const run = async (db: Database) => {
    const row = (await db.prepare(sql).get(param)) as DbRow | undefined;
    if (!row) return null;
    return rowToRecord(row);
  };
  // writable 选项用于测试自读刚写入的库；生产 Agent 走只读短连接
  if (mode === "readwrite") {
    return withWritableDb(pathToUse, run);
  }
  return withReadableDb(pathToUse, run);
}

/** 按 capability digest 查询（含已撤销，调用方自行检查 revokedAt）。 */
export async function getBindingByCapabilityDigest(
  digest: string,
  options?: { readonly dbPath?: string; readonly writable?: boolean },
): Promise<WorkspaceBindingRecord | null> {
  if (!digest || typeof digest !== "string") return null;
  return getBindingRow(
    options?.writable ? "readwrite" : "readonly",
    `SELECT workspace_id, agent_id, roots_json, capability_digest, created_at, revoked_at
     FROM workspace_bindings WHERE capability_digest = ?`,
    digest,
    options?.dbPath,
  );
}

/** 按 workspaceId 只读查询。 */
export async function getBindingByWorkspaceId(
  workspaceId: string,
  options?: { readonly dbPath?: string; readonly writable?: boolean },
): Promise<WorkspaceBindingRecord | null> {
  if (!workspaceId || typeof workspaceId !== "string") return null;
  return getBindingRow(
    options?.writable ? "readwrite" : "readonly",
    `SELECT workspace_id, agent_id, roots_json, capability_digest, created_at, revoked_at
     FROM workspace_bindings WHERE workspace_id = ?`,
    workspaceId,
    options?.dbPath,
  );
}

/** 最近目录集合默认条数上限（去重后）。 */
/** 绑定表单「最近使用」默认只回显最近 3 组目录集合 */
export const RECENT_ROOT_SETS_DEFAULT_LIMIT = 3;

/** 扫描历史 binding 的行数上限（再在内存中按路径集合去重）。 */
const RECENT_ROOT_SETS_SCAN_LIMIT = 48;

function rootSetDedupeKey(roots: readonly WorkspaceRoot[]): string {
  // 用 canonical 去重（不落客户端）；顺序敏感，保留用户绑定顺序语义
  return roots.map((r) => r.canonicalPath.trim().toLowerCase()).join("\0");
}

/**
 * 从 workspace_bindings 历史派生最近目录集合（本机产品偏好）。
 * - 按 created_at 新→旧扫描，按 canonical 路径集合去重
 * - 含已撤销 binding（撤销不代表目录无效，仅 capability 失效）
 * - 响应仅含 displayPath；库不存在时返回空列表（不抛）
 */
export async function listRecentRootSets(options?: {
  readonly dbPath?: string;
  readonly limit?: number;
  /** 若指定则只聚合该 agent 的历史；默认全 agent（本机共用） */
  readonly agentId?: AgentId;
}): Promise<readonly RecentRootSetPublic[]> {
  const limit = Math.min(
    Math.max(options?.limit ?? RECENT_ROOT_SETS_DEFAULT_LIMIT, 1),
    32,
  );
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();

  try {
    await stat(dbPath);
  } catch {
    return [];
  }

  try {
    return await withReadableDb(dbPath, async (db) => {
      const agentId = options?.agentId;
      const rows = (
        agentId
          ? await db
              .prepare(
                `SELECT roots_json, created_at
                 FROM workspace_bindings
                 WHERE agent_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?`,
              )
              .all(agentId, RECENT_ROOT_SETS_SCAN_LIMIT)
          : await db
              .prepare(
                `SELECT roots_json, created_at
                 FROM workspace_bindings
                 ORDER BY created_at DESC
                 LIMIT ?`,
              )
              .all(RECENT_ROOT_SETS_SCAN_LIMIT)
      ) as Array<{ roots_json: string; created_at: string }>;

      const seen = new Set<string>();
      const out: RecentRootSetPublic[] = [];

      for (const row of rows) {
        let roots: WorkspaceRoot[];
        try {
          const parsed = JSON.parse(row.roots_json) as WorkspaceRoot[];
          if (!Array.isArray(parsed) || parsed.length === 0) continue;
          roots = parsed.map((r) => ({
            alias: String(r.alias),
            canonicalPath: String(r.canonicalPath),
            displayPath: String(r.displayPath),
          }));
        } catch {
          continue;
        }

        const key = rootSetDedupeKey(roots);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const paths = roots
          .map((r) => r.displayPath.trim())
          .filter((p) => p.length > 0);
        if (paths.length === 0) continue;

        out.push({
          paths,
          usedAt:
            typeof row.created_at === "string" && row.created_at
              ? row.created_at
              : new Date(0).toISOString(),
        });
        if (out.length >= limit) break;
      }

      return out;
    });
  } catch (err) {
    if (err instanceof WorkspaceStoreError && err.code === "database_error") {
      // 库损坏/暂不可读：绑定页仍可用，只是无历史
      return [];
    }
    throw err;
  }
}

/**
 * 兼容旧测试钩子：连接已改为每次操作短生命周期，无需再清缓存。
 */
export function resetWorkspaceDbCachesForTests(): void {
  // no-op：不再缓存进程级 Database 句柄
}
