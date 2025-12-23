/**
 * Tests for CircularBuffer utility.
 */

import { describe, it, expect } from 'vitest'
import { CircularBuffer } from '../src/circular-buffer.js'

describe('CircularBuffer', () => {
  describe('constructor', () => {
    it('should create buffer with specified size', () => {
      const buffer = new CircularBuffer<number>(5)
      expect(buffer.capacity).toBe(5)
      expect(buffer.size).toBe(0)
      expect(buffer.isEmpty).toBe(true)
      expect(buffer.isFull).toBe(false)
    })

    it('should throw error for non-positive size', () => {
      expect(() => new CircularBuffer<number>(0)).toThrow(
        'CircularBuffer maxSize must be positive'
      )
      expect(() => new CircularBuffer<number>(-1)).toThrow(
        'CircularBuffer maxSize must be positive'
      )
    })
  })

  describe('add', () => {
    it('should add items when buffer is not full', () => {
      const buffer = new CircularBuffer<number>(3)

      buffer.add(1)
      expect(buffer.size).toBe(1)
      expect(buffer.isEmpty).toBe(false)
      expect(buffer.isFull).toBe(false)

      buffer.add(2)
      expect(buffer.size).toBe(2)

      buffer.add(3)
      expect(buffer.size).toBe(3)
      expect(buffer.isFull).toBe(true)
    })

    it('should overwrite oldest item when buffer is full', () => {
      const buffer = new CircularBuffer<number>(3)

      buffer.add(1)
      buffer.add(2)
      buffer.add(3)
      expect(buffer.getOrdered()).toEqual([1, 2, 3])

      buffer.add(4) // Overwrites 1
      expect(buffer.size).toBe(3)
      expect(buffer.getOrdered()).toEqual([2, 3, 4])

      buffer.add(5) // Overwrites 2
      expect(buffer.getOrdered()).toEqual([3, 4, 5])
    })

    it('should handle multiple wraps around', () => {
      const buffer = new CircularBuffer<number>(3)

      // Fill buffer
      buffer.add(1)
      buffer.add(2)
      buffer.add(3)

      // Multiple overwrites
      buffer.add(4)
      buffer.add(5)
      buffer.add(6)
      buffer.add(7)

      expect(buffer.getOrdered()).toEqual([5, 6, 7])
    })
  })

  describe('getOrdered', () => {
    it('should return items in chronological order when not full', () => {
      const buffer = new CircularBuffer<string>(5)

      buffer.add('a')
      buffer.add('b')
      buffer.add('c')

      expect(buffer.getOrdered()).toEqual(['a', 'b', 'c'])
    })

    it('should return items in chronological order when full', () => {
      const buffer = new CircularBuffer<string>(3)

      buffer.add('a')
      buffer.add('b')
      buffer.add('c')
      buffer.add('d') // Overwrites 'a'
      buffer.add('e') // Overwrites 'b'

      expect(buffer.getOrdered()).toEqual(['c', 'd', 'e'])
    })

    it('should return empty array for empty buffer', () => {
      const buffer = new CircularBuffer<number>(5)
      expect(buffer.getOrdered()).toEqual([])
    })

    it('should not mutate original buffer', () => {
      const buffer = new CircularBuffer<number>(3)
      buffer.add(1)
      buffer.add(2)

      const ordered = buffer.getOrdered()
      ordered.push(99)

      expect(buffer.getOrdered()).toEqual([1, 2])
    })
  })

  describe('getRaw', () => {
    it('should return items in storage order', () => {
      const buffer = new CircularBuffer<number>(3)

      buffer.add(1)
      buffer.add(2)
      buffer.add(3)
      buffer.add(4) // Storage: [4, 2, 3]

      const raw = buffer.getRaw()
      expect(raw).toEqual([4, 2, 3])
    })
  })

  describe('clear', () => {
    it('should remove all items', () => {
      const buffer = new CircularBuffer<number>(3)

      buffer.add(1)
      buffer.add(2)
      buffer.add(3)

      buffer.clear()

      expect(buffer.size).toBe(0)
      expect(buffer.isEmpty).toBe(true)
      expect(buffer.isFull).toBe(false)
      expect(buffer.getOrdered()).toEqual([])
    })

    it('should allow adding after clear', () => {
      const buffer = new CircularBuffer<number>(3)

      buffer.add(1)
      buffer.add(2)
      buffer.clear()

      buffer.add(3)
      buffer.add(4)

      expect(buffer.getOrdered()).toEqual([3, 4])
    })
  })

  describe('properties', () => {
    it('should track size correctly', () => {
      const buffer = new CircularBuffer<number>(5)

      expect(buffer.size).toBe(0)

      buffer.add(1)
      expect(buffer.size).toBe(1)

      buffer.add(2)
      buffer.add(3)
      expect(buffer.size).toBe(3)

      buffer.clear()
      expect(buffer.size).toBe(0)
    })

    it('should report isEmpty correctly', () => {
      const buffer = new CircularBuffer<number>(3)

      expect(buffer.isEmpty).toBe(true)

      buffer.add(1)
      expect(buffer.isEmpty).toBe(false)

      buffer.clear()
      expect(buffer.isEmpty).toBe(true)
    })

    it('should report isFull correctly', () => {
      const buffer = new CircularBuffer<number>(2)

      expect(buffer.isFull).toBe(false)

      buffer.add(1)
      expect(buffer.isFull).toBe(false)

      buffer.add(2)
      expect(buffer.isFull).toBe(true)

      buffer.add(3)
      expect(buffer.isFull).toBe(true)
    })
  })

  describe('complex data types', () => {
    it('should handle objects', () => {
      interface Item {
        id: number
        name: string
      }

      const buffer = new CircularBuffer<Item>(3)

      buffer.add({ id: 1, name: 'Alice' })
      buffer.add({ id: 2, name: 'Bob' })
      buffer.add({ id: 3, name: 'Charlie' })

      expect(buffer.getOrdered()).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' }
      ])
    })

    it('should handle null and undefined', () => {
      const buffer = new CircularBuffer<string | null | undefined>(3)

      buffer.add('value')
      buffer.add(null)
      buffer.add(undefined)

      expect(buffer.getOrdered()).toEqual(['value', null, undefined])
    })
  })

  describe('edge cases', () => {
    it('should handle single-item buffer', () => {
      const buffer = new CircularBuffer<number>(1)

      buffer.add(1)
      expect(buffer.getOrdered()).toEqual([1])

      buffer.add(2)
      expect(buffer.getOrdered()).toEqual([2])

      buffer.add(3)
      expect(buffer.getOrdered()).toEqual([3])
    })

    it('should handle large buffer', () => {
      const buffer = new CircularBuffer<number>(1000)

      for (let i = 0; i < 1500; i++) {
        buffer.add(i)
      }

      expect(buffer.size).toBe(1000)
      expect(buffer.isFull).toBe(true)

      const ordered = buffer.getOrdered()
      expect(ordered).toHaveLength(1000)
      expect(ordered[0]).toBe(500) // First item should be 500 (oldest)
      expect(ordered[999]).toBe(1499) // Last item should be 1499 (newest)
    })
  })
})
