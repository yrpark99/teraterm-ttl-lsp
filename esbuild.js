/**
 * esbuild bundler for the TTL extension.
 *
 * Bundles the two Node entry points into `dist/`:
 *   - client/src/extension.ts -> dist/extension.js   (the extension itself)
 *   - server/src/server.ts    -> dist/server.js      (the language server)
 *
 * `vscode` is the only external module (provided by the host at runtime);
 * everything else (vscode-languageclient/server, etc.) is bundled in.
 *
 * Flags:
 *   --watch        rebuild on change
 *   --production   minify and drop sourcemaps
 */

const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** Logs build start/end so watch mode is legible in the terminal. */
const watchLogPlugin = {
  name: 'watch-log',
  setup(build) {
    let name = 'build';
    build.onStart(() => console.log(`[${name}] building...`));
    build.onEnd((result) => {
      for (const err of result.errors) {
        console.error(`[${name}] ${err.text}`);
      }
      console.log(`[${name}] done (${result.errors.length} errors)`);
    });
  }
};

/** @returns {import('esbuild').BuildOptions} */
function baseOptions(entry, outfile) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    logLevel: 'silent',
    plugins: [watchLogPlugin]
  };
}

async function main() {
  const configs = [
    baseOptions('client/src/extension.ts', 'dist/extension.js'),
    baseOptions('server/src/server.ts', 'dist/server.js')
  ];

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[watch] watching for changes...');
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
