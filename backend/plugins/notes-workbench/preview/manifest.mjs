// @ts-check
/**
 * 预览条目清单：声明可被笔记页面 meta.preview 引用的真实组件演示。
 * file 为仓库根相对路径；export 为该文件的具名导出；由 scripts/build-notes-preview.mjs 编译。
 * multi 条目把导出对象整体并入条目注册表（catalog-registry 注册全部 catalog:<id>）。
 */
export const previewEntries = [
  {
    id: "notification-toast",
    file: "backend/plugins/notes-workbench/preview/notification-toast-entry.tsx",
    export: "NotificationToastEntry",
  },
  {
    id: "home-story",
    file: "backend/plugins/notes-workbench/preview/home-story-entry.tsx",
    export: "HomeStoryEntry",
  },
  {
    id: "catalog-registry",
    file: "backend/plugins/notes-workbench/preview/catalogs/index.tsx",
    export: "catalogEntries",
    multi: true,
  },
]
/** moon-ui 白名单注册表：页面源码 import { X } from "moon-ui" 的解析来源。 */
export const moonUiExport = {
  file: "backend/plugins/notes-workbench/preview/catalogs/moon-ui.ts",
  export: "moonUi",
}
