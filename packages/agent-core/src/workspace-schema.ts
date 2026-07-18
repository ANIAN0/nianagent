/** schema 版本：与 schema_migrations.version 对齐。 */
export const WORKSPACE_SCHEMA_VERSION = 3;

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

/**
 * version 2：会话权限状态与工作区持久信任规则。
 * 无 last_used_at 写路径；Agent 不得写入本 schema 的表。
 */
export const WORKSPACE_SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS session_permission_state (
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  accept_edits INTEGER NOT NULL DEFAULT 0,
  global_bypass INTEGER NOT NULL DEFAULT 0,
  session_tool_grants_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id),
  UNIQUE (session_id, workspace_id, agent_id)
);

CREATE TABLE IF NOT EXISTS tool_trust_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  match_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  logical_cwd TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tool_trust_rules_lookup_idx
  ON tool_trust_rules (workspace_id, agent_id, tool_name, enabled);
`;

/**
 * version 3：规则变更世代（供 Agent 热缓存失效）+ 规则内容唯一键（幂等固化）。
 * 内容唯一：同一 workspace/agent/tool/match/pattern/cwd 仅一条行。
 */
export const WORKSPACE_SCHEMA_V3_SQL = `
CREATE TABLE IF NOT EXISTS tool_trust_rules_epoch (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, agent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_trust_rules_content_uidx
  ON tool_trust_rules (
    workspace_id,
    agent_id,
    tool_name,
    match_type,
    pattern,
    ifnull(logical_cwd, '')
  );
`;
