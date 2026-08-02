/**
 * Destructive-operation guard tests: TTY prompts, non-TTY fails fast,
 * --force always proceeds, and nothing ever auto-proceeds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { guardDestructive } from '@/utils/guard.js'
import { CLIError } from '@/utils/errors.js'
import { configureOutput, resetOutput } from '@/utils/output.js'
import { confirm } from '@xec-sh/kit'

vi.mock('@xec-sh/kit', () => ({
  confirm: vi.fn(),
  prism: new Proxy({}, { get: () => (s: string) => s })
}))

function setTTY(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true })
}

describe('guardDestructive', () => {
  const originalStdinTTY = process.stdin.isTTY
  const originalStdoutTTY = process.stdout.isTTY

  beforeEach(() => {
    resetOutput()
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinTTY,
      configurable: true
    })
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutTTY,
      configurable: true
    })
    resetOutput()
  })

  it('proceeds without prompting when force is set', async () => {
    setTTY(false, false)
    await expect(guardDestructive('Wipe everything?', { force: true })).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('proceeds without prompting when yes is set', async () => {
    setTTY(false, false)
    await expect(guardDestructive('Wipe everything?', { yes: true })).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('fails fast without a TTY instead of auto-proceeding', async () => {
    setTTY(false, false)
    await expect(guardDestructive('Wipe everything?')).rejects.toThrow(CLIError)
    await expect(guardDestructive('Wipe everything?')).rejects.toThrow(
      /Refusing to run destructive operation/
    )
    expect(confirm).not.toHaveBeenCalled()
  })

  it('fails fast in JSON mode even with a TTY', async () => {
    setTTY(true, true)
    configureOutput({ json: true })
    await expect(guardDestructive('Wipe everything?')).rejects.toThrow(CLIError)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('includes a --force suggestion in the refusal', async () => {
    setTTY(false, false)
    try {
      await guardDestructive('Wipe everything?')
      expect.unreachable('guard should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError)
      expect((error as CLIError).code).toBe('CONFIRMATION_REQUIRED')
      expect((error as CLIError).suggestions.join(' ')).toContain('--force')
    }
  })

  it('prompts on an interactive TTY and returns the answer', async () => {
    setTTY(true, true)
    ;(confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    await expect(guardDestructive('Delete it?')).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith({ message: 'Delete it?', initialValue: false })
    ;(confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    await expect(guardDestructive('Delete it?')).resolves.toBe(false)
  })
})
