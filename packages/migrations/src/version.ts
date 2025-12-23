/**
 * Package version - injected at build time by tsup
 * Falls back to '0.0.0-dev' if placeholder is not replaced
 * @internal
 */
const RAW_VERSION = '__VERSION__'
export const VERSION = RAW_VERSION.startsWith('__') ? '0.0.0-dev' : RAW_VERSION
