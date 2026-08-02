/**
 * Convert snake_case string to camelCase
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/**
 * Convert snake_case string to PascalCase
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * Convert snake_case string to kebab-case
 */
export function toKebabCase(str: string): string {
  return str.replace(/_/g, '-').toLowerCase()
}
