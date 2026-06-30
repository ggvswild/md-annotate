# Markdown 语法对比测试 H1

用于对比 GitHub 线上渲染与 VS Code 插件预览的差异。涵盖 GFM 常见语法。

## 标题 H2

### 标题 H3

#### 标题 H4

##### 标题 H5

###### 标题 H6

## 一、行内文本

普通段落，包含 **加粗**、*斜体*、***加粗斜体***、~~删除线~~、`行内代码`、<kbd>Cmd</kbd>+<kbd>K</kbd>，以及上标 H~2~O / X^2^（扩展语法）。

链接：[显式链接](https://github.com) 、裸链接 https://github.com/sindresorhus/github-markdown-css 、邮箱 test@example.com 。

脚注引用[^1] 和第二个脚注[^note]。

Emoji 速记：:rocket: :tada: :+1: :warning: 。

## 二、引用块

> 一级引用：The minimal amount of CSS to replicate the GitHub Markdown style.
>
> > 嵌套二级引用，包含 `inline code` 和 **bold**。
>
> — 引用结尾

## 三、列表

无序列表：

- 第一项
- 第二项
  - 嵌套项 a
  - 嵌套项 b
    - 更深一层
- 第三项

有序列表：

1. 步骤一
2. 步骤二
   1. 子步骤 2.1
   2. 子步骤 2.2
3. 步骤三

任务列表（GFM）：

- [x] 已完成的任务
- [ ] 未完成的任务
- [ ] 含 `代码` 和 [链接](https://github.com) 的任务

## 四、表格（带对齐）

| 左对齐 | 居中 | 右对齐 | 说明 |
| :----- | :--: | -----: | ---- |
| `code` | **粗** | 123 | 含 `行内代码` |
| a | b | 4,567 | 普通文本 |
| 长内容长内容长内容 | x | 89 | ~~删除~~ |

## 五、代码

行内：`const x = 1`。

```ts
// TypeScript 代码块，检验语法高亮
interface Friend {
  userId: number;
  nickname: string;
  onlined?: boolean;
}

function load(list: Friend[]): string[] {
  return list.filter((f) => f.onlined).map((f) => f.nickname);
}
```

```bash
# Shell 代码块
curl -sL https://api.github.com/markdown -d '{"text":"# hi","mode":"gfm"}'
npm run build && echo "done"
```

```json
{ "name": "md-annotate", "version": "0.1.0", "private": true }
```

## 六、分隔线与其它

---

水平分隔线上下各一段。

行内 HTML：<mark>高亮 mark</mark> 与 <sub>下标</sub> / <sup>上标</sup>。

图片：

![占位图](https://placehold.co/120x40/png)

折叠块（GFM `<details>`）：

<details>
<summary>点击展开</summary>

这里是展开后的内容，包含一段 `code` 和一个列表：

- 项目 1
- 项目 2

</details>

## 七、脚注定义

[^1]: 第一个脚注的内容。
[^note]: 第二个脚注，含 [链接](https://github.com)。
