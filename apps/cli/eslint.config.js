import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/**
 * CLI lint profile: the root config ignores apps/** entirely, so this file
 * is the CLI's real gate (run from apps/cli). Terminal tooling ground rules:
 * console IS the interface and command orchestration runs long — those
 * rules are relaxed. Type-safety rules stay at package strictness.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,
  {
    ignores: ['dist/**', 'node_modules/**', 'tests/**', 'scripts/**', 'tsup.config.ts', 'vitest.config.ts', 'eslint.config.js']
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      'no-console': 'off',
      complexity: 'off',
      'max-depth': 'off',
      'max-lines-per-function': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true }
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error'
    }
  }
)
