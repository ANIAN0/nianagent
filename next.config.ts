import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nianagent/agent-core"],
  // Turso native driver 仅服务端使用，禁止打进 client bundle
  serverExternalPackages: [
    "@tursodatabase/database",
    "@tursodatabase/database-common",
    "@tursodatabase/database-win32-x64-msvc",
  ],
};

export default withEve(nextConfig, {
  agents: {
    "knowledge-base": "agents/knowledge-base",
    "work-assistant": "agents/work-assistant",
  },
});
