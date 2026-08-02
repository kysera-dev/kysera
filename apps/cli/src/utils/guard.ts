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
  options: { force?: boolean | undefined; yes?: boolean | undefined } = {}
): Promise<boolean> {
  if (options.force || options.yes) {
    return true
  }

  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true

  if (!interactive || isJsonMode()) {
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
