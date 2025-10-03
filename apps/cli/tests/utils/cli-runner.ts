import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.join(__dirname, '../../dist/index.js')

/**
 * Simple CLI test runner using execFileSync
 */
export function runCLISync(
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
  } = {}
): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ...options.env
      },
      encoding: 'utf-8',
      stdio: 'pipe'
    })

    return {
      stdout: stdout || '',
      stderr: '',
      code: 0
    }
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      code: error.status || 1
    }
  }
}