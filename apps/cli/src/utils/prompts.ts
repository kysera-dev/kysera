import prompts from 'prompts'
import chalk from 'chalk'
import figures from 'figures'

// Configure prompts globally
prompts.override(process.argv)

export interface PromptOptions {
  onCancel?: () => void
}

/**
 * Text input prompt
 */
export async function text(
  message: string,
  initial?: string,
  options: PromptOptions = {}
): Promise<string> {
  const result = await prompts(
    {
      type: 'text',
      name: 'value',
      message,
      initial
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * Password input prompt
 */
export async function password(
  message: string,
  options: PromptOptions = {}
): Promise<string> {
  const result = await prompts(
    {
      type: 'password',
      name: 'value',
      message
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * Confirmation prompt
 */
export async function confirm(
  message: string,
  initial: boolean = false,
  options: PromptOptions = {}
): Promise<boolean> {
  const result = await prompts(
    {
      type: 'confirm',
      name: 'value',
      message,
      initial
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * Select prompt (single choice)
 */
export async function select<T extends string>(
  message: string,
  choices: Array<{ title: string; value: T; description?: string }>,
  initial?: number,
  options: PromptOptions = {}
): Promise<T> {
  const result = await prompts(
    {
      type: 'select',
      name: 'value',
      message,
      choices,
      initial
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * Multi-select prompt
 */
export async function multiselect<T extends string>(
  message: string,
  choices: Array<{ title: string; value: T; selected?: boolean }>,
  options: PromptOptions = {}
): Promise<T[]> {
  const result = await prompts(
    {
      type: 'multiselect',
      name: 'value',
      message,
      choices,
      instructions: chalk.gray('Space to select, Enter to confirm')
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value || []
}

/**
 * Number input prompt
 */
export async function number(
  message: string,
  initial?: number,
  min?: number,
  max?: number,
  options: PromptOptions = {}
): Promise<number> {
  const result = await prompts(
    {
      type: 'number',
      name: 'value',
      message,
      initial,
      min,
      max
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * Autocomplete prompt
 */
export async function autocomplete(
  message: string,
  choices: Array<{ title: string; value: string }>,
  initial?: string,
  options: PromptOptions = {}
): Promise<string> {
  const result = await prompts(
    {
      type: 'autocomplete',
      name: 'value',
      message,
      choices,
      initial,
      suggest: async (input: string) => {
        return choices.filter(choice =>
          choice.title.toLowerCase().includes(input.toLowerCase())
        )
      }
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * Date prompt
 */
export async function date(
  message: string,
  initial?: Date,
  options: PromptOptions = {}
): Promise<Date> {
  const result = await prompts(
    {
      type: 'date',
      name: 'value',
      message,
      initial
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * List prompt (comma-separated values)
 */
export async function list(
  message: string,
  separator: string = ',',
  options: PromptOptions = {}
): Promise<string[]> {
  const result = await prompts(
    {
      type: 'list',
      name: 'value',
      message,
      separator
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value || []
}

/**
 * Toggle prompt
 */
export async function toggle(
  message: string,
  active: string = 'yes',
  inactive: string = 'no',
  initial: boolean = false,
  options: PromptOptions = {}
): Promise<boolean> {
  const result = await prompts(
    {
      type: 'toggle',
      name: 'value',
      message,
      active,
      inactive,
      initial
    },
    {
      onCancel: options.onCancel || (() => {
        process.exit(1)
      })
    }
  )
  return result.value
}

/**
 * Show a warning prompt
 */
export async function warning(
  message: string,
  confirmText: string = 'Continue anyway?'
): Promise<boolean> {
  console.log(chalk.yellow(`${figures.warning} ${message}`))
  return confirm(confirmText, false)
}

/**
 * Show a danger prompt (for destructive actions)
 */
export async function danger(
  message: string,
  confirmText: string = 'Are you absolutely sure?'
): Promise<boolean> {
  console.log(chalk.red(`${figures.cross} ${message}`))
  console.log(chalk.red('This action cannot be undone!'))
  const first = await confirm(confirmText, false)
  if (first) {
    return confirm('Please confirm once more', false)
  }
  return false
}

/**
 * Create a wizard (multi-step prompt)
 */
export async function wizard<T>(
  steps: Array<() => Promise<Partial<T>>>
): Promise<T> {
  const result: Partial<T> = {}

  for (const step of steps) {
    const stepResult = await step()
    Object.assign(result, stepResult)
  }

  return result as T
}