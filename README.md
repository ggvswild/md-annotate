# Markdown 批注预览 · MD Annotate

在 VS Code 里以"预览"形式打开 Markdown，像富文本工具一样**划选文字或段落写批注**，导出结构化 `JSON` 交给 AI（Claude Code 等）去精确修改源文件。

> 灵感来自一个 Chrome 网页批注扩展（`static-site-html/extension`），把它的交互移植到 VS Code 的 Markdown 预览场景，并加入**渲染→源码行号映射**，让 AI 在源文件中定位更稳。

## 功能

- 命令 **`Markdown 批注预览：打开`**（或编辑器标题栏 💬 按钮，仅 `.md` 文件可见）打开右侧批注预览。
- 右下角浮动面板（可拖动、可隐藏）：
  - ✍️ **评论选中文字** — 鼠标划选渲染后的文字。
  - 🎯 **选段落** — 按住 `Alt` 点击整段/标题/列表项。
- 每条批注选类型：**评论 / 替换 / 删除**，写下修改意见。
- 列表支持删除、点按跳转高亮、**↪ 定位源码**（在编辑器中定位到对应行）。
- ⬇ 导出 / 📋 复制 / 🗑 清空；批注按文件自动暂存，文件保存后重渲不丢。

## 输出

导出会在 md 同目录生成 `<文件名>.annotations.json`：

```json
{
  "file": "draft-v0/XCREW/XCREW.md",
  "count": 1,
  "annotations": [
    {
      "id": "a1", "type": "replacement", "mode": "text",
      "selectedText": "渲染后选中的文字", "comment": "改成更口语的表达",
      "replacementText": "渲染后选中的文字",
      "sourceLineStart": 12, "sourceLineEnd": 14,
      "sourceText": "该块的原始 markdown 文本",
      "contextPrefix": "…", "contextSuffix": "…"
    }
  ]
}
```

字段对齐 Raven `.annotations.json` schema，并附**源码行号 + 原始 markdown 文本**，便于 AI 定位。

## 应用闭环

在 Claude Code 里说：

> 应用 `XCREW.annotations.json` 到对应 md 源文件

AI 读取 JSON → 逐条按类型改写 `.md`。`replacement/deletion` 用 `selectedText`/`sourceText` 在行号区间内定位；`comment` 按意见改写；定位失败用前后文兜底。

## 开发

```bash
npm install
npm run build      # esbuild 打包 + tsc 类型检查
npm run package    # 生成 md-annotate.vsix
```

按 `F5` 启动扩展开发宿主调试，或 `code --install-extension md-annotate.vsix` 安装。
