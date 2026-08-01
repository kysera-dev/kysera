/**
 * Test for M-8: Audit table creation race condition fix
 */

import { describe, it, expect, vi } from 'vitest'
import { auditPlugin } from '../src/index.js'

describe('M-8: Audit table creation race condition', () => {

  it('should handle concurrent plugin initialization without race conditions', async () => {
    let tableCreationCount = 0
    let checkCount = 0

    // Mock database that tracks table creation attempts
    const mockDb = {
      schema: {
        createTable: vi.fn(() => ({
          addColumn: vi.fn(() => ({
            addColumn: vi.fn(() => ({
              addColumn: vi.fn(() => ({
                addColumn: vi.fn(() => ({
                  addColumn: vi.fn(() => ({
                    addColumn: vi.fn(() => ({
                      addColumn: vi.fn(() => ({
                        addColumn: vi.fn(() => ({
                          addColumn: vi.fn(() => ({
                            execute: vi.fn(async () => {
                              tableCreationCount++
                              await new Promise(resolve => setTimeout(resolve, 10))
                            })
                          }))
                        }))
                      }))
                    }))
                  }))
                }))
              }))
            }))
          }))
        }))
      },
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => ({
            execute: vi.fn(async () => {
              checkCount++
              // First check throws (table doesn't exist)
              // After table creation, succeed
              if (tableCreationCount === 0) {
                throw new Error('Table does not exist')
              }
              return []
            })
          }))
        }))
      }))
    }

    // Create multiple audit plugins
    const plugins = Array.from({ length: 5 }, () =>
      auditPlugin({
        auditTable: 'audit_logs',
        tables: ['users']
      })
    )

    // Initialize all plugins concurrently
    const initPromises = plugins.map(plugin => {
      if (plugin.onInit) {
        return plugin.onInit(mockDb as any)
      }
      return Promise.resolve()
    })

    // All should complete successfully without errors
    await expect(Promise.all(initPromises)).resolves.not.toThrow()

    // Table should have been created exactly once (not 5 times)
    expect(tableCreationCount).toBe(1)
  })

  it('should handle rapid plugin reinitializations', async () => {
    let creationAttempts = 0

    const mockDb = {
      schema: {
        createTable: vi.fn(() => ({
          addColumn: vi.fn(() => ({
            addColumn: vi.fn(() => ({
              addColumn: vi.fn(() => ({
                addColumn: vi.fn(() => ({
                  addColumn: vi.fn(() => ({
                    addColumn: vi.fn(() => ({
                      addColumn: vi.fn(() => ({
                        addColumn: vi.fn(() => ({
                          addColumn: vi.fn(() => ({
                            execute: vi.fn(async () => {
                              creationAttempts++
                            })
                          }))
                        }))
                      }))
                    }))
                  }))
                }))
              }))
            }))
          }))
        }))
      },
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => ({
            execute: vi.fn(async () => {
              if (creationAttempts === 0) {
                throw new Error('Table does not exist')
              }
              return []
            })
          }))
        }))
      }))
    }

    const plugin = auditPlugin({
      auditTable: 'audit_logs',
      tables: ['users']
    })

    // Initialize plugin multiple times rapidly
    const initPromises = Array.from({ length: 10 }, () => {
      if (plugin.onInit) {
        return plugin.onInit(mockDb as any)
      }
      return Promise.resolve()
    })

    await expect(Promise.all(initPromises)).resolves.not.toThrow()

    // Should only create table once despite 10 init calls
    expect(creationAttempts).toBe(1)
  })

  it('should allow proper cleanup with onDestroy', async () => {
    const mockDb = {
      schema: {
        createTable: vi.fn(() => ({
          addColumn: vi.fn(() => ({
            addColumn: vi.fn(() => ({
              addColumn: vi.fn(() => ({
                addColumn: vi.fn(() => ({
                  addColumn: vi.fn(() => ({
                    addColumn: vi.fn(() => ({
                      addColumn: vi.fn(() => ({
                        addColumn: vi.fn(() => ({
                          addColumn: vi.fn(() => ({
                            execute: vi.fn(async () => {})
                          }))
                        }))
                      }))
                    }))
                  }))
                }))
              }))
            }))
          }))
        }))
      },
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => ({
            execute: vi.fn(async () => {
              throw new Error('Table does not exist')
            })
          }))
        }))
      }))
    }

    const plugin = auditPlugin({
      auditTable: 'audit_logs',
      tables: ['users']
    })

    // Initialize
    if (plugin.onInit) {
      await plugin.onInit(mockDb as any)
    }

    // Destroy should cleanup locks
    if (plugin.onDestroy) {
      expect(() => plugin.onDestroy!()).not.toThrow()
    }

    // Should be able to reinitialize safely
    if (plugin.onInit) {
      await expect(plugin.onInit(mockDb as any)).resolves.not.toThrow()
    }
  })

  it('should retry table creation after a transient failure instead of caching the rejection', async () => {
    let createAttempts = 0
    let failNext = true

    // Chainable table builder whose execute() fails exactly once
    const tableBuilder: any = {
      addColumn: () => tableBuilder,
      execute: async () => {
        createAttempts++
        if (failNext) {
          failNext = false
          throw new Error('transient DDL failure')
        }
      }
    }

    const mockDb = {
      schema: { createTable: () => tableBuilder },
      selectFrom: () => ({
        select: () => ({
          limit: () => ({
            execute: async () => {
              throw new Error('Table does not exist')
            }
          })
        })
      })
    }

    const plugin = auditPlugin({ auditTable: 'audit_logs', tables: ['users'] })

    // First initialization fails with the transient error...
    await expect(plugin.onInit!(mockDb as any)).rejects.toThrow('transient DDL failure')

    // ...but the failure must not be cached: the same executor retries and succeeds
    await expect(plugin.onInit!(mockDb as any)).resolves.toBeUndefined()
    expect(createAttempts).toBe(2)
  })

  it('should share one creation attempt between concurrent calls even when it fails', async () => {
    let createAttempts = 0

    const tableBuilder: any = {
      addColumn: () => tableBuilder,
      execute: async () => {
        createAttempts++
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('always failing DDL')
      }
    }

    const mockDb = {
      schema: { createTable: () => tableBuilder },
      selectFrom: () => ({
        select: () => ({
          limit: () => ({
            execute: async () => {
              throw new Error('Table does not exist')
            }
          })
        })
      })
    }

    const plugin = auditPlugin({ auditTable: 'audit_logs', tables: ['users'] })

    // Concurrent initializations share the single in-flight attempt (and its rejection)
    const results = await Promise.allSettled([
      plugin.onInit!(mockDb as any),
      plugin.onInit!(mockDb as any),
      plugin.onInit!(mockDb as any)
    ])

    expect(results.every(r => r.status === 'rejected')).toBe(true)
    expect(createAttempts).toBe(1)

    // After the shared failure settles, a fresh call starts a new attempt
    await expect(plugin.onInit!(mockDb as any)).rejects.toThrow('always failing DDL')
    expect(createAttempts).toBe(2)
  })
})
