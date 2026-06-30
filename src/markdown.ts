// Markdown rendering pipeline aligned with GitHub's GFM output.
//
// GitHub renders Markdown with cmark-gfm + client-side syntax highlighting and a
// handful of content extensions. Plain markdown-it covers most of it, so here we
// add the missing pieces to match github.com:
//   - syntax highlighting via @wooorm/starry-night (emits `pl-*` token classes,
//     which the vendored github-markdown-css already colors)
//   - task lists (`- [ ]`), footnotes (`[^1]`), emoji (`:rocket:`)
//   - heading ids using GitHub-compatible slugs
//
// starry-night is ESM-only and loads an oniguruma `.wasm` at runtime from its
// node_modules, so it is externalized (see esbuild.js) and loaded lazily via
// dynamic import. Every plugin below is dynamically imported too, which keeps
// TypeScript's Node16 module mode happy when importing ESM/untyped packages.

import MarkdownIt from 'markdown-it';

/** starry-night highlighter; null until initialized (or if init fails). */
let starryNight: { flagToScope(flag: string): string | undefined; highlight(value: string, scope: string): unknown } | null = null;
/** hast → HTML serializer, paired with starryNight. */
let toHtml: ((tree: any) => string) | null = null;

/** markdown-it `highlight` hook: returns GitHub `pl-*` token HTML, or '' to let
 *  markdown-it escape + wrap the code untouched (matches GitHub for unknown langs). */
function highlight(code: string, lang: string): string {
  if (starryNight && toHtml && lang) {
    const scope = starryNight.flagToScope(lang);
    if (scope) {
      try {
        return toHtml(starryNight.highlight(code, scope));
      } catch {
        /* fall through to plain rendering */
      }
    }
  }
  return '';
}

async function build(): Promise<MarkdownIt> {
  const [snMod, h2hMod, emojiMod, anchorMod, footnoteMod, taskListsMod, sluggerMod] = await Promise.all([
    import('@wooorm/starry-night'),
    import('hast-util-to-html'),
    import('markdown-it-emoji'),
    import('markdown-it-anchor'),
    import('markdown-it-footnote'),
    import('markdown-it-task-lists'),
    import('github-slugger')
  ]);

  // Highlighting is best-effort: if grammars fail to load, code blocks still render
  // (monochrome) rather than breaking the whole preview.
  try {
    starryNight = await snMod.createStarryNight(snMod.common);
    toHtml = h2hMod.toHtml;
  } catch (err) {
    console.error('[md-annotate] syntax highlighter failed to initialize:', err);
  }

  const Slugger = sluggerMod.default;

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight
  });

  md.use(footnoteMod.default);
  md.use(taskListsMod.default, { label: true });
  md.use(emojiMod.full);
  // A fresh slugger per heading; GitHub keeps CJK, lowercases latin, spaces→'-'.
  md.use(anchorMod.default, { permalink: false, slugify: (s: string) => new Slugger().slug(s) });

  // Tag every top-level token with its 1-based source line so the annotation layer
  // can map a clicked block back to the Markdown source.
  md.core.ruler.push('source_line', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1) {
        token.attrSet('data-source-line', String(token.map[0] + 1));
        token.attrSet('data-source-end', String(token.map[1]));
      }
    }
    return false;
  });

  return md;
}

let rendererPromise: Promise<MarkdownIt> | null = null;

/** Lazily build (and cache) the configured markdown-it instance. */
function getRenderer(): Promise<MarkdownIt> {
  if (!rendererPromise) {
    rendererPromise = build();
  }
  return rendererPromise;
}

/** Render Markdown source to GitHub-aligned HTML. */
export async function renderMarkdown(source: string): Promise<string> {
  const md = await getRenderer();
  return md.render(source);
}

/** Warm up the renderer (grammars) ahead of first render. */
export function warmupRenderer(): void {
  void getRenderer();
}
