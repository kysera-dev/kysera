import { spinner as createSpinner, prism } from '@xec-sh/kit';
import { EventEmitter } from 'node:events';

export interface ProgressOptions {
  total?: number;
  showPercentage?: boolean;
  showETA?: boolean;
  showSpeed?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

export interface ProgressUpdate {
  current: number;
  total?: number;
  message?: string;
  details?: string;
}

/**
 * Progress tracker for long-running operations
 */
export class ProgressTracker extends EventEmitter {
  private current = 0;
  private total: number;
  private startTime: number;
  private spinner: ReturnType<typeof createSpinner>;
  private lastUpdate = 0;
  private options: ProgressOptions;
  private isActive = false;

  constructor(message: string, options: ProgressOptions = {}) {
    super();
    this.options = {
      showPercentage: true,
      showETA: true,
      showSpeed: false,
      verbose: false,
      quiet: false,
      ...options,
    };
    this.total = options.total || 100;
    this.startTime = Date.now();
    this.spinner = createSpinner();

    if (!this.options.quiet) {
      this.start(message);
    }
  }

  /**
   * Start progress tracking
   */
  start(message: string): void {
    if (this.options.quiet) return;

    this.isActive = true;
    this.startTime = Date.now();
    this.current = 0;
    this.spinner.start(this.formatMessage(message));
    this.emit('start', { message });
  }

  /**
   * Update progress
   */
  update(update: ProgressUpdate | number): void {
    if (this.options.quiet) return;

    if (typeof update === 'number') {
      this.current = update;
    } else {
      this.current = update.current;
      if (update.total) this.total = update.total;
    }

    const now = Date.now();
    if (now - this.lastUpdate < 100 && this.current < this.total) {
      return; // Throttle updates to max 10/second
    }
    this.lastUpdate = now;

    const message = typeof update === 'object' ? update.message : undefined;
    const details = typeof update === 'object' ? update.details : undefined;

    if (this.isActive) {
      this.spinner.message(this.formatMessage(message, details));
      this.emit('progress', {
        current: this.current,
        total: this.total,
        percentage: this.getPercentage(),
      });
    }
  }

  /**
   * Increment progress by amount
   */
  increment(amount = 1, message?: string): void {
    this.update({
      current: Math.min(this.current + amount, this.total),
      message,
    });
  }

  /**
   * Complete the progress
   */
  complete(message?: string): void {
    if (this.options.quiet) return;

    this.current = this.total;
    this.isActive = false;
    this.spinner.stop();

    const duration = this.getDuration();
    const finalMessage = message || 'Complete';

    console.log(prism.green('✓') + ' ' + finalMessage + ' ' + prism.gray(`(${this.formatDuration(duration)})`));

    this.emit('complete', { duration });
  }

  /**
   * Fail the progress
   */
  fail(message?: string): void {
    if (this.options.quiet) return;

    this.isActive = false;
    this.spinner.stop();

    const finalMessage = message || 'Failed';
    console.log(prism.red('✗') + ' ' + finalMessage);

    this.emit('fail', { message });
  }

  /**
   * Format progress message
   */
  private formatMessage(message?: string, details?: string): string {
    const parts = [];

    if (message) {
      parts.push(message);
    }

    if (this.options.showPercentage && this.total > 0) {
      parts.push(`[${this.getPercentage()}%]`);
    }

    if (this.options.showETA && this.current > 0 && this.current < this.total) {
      const eta = this.getETA();
      if (eta !== null) {
        parts.push(`ETA: ${this.formatDuration(eta)}`);
      }
    }

    if (this.options.showSpeed && this.current > 0) {
      const speed = this.getSpeed();
      parts.push(`${speed.toFixed(1)}/s`);
    }

    if (this.options.verbose && details) {
      parts.push(prism.gray(details));
    }

    return parts.join(' ');
  }

  /**
   * Get completion percentage
   */
  private getPercentage(): number {
    if (this.total === 0) return 0;
    return Math.round((this.current / this.total) * 100);
  }

  /**
   * Get estimated time to completion in ms
   */
  private getETA(): number | null {
    if (this.current === 0) return null;

    const elapsed = Date.now() - this.startTime;
    const rate = this.current / elapsed;
    const remaining = this.total - this.current;

    if (rate === 0) return null;
    return remaining / rate;
  }

  /**
   * Get processing speed (items per second)
   */
  private getSpeed(): number {
    const elapsed = (Date.now() - this.startTime) / 1000;
    if (elapsed === 0) return 0;
    return this.current / elapsed;
  }

  /**
   * Get elapsed duration in ms
   */
  private getDuration(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else if (seconds > 5) {
      return `${seconds}s`;
    } else {
      return `${ms}ms`;
    }
  }
}

/**
 * Progress bar for batch operations
 */
export class BatchProgress {
  private trackers: Map<string, ProgressTracker> = new Map();
  private options: ProgressOptions;

  constructor(options: ProgressOptions = {}) {
    this.options = options;
  }

  /**
   * Add a new task
   */
  addTask(id: string, message: string, total?: number): ProgressTracker {
    const tracker = new ProgressTracker(message, {
      ...this.options,
      total,
    });
    this.trackers.set(id, tracker);
    return tracker;
  }

  /**
   * Get a task tracker
   */
  getTask(id: string): ProgressTracker | undefined {
    return this.trackers.get(id);
  }

  /**
   * Update task progress
   */
  updateTask(id: string, update: ProgressUpdate | number): void {
    const tracker = this.trackers.get(id);
    if (tracker) {
      tracker.update(update);
    }
  }

  /**
   * Complete a task
   */
  completeTask(id: string, message?: string): void {
    const tracker = this.trackers.get(id);
    if (tracker) {
      tracker.complete(message);
      this.trackers.delete(id);
    }
  }

  /**
   * Fail a task
   */
  failTask(id: string, message?: string): void {
    const tracker = this.trackers.get(id);
    if (tracker) {
      tracker.fail(message);
      this.trackers.delete(id);
    }
  }

  /**
   * Complete all tasks
   */
  completeAll(message?: string): void {
    this.trackers.forEach((tracker) => {
      tracker.complete(message);
    });
    this.trackers.clear();
  }

  /**
   * Get overall progress
   */
  getOverallProgress(): { current: number; total: number; percentage: number } {
    let current = 0;
    let total = 0;

    this.trackers.forEach((tracker) => {
      current += (tracker as any).current;
      total += (tracker as any).total;
    });

    return {
      current,
      total,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
    };
  }
}

/**
 * Simple progress indicator for determinate operations
 */
export function withProgress<T>(
  message: string,
  operation: (progress: ProgressTracker) => Promise<T>,
  options: ProgressOptions = {}
): Promise<T> {
  const progress = new ProgressTracker(message, options);

  return operation(progress)
    .then((result) => {
      progress.complete();
      return result;
    })
    .catch((error) => {
      progress.fail();
      throw error;
    });
}

/**
 * Progress indicator for array operations
 */
export async function mapWithProgress<T, R>(
  items: T[],
  message: string,
  mapper: (item: T, index: number) => Promise<R>,
  options: ProgressOptions = {}
): Promise<R[]> {
  const progress = new ProgressTracker(message, {
    ...options,
    total: items.length,
  });

  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      const result = await mapper(items[i], i);
      results.push(result);
      progress.increment(1);
    } catch (error) {
      progress.fail(`Failed at item ${i + 1}`);
      throw error;
    }
  }

  progress.complete(`Processed ${items.length} items`);
  return results;
}

/**
 * Progress indicator for batch operations
 */
export async function batchWithProgress<T, R>(
  items: T[],
  message: string,
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>,
  options: ProgressOptions = {}
): Promise<R[]> {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const progress = new ProgressTracker(message, {
    ...options,
    total: batches.length,
  });

  const results: R[] = [];

  for (const batch of batches) {
    try {
      const batchResults = await processor(batch);
      results.push(...batchResults);
      progress.increment(1, `Processed batch (${results.length}/${items.length} items)`);
    } catch (error) {
      progress.fail();
      throw error;
    }
  }

  progress.complete(`Processed ${items.length} items in ${batches.length} batches`);
  return results;
}
