import { describe, it, expect } from 'vitest'
import { Command, InvalidArgumentError } from 'commander'
import { parsePositiveIntOption } from '../../../src/utils/option-parsers.js'

describe('parsePositiveIntOption', () => {
  it('parses decimal integers regardless of any previous value', () => {
    expect(parsePositiveIntOption('2500')).toBe(2500)
    expect(parsePositiveIntOption('10')).toBe(10)
  })

  it('rejects non-numeric and non-positive values', () => {
    expect(() => parsePositiveIntOption('abc')).toThrow(InvalidArgumentError)
    expect(() => parsePositiveIntOption('0')).toThrow(InvalidArgumentError)
    expect(() => parsePositiveIntOption('-5')).toThrow(InvalidArgumentError)
  })

  it('makes --interval actually override the default (bare parseInt used the default as radix)', () => {
    // Regression: `.option('--interval <ms>', ..., parseInt, 5000)` called
    // parseInt(value, 5000) — radix 5000 — so every user value became NaN
    // and the 5000 default always won.
    const cmd = new Command('probe')
      .exitOverride()
      .option('--interval <ms>', 'interval', parsePositiveIntOption, 5000)
      .action(() => {})

    cmd.parse(['--interval', '250'], { from: 'user' })
    expect(cmd.opts<{ interval: number }>().interval).toBe(250)
  })
})
