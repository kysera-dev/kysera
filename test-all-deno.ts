// Comprehensive Deno compatibility test
// Run with: deno run --allow-read --allow-env test-all-deno.ts

const packages = [
  'core', 'executor', 'dal', 'repository', 'soft-delete',
  'audit', 'timestamps', 'rls', 'debug', 'infra',
  'testing', 'migrations', 'dialects'
] as const

console.log('Testing Deno compatibility...\n')

const results: Array<{pkg: string, status: string, exports?: number, error?: string}> = []

for (const pkg of packages) {
  try {
    const mod = await import(`./packages/${pkg}/dist/index.js`)
    results.push({ pkg, status: 'OK', exports: Object.keys(mod).length })
  } catch (e) {
    results.push({ pkg, status: 'FAIL', error: (e as Error).message.split('\n')[0] })
  }
}

let failed = 0
for (const r of results) {
  const icon = r.status === 'OK' ? 'PASS' : 'FAIL'
  console.log(`[${icon}] @kysera/${r.pkg}${r.exports ? ` (${r.exports} exports)` : ''}`)
  if (r.error) { console.log(`   Error: ${r.error}`); failed++ }
}

// Test node:crypto functionality (cursor-crypto)
console.log('\n--- Runtime feature tests ---')
try {
  const { signCursor, verifyCursor } = await import('./packages/core/dist/cursor-crypto.js')
  const secret = 'deno-test-secret-key-32chars-ok!'
  const cursor = 'eyJpZCI6MTAwfQ=='
  const signed = signCursor(cursor, secret)
  const verified = verifyCursor(signed, secret)
  console.log(`[${verified === cursor ? 'PASS' : 'FAIL'}] node:crypto (cursor signing/verification)`)
} catch (e) {
  console.log(`[FAIL] node:crypto: ${(e as Error).message}`)
  failed++
}

// Test node:async_hooks (RLS context)
try {
  const { withRLSContext, rlsContext } = await import('./packages/rls/dist/index.js')
  console.log(`[PASS] node:async_hooks (RLS context loaded)`)
} catch (e) {
  console.log(`[FAIL] node:async_hooks: ${(e as Error).message}`)
  failed++
}

console.log(`\n${failed === 0 ? 'All checks passed!' : `${failed} check(s) failed.`}`)
Deno.exit(failed > 0 ? 1 : 0)
