/**
 * Raw version string injected at build time
 * @internal
 */
declare const __VERSION__: string

const RAW_VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '__VERSION__'

/**
 * Get the current package version.
 * Returns the version injected at build time, or '0.0.0-dev' in development.
 *
 * @returns The package version string
 *
 * @example
 * ```typescript
 * import { getPackageVersion } from '@kysera/core'
 *
 * const version = getPackageVersion()
 * // Production: '0.8.0'
 * // Development: '0.0.0-dev'
 * ```
 */
export function getPackageVersion(): string {
  return RAW_VERSION.startsWith('__') ? '0.0.0-dev' : RAW_VERSION
}

/**
 * Format a version string with an optional prefix.
 *
 * @param prefix - Optional prefix to prepend to the version (default: '')
 * @returns Formatted version string
 *
 * @example
 * ```typescript
 * import { formatVersionString } from '@kysera/core'
 *
 * formatVersionString()        // '0.8.0'
 * formatVersionString('v')     // 'v0.8.0'
 * formatVersionString('@kysera/core@') // '@kysera/core@0.8.0'
 * ```
 */
export function formatVersionString(prefix = ''): string {
  return `${prefix}${getPackageVersion()}`
}

/**
 * Check if the package is running in development mode.
 *
 * @returns true if running in development (version not injected), false otherwise
 *
 * @example
 * ```typescript
 * import { isDevelopmentVersion } from '@kysera/core'
 *
 * if (isDevelopmentVersion()) {
 *   console.log('Running in development mode')
 * }
 * ```
 */
export function isDevelopmentVersion(): boolean {
  return RAW_VERSION.startsWith('__')
}

/**
 * The current package version.
 * Convenience export for direct access to the version string.
 *
 * @example
 * ```typescript
 * import { VERSION } from '@kysera/core'
 *
 * console.log(`Kysera Core v${VERSION}`)
 * ```
 */
export const VERSION = getPackageVersion()
