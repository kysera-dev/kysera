import { describe, it, expect } from 'vitest'
import { getPackageVersion, formatVersionString, isDevelopmentVersion, VERSION } from '../src/version.js'

describe('version utilities', () => {
  describe('getPackageVersion', () => {
    it('should return development version when __VERSION__ is not replaced', () => {
      const version = getPackageVersion()
      expect(version).toBe('0.0.0-dev')
    })

    it('should return a valid semver string', () => {
      const version = getPackageVersion()
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
    })
  })

  describe('formatVersionString', () => {
    it('should return version without prefix by default', () => {
      const formatted = formatVersionString()
      expect(formatted).toBe('0.0.0-dev')
    })

    it('should add prefix when provided', () => {
      const formatted = formatVersionString('v')
      expect(formatted).toBe('v0.0.0-dev')
    })

    it('should work with custom prefixes', () => {
      expect(formatVersionString('@kysera/core@')).toBe('@kysera/core@0.0.0-dev')
      expect(formatVersionString('version-')).toBe('version-0.0.0-dev')
    })

    it('should handle empty string prefix', () => {
      const formatted = formatVersionString('')
      expect(formatted).toBe('0.0.0-dev')
    })
  })

  describe('isDevelopmentVersion', () => {
    it('should return true for development builds', () => {
      const isDev = isDevelopmentVersion()
      expect(isDev).toBe(true)
    })

    it('should indicate unreplaced __VERSION__ marker', () => {
      // In test environment, __VERSION__ is not replaced
      expect(isDevelopmentVersion()).toBe(true)
    })
  })

  describe('VERSION constant', () => {
    it('should export VERSION constant', () => {
      expect(VERSION).toBeDefined()
      expect(typeof VERSION).toBe('string')
    })

    it('should match getPackageVersion() result', () => {
      expect(VERSION).toBe(getPackageVersion())
    })

    it('should be a valid version string', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
    })
  })

  describe('version consistency', () => {
    it('should have consistent results across multiple calls', () => {
      const v1 = getPackageVersion()
      const v2 = getPackageVersion()
      const v3 = VERSION

      expect(v1).toBe(v2)
      expect(v2).toBe(v3)
    })

    it('should maintain consistency with formatVersionString', () => {
      const version = getPackageVersion()
      const formatted = formatVersionString()

      expect(formatted).toBe(version)
    })
  })
})
