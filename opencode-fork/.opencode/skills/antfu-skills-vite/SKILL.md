---
name: vite
description: Vite next-generation frontend build tool with fast HMR and optimized builds. Use when configuring Vite, adding plugins, working with dev server, or building for production.
metadata:
  author: Anthony Fu
  version: "2026.1.28"
  source: Generated from https://github.com/vitejs/vite, scripts located at https://github.com/antfu/skills
---

Vite is a modern build tool for frontend development featuring instant server start with native ES modules, lightning-fast HMR, and optimized production builds using Rolldown/Rollup. It supports TypeScript, JSX, CSS pre-processors out of the box and has a rich plugin ecosystem.

> The skill is based on Vite 6.x, generated at 2026-01-28.

## Core

| Topic | Description | Reference |
|-------|-------------|-----------|
| Configuration | Config file setup, defineConfig, conditional and async configs | [core-config](references/core-config.md) |
| CLI Commands | Dev server, build, preview commands and options | [core-cli](references/core-cli.md) |
| Core Features | TypeScript, JSX, CSS, HTML processing, JSON handling | [core-features](references/core-features.md) |
| Using Plugins | Adding, configuring, and ordering plugins | [core-plugins](references/core-plugins.md) |

## Features

| Topic | Description | Reference |
|-------|-------------|-----------|
| CSS Handling | CSS modules, pre-processors, PostCSS, Lightning CSS | [features-css](references/features-css.md) |
| Static Assets | Asset imports, public directory, URL handling | [features-assets](references/features-assets.md) |
| Glob Import | import.meta.glob, dynamic imports, batch loading | [features-glob-import](references/features-glob-import.md) |
| Environment Variables | .env files, modes, import.meta.env constants | [features-env](references/features-env.md) |
| HMR API | Hot Module Replacement client API | [features-hmr](references/features-hmr.md) |
| Web Workers | Worker imports and configuration | [features-workers](references/features-workers.md) |
| Dependency Pre-Bundling | optimizeDeps, caching, monorepo setup | [features-dep-bundling](references/features-dep-bundling.md) |

## Build

| Topic | Description | Reference |
|-------|-------------|-----------|
| Production Build | Build options, browser targets, multi-page apps | [build-production](references/build-production.md) |
| Library Mode | Building libraries with proper package exports | [build-library](references/build-library.md) |
| SSR | Server-side rendering setup and configuration | [build-ssr](references/build-ssr.md) |

## Advanced

| Topic | Description | Reference |
|-------|-------------|-----------|
| JavaScript API | createServer, build, preview programmatic APIs | [advanced-api](references/advanced-api.md) |
| Plugin API | Creating Vite plugins, hooks, virtual modules | [advanced-plugin-api](references/advanced-plugin-api.md) |
| Performance | Optimization tips for dev server and builds | [advanced-performance](references/advanced-performance.md) |
| Backend Integration | Integrating Vite with traditional backends | [advanced-backend](references/advanced-backend.md) |


---

## Referenced Files

> The following files are referenced in this skill and included for context.

### references/core-config.md

```markdown
---
name: core-config
description: Vite configuration file setup, defineConfig helper, conditional and async configs
---

# Vite Configuration

Vite automatically resolves a config file named `vite.config.*` in the project root.

## Basic Configuration

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  // config options
})
```

Use `defineConfig` for TypeScript intellisense. Alternatively, use JSDoc annotations:

```js
/** @type {import('vite').UserConfig} */
export default {
  // config options
}
```

## Conditional Config

Export a function to conditionally determine options based on command, mode, or build type:

```ts
import { defineConfig } from 'vite'

export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {
  if (command === 'serve') {
    // dev specific config
    return {
      define: {
        __DEV__: true
      }
    }
  } else {
    // build specific config
    return {
      define: {
        __DEV__: false
      }
    }
  }
})
```

- `command` is `'serve'` during dev (`vite`, `vite dev`, `vite serve`) and `'build'` for production
- `mode` defaults to `'development'` for serve, `'production'` for build

## Async Config

```ts
import { defineConfig } from 'vite'

export default defineConfig(async ({ command, mode }) => {
  const data = await fetchRemoteConfig()
  return {
    // config using fetched data
  }
})
```

## Key Configuration Options

### Root and Base

```ts
export default defineConfig({
  root: './src',           // Project root directory (where index.html is)
  base: '/my-app/',        // Public base path for assets
  publicDir: 'public',     // Static assets directory
  cacheDir: 'node_modules/.vite'  // Cache directory
})
```

### Resolve Aliases

```ts
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '~': resolve(__dirname, 'src/components')
    },
    // File extensions to try for imports without extension
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
  }
})
```

### Define Global Constants

```ts
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('1.0.0'),
    __API_URL__: JSON.stringify('https://api.example.com')
  }
})
```

Values must be JSON-serializable or a single identifier. Add TypeScript declarations:

```ts
// vite-env.d.ts
declare const __APP_VERSION__: string
declare const __API_URL__: string
```

### JSON Handling

```ts
export default defineConfig({
  json: {
    namedExports: true,  // Support named imports from JSON
    stringify: 'auto'    // Stringify large JSON for performance
  }
})
```

## Using Environment Variables in Config

Variables from `.env` files are NOT automatically available in config. Use `loadEnv`:

```ts
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Load env vars from .env files
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV)
    },
    server: {
      port: env.APP_PORT ? Number(env.APP_PORT) : 5173
    }
  }
})
```

## Specifying Config File

```bash
vite --config my-config.ts
```

## Config Loading Methods

```bash
# Default: bundle with Rolldown (may have issues in monorepos)
vite

# Use module runner (no temp file, transforms on the fly)
vite --configLoader runner

# Use native runtime (requires Node.js with TypeScript support)
vite --configLoader native
```

<!-- 
Source references:
- https://vite.dev/config/
-->

```

### references/core-cli.md

```markdown
---
name: core-cli
description: Vite CLI commands for development, building, and previewing
---

# Vite CLI

## Dev Server

Start the development server:

```bash
vite [root]
vite dev [root]   # alias
vite serve [root] # alias
```

### Dev Server Options

| Option | Description |
|--------|-------------|
| `--host [host]` | Specify hostname (use `0.0.0.0` for LAN access) |
| `--port <port>` | Specify port (default: 5173) |
| `--open [path]` | Open browser on startup |
| `--cors` | Enable CORS |
| `--strictPort` | Exit if port is in use |
| `--force` | Force optimizer to re-bundle dependencies |
| `-c, --config <file>` | Use specified config file |
| `--base <path>` | Public base path |
| `-m, --mode <mode>` | Set env mode |
| `-l, --logLevel <level>` | info \| warn \| error \| silent |
| `--clearScreen` | Allow/disable clear screen when logging |

## Build

Build for production:

```bash
vite build [root]
```

### Build Options

| Option | Description |
|--------|-------------|
| `--target <target>` | Transpile target (default: `"modules"`) |
| `--outDir <dir>` | Output directory (default: `dist`) |
| `--assetsDir <dir>` | Assets directory under outDir (default: `"assets"`) |
| `--assetsInlineLimit <number>` | Inline threshold in bytes (default: 4096) |
| `--ssr [entry]` | Build for SSR |
| `--sourcemap [output]` | Generate source maps (`boolean \| "inline" \| "hidden"`) |
| `--minify [minifier]` | Minifier (`boolean \| "oxc" \| "terser" \| "esbuild"`) |
| `--manifest [name]` | Generate build manifest JSON |
| `--ssrManifest [name]` | Generate SSR manifest JSON |
| `--emptyOutDir` | Force empty outDir |
| `-w, --watch` | Watch mode for rebuilding |

## Preview

Locally preview the production build:

```bash
vite preview [root]
```

### Preview Options

| Option | Description |
|--------|-------------|
| `--host [host]` | Specify hostname |
| `--port <port>` | Specify port |
| `--strictPort` | Exit if port is in use |
| `--open [path]` | Open browser on startup |
| `--outDir <dir>` | Output directory (default: `dist`) |

## Package Scripts

Typical `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

## Running Vite

```bash
# With npm
npx vite

# With pnpm
pnpm vite

# With yarn
yarn vite

# With bun
bunx vite
```

## Scaffolding New Project

```bash
# Interactive prompts
npm create vite@latest

# With project name and template
npm create vite@latest my-app -- --template vue-ts

# Available templates: vanilla, vanilla-ts, vue, vue-ts, react, react-ts,
# react-swc, react-swc-ts, preact, preact-ts, lit, lit-ts, svelte, svelte-ts,
# solid, solid-ts, qwik, qwik-ts
```

## Debugging

```bash
# Debug plugin transforms
vite --debug plugin-transform

# Debug with profiling
vite --profile
# Then press 'p + enter' to record .cpuprofile

# Filter debug logs
vite --debug -f plugin-transform
```

<!-- 
Source references:
- https://vite.dev/guide/cli.html
-->

```

### references/core-features.md

```markdown
---
name: core-features
description: Core Vite features including TypeScript, JSX, CSS, and HTML processing
---

# Core Features

## TypeScript

Vite supports `.ts` files out of the box with transpilation via Oxc Transformer (20-30x faster than tsc).

### Important: Transpile Only

Vite does NOT perform type checking. Run type checking separately:

```bash
# Production build
tsc --noEmit && vite build

# During development (separate process)
tsc --noEmit --watch

# Or use vite-plugin-checker for browser error reporting
```

### TypeScript Configuration

Required `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "skipLibCheck": true
  }
}
```

### Client Types

Add Vite's client types for `import.meta.env` and asset imports:

```json
{
  "compilerOptions": {
    "types": ["vite/client"]
  }
}
```

This provides types for:
- Asset imports (`.svg`, `.png`, etc.)
- `import.meta.env` constants
- `import.meta.hot` HMR API

### Custom Type Overrides

Override default asset import types:

```ts
// vite-env-override.d.ts
declare module '*.svg' {
  const content: React.FC<React.SVGProps<SVGElement>>
  export default content
}
```

### Path Aliases with tsconfig

Enable tsconfig paths resolution:

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    tsconfigPaths: true
  }
})
```

## JSX

`.jsx` and `.tsx` files are supported out of the box. Custom JSX configuration:

```ts
export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'classic',  // or 'automatic'
      pragma: 'h',
      pragmaFrag: 'Fragment'
    },
    // Auto-inject JSX helpers
    jsxInject: `import React from 'react'`
  }
})
```

## HTML

`index.html` is the entry point, not tucked away in `public/`. Vite processes it as part of the module graph.

### Supported Elements

Vite processes these HTML element attributes:

- `<script type="module" src>`
- `<link href>` (stylesheets)
- `<img src>`, `<img srcset>`
- `<video src>`, `<video poster>`
- `<audio src>`
- `<source src>`, `<source srcset>`
- `<meta content>` (for og:image, twitter:image, etc.)

### Opt-out of Processing

```html
<script vite-ignore type="module" src="https://cdn.example.com/lib.js"></script>
```

### Multi-Page Apps

Access any HTML file by its path:

- `<root>/index.html` → `http://localhost:5173/`
- `<root>/about.html` → `http://localhost:5173/about.html`
- `<root>/blog/index.html` → `http://localhost:5173/blog/index.html`

## JSON

Direct import with named exports support:

```ts
// Import entire object
import json from './data.json'

// Named imports (tree-shakeable)
import { field } from './data.json'
```

## Framework Support

Official framework plugins:

| Framework | Plugin |
|-----------|--------|
| Vue 3 | `@vitejs/plugin-vue` |
| Vue 3 JSX | `@vitejs/plugin-vue-jsx` |
| React | `@vitejs/plugin-react` |
| React (SWC) | `@vitejs/plugin-react-swc` |
| React Server Components | `@vitejs/plugin-rsc` |
| Legacy browsers | `@vitejs/plugin-legacy` |

## Content Security Policy

Configure nonce for CSP:

```ts
export default defineConfig({
  html: {
    cspNonce: 'PLACEHOLDER'  // Replace per-request
  }
})
```

<!-- 
Source references:
- https://vite.dev/guide/features.html
-->

```

### references/core-plugins.md

```markdown
---
name: core-plugins
description: Adding, configuring, and ordering Vite plugins
---

# Using Plugins

Vite extends Rolldown's plugin interface with extra Vite-specific options.

## Adding Plugins

Install and add to config:

```bash
npm add -D @vitejs/plugin-vue
```

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()]
})
```

## Plugin Arrays

Plugins can return arrays (for complex features):

```ts
// Framework plugin returning multiple plugins
export default function framework(config) {
  return [
    frameworkRefresh(config),
    frameworkDevtools(config)
  ]
}
```

## Conditional Plugins

Falsy values are ignored:

```ts
export default defineConfig({
  plugins: [
    vue(),
    process.env.ANALYZE && visualizer()  // Only if ANALYZE is set
  ]
})
```

## Enforcing Plugin Order

Control when plugin runs relative to Vite core:

```ts
export default defineConfig({
  plugins: [
    {
      ...somePlugin(),
      enforce: 'pre'  // Before Vite core plugins
    },
    {
      ...anotherPlugin(),
      enforce: 'post'  // After Vite build plugins
    }
  ]
})
```

**Order:**
1. Alias
2. Plugins with `enforce: 'pre'`
3. Vite core plugins
4. Plugins without enforce
5. Vite build plugins
6. Plugins with `enforce: 'post'`
7. Vite post-build plugins (minify, manifest)

## Conditional Application

Apply only during serve or build:

```ts
export default defineConfig({
  plugins: [
    {
      ...typescript2(),
      apply: 'build'  // Only during build
    },
    {
      ...devOnlyPlugin(),
      apply: 'serve'  // Only during dev
    }
  ]
})
```

Function form for more control:

```ts
{
  ...myPlugin(),
  apply(config, { command }) {
    // Apply only on build but not for SSR
    return command === 'build' && !config.build.ssr
  }
}
```

## Finding Plugins

1. Check [Vite Features Guide](https://vite.dev/guide/features.html) - many use cases are built-in
2. Official plugins in [Vite Plugins](https://vite.dev/plugins/)
3. Community plugins in [awesome-vite](https://github.com/vitejs/awesome-vite#plugins)
4. Search npm for `vite-plugin-*` or `rollup-plugin-*`

## Official Plugins

| Plugin | Purpose |
|--------|---------|
| `@vitejs/plugin-vue` | Vue 3 SFC support |
| `@vitejs/plugin-vue-jsx` | Vue 3 JSX support |
| `@vitejs/plugin-react` | React with Babel/Oxc |
| `@vitejs/plugin-react-swc` | React with SWC |
| `@vitejs/plugin-rsc` | React Server Components |
| `@vitejs/plugin-legacy` | Legacy browser support |

## Rollup/Rolldown Plugin Compatibility

Many Rollup plugins work directly with Vite if they:
- Don't use `moduleParsed` hook
- Don't rely on Rolldown-specific options
- Don't have strong coupling between bundle and output phases

For build-only Rollup plugins:

```ts
export default defineConfig({
  build: {
    rolldownOptions: {
      plugins: [rollupPluginForBuildOnly()]
    }
  }
})
```

<!-- 
Source references:
- https://vite.dev/guide/using-plugins.html
-->

```

### references/features-css.md

```markdown
---
name: features-css
description: CSS handling in Vite including modules, pre-processors, PostCSS, and Lightning CSS
---

# CSS Handling

Vite provides rich CSS support with HMR, `@import` inlining, and automatic URL rebasing.

## Basic CSS Import

```ts
import './styles.css'  // Injected into page with HMR support
```

## CSS Modules

Files ending with `.module.css` are treated as CSS modules:

```css
/* example.module.css */
.red {
  color: red;
}
```

```ts
import classes from './example.module.css'
element.className = classes.red
```

### Named Imports with camelCase

```ts
// vite.config.ts
export default defineConfig({
  css: {
    modules: {
      localsConvention: 'camelCaseOnly'
    }
  }
})
```

```ts
// .apply-color -> applyColor
import { applyColor } from './example.module.css'
```

## CSS Pre-processors

Install the pre-processor, no Vite plugin needed:

```bash
# Sass (sass-embedded recommended for performance)
npm add -D sass-embedded

# Less
npm add -D less

# Stylus
npm add -D stylus
```

Use by file extension:

```ts
import './styles.scss'
import './styles.less'
import './styles.styl'
```

### Pre-processor Options

```ts
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `$injectedColor: orange;`,
        importers: [/* ... */]
      },
      less: {
        math: 'parens-division'
      }
    },
    preprocessorMaxWorkers: true  // Use multiple threads
  }
})
```

### Combined with CSS Modules

```ts
import styles from './component.module.scss'
```

## PostCSS

Automatically applied if `postcss.config.js` exists:

```js
// postcss.config.js
export default {
  plugins: [
    require('postcss-nesting'),
    require('autoprefixer')
  ]
}
```

Or configure inline:

```ts
export default defineConfig({
  css: {
    postcss: {
      plugins: [
        postcssNesting(),
        autoprefixer()
      ]
    }
  }
})
```

## Lightning CSS

Experimental faster CSS processing:

```bash
npm add -D lightningcss
```

```ts
export default defineConfig({
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: {
        chrome: 111
      },
      cssModules: {
        // Lightning CSS modules config
      }
    }
  }
})
```

Use Lightning CSS for minification only:

```ts
export default defineConfig({
  build: {
    cssMinify: 'lightningcss'
  }
})
```

## Disable CSS Injection

Import CSS as string without injecting:

```ts
import styles from './styles.css?inline'  // Returns CSS string, not injected
```

## Source Maps

Enable CSS source maps in development:

```ts
export default defineConfig({
  css: {
    devSourcemap: true
  }
})
```

## CSS Code Splitting

By default, CSS is extracted per async chunk. Disable to get single CSS file:

```ts
export default defineConfig({
  build: {
    cssCodeSplit: false  // Single CSS file for entire app
  }
})
```

## CSS Target

Set different browser target for CSS:

```ts
export default defineConfig({
  build: {
    cssTarget: 'chrome61'  // For Android WeChat WebView
  }
})
```

## @import and URL Handling

- `@import` statements are inlined automatically
- Vite aliases work in `@import`
- `url()` references are rebased for correctness
- Works across Sass/Less files in different directories

<!-- 
Source references:
- https://vite.dev/guide/features.html#css
-->

```

### references/features-assets.md

```markdown
---
name: features-assets
description: Static asset handling in Vite including imports, public directory, and URL handling
---

# Static Asset Handling

## Importing Assets as URL

```ts
import imgUrl from './img.png'
document.getElementById('hero-img').src = imgUrl
// Dev: /src/img.png
// Build: /assets/img.2d8efhg.png
```

Common image, media, and font types are detected automatically.

## Import Queries

### Explicit URL Import

```ts
import workletURL from './worklet.js?url'
CSS.paintWorklet.addModule(workletURL)
```

### Import as String (Raw)

```ts
import shaderString from './shader.glsl?raw'
```

### Control Inlining

```ts
import imgUrl1 from './img.svg?no-inline'  // Never inline
import imgUrl2 from './img.png?inline'      // Always inline as base64
```

## Asset Inlining

Assets smaller than `assetsInlineLimit` (default 4KB) are inlined as base64:

```ts
export default defineConfig({
  build: {
    assetsInlineLimit: 4096,  // 4KB
    // Or use callback for fine control
    assetsInlineLimit: (filePath) => {
      return !filePath.endsWith('.svg')
    }
  }
})
```

## The `public` Directory

Files in `public/` are:
- Served at root path `/` during dev
- Copied as-is to `dist/` root during build
- Not processed or hashed

```
public/
  favicon.ico  → /favicon.ico
  robots.txt   → /robots.txt
```

Reference with absolute paths in source:

```html
<img src="/icon.png" />
```

Configure directory:

```ts
export default defineConfig({
  publicDir: 'static'  // or false to disable
})
```

## Extending Asset Types

```ts
export default defineConfig({
  assetsInclude: ['**/*.gltf', '**/*.hdr']
})
```

## Dynamic URLs with import.meta.url

```ts
// Works natively in modern browsers
const imgUrl = new URL('./img.png', import.meta.url).href

// Dynamic pattern (limited)
function getImageUrl(name) {
  return new URL(`./dir/${name}.png`, import.meta.url).href
}
```

**Limitations:**
- URL string must be static for build analysis
- Does not work with SSR (different semantics in Node.js vs browser)

## TypeScript Support

Add `vite/client` to types for asset import recognition:

```json
{
  "compilerOptions": {
    "types": ["vite/client"]
  }
}
```

## URL Handling in CSS

```css
.hero {
  background: url('./img.png');  /* Processed and rebased */
}
```

For dynamically constructed SVG URLs:

```ts
import imgUrl from './img.svg'
element.style.background = `url("${imgUrl}")`  // Note double quotes
```

<!-- 
Source references:
- https://vite.dev/guide/assets.html
-->

```

### references/features-glob-import.md

```markdown
---
name: features-glob-import
description: Vite's import.meta.glob for batch importing modules and dynamic imports
---

# Glob Import

## Basic Usage

Import multiple modules using glob patterns:

```ts
const modules = import.meta.glob('./dir/*.js')
// Transformed to:
// {
//   './dir/foo.js': () => import('./dir/foo.js'),
//   './dir/bar.js': () => import('./dir/bar.js'),
// }
```

Iterate and load:

```ts
for (const path in modules) {
  modules[path]().then((mod) => {
    console.log(path, mod)
  })
}
```

## Eager Loading

Load all modules immediately (no dynamic import):

```ts
const modules = import.meta.glob('./dir/*.js', { eager: true })
// Transformed to:
// import * as __glob_0 from './dir/foo.js'
// import * as __glob_1 from './dir/bar.js'
// const modules = {
//   './dir/foo.js': __glob_0,
//   './dir/bar.js': __glob_1,
// }
```

## Multiple Patterns

```ts
const modules = import.meta.glob([
  './dir/*.js',
  './another/*.js'
])
```

## Negative Patterns

Exclude files with `!` prefix:

```ts
const modules = import.meta.glob([
  './dir/*.js',
  '!**/bar.js'  // Exclude bar.js
])
```

## Named Imports

Import specific exports for tree-shaking:

```ts
const modules = import.meta.glob('./dir/*.js', {
  import: 'setup'
})
// './dir/foo.js': () => import('./dir/foo.js').then(m => m.setup)
```

Import default export:

```ts
const modules = import.meta.glob('./dir/*.js', {
  import: 'default',
  eager: true
})
```

## Custom Queries

Import as raw strings or URLs:

```ts
const moduleStrings = import.meta.glob('./dir/*.svg', {
  query: '?raw',
  import: 'default'
})

const moduleUrls = import.meta.glob('./dir/*.svg', {
  query: '?url',
  import: 'default'
})
```

Custom queries for plugins:

```ts
const modules = import.meta.glob('./dir/*.js', {
  query: { foo: 'bar', bar: true }
})
```

## Base Path

Change the base path for imports:

```ts
const modules = import.meta.glob('./**/*.js', {
  base: './base'
})
// Keys: './dir/foo.js'
// Imports: './base/dir/foo.js'
```

## Important Caveats

1. **Vite-only feature** - Not a web standard
2. **Patterns must be literals** - Cannot use variables
3. **Relative or absolute** - Must start with `./`, `/`, or use an alias
4. **Glob matching** - Uses [tinyglobby](https://github.com/SuperchupuDev/tinyglobby)

## Dynamic Import with Variables

Limited dynamic import support:

```ts
const module = await import(`./dir/${file}.js`)
```

**Rules:**
- Must start with `./` or `../`
- Must end with file extension
- Variable represents only one level (no `foo/bar`)
- Own directory needs filename pattern: `./prefix-${foo}.js` not `./${foo}.js`

## Practical Example: Loading Route Components

```ts
// Lazy load all page components
const pages = import.meta.glob('./pages/*.vue')

const routes = Object.keys(pages).map((path) => {
  const name = path.match(/\.\/pages\/(.*)\.vue$/)[1]
  return {
    path: `/${name.toLowerCase()}`,
    component: pages[path]  // Lazy loaded
  }
})
```

<!-- 
Source references:
- https://vite.dev/guide/features.html#glob-import
-->

```

### references/features-env.md

```markdown
---
name: features-env
description: Environment variables, .env files, and modes in Vite
---

# Environment Variables and Modes

## Built-in Constants

Available via `import.meta.env`:

| Constant | Description |
|----------|-------------|
| `import.meta.env.MODE` | App mode (`'development'` or `'production'`) |
| `import.meta.env.BASE_URL` | Base URL from `base` config |
| `import.meta.env.PROD` | `true` in production |
| `import.meta.env.DEV` | `true` in development |
| `import.meta.env.SSR` | `true` in server-side rendering |

```ts
if (import.meta.env.DEV) {
  console.log('Development mode')
  // Tree-shaken in production
}
```

## Custom Environment Variables

Only variables prefixed with `VITE_` are exposed to client code:

```bash
# .env
VITE_API_URL=https://api.example.com
DB_PASSWORD=secret  # NOT exposed to client
```

```ts
console.log(import.meta.env.VITE_API_URL)  // "https://api.example.com"
console.log(import.meta.env.DB_PASSWORD)   // undefined
```

### Custom Prefix

```ts
export default defineConfig({
  envPrefix: ['VITE_', 'APP_']  // Expose VITE_* and APP_*
})
```

## .env Files

Load order (later has higher priority):

```
.env                # Always loaded
.env.local          # Always loaded, gitignored
.env.[mode]         # Only in specified mode
.env.[mode].local   # Only in specified mode, gitignored
```

### Variable Expansion

```bash
# .env
KEY=123
EXPANDED=test$KEY   # test123
ESCAPED=test\$foo   # test$foo (escaped)
```

## Modes

```bash
# Development mode (default for dev)
vite

# Production mode (default for build)
vite build

# Custom mode
vite build --mode staging
```

Create mode-specific env file:

```bash
# .env.staging
VITE_APP_TITLE=My App (staging)
NODE_ENV=production  # Still production build
```

### NODE_ENV vs Mode

| Command | NODE_ENV | Mode |
|---------|----------|------|
| `vite build` | `production` | `production` |
| `vite build --mode development` | `production` | `development` |
| `NODE_ENV=development vite build` | `development` | `production` |

## TypeScript IntelliSense

Create type declarations for custom env variables:

```ts
// vite-env.d.ts
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

For strict typing (disallow unknown keys):

```ts
interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}
```

## HTML Replacement

Use `%VARIABLE%` syntax in HTML:

```html
<title>%VITE_APP_TITLE%</title>
<p>Mode: %MODE%</p>
```

Non-existent variables are left as-is (not replaced with `undefined`).

## Loading Env in Config

Env vars are NOT available in `vite.config.ts` automatically:

```ts
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')  // '' loads all vars
  
  return {
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV)
    }
  }
})
```

## Security Notes

- Add `*.local` to `.gitignore`
- `VITE_*` variables end up in client bundle - no secrets
- Never set `envPrefix` to `''` (exposes everything)

<!-- 
Source references:
- https://vite.dev/guide/env-and-mode.html
-->

```

### references/features-hmr.md

```markdown
---
name: features-hmr
description: Vite's Hot Module Replacement (HMR) client API
---

# HMR API

The HMR API is exposed via `import.meta.hot`. Primarily for framework and tooling authors.

## Conditional Guard

Always guard HMR code for tree-shaking in production:

```ts
if (import.meta.hot) {
  // HMR code
}
```

## TypeScript Support

Add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["vite/client"]
  }
}
```

## Self-Accepting Module

Module handles its own updates:

```ts
export const count = 1

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      console.log('updated: count is now', newModule.count)
    }
  })
}
```

## Accept Dependency Updates

React to changes in dependencies without self-reload:

```ts
import { foo } from './foo.js'

foo()

if (import.meta.hot) {
  // Single dependency
  import.meta.hot.accept('./foo.js', (newFoo) => {
    newFoo?.foo()
  })
  
  // Multiple dependencies
  import.meta.hot.accept(
    ['./foo.js', './bar.js'],
    ([newFooModule, newBarModule]) => {
      // Handle updates
    }
  )
}
```

## Cleanup on Update

Clean up side effects before module is replaced:

```ts
function setupSideEffect() {
  const interval = setInterval(() => {}, 1000)
  return interval
}

const interval = setupSideEffect()

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    clearInterval(interval)
  })
}
```

## Prune Callback

Called when module is no longer imported:

```ts
if (import.meta.hot) {
  import.meta.hot.prune((data) => {
    // Cleanup when module is removed from page
  })
}
```

## Persistent Data

Pass data between module instances:

```ts
if (import.meta.hot) {
  // Mutate properties, don't reassign data itself
  import.meta.hot.data.count = (import.meta.hot.data.count || 0) + 1
}
```

## Invalidate

Force propagation to importers:

```ts
if (import.meta.hot) {
  import.meta.hot.accept((module) => {
    if (cannotHandleUpdate(module)) {
      import.meta.hot.invalidate()  // Propagate to importers
    }
  })
}
```

## HMR Events

Listen to built-in events:

```ts
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    console.log('Update incoming')
  })
  
  import.meta.hot.on('vite:afterUpdate', (payload) => {
    console.log('Update applied')
  })
  
  import.meta.hot.on('vite:beforeFullReload', () => {
    console.log('Full reload')
  })
  
  import.meta.hot.on('vite:error', (error) => {
    console.error('HMR error', error)
  })
  
  import.meta.hot.on('vite:ws:connect', () => {
    console.log('WebSocket connected')
  })
  
  import.meta.hot.on('vite:ws:disconnect', () => {
    console.log('WebSocket disconnected')
  })
}
```

## Custom Events

Send events to server:

```ts
// Client
if (import.meta.hot) {
  import.meta.hot.send('my:event', { msg: 'Hello from client' })
}
```

Receive from server:

```ts
// Client
if (import.meta.hot) {
  import.meta.hot.on('my:response', (data) => {
    console.log(data.msg)
  })
}
```

## TypeScript for Custom Events

```ts
// events.d.ts
import 'vite/types/customEvent.d.ts'

declare module 'vite/types/customEvent.d.ts' {
  interface CustomEventMap {
    'my:event': { msg: string }
    'my:response': { msg: string }
  }
}
```

<!-- 
Source references:
- https://vite.dev/guide/api-hmr.html
-->

```

### references/features-workers.md

```markdown
---
name: features-workers
description: Web Worker support in Vite
---

# Web Workers

## Constructor Syntax (Recommended)

Standard Web Worker creation:

```ts
const worker = new Worker(new URL('./worker.js', import.meta.url))
```

Module worker:

```ts
const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module'
})
```

Shared Worker:

```ts
const sharedWorker = new SharedWorker(
  new URL('./shared-worker.js', import.meta.url)
)
```

**Note:** The `new URL()` must be used directly inside `new Worker()` for detection.

## Query Suffix Syntax

Import with `?worker` suffix:

```ts
import MyWorker from './worker?worker'

const worker = new MyWorker()
```

Shared worker:

```ts
import MySharedWorker from './worker?sharedworker'

const worker = new MySharedWorker()
```

### Inline Worker

Inline as base64 string (no separate chunk):

```ts
import MyWorker from './worker?worker&inline'

const worker = new MyWorker()
```

### Worker URL Only

Get URL instead of constructor:

```ts
import workerUrl from './worker?worker&url'
```

## Worker Script

Workers can use ESM `import` statements:

```ts
// worker.js
import { heavyComputation } from './utils'

self.onmessage = (e) => {
  const result = heavyComputation(e.data)
  self.postMessage(result)
}
```

## Worker Options

Configure worker bundling:

```ts
// vite.config.ts
export default defineConfig({
  worker: {
    format: 'es',  // or 'iife'
    plugins: () => [/* worker-specific plugins */],
    rollupOptions: {
      // Rollup options for worker bundle
    }
  }
})
```

## WebAssembly in Workers

```ts
// worker.js
import init from './module.wasm?init'

init().then((instance) => {
  instance.exports.compute()
})
```

<!-- 
Source references:
- https://vite.dev/guide/features.html#web-workers
-->

```

### references/features-dep-bundling.md

```markdown
---
name: features-dep-bundling
description: Dependency pre-bundling configuration and caching
---

# Dependency Pre-Bundling

Vite pre-bundles dependencies on first run for faster dev server startup.

## Why Pre-Bundling

1. **CommonJS/UMD to ESM** - Convert non-ESM dependencies
2. **Performance** - Bundle many internal modules into single file (e.g., lodash-es has 600+ modules)

```ts
// Works thanks to smart import analysis
import React, { useState } from 'react'
```

## Automatic Discovery

Vite crawls source code to find bare imports and pre-bundles them with Rolldown.

New dependencies discovered after server start trigger re-bundling.

## Including Dependencies

Force pre-bundling for dependencies not auto-discovered:

```ts
export default defineConfig({
  optimizeDeps: {
    include: [
      'some-package',
      'another-package/nested'  // Deep imports
    ]
  }
})
```

**When to include:**
- Dynamically imported (via plugin transform)
- Large dependencies with many internal modules
- CommonJS dependencies

## Excluding Dependencies

Skip pre-bundling for small ESM-only dependencies:

```ts
export default defineConfig({
  optimizeDeps: {
    exclude: ['small-esm-dep']
  }
})
```

## Monorepo Linked Dependencies

Linked packages are treated as source code by default. If not ESM:

```ts
export default defineConfig({
  optimizeDeps: {
    include: ['linked-dep']
  }
})
```

Restart with `--force` after making changes to linked deps.

## Custom Rolldown Options

```ts
export default defineConfig({
  optimizeDeps: {
    rolldownOptions: {
      plugins: [/* Rolldown plugins */],
      // Other Rolldown options
    }
  }
})
```

## Caching

### File System Cache

Located in `node_modules/.vite`. Re-runs when:

- Package lockfile changes (`package-lock.json`, `pnpm-lock.yaml`, etc.)
- Patches folder modified
- `vite.config.js` changes
- `NODE_ENV` changes

Force re-bundle:

```bash
vite --force
# Or delete node_modules/.vite
```

### Browser Cache

Pre-bundled deps are cached with `max-age=31536000,immutable`.

To debug dependencies with local edits:

1. Disable cache in browser DevTools Network tab
2. Restart Vite with `--force`
3. Reload page

## Entries

Specify custom entry points for discovery:

```ts
export default defineConfig({
  optimizeDeps: {
    entries: [
      'src/main.ts',
      'src/other-entry.ts'
    ]
  }
})
```

By default, all HTML files are used as entries.

## esbuildOptions (Deprecated)

Use `rolldownOptions` instead:

```ts
export default defineConfig({
  optimizeDeps: {
    // Deprecated
    esbuildOptions: {},
    // Use instead
    rolldownOptions: {}
  }
})
```

<!-- 
Source references:
- https://vite.dev/guide/dep-pre-bundling.html
-->

```

### references/build-production.md

```markdown
---
name: build-production
description: Building for production including targets, multi-page apps, and optimizations
---

# Building for Production

## Basic Build

```bash
vite build
```

Uses `<root>/index.html` as entry point, outputs to `dist/`.

## Browser Compatibility

Default target: Baseline Widely Available browsers (Chrome 111+, Edge 111+, Firefox 114+, Safari 16.4+).

```ts
export default defineConfig({
  build: {
    target: 'es2020',  // Or specific browsers
    // target: ['chrome64', 'firefox78', 'safari12']
  }
})
```

For legacy browsers:

```bash
npm add -D @vitejs/plugin-legacy
```

```ts
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ]
})
```

## Output Configuration

```ts
export default defineConfig({
  build: {
    outDir: 'dist',           // Output directory
    assetsDir: 'assets',      // Assets subdirectory
    emptyOutDir: true,        // Clear outDir before build
    sourcemap: true,          // Generate sourcemaps
    // sourcemap: 'inline' | 'hidden'
  }
})
```

## Public Base Path

For deploying under a subpath:

```ts
export default defineConfig({
  base: '/my-app/'
})
```

Relative base (works anywhere):

```ts
export default defineConfig({
  base: './'
})
```

Access in code:

```ts
const base = import.meta.env.BASE_URL
```

## Multi-Page App

```ts
import { resolve } from 'path'

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        nested: resolve(__dirname, 'nested/index.html')
      }
    }
  }
})
```

## Minification

```ts
export default defineConfig({
  build: {
    minify: 'oxc',     // Default, fastest
    // minify: 'terser',  // More options, slower
    // minify: false,     // Disable
    
    terserOptions: {   // If using terser
      compress: {
        drop_console: true
      }
    }
  }
})
```

## Chunk Strategy

```ts
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Manual chunks configuration
        }
      }
    },
    chunkSizeWarningLimit: 500  // KB
  }
})
```

## CSS Options

```ts
export default defineConfig({
  build: {
    cssCodeSplit: true,         // CSS per async chunk
    cssMinify: 'lightningcss',  // or 'esbuild'
    cssTarget: 'chrome61'       // Different from JS target
  }
})
```

## Asset Handling

```ts
export default defineConfig({
  build: {
    assetsInlineLimit: 4096,    // Inline assets < 4KB as base64
    copyPublicDir: true         // Copy public/ to outDir
  }
})
```

## Manifest

Generate manifest for backend integration:

```ts
export default defineConfig({
  build: {
    manifest: true  // .vite/manifest.json
  }
})
```

## Watch Mode

Rebuild on file changes:

```bash
vite build --watch
```

```ts
export default defineConfig({
  build: {
    watch: {}  // Enable programmatically
  }
})
```

## Load Error Handling

Handle dynamic import failures (e.g., after deployment):

```ts
window.addEventListener('vite:preloadError', (event) => {
  window.location.reload()
})
```

## Build Optimizations (Automatic)

- **CSS code splitting** - CSS per async chunk
- **Preload directives** - `<link rel="modulepreload">`
- **Async chunk optimization** - Parallel fetching of dependencies

## License Generation

Generate license file for dependencies:

```ts
export default defineConfig({
  build: {
    license: true  // .vite/license.md
  }
})
```

<!-- 
Source references:
- https://vite.dev/guide/build.html
- https://vite.dev/config/build-options.html
-->

```

### references/build-library.md

```markdown
---
name: build-library
description: Building libraries with Vite including proper package.json exports
---

# Library Mode

Build browser-oriented libraries for distribution.

## Basic Configuration

```ts
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'lib/main.js'),
      name: 'MyLib',           // Global variable name for UMD
      fileName: 'my-lib'       // Output filename (without extension)
    },
    rolldownOptions: {
      external: ['vue'],       // Don't bundle these
      output: {
        globals: {
          vue: 'Vue'           // Global var for externals in UMD
        }
      }
    }
  }
})
```

## Multiple Entry Points

```ts
export default defineConfig({
  build: {
    lib: {
      entry: {
        'my-lib': resolve(__dirname, 'lib/main.js'),
        'secondary': resolve(__dirname, 'lib/secondary.js')
      },
      name: 'MyLib'
    }
  }
})
```

## Output Formats

Single entry defaults: `['es', 'umd']`
Multiple entries defaults: `['es', 'cjs']`

```ts
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'lib/main.js'),
      formats: ['es', 'cjs', 'umd', 'iife']
    }
  }
})
```

## Custom File Names

```ts
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'lib/main.js'),
      fileName: (format, entryName) => `${entryName}.${format}.js`,
      cssFileName: 'styles'  // For bundled CSS
    }
  }
})
```

## Package.json Configuration

### Single Entry

```json
{
  "name": "my-lib",
  "type": "module",
  "files": ["dist"],
  "main": "./dist/my-lib.umd.cjs",
  "module": "./dist/my-lib.js",
  "exports": {
    ".": {
      "import": "./dist/my-lib.js",
      "require": "./dist/my-lib.umd.cjs"
    }
  }
}
```

### Multiple Entries

```json
{
  "name": "my-lib",
  "type": "module",
  "files": ["dist"],
  "main": "./dist/my-lib.cjs",
  "module": "./dist/my-lib.js",
  "exports": {
    ".": {
      "import": "./dist/my-lib.js",
      "require": "./dist/my-lib.cjs"
    },
    "./secondary": {
      "import": "./dist/secondary.js",
      "require": "./dist/secondary.cjs"
    }
  }
}
```

### With CSS

```json
{
  "exports": {
    ".": {
      "import": "./dist/my-lib.js",
      "require": "./dist/my-lib.umd.cjs"
    },
    "./style.css": "./dist/my-lib.css"
  }
}
```

## Library Entry File

```ts
// lib/main.js
import Foo from './Foo.vue'
import Bar from './Bar.vue'

export { Foo, Bar }
```

## Environment Variables

In library mode:
- `import.meta.env.*` is statically replaced
- `process.env.*` is NOT replaced (consumers can change it)

To replace `process.env`:

```ts
export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"production"'
  }
})
```

## Notes

- `assetsInlineLimit` is ignored - assets always inlined
- `cssCodeSplit` defaults to `false`
- For non-browser libraries, consider using [tsdown](https://tsdown.dev/) or Rolldown directly

<!-- 
Source references:
- https://vite.dev/guide/build.html#library-mode
-->

```

### references/build-ssr.md

```markdown
---
name: build-ssr
description: Server-side rendering setup and configuration with Vite
---

# Server-Side Rendering (SSR)

Low-level API for framework authors. For applications, use higher-level tools from [Awesome Vite SSR](https://github.com/vitejs/awesome-vite#ssr).

## Project Structure

```
├── index.html
├── server.js              # Express/Node server
└── src/
    ├── main.js            # Universal app code
    ├── entry-client.js    # Mounts app to DOM
    └── entry-server.js    # Renders app with SSR API
```

## index.html

```html
<!DOCTYPE html>
<html>
  <body>
    <div id="app"><!--ssr-outlet--></div>
    <script type="module" src="/src/entry-client.js"></script>
  </body>
</html>
```

## Development Server

```ts
// server.js
import express from 'express'
import { createServer as createViteServer } from 'vite'

async function createServer() {
  const app = express()

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom'
  })

  app.use(vite.middlewares)

  app.use('*all', async (req, res, next) => {
    const url = req.originalUrl

    try {
      // 1. Read index.html
      let template = fs.readFileSync(
        path.resolve(__dirname, 'index.html'),
        'utf-8'
      )

      // 2. Apply Vite transforms
      template = await vite.transformIndexHtml(url, template)

      // 3. Load server entry
      const { render } = await vite.ssrLoadModule('/src/entry-server.js')

      // 4. Render app HTML
      const appHtml = await render(url)

      // 5. Inject into template
      const html = template.replace('<!--ssr-outlet-->', appHtml)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e) {
      vite.ssrFixStacktrace(e)
      next(e)
    }
  })

  app.listen(5173)
}

createServer()
```

## Conditional Logic

```ts
if (import.meta.env.SSR) {
  // Server-only code (tree-shaken on client)
}
```

## Production Build

```json
{
  "scripts": {
    "build:client": "vite build --outDir dist/client",
    "build:server": "vite build --outDir dist/server --ssr src/entry-server.js"
  }
}
```

### Production Server

```ts
// Differences from dev:
// 1. Use dist/client/index.html as template
// 2. Use import('./dist/server/entry-server.js') instead of ssrLoadModule
// 3. Serve static files from dist/client
```

## SSR Manifest

For preload directives:

```bash
vite build --outDir dist/client --ssrManifest
```

Generates `dist/client/.vite/ssr-manifest.json` with module-to-chunk mappings.

## SSR Externals

Dependencies are externalized by default. To transform with Vite:

```ts
export default defineConfig({
  ssr: {
    noExternal: ['package-that-needs-transform'],
    external: ['package-to-externalize']
  }
})
```

## SSR-specific Plugin Logic

```ts
export function mySSRPlugin() {
  return {
    name: 'my-ssr',
    transform(code, id, options) {
      if (options?.ssr) {
        // SSR-specific transform
      }
    }
  }
}
```

## SSR Target

```ts
export default defineConfig({
  ssr: {
    target: 'node',      // Default
    // target: 'webworker'  // For edge runtimes
  }
})
```

## SSR Bundle

Bundle all dependencies (for workers):

```ts
export default defineConfig({
  ssr: {
    noExternal: true  // Bundle everything
  }
})
```

## Resolve Conditions

```ts
export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['node'],
      externalConditions: ['node']
    }
  }
})
```

## Pre-Rendering / SSG

Pre-render routes with known data into static HTML at build time.

<!-- 
Source references:
- https://vite.dev/guide/ssr.html
-->

```

### references/advanced-api.md

```markdown
---
name: advanced-api
description: Vite's JavaScript API for programmatic usage
---

# JavaScript API

Vite's APIs are fully typed. Use TypeScript or enable JS type checking for intellisense.

## `createServer`

Create a development server programmatically:

```ts
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  root: __dirname,
  server: {
    port: 1337
  }
})

await server.listen()
server.printUrls()
server.bindCLIShortcuts({ print: true })
```

### ViteDevServer Interface

```ts
interface ViteDevServer {
  config: ResolvedConfig
  middlewares: Connect.Server      // Connect app for custom middleware
  httpServer: http.Server | null   // Node HTTP server
  watcher: FSWatcher               // Chokidar watcher
  ws: WebSocketServer              // WebSocket for HMR
  moduleGraph: ModuleGraph         // Module import relationships
  
  // Transform without HTTP
  transformRequest(url: string): Promise<TransformResult | null>
  
  // Apply HTML transforms
  transformIndexHtml(url: string, html: string): Promise<string>
  
  // Load module for SSR
  ssrLoadModule(url: string): Promise<Record<string, any>>
  
  // Fix SSR error stack traces
  ssrFixStacktrace(e: Error): void
  
  // Control
  listen(port?: number): Promise<ViteDevServer>
  restart(): Promise<void>
  close(): Promise<void>
}
```

## `build`

Build for production:

```ts
import { build } from 'vite'

await build({
  root: './project',
  base: '/foo/',
  build: {
    rolldownOptions: {
      // ...
    }
  }
})
```

## `preview`

Preview production build locally:

```ts
import { preview } from 'vite'

const previewServer = await preview({
  preview: {
    port: 8080,
    open: true
  }
})

previewServer.printUrls()
```

## `resolveConfig`

Resolve config without starting server:

```ts
import { resolveConfig } from 'vite'

const config = await resolveConfig(
  { root: './project' },
  'serve',        // 'serve' | 'build'
  'development'   // default mode
)
```

## `mergeConfig`

Deep merge two configs:

```ts
import { mergeConfig } from 'vite'

const merged = mergeConfig(baseConfig, overrideConfig)
```

Merge callback config:

```ts
import { defineConfig, mergeConfig } from 'vite'

export default defineConfig((env) =>
  mergeConfig(configAsCallback(env), configAsObject)
)
```

## `loadEnv`

Load .env files:

```ts
import { loadEnv } from 'vite'

// Load VITE_* vars
const env = loadEnv('development', process.cwd())

// Load all vars (empty prefix)
const allEnv = loadEnv('development', process.cwd(), '')
```

## `searchForWorkspaceRoot`

Find monorepo workspace root:

```ts
import { searchForWorkspaceRoot } from 'vite'

const workspaceRoot = searchForWorkspaceRoot(process.cwd())
```

## `normalizePath`

Normalize paths for cross-platform:

```ts
import { normalizePath } from 'vite'

normalizePath('foo\\bar')  // 'foo/bar'
```

## `transformWithOxc`

Transform JS/TS with Oxc Transformer:

```ts
import { transformWithOxc } from 'vite'

const result = await transformWithOxc(
  code,
  'file.ts',
  { target: 'es2020' }
)
```

## `preprocessCSS`

Pre-process CSS files:

```ts
import { preprocessCSS, resolveConfig } from 'vite'

const config = await resolveConfig({}, 'serve')
const result = await preprocessCSS(code, 'styles.scss', config)
// result.code - plain CSS
// result.modules - CSS modules mapping
```

## `loadConfigFromFile`

Load config file manually:

```ts
import { loadConfigFromFile } from 'vite'

const result = await loadConfigFromFile(
  { command: 'serve', mode: 'development' },
  'vite.config.ts'
)
// result.config, result.path, result.dependencies
```

## InlineConfig

Extends UserConfig with:

```ts
interface InlineConfig extends UserConfig {
  configFile?: string | false  // Config file path or false to skip
  mode?: string
}
```

<!-- 
Source references:
- https://vite.dev/guide/api-javascript.html
-->

```

### references/advanced-plugin-api.md

```markdown
---
name: advanced-plugin-api
description: Creating Vite plugins, hooks, virtual modules, and client-server communication
---

# Plugin API

Vite plugins extend Rolldown's plugin interface with Vite-specific hooks.

## Basic Plugin Structure

```ts
export default function myPlugin(options = {}) {
  return {
    name: 'vite-plugin-my-plugin',
    
    // Hooks...
  }
}
```

## Naming Conventions

- Vite-only plugins: `vite-plugin-*`
- Rollup-compatible: `rollup-plugin-*`
- Framework-specific: `vite-plugin-vue-*`, `vite-plugin-react-*`

## Universal Hooks (from Rolldown)

Called on server start:
- `options` - Modify Rolldown options
- `buildStart` - Build starting

Called per module request:
- `resolveId` - Resolve import paths
- `load` - Load module content
- `transform` - Transform module code

Called on server close:
- `buildEnd`
- `closeBundle`

## Vite-Specific Hooks

### `config`

Modify config before resolution:

```ts
{
  name: 'modify-config',
  config(config, { command, mode }) {
    if (command === 'build') {
      return {
        resolve: {
          alias: { foo: 'bar' }
        }
      }
    }
  }
}
```

### `configResolved`

Access final resolved config:

```ts
{
  name: 'read-config',
  configResolved(config) {
    this.config = config
  }
}
```

### `configureServer`

Add dev server middleware:

```ts
{
  name: 'configure-server',
  configureServer(server) {
    // Before Vite's middlewares
    server.middlewares.use((req, res, next) => {
      // Handle request
      next()
    })
    
    // Return function to run after Vite's middlewares
    return () => {
      server.middlewares.use((req, res, next) => {
        // Post middleware
      })
    }
  }
}
```

### `transformIndexHtml`

Transform HTML files:

```ts
{
  name: 'html-transform',
  transformIndexHtml(html) {
    return html.replace(/<title>(.*?)<\/title>/, '<title>New Title</title>')
  }
}
```

Inject tags:

```ts
{
  name: 'html-inject',
  transformIndexHtml() {
    return {
      tags: [
        {
          tag: 'script',
          attrs: { src: '/inject.js' },
          injectTo: 'body'  // 'head' | 'body' | 'head-prepend' | 'body-prepend'
        }
      ]
    }
  }
}
```

### `handleHotUpdate`

Custom HMR handling:

```ts
{
  name: 'custom-hmr',
  handleHotUpdate({ file, server, modules }) {
    if (file.endsWith('.custom')) {
      server.ws.send({
        type: 'custom',
        event: 'custom-update',
        data: { file }
      })
      return []  // Prevent default HMR
    }
  }
}
```

## Virtual Modules

Provide build-time information to source code:

```ts
export default function myPlugin() {
  const virtualModuleId = 'virtual:my-module'
  const resolvedId = '\0' + virtualModuleId

  return {
    name: 'virtual-module',
    
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedId
      }
    },
    
    load(id) {
      if (id === resolvedId) {
        return `export const msg = "from virtual module"`
      }
    }
  }
}
```

Usage:

```ts
import { msg } from 'virtual:my-module'
```

## Client-Server Communication

### Server to Client

```ts
{
  configureServer(server) {
    server.ws.on('connection', () => {
      server.ws.send('my:greetings', { msg: 'hello' })
    })
  }
}
```

Client receives:

```ts
if (import.meta.hot) {
  import.meta.hot.on('my:greetings', (data) => {
    console.log(data.msg)
  })
}
```

### Client to Server

```ts
// Client
if (import.meta.hot) {
  import.meta.hot.send('my:from-client', { msg: 'Hey!' })
}

// Server (in plugin)
{
  configureServer(server) {
    server.ws.on('my:from-client', (data, client) => {
      console.log(data.msg)
      client.send('my:reply', { msg: 'Got it!' })
    })
  }
}
```

## Transform with Filtering

```ts
{
  name: 'transform-js',
  transform: {
    filter: {
      id: /\.js$/  // Only .js files
    },
    handler(code, id) {
      return transformCode(code)
    }
  }
}
```

## Path Normalization

Use POSIX separators for cross-platform compatibility:

```ts
import { normalizePath } from 'vite'

normalizePath('foo\\bar')  // 'foo/bar'
```

<!-- 
Source references:
- https://vite.dev/guide/api-plugin.html
-->

```

### references/advanced-performance.md

```markdown
---
name: advanced-performance
description: Performance optimization tips for Vite dev server and builds
---

# Performance Optimization

## Browser Setup

- Use dev-only browser profile without extensions
- Disable "Disable Cache" in DevTools when using Vite
- Extensions can interfere with requests and slow startup

## Audit Plugin Performance

1. **Lazy load large dependencies** in plugins
2. **Avoid long operations** in `buildStart`, `config`, `configResolved`
3. **Optimize transform hooks** - check `id` extension before processing

Debug transform times:

```bash
vite --debug plugin-transform
```

Use [vite-plugin-inspect](https://github.com/antfu/vite-plugin-inspect) to inspect transforms.

## Profiling

```bash
vite --profile
# Visit site, press 'p + enter' to record .cpuprofile
# Open in https://www.speedscope.app
```

## Reduce Resolve Operations

Be explicit with extensions to avoid filesystem checks:

```ts
// Slow: checks .mjs, .js, .mts, .ts, .jsx, .tsx, .json
import Component from './Component'

// Fast: direct hit
import Component from './Component.tsx'
```

Enable TypeScript path resolution for explicit imports:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true
  }
}
```

## Avoid Barrel Files

Barrel files (`index.js` re-exporting everything) cause all files to load:

```ts
// Slow: loads all utils
import { slash } from './utils'

// Fast: loads only slash.js
import { slash } from './utils/slash.js'
```

## Warm Up Frequently Used Files

Pre-transform files that are always loaded:

```ts
export default defineConfig({
  server: {
    warmup: {
      clientFiles: [
        './src/components/BigComponent.vue',
        './src/utils/big-utils.js'
      ],
      ssrFiles: ['./src/server/modules/*.js']
    }
  }
})
```

Find files to warm up:

```bash
vite --debug transform
```

## Use Native/Less Tooling

**Do less work:**
- CSS instead of Sass/Less (PostCSS has nesting)
- Don't transform SVGs to components - import as strings/URLs
- Skip Babel in `@vitejs/plugin-react` if not needed

**Use native tools:**
- Try Lightning CSS for faster CSS processing

```ts
export default defineConfig({
  css: {
    transformer: 'lightningcss'
  }
})
```

## Server Options

### Open Browser Automatically

Triggers warmup of entry point:

```ts
export default defineConfig({
  server: {
    open: true
  }
})
```

### Limit File Watching

```ts
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/large-folder/**']
    }
  }
})
```

## Build Performance

### Disable Reporting

Skip gzip size calculation for large projects:

```ts
export default defineConfig({
  build: {
    reportCompressedSize: false
  }
})
```

### Sourcemaps

Disable if not needed:

```ts
export default defineConfig({
  build: {
    sourcemap: false
  }
})
```

<!-- 
Source references:
- https://vite.dev/guide/performance.html
-->

```

### references/advanced-backend.md

```markdown
---
name: advanced-backend
description: Integrating Vite with traditional backend frameworks
---

# Backend Integration

Integrate Vite with traditional backends (Rails, Laravel, etc.) for asset serving.

## Configuration

```ts
// vite.config.ts
export default defineConfig({
  server: {
    cors: {
      origin: 'http://my-backend.example.com'
    }
  },
  build: {
    manifest: true,  // Generate .vite/manifest.json
    rolldownOptions: {
      input: '/path/to/main.js'  // Override HTML entry
    }
  }
})
```

Import polyfill in entry:

```ts
// main.js
import 'vite/modulepreload-polyfill'
```

## Development

Inject Vite client and entry in your backend template:

```html
<!-- Development only -->
<script type="module" src="http://localhost:5173/@vite/client"></script>
<script type="module" src="http://localhost:5173/main.js"></script>
```

### React Setup

Add before other scripts:

```html
<script type="module">
  import RefreshRuntime from 'http://localhost:5173/@react-refresh'
  RefreshRuntime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}
  window.$RefreshSig$ = () => (type) => type
  window.__vite_plugin_react_preamble_installed__ = true
</script>
```

### Asset Proxying

Either:
1. Proxy static asset requests to Vite
2. Set `server.origin`:

```ts
export default defineConfig({
  server: {
    origin: 'http://localhost:5173'
  }
})
```

## Production

Build generates `.vite/manifest.json`:

```json
{
  "views/foo.js": {
    "file": "assets/foo-BRBmoGS9.js",
    "src": "views/foo.js",
    "isEntry": true,
    "imports": ["_shared-B7PI925R.js"],
    "css": ["assets/foo-5UjPuW-k.css"]
  },
  "_shared-B7PI925R.js": {
    "file": "assets/shared-B7PI925R.js",
    "css": ["assets/shared-ChJ_j-JJ.css"]
  }
}
```

## Rendering Tags

For entry `views/foo.js`, render in this order:

```html
<!-- 1. Entry CSS -->
<link rel="stylesheet" href="/assets/foo-5UjPuW-k.css" />

<!-- 2. Imported chunks' CSS (recursive) -->
<link rel="stylesheet" href="/assets/shared-ChJ_j-JJ.css" />

<!-- 3. Entry script -->
<script type="module" src="/assets/foo-BRBmoGS9.js"></script>

<!-- 4. Optional: preload imports -->
<link rel="modulepreload" href="/assets/shared-B7PI925R.js" />
```

## Manifest Structure

```ts
interface ManifestChunk {
  src?: string           // Input file name
  file: string          // Output file name
  css?: string[]        // CSS files (JS chunks only)
  assets?: string[]     // Non-CSS assets (JS chunks only)
  isEntry?: boolean     // Is entry point
  isDynamicEntry?: boolean  // Is dynamic import
  imports?: string[]    // Static imports (manifest keys)
  dynamicImports?: string[]  // Dynamic imports (manifest keys)
}
```

## Processing Imports

Recursively collect all imported chunks:

```ts
function getImportedChunks(manifest, name) {
  const seen = new Set()
  const chunks = []
  
  function collect(chunk) {
    for (const file of chunk.imports ?? []) {
      if (seen.has(file)) continue
      seen.add(file)
      
      const importee = manifest[file]
      collect(importee)
      chunks.push(importee)
    }
  }
  
  collect(manifest[name])
  return chunks
}
```

## Existing Integrations

Check [Awesome Vite](https://github.com/vitejs/awesome-vite#integrations-with-backends) for:
- Laravel (laravel-vite)
- Rails
- Django
- Flask
- And more

<!-- 
Source references:
- https://vite.dev/guide/backend-integration.html
-->

```

