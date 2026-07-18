/** schema 版本：与 schema_migrations.version 对齐。 */
export const WORKSPACE_SCHEMA_VERSION = 1;

/**
 * version 1：会话多目录 binding 产品表。
 * 仅由 Next 写路径执行 migration；Agent 只读打开。
 */
export const WORKSPACE_SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_bindings (
  workspace_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  roots_json TEXT NOT NULL,
  capability_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS workspace_bindings_active_agent_idx
  ON workspace_bindings (agent_id, revoked_at);
`;
