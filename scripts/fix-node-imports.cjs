#!/usr/bin/env node

/**
 * Post-build script to restore node: prefix in dist/ .js files.
 *
 * esbuild strips the `node:` prefix from externalized Node built-in imports
 * (e.g., `from 'node:crypto'` → `from 'crypto'`).  Deno requires the prefix,
 * so we add it back after the build.
 *
 * Usage: node scripts/fix-node-imports.js [dir=./dist] [modules...]
 *   e.g. node scripts/fix-node-imports.js ./dist crypto async_hooks
 */

const fs = require('fs')
const path = require('path')

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers',
  'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm',
  'wasi', 'worker_threads', 'zlib'
])

const dir = process.argv[2] || './dist'
const only = process.argv.length > 3 ? new Set(process.argv.slice(3)) : null

const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'))

let fixed = 0
for (const file of files) {
  const filePath = path.join(dir, file)
  let content = fs.readFileSync(filePath, 'utf8')
  let changed = false

  // Match:  from 'module'  or  from "module"  (with optional minified spacing)
  const replaced = content.replace(
    /from\s*(['"])([a-z_]+)\1/g,
    (match, quote, mod) => {
      if (!NODE_BUILTINS.has(mod)) return match
      if (only && !only.has(mod)) return match
      changed = true
      return `from ${quote}node:${mod}${quote}`
    }
  )

  if (changed) {
    fs.writeFileSync(filePath, replaced)
    fixed++
  }
}

if (fixed > 0) {
  console.log(`fix-node-imports: patched ${fixed} file(s) in ${dir}`)
}
