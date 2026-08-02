import { InvalidArgumentError } from 'commander'

/**
 * Commander argParser for integer options.
 *
 * Commander calls argParsers as (value, previous); passing bare `parseInt`
 * makes the previous value (e.g. a 5000ms default) the RADIX, so every
 * user-supplied value parses to NaN and the default silently wins.
 */
export function parsePositiveIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer.')
  }
  return parsed
}
