import { beforeAll, afterAll, vi } from 'vitest'

// Set test environment
process.env['NODE_ENV'] = 'test'

// Global mock for @xec-sh/kit to prevent "No export" errors
vi.mock('@xec-sh/kit', () => ({
  // log utility with all methods
  log: {
    message: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  },
  // prism color utilities
  prism: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
    grey: (s: string) => s,
    blue: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
    italic: (s: string) => s,
    underline: (s: string) => s,
    inverse: (s: string) => s,
    hidden: (s: string) => s,
    strikethrough: (s: string) => s,
    black: (s: string) => s,
    white: (s: string) => s,
    magenta: (s: string) => s,
    bgBlack: (s: string) => s,
    bgRed: (s: string) => s,
    bgGreen: (s: string) => s,
    bgYellow: (s: string) => s,
    bgBlue: (s: string) => s,
    bgMagenta: (s: string) => s,
    bgCyan: (s: string) => s,
    bgWhite: (s: string) => s
  },
  // strip ANSI codes
  strip: (s: string) => s.replace(/\[.*?\]/g, ''),
  // prompts
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  multiselect: vi.fn(),
  password: vi.fn(),
  selectKey: vi.fn(),
  autocomplete: vi.fn(),
  autocompleteMultiselect: vi.fn(),
  groupMultiselect: vi.fn(),
  // components
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: '',
    isCancelled: false
  })),
  table: vi.fn(() => ''),
  interactiveTable: vi.fn(),
  box: vi.fn((opts: any) => opts?.body || ''),
  note: vi.fn(),
  task: vi.fn(),
  taskLog: vi.fn(),
  progressBar: vi.fn(),
  // utilities
  group: vi.fn(),
  isCancel: vi.fn(() => false),
  block: vi.fn(),
  getRows: vi.fn(),
  getColumns: vi.fn(),
  settings: {},
  updateSettings: vi.fn()
}))

// Global test setup
beforeAll(() => {
  // Suppress console output during tests unless VERBOSE is set
  if (!process.env['VERBOSE']) {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Keep error output for debugging
    // vi.spyOn(console, 'error').mockImplementation(() => {});
  }
})

afterAll(() => {
  vi.restoreAllMocks()
})

// Global error handling for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})
