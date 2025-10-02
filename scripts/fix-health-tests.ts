#!/usr/bin/env tsx

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Fix health test files to match the actual checkDatabaseHealth return structure
 */
async function fixHealthTests() {
  const testFiles = [
    'packages/core/test/health-real.test.ts',
    'packages/core/test/multi-db.test.ts'
  ]

  for (const file of testFiles) {
    const filePath = path.resolve(file)
    let content = await fs.readFile(filePath, 'utf-8')

    // Replace old structure with new structure
    const replacements = [
      // Replace .checks.database.connected
      {
        from: /result\.checks\.database\.connected/g,
        to: 'result.checks[0]?.status === \'healthy\''
      },
      {
        from: /health\.checks\.database\.connected/g,
        to: 'health.checks[0]?.status === \'healthy\''
      },
      // Replace .checks.database.latency for comparisons
      {
        from: /result\.checks\.database\.latency/g,
        to: 'result.metrics?.checkLatency'
      },
      {
        from: /health\.checks\.database\.latency/g,
        to: 'health.metrics?.checkLatency'
      },
      // Replace .checks.database.error
      {
        from: /result\.checks\.database\.error/g,
        to: 'result.checks[0]?.message'
      },
      {
        from: /health\.checks\.database\.error/g,
        to: 'health.checks[0]?.message'
      },
      // Replace .checks.pool
      {
        from: /result\.checks\.pool/g,
        to: 'result.metrics?.poolMetrics'
      },
      {
        from: /health\.checks\.pool/g,
        to: 'health.metrics?.poolMetrics'
      }
    ]

    for (const { from, to } of replacements) {
      content = content.replace(from, to)
    }

    // Fix specific assertions that need different handling
    content = content.replace(
      /expect\((.+?)\.checks\[0\]\?\.status === 'healthy'\)\.toBe\(true\)/g,
      'expect($1.checks[0]?.status).toBe(\'healthy\')'
    )
    content = content.replace(
      /expect\((.+?)\.checks\[0\]\?\.status === 'healthy'\)\.toBe\(false\)/g,
      'expect($1.checks[0]?.status).toBe(\'unhealthy\')'
    )

    await fs.writeFile(filePath, content, 'utf-8')
    console.log(`Fixed: ${file}`)
  }
}

fixHealthTests().catch(console.error)