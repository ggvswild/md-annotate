// Bundle the extension host code (TypeScript + markdown-it) into dist/extension.js.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // vscode is provided by the runtime, never bundle it.
  // @wooorm/starry-night is ESM and loads an oniguruma .wasm at runtime via its
  // own node_modules layout, which breaks when inlined — keep it external and
  // ship its node_modules tree (see .vscodeignore). Everything else is bundled.
  external: ['vscode', '@wooorm/starry-night'],
  sourcemap: true,
  logLevel: 'info'
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[esbuild] watching...');
  } else {
    await esbuild.build(options);
    console.log('[esbuild] build complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
