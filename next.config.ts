import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};

export default withEve(nextConfig, {
  agents: {
    "knowledge-base": "agents/knowledge-base",
    "work-assistant": "agents/work-assistant",
  },
});
