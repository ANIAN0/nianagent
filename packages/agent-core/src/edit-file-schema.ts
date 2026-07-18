/**
 * edit_file 共享 input schema：两端 Agent 工具与协议描述对齐。
 * new_string 允许 null/undefined 规范化为 ""（删除语义），避免空串在链路中丢失后校验失败。
 */

import { z } from "zod";

/** 将 null/undefined 规范为空串；其它非 string 交由后续 z.string 报错。 */
function coerceOptionalEmptyString(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  return value;
}

export const editFileInputSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe("逻辑绝对路径：/workspace/<alias>/..."),
  old_string: z
    .string()
    .describe(
      "要替换/删除的原文，须与文件内容逐字一致且非空；匹配须唯一，除非 replace_all=true",
    ),
  new_string: z.preprocess(
    coerceOptionalEmptyString,
    z
      .string()
      .describe(
        '替换后的文本；空字符串 "" 表示删除 old_string 片段（删除时务必显式传 ""）',
      ),
  ),
  replace_all: z
    .boolean()
    .optional()
    .describe("是否替换全部匹配；默认 false，多匹配时拒绝"),
});

export type EditFileInput = z.infer<typeof editFileInputSchema>;
