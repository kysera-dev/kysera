import { CLIError } from './errors.js'
import { isJsonMode } from './output.js'

/**
 * Gate a destructive operation behind explicit confirmation.
 *
 * - `--force` (or `--yes`) proceeds without prompting.
 * - On an interactive TTY the user is prompted; returns false if declined.
 * - Without a TTY (CI, pipes) or in JSON mode this FAILS instead of
 *   auto-proceeding or hanging: destructive operations never run
 *   implicitly.
 */
export async function guardDestructive(
  message: string,
  options: {
    force?: boolean | undefined
    yes?: boolean | undefined
    json?: boolean | undefined
  } = {}
): Promise<boolean> {
  if (options.force === true || options.yes === true) {
    return true
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY

  if (!interactive || options.json === true || isJsonMode()) {
    throw new CLIError(
      `Refusing to run destructive operation without confirmation: ${message}`,
      'CONFIRMATION_REQUIRED',
      undefined,
      ['Re-run with --force to confirm this operation in non-interactive mode']
    )
  }

  const { confirm } = await import('@xec-sh/kit')
  const confirmed = await confirm({ message, initialValue: false })
  return confirmed === true
}

/** Interactive input must never block JSON output, pipes, or CI. */
export function requireInteractive(
  message: string,
  options: { json?: boolean | undefined } = {}
): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY || options.json === true || isJsonMode()) {
    throw new CLIError(message, 'INTERACTION_REQUIRED', undefined, [
      'Supply the required arguments or options instead of interactive input'
    ])
  }
}
