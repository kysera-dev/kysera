/**
 * Thin layer over tinybench enforcing the determinism discipline:
 * fixed warmup iterations, fixed measured iterations (no wall-clock budget),
 * single-threaded sequential execution, hrtime-based timestamps, and
 * fail-fast on task errors.
 */
import { Bench } from 'tinybench'

export interface BenchShape {
  iterations: number
  warmupIterations: number
}

/** Fixed iteration counts per workload class (identical across variants). */
export const SHAPES = {
  compile: { iterations: 20_000, warmupIterations: 2_000 },
  execute: { iterations: 8_000, warmupIterations: 800 },
  repoRead: { iterations: 8_000, warmupIterations: 800 },
  repoWrite: { iterations: 3_000, warmupIterations: 300 },
  dal: { iterations: 8_000, warmupIterations: 800 },
  pagination: { iterations: 600, warmupIterations: 60 }
} as const satisfies Record<string, BenchShape>

export function createBench(name: string, shape: BenchShape): Bench {
  return new Bench({
    name,
    // time/warmupTime 0 => run exactly `iterations` per task, so every run
    // and every variant performs the same amount of work.
    time: 0,
    iterations: shape.iterations,
    warmup: true,
    warmupTime: 0,
    warmupIterations: shape.warmupIterations,
    throws: true,
    timestampProvider: 'hrtimeNow'
  })
}

export interface MeasuredTask {
  name: string
  opsPerSec: number
  medianUs: number
  p99Us: number
  samples: number
}

export interface SuiteTable {
  title: string
  /** One-line description of what exactly is measured. */
  caption: string
  /** Task name whose ops/sec is treated as 100 % in the relative column. */
  baseline: string
  tasks: MeasuredTask[]
  /** Honest interpretation, generated from the measured numbers. */
  notes: string[]
}

export async function runAndCollect(bench: Bench): Promise<MeasuredTask[]> {
  // Discarded first pass: tinybench runs tasks strictly sequentially, so the
  // first variant would otherwise pay one-time JIT/IC warmup of the shared
  // Kysely internals that later variants inherit for free. A full throwaway
  // pass puts every task in the same hot world before measurement.
  await bench.run()
  bench.reset()
  await bench.run()
  return bench.tasks.map(task => {
    const result = task.result
    if (result.state === 'errored') {
      throw new Error(`Benchmark task "${task.name}" failed: ${result.error.message}`, {
        cause: result.error
      })
    }
    if (result.state !== 'completed') {
      throw new Error(`Benchmark task "${task.name}" did not complete (state: ${result.state})`)
    }
    // ops/sec is derived from the median latency rather than mean throughput:
    // the median shrugs off GC pauses and background-load bursts that would
    // otherwise dominate a mean on µs-scale samples.
    const p50Ms = result.latency.p50
    return {
      name: task.name,
      opsPerSec: p50Ms > 0 ? 1000 / p50Ms : Number.POSITIVE_INFINITY,
      medianUs: p50Ms * 1000,
      p99Us: result.latency.p99 * 1000,
      samples: result.latency.samplesCount
    }
  })
}

export function findTask(tasks: MeasuredTask[], name: string): MeasuredTask {
  const task = tasks.find(t => t.name === name)
  if (!task) throw new Error(`No measured task named "${name}"`)
  return task
}

/** Percentage of baseline throughput, e.g. 87.3 means 12.7 % slower. */
export function relativePct(tasks: MeasuredTask[], baseline: string, name: string): number {
  return (findTask(tasks, name).opsPerSec / findTask(tasks, baseline).opsPerSec) * 100
}

/**
 * Render a relative percentage for prose, flagging values inside the ±5 %
 * band where run-order and GC noise on µs-scale ops exceeds real signal.
 */
export function pctPhrase(tasks: MeasuredTask[], baseline: string, name: string): string {
  const pct = relativePct(tasks, baseline, name)
  const formatted = `${pct.toFixed(1)} %`
  if (pct >= 95 && pct <= 105) return `${formatted} (within the ±5 % noise floor)`
  return formatted
}
