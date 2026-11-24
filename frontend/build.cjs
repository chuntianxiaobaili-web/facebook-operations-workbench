const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const esbuild = require('esbuild');
const stylex = require('@stylexjs/babel-plugin');

async function build() {
  const target = path.join(__dirname, '../public');
  fs.mkdirSync(target, { recursive: true });
  const source = path.join(__dirname, 'controls.jsx');
  const transformed = babel.transformFileSync(source, {
    plugins: [[stylex, { dev: false, runtimeInjection: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
  });
  const css = stylex.processStylexRules(transformed.metadata.stylex);
  if (!css) throw Error('No StyleX style rules were compiled');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'app.jsx')],
    bundle: true,
    jsx: 'automatic',
    minify: true,
    target: 'es2020',
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: require.resolve.paths('react'),
    plugins: [
      {
        name: 'stylex-controls',
        setup(build) {
          build.onLoad({ filter: /[\\/]controls\.jsx$/ }, () => ({
            contents: transformed.code,
            loader: 'jsx',
            resolveDir: __dirname,
          }));
        },
      },
    ],
    outfile: path.join(target, 'app.js'),
    legalComments: 'inline',
  });
  // Badge is a stateless Astryx component. Its documented theme selector
  // activates the prebuilt Neutral theme without loading the icon registry.
  const layers = [
    '@astryxdesign/core/reset.css',
    '@astryxdesign/core/astryx.css',
    '@astryxdesign/theme-neutral/theme.css',
  ].map(specifier => fs.readFileSync(require.resolve(specifier), 'utf8'));
  layers.push(fs.readFileSync(path.join(__dirname, 'layout.css'), 'utf8'), css);
  const output = await esbuild.transform(layers.join('\n'), {loader:'css', minify:true});
  fs.writeFileSync(path.join(target, 'app.css'), output.code);
  console.log('Built public/app.js and public/app.css');
}
build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
