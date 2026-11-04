import { useLayoutEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CatalogNavigation, catalogMatches } from "./catalog-navigation"
import { CatalogComponentShell } from "./catalog-component-shell"
import { CatalogPreviewFrame } from "./catalog-preview-frame"
import { CatalogToolbar } from "./catalog-toolbar"
import { CatalogDocs } from "./catalog-docs"
import { ExampleCode } from "./example-code"
import { useCatalogController } from "./use-catalog-controller"
import { entries } from "./catalog"
import { ToolLayout } from "../devtools/tool-layout"
import {
  componentHref,
  fileHref,
  codeModuleFor,
  codeModuleHref,
  operationsForComponent,
  apiHref,
} from "../devtools/content-index"

export function CatalogPage() {
  const controller = useCatalogController()
  const { selection, theme, width, height, fixedViewport } = controller
  const { entry, state } = selection
  const canvas = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(800)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    const measure = () => setAvailable(Math.max(240, element.clientWidth - 2))
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [entry?.id])
  const matches = entries
    .filter(
      (item) =>
        catalogMatches(item, controller.query).entry ||
        catalogMatches(item, controller.query).states.length
    )
    .sort((a, b) => a.order - b.order)
  const isOverview = !selection.component
  const relations = entry ? operationsForComponent(entry.id) : []
  const modules = entry
    ? entries.filter(
        (item) =>
          item.id !== entry.id &&
          (entry.modules
            ? entry.modules.some((module) => module.id === item.id)
            : entry.composition.some((value) => value.includes(item.source)))
      )
    : []
  const list = (items: typeof entries) => (
    <div className="reader-overview-grid">
      {items.map((item) => (
        <a
          className="reader-overview-card"
          key={item.id}
          href={controller.hrefFor(item)}
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey) return
            event.preventDefault()
            controller.navigate(item)
          }}
        >
          <strong>{item.name}</strong>
          <p>{item.description || item.story?.goal}</p>
          <small>
            {item.stage === "structure"
              ? "规划中 · 暂无运行演示"
              : `${item.states.length} 个命名场景`}
          </small>
        </a>
      ))}
    </div>
  )
  return (
    <ToolLayout
      navigationLabel="页面与组件目录"
      selectionKey={
        entry ? `component:${entry.id}:${state?.id ?? ""}` : "overview"
      }
      navigation={
        <CatalogNavigation
          component={selection.component}
          stateId={selection.stateId}
          query={controller.query}
          onQueryChange={controller.setQuery}
          onClearFilters={controller.clearFilters}
          onNavigate={controller.navigate}
          hrefFor={controller.hrefFor}
        />
      }
    >
      {isOverview ? (
        <article>
          <header>
            <p className="reader-kicker">开发资料 / 页面与组件</p>
            <h1>从页面理解产品</h1>
            <p>
              先查看完整页面，再进入业务模块的操作、状态与复用规则。演示直接使用正式组件，场景在隔离数据环境中运行。
            </p>
          </header>
          <h2>正式页面</h2>
          {list(matches.filter((item) => item.layer === "页面"))}
          <h2>业务模块</h2>
          <p>按要完成的操作定位到场景，页面内也可从组成模块进入。</p>
          {list(
            matches.filter(
              (item) => item.layer === "复合组件" || item.layer === "组合验证"
            )
          )}
          <h2>共享基础组件</h2>
          <div className="catalog-component-index">
            {matches
              .filter((item) => item.layer === "基础组件")
              .map((item) => (
                <a key={item.id} href={componentHref(item.id)}>
                  {item.name}
                </a>
              ))}
          </div>
          <h2>公共设计规则</h2>
          <DesignReference />
        </article>
      ) : !entry ? (
        <article>
          <h1>未找到组件</h1>
          <p>此标识没有展示定义。</p>
          <a href="/ui-catalog/">返回总览</a>
        </article>
      ) : (
        <article className="catalog-reading" data-expanded={expanded}>
          <header>
            <p className="reader-kicker">
              <a href="/ui-catalog/">页面与组件</a> / {entry.group}
            </p>
            <h1>{entry.name}</h1>
            <p>{entry.description || entry.story?.goal}</p>
            {entry.stage === "structure" && (
              <Badge variant="secondary">规划中</Badge>
            )}
          </header>
          {entry.story && (
            <section>
              <h2>目标与使用前提</h2>
              <p>{entry.story.goal}</p>
              <ul>
                {entry.story.preconditions.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
              <p>完成后：{entry.story.result}</p>
            </section>
          )}
          {entry.stage === "structure" ? (
            <CatalogComponentShell entry={entry} section={selection.section} />
          ) : (
            state && (
              <section>
                <h2>操作演示</h2>
                <div className="catalog-scene-selection">
                  <Select
                    value={state.id}
                    onValueChange={(id) => controller.navigate(entry, id)}
                  >
                    <SelectTrigger aria-label="选择命名场景">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {entry.states.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Badge variant="outline">
                    {state.section === "states"
                      ? "预置状态起点"
                      : "连续操作场景"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? (
                      <Minimize2 data-icon="inline-start" />
                    ) : (
                      <Maximize2 data-icon="inline-start" />
                    )}
                    {expanded ? "收起演示" : "展开演示"}
                  </Button>
                </div>
                <p>{state.condition}</p>
                <div className="catalog-demo">
                  <CatalogToolbar controller={controller} />
                  <div
                    ref={canvas}
                    className="catalog-reading-canvas"
                    data-fit={!fixedViewport}
                  >
                    <CatalogPreviewFrame
                      key={`${entry.id}:${state.id}:${controller.revision}`}
                      mode="canvas"
                      src={controller.previewUrl}
                      title={`${entry.name} · ${state.name}`}
                      initialHeight={
                        entry.layer === "基础组件"
                          ? Math.min(entry.viewport.height, 420)
                          : 680
                      }
                      width={fixedViewport ? width : available}
                      height={
                        fixedViewport
                          ? height
                          : entry.layer === "基础组件"
                            ? Math.min(entry.viewport.height, 420)
                            : 680
                      }
                      theme={theme}
                    />
                  </div>
                </div>
                <p className="reader-kicker">
                  示例使用隔离数据与服务。预览载入成功只表示可以操作，实际宿主能力需从正式功能验收。
                </p>
                <CatalogDocs entry={entry} stateId={state.id} />
                <ExampleCode key={entry.id} id={entry.id} />
              </section>
            )
          )}
          {!!modules.length && (
            <section>
              <h2>
                {entry.layer === "页面" ? "页面由什么组成" : "关联业务模块"}
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>所在区域</th>
                    <th>模块</th>
                    <th>作用</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {entry.modules?.find((module) => module.id === item.id)
                          ?.region ?? "组成模块"}
                      </td>
                      <td>
                        <a href={componentHref(item.id)}>{item.name}</a>
                      </td>
                      <td>{item.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {!!entry.standards.length && (
            <section>
              <h2>使用规则</h2>
              {entry.standards.map((rule) => (
                <section key={rule.id}>
                  <h3>{rule.name}</h3>
                  <p>{rule.rule}</p>
                  <p className="reader-kicker">{rule.reason}</p>
                  <details>
                    <summary>如何核对这条规则</summary>
                    <p>{rule.check}</p>
                  </details>
                </section>
              ))}
            </section>
          )}
          <section>
            <h2>输入与事件</h2>
            {entry.props?.length ? (
              <table>
                <thead>
                  <tr>
                    <th>参数 / 类型</th>
                    <th>用途</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.props.map((prop) => (
                    <tr key={prop.name}>
                      <td>
                        <code>{prop.name}</code>
                        <br />
                        {prop.type}
                      </td>
                      <td>
                        {prop.description}
                        <br />
                        默认：{prop.default || "未声明"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {entry.inputs.length > 0 && (
              <>
                <h3>输入</h3>
                <ul>
                  {entry.inputs.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              </>
            )}
            {entry.events.length > 0 && (
              <>
                <h3>事件与结果</h3>
                <ul>
                  {entry.events.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section>
            <h2>组成与使用位置</h2>
            <ul>
              {entry.composition.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
            <h3>使用方</h3>
            <ul>
              {entry.consumers.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
            <p>{entry.boundary}</p>
          </section>
          <section>
            <h2>相关代码与接口</h2>
            <div className="reader-related">
              <a href={fileHref(entry.source)}>{entry.source}</a>
              <a href={codeModuleHref(codeModuleFor(entry.source).id)}>
                {codeModuleFor(entry.source).title}
              </a>
            </div>
            {relations.length > 0 && (
              <div className="reader-related">
                {relations.map(([id, doc]) => (
                  <a key={id} href={apiHref(id)}>
                    {doc.definition.title} · {id}
                  </a>
                ))}
              </div>
            )}
          </section>
          <section>
            <h2>公共设计规则</h2>
            <DesignReference />
          </section>
        </article>
      )}
    </ToolLayout>
  )
}

function DesignReference() {
  const [content, setContent] = useState<string>()
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && content === undefined)
          void fetch("/__devtools/design").then(
            async (response) =>
              setContent(
                response.ok
                  ? await response.text()
                  : "本地 DESIGN.md 不可用；模块用法、场景和契约仍可在本页阅读。"
              ),
            () => setContent("本地设计参考读取失败，请检查开发服务。")
          )
      }}
    >
      <summary>阅读本地 DESIGN.md</summary>
      <p className="reader-kicker">
        直接读取当前本地规范；此文件按仓库约定忽略，不随正式插件页面发布。
      </p>
      {content ? (
        <div className="catalog-design-reference">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content.replace(/^---[\s\S]*?---\s*/, "")}
          </ReactMarkdown>
        </div>
      ) : (
        <p>展开后读取</p>
      )}
    </details>
  )
}
