import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const controlClasses = [
  "moon-composer-model-trigger",
  "moon-permission-trigger",
]
const controlStylesheets = [
  "src/components/composer/composer-input-card.css",
  "src/features/conversation/permissions/permission-picker.css",
]
const appearanceProperty =
  /^(?:height|min-height|max-height|font(?:-.+)?|line-height|border(?:-.+)?|background(?:-.+)?|color|padding(?:-.+)?|gap|row-gap|column-gap|box-shadow|opacity)$/
const appearanceUtility =
  /^(?:!?)(?:rounded|font|text|bg|border|h|min-h|max-h|size|p|px|py|pt|pb|pl|pr|ps|pe|gap|gap-x|gap-y|leading|tracking|shadow|ring|opacity)-/

function attribute(node, name) {
  return node.attributes.find(
    (item) => item.type === "JSXAttribute" && item.name.name === name
  )
}

function literalValue(item) {
  const value = item?.value
  if (value?.type === "Literal") return value.value
  if (
    value?.type === "JSXExpressionContainer" &&
    value.expression.type === "Literal"
  ) {
    return value.expression.value
  }
  return undefined
}

function buttonImports(node, names) {
  if (!/components\/ui\/button$/.test(node.source.value)) return
  for (const specifier of node.specifiers) {
    if (
      specifier.type === "ImportSpecifier" &&
      specifier.imported.name === "Button"
    ) {
      names.add(specifier.local.name)
    }
  }
}

// Check the actual CSS source as part of linting its toolbar owner. These
// selectors must survive Tooltip/Popover asChild changing the final data-slot.
export function inspectComposerCss(css, file) {
  const problems = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " ")
  )
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of block[1].split(",")) {
      for (const className of controlClasses) {
        const marker = new RegExp(`\\.${className}(?=[\\s.#[:>+~]|$)`)
        const match = marker.exec(selector)
        if (!match) continue
        const line = source
          .slice(0, block.index + block[1].indexOf(selector))
          .split("\n").length
        if (/\[data-slot\s*=\s*["']?button["']?\s*\]/.test(selector)) {
          problems.push(
            `${file}:${line}：${className} 不能依赖 data-slot=button；组合触发器会改变该属性。`
          )
        }
        const tail = selector
          .slice(match.index + match[0].length)
          .replace(/\[[^\]]*\]/g, "")
          .replace(/:[\w-]+(?:\([^)]*\))?/g, "")
          .trim()
        if (tail) continue // A descendant (for example the chevron) has its own role.
        for (const declaration of block[2].matchAll(
          /(?:^|;)\s*([\w-]+)\s*:/g
        )) {
          if (appearanceProperty.test(declaration[1])) {
            problems.push(
              `${file}:${line}：${className} 的 ${declaration[1]} 应维护在 Button composer 变体，业务 CSS 只处理布局。`
            )
          }
        }
      }
    }
  }
  return problems
}

export default {
  rules: {
    "project-tooltip": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          native:
          "需要补充说明时使用项目 Tooltip，无需补充时移除 title；HTML/Button title 会绕过统一外观与键盘说明。",
        },
      },
      create(context) {
        const buttons = new Set()
        return {
          ImportDeclaration(node) {
            buttonImports(node, buttons)
          },
          JSXOpeningElement(node) {
            if (node.name.type !== "JSXIdentifier") return
            if (!/^[a-z]/.test(node.name.name) && !buttons.has(node.name.name))
              return
            const title = attribute(node, "title")
            if (title) context.report({ node: title, messageId: "native" })
          },
        }
      },
    },
    "composer-controls": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          variant:
            '权限、模型和会话配置入口必须同时使用 Button variant="composer"、size="composer"。',
          override:
            "composer 入口的共同外观维护在 Button 变体；这里不能用 style 或外观类覆盖。",
        },
      },
      create(context) {
        const buttons = new Set()
        return {
          ImportDeclaration(node) {
            buttonImports(node, buttons)
          },
          JSXOpeningElement(node) {
            if (
              node.name.type !== "JSXIdentifier" ||
              !buttons.has(node.name.name)
            )
              return
            const classNode = attribute(node, "className")
            const classText = classNode
              ? context.sourceCode.getText(classNode)
              : ""
            const managed =
              controlClasses.some((name) => classText.includes(name)) ||
              literalValue(attribute(node, "aria-label")) === "打开会话配置" ||
              literalValue(attribute(node, "variant")) === "composer" ||
              literalValue(attribute(node, "size")) === "composer"
            if (!managed) return
            if (
              literalValue(attribute(node, "variant")) !== "composer" ||
              literalValue(attribute(node, "size")) !== "composer"
            ) {
              context.report({ node, messageId: "variant" })
            }
            const style = attribute(node, "style")
            if (style) context.report({ node: style, messageId: "override" })
            // Inspect literal class fragments too, including cn/conditional calls.
            if (classNode) {
              const fragments = [...classText.matchAll(/["'`]([^"'`]*)["'`]/g)]
              if (
                fragments.some((fragment) =>
                  fragment[1]
                    .split(/\s+/)
                    .some((token) =>
                      appearanceUtility.test(token.split(":").at(-1))
                    )
                )
              )
                context.report({ node: classNode, messageId: "override" })
            }
          },
        }
      },
    },
    "composer-css": {
      meta: {
        type: "problem",
        schema: [],
        messages: { source: "{{problem}}" },
      },
      create(context) {
        return {
          Program(node) {
            for (const file of controlStylesheets) {
              const css = readFileSync(resolve(context.cwd, file), "utf8")
              for (const problem of inspectComposerCss(css, file)) {
                context.report({ node, messageId: "source", data: { problem } })
              }
            }
          },
        }
      },
    },
  },
}
