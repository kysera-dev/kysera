import { prism } from '@xec-sh/kit'
import { isJsonMode, output } from '../../utils/output.js'
import {
  checkConfig,
  checkDatabase,
  checkDrivers,
  checkRuntime,
  checkVersions,
  readCliPackage,
  summarize,
  type DoctorCheck,
  type DoctorSummary
} from './checks.js'

export interface DoctorOptions {
  config?: string
  json?: boolean
}

const SECTIONS: [prefix: string, title: string][] = [
  ['runtime', 'Runtime'],
  ['config', 'Configuration'],
  ['drivers', 'Drivers'],
  ['database', 'Database'],
  ['versions', 'Versions'],
  ['doctor', 'Doctor']
]

/**
 * Run all doctor probes and report. Never throws: even an unexpected
 * internal error is converted into a fail check. Exit code is 0 when no
 * check fails (warnings allowed), 1 otherwise.
 */
export async function runDoctor(options: DoctorOptions): Promise<void> {
  const checks: DoctorCheck[] = []

  try {
    const pkg = readCliPackage()
    checks.push(...checkRuntime(pkg))
    const configResult = await checkConfig(options.config)
    checks.push(...configResult.checks)
    checks.push(...(await checkDrivers(configResult.config)))
    checks.push(...(await checkDatabase(configResult.config)))
    checks.push(...checkVersions(pkg.version))
  } catch (error) {
    checks.push({
      id: 'doctor.internal',
      status: 'fail',
      detail: `unexpected doctor failure: ${error instanceof Error ? error.message : String(error)}`
    })
  }

  const summary = summarize(checks)

  if (options.json === true || isJsonMode()) {
    output({ checks, summary }, { format: 'json' })
  } else {
    output(renderReport(checks, summary))
  }

  if (summary.fail > 0) {
    process.exitCode = 1
  }
}

function icon(status: DoctorCheck['status']): string {
  if (status === 'pass') return prism.green('[OK]')
  if (status === 'warn') return prism.yellow('[WARN]')
  return prism.red('[ERR]')
}

function renderReport(checks: DoctorCheck[], summary: DoctorSummary): string {
  const lines: string[] = ['', prism.bold('Kysera Doctor')]

  for (const [prefix, title] of SECTIONS) {
    const section = checks.filter(check => check.id.startsWith(`${prefix}.`))
    if (section.length === 0) continue
    lines.push('', prism.bold(title))
    for (const check of section) {
      const label = check.id.slice(prefix.length + 1)
      const [first = '', ...continuation] = check.detail.split('\n')
      lines.push(`  ${icon(check.status)} ${label}: ${first}`)
      for (const line of continuation) {
        lines.push(`         ${line}`)
      }
    }
  }

  const counts = `Summary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`
  const colored =
    summary.status === 'fail'
      ? prism.red(counts)
      : summary.status === 'warn'
        ? prism.yellow(counts)
        : prism.green(counts)
  lines.push('', colored)

  return lines.join('\n')
}
