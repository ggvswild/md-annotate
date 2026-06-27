# MD Annotate — Markdown 批注预览插件 设计文档

- 日期：2026-06-27
- 状态：已确认，进入实现
- 参考交互：`~/Documents/NetEase/static-site-html/extension`（Chrome 网页批注扩展）

## 1. 目标与背景

用户在 VS Code 里预览 Markdown 时，希望像富文本工具那样对**特定文字或段落**做选定、评论、批注，并生成一个本地文件交给 AI Agent 处理，从而能精确告诉 AI「改这一句 / 这一段」。

VS Code 自带的 Markdown 预览无法叠加批注 UI，也无法把"指认的文字位置"结构化导出。本插件填补这一空缺。

## 2. 范围（v1）

IN：
- 对任意 `.md` 打开"批注预览"webview（命令 + 编辑器标题栏按钮）。
- 渲染 markdown（markdown-it），块级元素带源码行号映射。
- 浮动批注面板（可拖动 / 可隐藏），两种锚定：划选文本、Alt+点选块。
- 每条批注：类型（评论 / 替换 / 删除）+ 意见文本。
- 批注列表：删除、点按跳转高亮、定位到编辑器源码行。
- 导出 / 复制 / 清空；按文件自动暂存（workspaceState），保存后重渲不丢。
- 产出 `<文件名>.annotations.json`（schema 对齐 Raven `.annotations.json`）。

OUT（v2，明确不做）：
- 回复盖楼（threads / parentId）。
- 跨文件批注汇总。
- 文档编辑后批注自动重锚（仅做"保存后重渲并尽力保留"）。
- 插件内置一键应用（应用统一走 Claude Code 对话）。

## 3. 架构

```
┌─────────────────────── Extension Host (Node) ──────────────────────┐
│ extension.ts                                                       │
│  - 注册命令 mdAnnotate.openPreview                                  │
│  - 读取活动 .md → markdown-it 渲染（注入 data-source-line/-end）    │
│  - 创建/复用 WebviewPanel，下发 {type:'render', html, source,...}   │
│  - onDidSaveTextDocument：被预览文件保存 → 重渲并保留批注           │
│  - 接收 webview 消息：save / persist / copy / reveal / info         │
│  - 写 <doc>.annotations.json；env.clipboard 复制；reveal 定位编辑器 │
└────────────────────────────────────────────────────────────────────┘
                 ▲  postMessage              │ onDidReceiveMessage
                 │                           ▼
┌─────────────────────────── Webview (Browser) ──────────────────────┐
│ panel.js  —— 移植自 content.js                                     │
│  - 渲染区：host 下发的 HTML（带 data-source-line）                  │
│  - 批注面板：选文本 / 选块 → 表单 → 列表                            │
│  - 捕获 selectedText / 前后文 / sourceLineStart-End / sourceText    │
│  - 与 host 通信：persist(每次变更) / save / copy / reveal           │
│ panel.css / markdown.css —— 面板样式 + 主题化 markdown 排版         │
└────────────────────────────────────────────────────────────────────┘
```

## 4. 数据模型（`<doc>.annotations.json`）

```json
{
  "file": "draft-v0/XCREW 数字员工/XCREW 数字员工-报告v0.md",
  "generatedAt": "2026-06-27T03:00:00.000Z",
  "count": 2,
  "annotations": [
    {
      "id": "a1",
      "type": "comment | replacement | deletion",
      "mode": "text | block",
      "selectedText": "渲染后选中的文字",
      "comment": "用户的修改意见",
      "replacementText": "（可选）替换目标文字",
      "sourceLineStart": 12,
      "sourceLineEnd": 14,
      "sourceText": "该块的原始 markdown 文本",
      "contextPrefix": "选区前 40 字",
      "contextSuffix": "选区后 40 字"
    }
  ]
}
```

字段对齐 Raven `.annotations.json`（`type/selectedText/replacementText/contextPrefix/contextSuffix`），并新增源码行号与 `sourceText`，使 AI 在**源码**中定位更稳健（渲染文本可能 ≠ 源码文本）。

## 5. 渲染→源码映射

markdown-it `core.ruler` 注入：对所有带 `token.map` 的顶层 token，设置
`data-source-line = map[0]+1`、`data-source-end = map[1]`（1-based，end 含）。
webview 捕获时向上找最近带 `data-source-line` 的祖先块，得到行号区间；
`sourceText = source.split('\n').slice(start-1, end).join('\n')`。

## 6. 消息协议

Host → Webview：`render { html, source, fileName, filePath, annotations }`
Webview → Host：
- `persist { annotations }` — 每次变更，写 workspaceState
- `save { annotations }` — 写 `<doc>.annotations.json`
- `copy { text }` — env.clipboard.writeText
- `reveal { line }` — 在编辑器中打开 .md 并定位该行
- `info { message }` — 顶部提示

## 7. 错误处理

- 非 markdown 文件触发命令 → 提示并退出。
- webview 写文件失败 → host 回 info 提示。
- 选区为空 / 未选块 → 面板内提示。
- 找不到 `data-source-line` 祖先（如代码块内）→ 行号置 null，回退到文本+前后文匹配。

## 8. 验证

- `npm run build`（esbuild 打包 + tsc 类型检查）零错误。
- 在 VS Code 中 F5 / 安装 .vsix，打开 `XCREW 数字员工-报告v0.md`：能渲染、能划选/选块批注、导出 JSON 内容正确（行号、sourceText 准确）。
- 用导出的 JSON 跑一次"应用"闭环（我读取并改源文件）。

## 9. 应用闭环

用户在 Claude Code 说「应用 `<doc>.annotations.json`」→ 读取 → 逐条按 type 改 `.md`：
- replacement：在 sourceLineStart..End 内定位 selectedText/sourceText → 替换为 replacementText/意见。
- deletion：定位 → 删除。
- comment：按意见在相应位置改写。
找不到精确匹配时用 contextPrefix/Suffix 兜底，仍失败则跳过并汇报。
