import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Command } from 'commander'

describe('CLI', () => {
  it('should be testable', () => {
    const program = new Command()
    program
      .name('kysera')
      .description('Test CLI')
      .version('0.1.0')

    expect(program.name()).toBe('kysera')
    expect(program.description()).toBe('Test CLI')
  })
})