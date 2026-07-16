import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nianagent/agent-core"],
};

export default withEve(nextConfig, {
  agents: {
    "knowledge-base": "agents/knowledge-base",
    "work-assistant": "agents/work-assistant",
  },
});
