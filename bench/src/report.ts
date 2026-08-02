/**
 * Markdown rendering for RESULTS.md: environment header, suite tables with
 * relative-throughput columns, and the query-count section.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, platform, release, arch } from 'node:os'
import { dirname, join } from 'node:path'
import type { RecordedStatement } from './counting.js'
import { findTask, type MeasuredTask, type SuiteTable } from './runner.js'

const require = createRequire(import.meta.url)

function pkgVersion(name: string): string {
  try {
    const pkg = require(`${name}/package.json`) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    // Package hides package.json behind its exports map — resolve the entry
    // point and walk up until the package's own manifest is found.
    try {
      let dir = dirname(require.resolve(name))
      for (let i = 0; i < 6; i++) {
        const candidate = join(dir, 'package.json')
        if (existsSync(candidate)) {
          const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
            name?: string
            version?: string
          }
          if (parsed.name === name) return parsed.version ?? 'unknown'
        }
        dir = dirname(dir)
      }
    } catch {
      /* fall through */
    }
    return 'unknown'
  }
}

/**
 * Workspace packages are ESM-only with a closed exports map, so
 * `require('@kysera/x/package.json')` is blocked; read the manifest straight
 * from the monorepo instead (bench/ sits at the repo root).
 */
function kyseraVersion(): string {
  try {
    const manifest = new URL('../../packages/executor/package.json', import.meta.url)
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }
    return parsed.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function fmtOps(value: number): string {
  return numberFormat.format(Math.round(value))
}

function fmtUs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} ms`
  return `${value.toFixed(2)} µs`
}

function fmtRelative(task: MeasuredTask, baseline: MeasuredTask): string {
  if (task.name === baseline.name) return '100 % (baseline)'
  const pct = (task.opsPerSec / baseline.opsPerSec) * 100
  return `${pct.toFixed(1)} %`
}

export function renderEnvironmentHeader(): string {
  const cpu = cpus()[0]?.model ?? 'unknown CPU'
  const lines = [
    '> **Read this first.** These numbers are *relative* indicators measured on a single',
    '> machine against an **in-memory SQLite** database with a synchronous driver. They',
    '> exist to quantify the overhead Kysera adds on top of raw Kysely, not to promise',
    '> absolute throughput. On any networked database (PostgreSQL, MySQL), per-query I/O',
    '> latency is orders of magnitude larger than every overhead measured here. Absolute',
    '> ops/sec will differ between machines and runs; the *relative* percentages are the',
    '> signal. All suites are single-threaded with fixed warmup, fixed iteration counts and',
    '> a discarded first pass so every variant is measured JIT-hot. ops/sec is derived',
    '> from median latency (1000 / p50), which resists GC pauses and background-load',
    '> bursts better than mean-based throughput. Even so, differences within ±5 % of a',
    '> baseline should be read as "no measurable difference".',
    '',
    '| Environment | |',
    '| --- | --- |',
    `| Date | ${new Date().toISOString()} |`,
    `| Node.js | ${process.version} (V8 ${process.versions.v8}) |`,
    `| OS / arch | ${platform()} ${release()} / ${arch()} |`,
    `| CPU | ${cpu} |`,
    `| kysely | ${pkgVersion('kysely')} |`,
    `| better-sqlite3 | ${pkgVersion('better-sqlite3')} |`,
    `| tinybench | ${pkgVersion('tinybench')} |`,
    `| @kysera/* | ${kyseraVersion()} |`
  ]
  return lines.join('\n')
}

export function renderSuiteTable(suite: SuiteTable, index: number): string {
  const baseline = findTask(suite.tasks, suite.baseline)
  const lines = [
    `## ${index}. ${suite.title}`,
    '',
    suite.caption,
    '',
    '| Variant | ops/sec (median-derived) | median | p99 | relative ops/sec |',
    '| --- | ---: | ---: | ---: | ---: |'
  ]
  for (const task of suite.tasks) {
    lines.push(
      `| ${task.name} | ${fmtOps(task.opsPerSec)} | ${fmtUs(task.medianUs)} | ${fmtUs(task.p99Us)} | ${fmtRelative(task, baseline)} |`
    )
  }
  if (suite.notes.length > 0) {
    lines.push('', suite.notes.join(' '))
  }
  return lines.join('\n')
}

export interface QueryCountEntry {
  operation: string
  statements: RecordedStatement[]
  byKind: Record<string, number>
}

export function renderQueryCountSection(
  index: number,
  entries: QueryCountEntry[],
  notes: string[]
): string {
  const lines = [
    `## ${index}. Mutation round-trip query count (RLS + audit + soft-delete)`,
    '',
    'Statements that actually reached SQLite for **one** repository call, recorded by a',
    'counting driver (transaction control included). Stack: `rlsPlugin` (tenant user',
    'context, non-system) + `auditPlugin` (captureOldValues) + `softDeletePlugin`.',
    '',
    '| Operation | total statements | breakdown |',
    '| --- | ---: | --- |'
  ]
  for (const entry of entries) {
    const breakdown = Object.entries(entry.byKind)
      .map(([kind, count]) => `${count}× ${kind}`)
      .join(', ')
    lines.push(`| \`${entry.operation}\` | ${entry.statements.length} | ${breakdown} |`)
  }

  const update = entries.find(entry => entry.operation.startsWith('update'))
  if (update) {
    lines.push('', 'Statement-by-statement trace of the single `update(id, data)` call:', '')
    lines.push('| # | kind | SQL |', '| ---: | --- | --- |')
    update.statements.forEach((statement, i) => {
      const sql = statement.sql.replaceAll('|', '\\|')
      lines.push(`| ${i + 1} | ${statement.kind} | \`${sql}\` |`)
    })
  }

  if (notes.length > 0) {
    lines.push('', notes.join(' '))
  }
  return lines.join('\n')
}
