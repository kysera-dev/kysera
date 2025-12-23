/**
 * Tests for factory utilities.
 */

import { describe, it, expect } from 'vitest'
import { createFactory, createMany, createSequenceFactory } from '../src/factories.js'

describe('createFactory', () => {
  it('should create instance with default values', () => {
    const createUser = createFactory({
      name: 'Test User',
      email: 'test@example.com',
      role: 'user'
    })

    const user = createUser()

    expect(user.name).toBe('Test User')
    expect(user.email).toBe('test@example.com')
    expect(user.role).toBe('user')
  })

  it('should allow overriding default values', () => {
    const createUser = createFactory({
      name: 'Test User',
      email: 'test@example.com',
      role: 'user'
    })

    const admin = createUser({ role: 'admin', name: 'Admin User' })

    expect(admin.name).toBe('Admin User')
    expect(admin.email).toBe('test@example.com')
    expect(admin.role).toBe('admin')
  })

  it('should call function defaults on each invocation', () => {
    let counter = 0
    const createUser = createFactory({
      id: () => ++counter,
      name: 'Test User'
    })

    const user1 = createUser()
    const user2 = createUser()

    expect(user1.id).toBe(1)
    expect(user2.id).toBe(2)
  })

  it('should support dynamic email generation', () => {
    let counter = 0
    const createUser = createFactory({
      email: () => `user-${Date.now()}-${++counter}@example.com`,
      name: 'Test User'
    })

    const user1 = createUser()
    const user2 = createUser()

    expect(user1.email).toMatch(/^user-\d+-\d+@example\.com$/)
    expect(user2.email).toMatch(/^user-\d+-\d+@example\.com$/)
    expect(user1.email).not.toBe(user2.email)
  })
})

describe('createMany', () => {
  it('should create multiple instances', () => {
    const createUser = createFactory({
      name: 'Test User',
      email: 'test@example.com'
    })

    const users = createMany(createUser, 5)

    expect(users).toHaveLength(5)
    users.forEach(user => {
      expect(user.name).toBe('Test User')
    })
  })

  it('should apply overrides function', () => {
    const createUser = createFactory({
      name: 'Test User',
      email: 'test@example.com'
    })

    const users = createMany(createUser, 3, i => ({
      name: `User ${i + 1}`
    }))

    expect(users[0]?.name).toBe('User 1')
    expect(users[1]?.name).toBe('User 2')
    expect(users[2]?.name).toBe('User 3')
  })
})

describe('createSequenceFactory', () => {
  it('should provide sequence number to defaults', () => {
    const createUser = createSequenceFactory(seq => ({
      id: seq,
      email: `user-${seq}@example.com`,
      name: `User ${seq}`
    }))

    const user1 = createUser()
    const user2 = createUser()
    const user3 = createUser()

    expect(user1.id).toBe(1)
    expect(user1.email).toBe('user-1@example.com')

    expect(user2.id).toBe(2)
    expect(user2.email).toBe('user-2@example.com')

    expect(user3.id).toBe(3)
    expect(user3.email).toBe('user-3@example.com')
  })

  it('should allow overriding sequence-generated values', () => {
    const createUser = createSequenceFactory(seq => ({
      id: seq,
      name: `User ${seq}`
    }))

    const user = createUser({ name: 'Custom Name' })

    expect(user.id).toBe(1)
    expect(user.name).toBe('Custom Name')
  })
})
