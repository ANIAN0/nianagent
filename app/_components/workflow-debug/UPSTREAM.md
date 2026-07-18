# Workflow 调试 UI 上游来源

- 仓库：https://github.com/vercel/workflow
- Commit（移植基线）：`927b61ab419e98c027c077af81273e73650cb94f`
- 源包：`packages/web`、`packages/web-shared`（Apache-2.0）
- 适配：React Router → Next App Router；RPC 经 Next 同源代理 → Agent `getWorld()` bridge
- 升级：对比上游 diff 后合并算法/表面；**禁止**引入第二 World；Eve 升级后按 T-004/T-006 重验同 World
- 协议冲突：以当前 Eve 内嵌 `@workflow/core` surface 为准
- 收口清单：`workplace/v0.1.0/acceptance/2026-07-17-local-workspace-binding/defects/DEF-012-page-checklist.md`
- P1 Runs：对齐 `packages/web/app/components/runs-table.tsx` + display-utils（copyable / relative-time / selection-bar / row actions）；local 不移植 Vercel period
- P2 Trace：对齐 `run-detail-view.tsx` + `web-shared` `buildTrace` / span-construction / NewTraceViewer 信息架构（列表+时间轴+侧栏）；数据钩子对齐 `use-trace-viewer`（事件分页、自动续载、运行中轮询）
- P3 Events/Streams：Events 排序/搜索/展开；Streams 分栏 + live 轮询分块解码
- P4 Graph：`adapt-manifest` + SVG 图 + 事件执行叠加
- P5 Hooks：列表筛选/无限滚动/复制/相对时间/resume payload
- P6 Workflows：清单表 + 宽侧栏图浏览
- P7 Stream 独立页：面包屑 + 全页 StreamViewer

## 许可

上游代码与算法遵循 Apache License 2.0。本目录移植件保留该许可义务；见同目录 `LICENSE-APACHE-2.0.txt`。
