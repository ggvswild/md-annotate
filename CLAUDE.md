# md-annotate — 项目说明（给 Claude）

VS Code 扩展：在**自定义批注 webview** 里预览 Markdown（支持划选评论、导出 JSON）。
核心约束：**预览效果要和 GitHub.com 完全对齐**（样式 + 渲染内容）。

## 构建 / 打包 / 安装

```bash
npm run build      # esbuild 打 dist/extension.js + tsc --noEmit 类型检查
npm run package    # 生成 md-annotate.vsix（会先跑 esbuild）
code --install-extension md-annotate.vsix --force
```

安装后必须：**改版本号** → Reload Window → **关掉旧预览标签再重开**（原因见下方踩坑 3）。

## 渲染管线（两层）

1. **样式** — `media/themes/github-{auto,light,dark,dimmed}.css` 是官方
   [`github-markdown-css@5.9.0`](https://github.com/sindresorhus/github-markdown-css) **原样 vendored**，
   一次只激活一个（`extension.ts` 注入 `<link id="wa-theme-css">`，`panel.js` 切换时换 href）。
   `media/markdown.css` 是**叠加层**（阅读栏布局 + 页面留白底色 + 批注视觉 + 中和 VS Code 默认样式），
   最后加载，靠 `.markdown-body` 优先级压过主题文件。
2. **渲染** — `src/markdown.ts`：markdown-it + GFM 插件（task-lists / footnote / emoji / anchor+github-slugger）
   + [`@wooorm/starry-night`](https://github.com/wooorm/starry-night) 语法高亮。starry-night 产出 GitHub 同款
   `pl-*` token，直接被 vendored CSS 着色（无需额外高亮 CSS）。渲染器是 **async**（高亮要异步初始化 grammar/wasm）。

## 踩坑 & 经验（重要，改之前先读）

1. **VS Code webview 默认样式陷阱（最隐蔽）**
   VS Code 给每个 webview 注入一套默认样式，用 `--vscode-*` 变量的**裸标签规则**：
   `code { color: var(--vscode-textPreformat-foreground) }`（暗色编辑器里是橙色）、
   `blockquote { background: var(--vscode-textBlockQuote-background) }`（深色）。
   而 github-markdown-css 对**行内代码字色靠继承**、**引用块背景留空**——裸标签规则赢过"继承/未设置"，
   于是行内代码变橙、引用块变黑。`media/markdown.css` 必须保留：
   ```css
   .markdown-body code, .markdown-body tt { color: inherit; }
   .markdown-body blockquote { background: transparent; }
   ```
   ⚠️ 叠加层里**不要**用 `var(--bgColor-*/--fgColor-*)`：standalone 主题文件是内联色、**没有**定义这些变量
   （只有 `github-auto.css` 用变量），fallback 会把 light/dark/dimmed 的链接色、代码块底色搞坏。

2. **starry-night 的 wasm 打包**
   starry-night 是 ESM，且运行时要从自己的 node_modules 读 `vscode-oniguruma/release/onig.wasm`，
   打进 bundle 会失败。所以：
   - `esbuild.js` 里 `external: ['vscode', '@wooorm/starry-night']`（用动态 `import()` 加载）。
   - 随包带它的 node_modules：`package` 脚本**不能**用 `--no-dependencies`（那会整个排除 node_modules）；
     `.vscodeignore` 先 `node_modules/**` 再 negate `@wooorm/**`、`vscode-oniguruma/**`、`vscode-textmate/**`、`import-meta-resolve/**`。
   - 只有 `@wooorm/starry-night` 是 prod 依赖；其余（markdown-it、各插件、hast-util-to-html、github-slugger）是 devDependency（被 esbuild 打进 bundle）。

3. **验证方法的陷阱**
   - **无头 Chrome 复现不出 webview 问题**：Chrome 不会注入 VS Code 的默认样式，所以踩坑 1 在纯浏览器里看着是对的、
     在真实 webview 里却是错的。验证渲染问题时要么**在 HTML 里手动模拟 VS Code 注入**（一段 `<style>` 写裸
     `code`/`blockquote` 规则），要么直接在真实 webview 里看。
   - **同版本号覆盖安装有缓存**：VS Code 在版本号不变 + 进程运行时常继续用旧代码/旧 webview。改完务必 bump 版本号再装。

4. **行内代码不要加强调色**
   GitHub 线上行内代码就是**正文同色（继承）+ 浅灰底**（用 Playwright 抓 github.com 计算样式核对过：
   `color rgb(31,35,40)`、`background rgba(129,139,152,0.12)`）。曾试过加紫色强调，"要和线上完全对齐"时撤掉了。

## 和 GitHub 真值对比

- 权威 GFM HTML：`POST https://api.github.com/markdown`（body `{"text": "...", "mode": "gfm"}`），不发布、无需建仓库。
  注意它**不做**代码高亮和 emoji（github.com 前端才做），对比时要把这两项单独看。
- 语法覆盖测试夹具：`docs/markdown-case/_syntax-kitchen-sink.md`。
