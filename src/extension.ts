import * as vscode from 'vscode';
import * as path from 'path';
import MarkdownIt from 'markdown-it';

/**
 * MD Annotate — open a Markdown file in an annotation preview webview.
 *
 * The host renders markdown with source-line attributes, the webview lets the
 * user attach comment/replacement/deletion annotations to selected text or
 * blocks, and the annotations are persisted to `<doc>.annotations.json`.
 */

interface Annotation {
  id: string;
  type: 'comment' | 'replacement' | 'deletion';
  mode: 'text' | 'block';
  selectedText: string;
  comment: string;
  replacementText?: string;
  sourceLineStart: number | null;
  sourceLineEnd: number | null;
  sourceText: string;
  contextPrefix: string;
  contextSuffix: string;
}

/** Available markdown preview themes (must match body.theme-* classes in markdown.css). */
const THEMES = ['vscode', 'github', 'sepia', 'dark', 'notion'];

/** UI preference keys allowed to be persisted from the webview. */
const PREF_KEYS = ['hlStyle', 'uiMode', 'panelHeight', 'tocOpen', 'hintDismissed'];

const md = createMarkdownRenderer();

// One live panel per source file path.
const panels = new Map<string, AnnotatePanel>();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mdAnnotate.openPreview', (uri?: vscode.Uri) => {
      const target = resolveTargetUri(uri);
      if (!target) {
        vscode.window.showWarningMessage('MD Annotate：请先打开或选中一个 Markdown(.md) 文件。');
        return;
      }
      openOrReveal(context, target);
    })
  );

  // Re-render a previewed file when it is saved on disk.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const panel = panels.get(doc.uri.fsPath);
      if (panel) {
        panel.refresh();
      }
    })
  );
}

export function deactivate(): void {
  for (const panel of panels.values()) {
    panel.dispose();
  }
  panels.clear();
}

function resolveTargetUri(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri && uri.scheme === 'file' && /\.mdx?$/i.test(uri.fsPath)) {
    return uri;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && /\.mdx?$/i.test(editor.document.uri.fsPath)) {
    return editor.document.uri;
  }
  return undefined;
}

function openOrReveal(context: vscode.ExtensionContext, target: vscode.Uri): void {
  const existing = panels.get(target.fsPath);
  if (existing) {
    existing.reveal();
    return;
  }
  const panel = new AnnotatePanel(context, target);
  panels.set(target.fsPath, panel);
  panel.onDispose(() => panels.delete(target.fsPath));
}

class AnnotatePanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private disposeCallbacks: Array<() => void> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly target: vscode.Uri
  ) {
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    const docDir = vscode.Uri.file(path.dirname(target.fsPath));
    const roots = [mediaRoot, docDir];
    const folder = vscode.workspace.getWorkspaceFolder(target);
    if (folder) {
      roots.push(folder.uri);
    }
    this.panel = vscode.window.createWebviewPanel(
      'mdAnnotate.preview',
      `批注: ${path.basename(target.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: roots
      }
    );

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    void this.render();
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  refresh(): void {
    void this.render();
  }

  onDispose(cb: () => void): void {
    this.disposeCallbacks.push(cb);
  }

  dispose(): void {
    for (const cb of this.disposeCallbacks) {
      cb();
    }
    this.disposeCallbacks = [];
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }

  private get stateKey(): string {
    return `mdAnnotate:${this.target.fsPath}`;
  }

  private loadSavedAnnotations(): Annotation[] {
    return this.context.workspaceState.get<Annotation[]>(this.stateKey, []);
  }

  private currentTheme(): string {
    const theme = this.context.globalState.get<string>('mdAnnotate.theme', 'github');
    return THEMES.includes(theme) ? theme : 'github';
  }

  /** UI preferences persisted in globalState so they survive reopening the preview. */
  private getPrefs(): Record<string, unknown> {
    return this.context.globalState.get<Record<string, unknown>>('mdAnnotate.prefs', {});
  }
  private async setPref(key: string, value: unknown): Promise<void> {
    if (!PREF_KEYS.includes(key)) {
      return;
    }
    const prefs = { ...this.getPrefs(), [key]: value };
    await this.context.globalState.update('mdAnnotate.prefs', prefs);
  }

  private async render(): Promise<void> {
    let source: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.target);
      source = Buffer.from(bytes).toString('utf8');
    } catch (err) {
      this.panel.webview.html = `<body style="font-family:sans-serif;padding:20px">无法读取文件：${escapeHtml(
        String(err)
      )}</body>`;
      return;
    }

    const webview = this.panel.webview;
    const docDir = path.dirname(this.target.fsPath);
    const html = resolveImages(md.render(source), docDir, webview);
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.js')
    );
    const panelCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.css')
    );
    const mdCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'markdown.css')
    );

    const theme = this.currentTheme();
    const bootstrap = {
      fileName: path.basename(this.target.fsPath),
      filePath: workspaceRelative(this.target),
      source,
      theme,
      prefs: this.getPrefs(),
      annotations: this.loadSavedAnnotations()
    };

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<link href="${mdCssUri}" rel="stylesheet">
<link href="${panelCssUri}" rel="stylesheet">
<title>批注预览</title>
</head>
<body class="theme-${theme}">
<article class="markdown-body" id="wa-doc">${html}</article>
<script nonce="${nonce}">window.__WA_BOOTSTRAP__ = ${JSON.stringify(bootstrap)};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async handleMessage(msg: any): Promise<void> {
    if (!msg || typeof msg.type !== 'string') {
      return;
    }
    switch (msg.type) {
      case 'persist':
        await this.context.workspaceState.update(this.stateKey, msg.annotations ?? []);
        return;
      case 'save':
        await this.saveAnnotationsFile(msg.annotations ?? []);
        return;
      case 'theme':
        if (typeof msg.theme === 'string' && THEMES.includes(msg.theme)) {
          await this.context.globalState.update('mdAnnotate.theme', msg.theme);
        }
        return;
      case 'pref':
        if (typeof msg.key === 'string') {
          await this.setPref(msg.key, msg.value);
        }
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(String(msg.text ?? ''));
        this.post({ type: 'info', message: typeof msg.message === 'string' ? msg.message : '已复制到剪贴板' });
        return;
      case 'reveal':
        await this.revealSourceLine(msg.line);
        return;
      case 'info':
        vscode.window.showInformationMessage(`MD Annotate：${String(msg.message ?? '')}`);
        return;
      default:
        return;
    }
  }

  private async saveAnnotationsFile(annotations: Annotation[]): Promise<void> {
    const now = new Date();
    const out = buildOutputUri(this.target, stamp(now));
    const payload = {
      file: workspaceRelative(this.target),
      generatedAt: now.toISOString(),
      count: annotations.length,
      annotations
    };
    try {
      await vscode.workspace.fs.writeFile(
        out,
        Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
      );
      const rel = workspaceRelative(out);
      this.post({ type: 'info', message: `已导出 ${rel}` });
      vscode.window.showInformationMessage(`MD Annotate：已导出 ${rel}`);
    } catch (err) {
      this.post({ type: 'info', message: `导出失败：${String(err)}` });
    }
  }

  private async revealSourceLine(line: unknown): Promise<void> {
    const lineNum = typeof line === 'number' && line > 0 ? Math.floor(line) - 1 : 0;
    const doc = await vscode.workspace.openTextDocument(this.target);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false
    });
    const pos = new vscode.Position(Math.min(lineNum, doc.lineCount - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter
    );
  }

  private post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }
}

/** Build a timestamped sibling `<basename>-<yyyyMMdd-HHmmss>.annotations.json` path. */
function buildOutputUri(target: vscode.Uri, ts: string): vscode.Uri {
  const dir = path.dirname(target.fsPath);
  const base = path.basename(target.fsPath).replace(/\.mdx?$/i, '');
  return vscode.Uri.file(path.join(dir, `${base}-${ts}.annotations.json`));
}

/** Local-time timestamp as yyyyMMdd-HHmmss. */
function stamp(d: Date): string {
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return (
    '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

/** Rewrite relative <img src> to webview URIs so local images render in the preview. */
function resolveImages(html: string, docDir: string, webview: vscode.Webview): string {
  return html.replace(/(<img\b[^>]*?\ssrc=)(["'])(.*?)\2/gi, (match, pre, quote, src) => {
    if (/^(https?:|data:|vscode-webview:|vscode-resource:)/i.test(src) || src.startsWith('//')) {
      return match;
    }
    try {
      const onDisk = vscode.Uri.file(path.resolve(docDir, decodeURIComponent(src)));
      return `${pre}${quote}${webview.asWebviewUri(onDisk)}${quote}`;
    } catch {
      return match;
    }
  });
}

function workspaceRelative(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    return path.relative(folder.uri.fsPath, uri.fsPath);
  }
  return uri.fsPath;
}

/** markdown-it with a source-line mapping rule for every block token. */
function createMarkdownRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false
  });

  renderer.core.ruler.push('source_line', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1) {
        token.attrSet('data-source-line', String(token.map[0] + 1));
        token.attrSet('data-source-end', String(token.map[1]));
      }
    }
    return false;
  });

  return renderer;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}
