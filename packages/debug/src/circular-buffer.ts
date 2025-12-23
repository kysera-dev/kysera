/**
 * Circular buffer utility for bounded memory usage.
 *
 * @module @kysera/debug
 */

/**
 * Circular buffer with O(1) operations.
 *
 * Maintains a fixed-size buffer where oldest entries are overwritten
 * when capacity is reached. Provides efficient add and retrieval
 * operations without reallocation.
 *
 * @template T - Type of items stored in buffer
 *
 * @example
 * ```typescript
 * const buffer = new CircularBuffer<number>(3);
 *
 * buffer.add(1);
 * buffer.add(2);
 * buffer.add(3);
 * buffer.add(4); // Overwrites oldest (1)
 *
 * const items = buffer.getOrdered(); // [2, 3, 4]
 * console.log(buffer.size); // 3
 * ```
 */
export class CircularBuffer<T> {
  private items: T[] = []
  private writeIndex = 0
  private readonly maxSize: number

  /**
   * Create a new circular buffer.
   *
   * @param maxSize - Maximum number of items to store
   */
  constructor(maxSize: number) {
    if (maxSize <= 0) {
      throw new Error('CircularBuffer maxSize must be positive')
    }
    this.maxSize = maxSize
  }

  /**
   * Add an item to the buffer.
   *
   * Uses O(1) operation. When buffer is full, overwrites oldest entry.
   *
   * @param item - Item to add
   */
  add(item: T): void {
    if (this.items.length < this.maxSize) {
      this.items.push(item)
    } else {
      this.items[this.writeIndex % this.maxSize] = item
    }
    this.writeIndex++
  }

  /**
   * Get all items in chronological order.
   *
   * Returns items from oldest to newest. Handles buffer wrap-around correctly.
   *
   * @returns Array of items in chronological order
   */
  getOrdered(): T[] {
    if (this.items.length < this.maxSize) {
      return [...this.items]
    }
    // Buffer is full, reconstruct chronological order
    const start = this.writeIndex % this.maxSize
    return [...this.items.slice(start), ...this.items.slice(0, start)]
  }

  /**
   * Get all items in storage order (not chronological).
   *
   * @returns Array of items in storage order
   */
  getRaw(): T[] {
    return [...this.items]
  }

  /**
   * Clear all items from buffer.
   */
  clear(): void {
    this.items = []
    this.writeIndex = 0
  }

  /**
   * Get current number of items in buffer.
   */
  get size(): number {
    return this.items.length
  }

  /**
   * Get maximum capacity of buffer.
   */
  get capacity(): number {
    return this.maxSize
  }

  /**
   * Check if buffer is full.
   */
  get isFull(): boolean {
    return this.items.length >= this.maxSize
  }

  /**
   * Check if buffer is empty.
   */
  get isEmpty(): boolean {
    return this.items.length === 0
  }
}
