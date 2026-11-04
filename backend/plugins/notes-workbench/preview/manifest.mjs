// @ts-check
/**
 * 预览条目清单：声明可被笔记页面 meta.preview 引用的真实组件演示。
 * file 为仓库根相对路径；export 为该文件的具名导出；由 scripts/build-notes-preview.mjs 编译。
 */
export const previewEntries = [
  {
    id: "notification-toast",
    file: "backend/plugins/notes-workbench/preview/notification-toast-entry.tsx",
    export: "NotificationToastEntry",
  },
  {
    id: "home-story",
    file: "ui-catalog/fixtures/home-stories.tsx",
    export: "HomeStoryExample",
  },
]
