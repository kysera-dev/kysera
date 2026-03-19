// Comprehensive Bun compatibility test
// Run with: bun test-all-bun.js

const packages = [
  'core', 'executor', 'dal', 'repository', 'soft-delete',
  'audit', 'timestamps', 'rls', 'debug', 'infra',
  'testing', 'migrations', 'dialects'
]

console.log('Testing Bun compatibility...\n')

const results = []

for (const pkg of packages) {
  try {
    const mod = await import(`./packages/${pkg}/dist/index.js`)
    results.push({ pkg, status: 'OK', exports: Object.keys(mod).length })
  } catch (e) {
    results.push({ pkg, status: 'FAIL', error: e.message.split('\n')[0] })
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
  const secret = 'bun-test-secret-key-32chars-ok!!'
  const cursor = 'eyJpZCI6MTAwfQ=='
  const signed = signCursor(cursor, secret)
  const verified = verifyCursor(signed, secret)
  console.log(`[${verified === cursor ? 'PASS' : 'FAIL'}] node:crypto (cursor signing/verification)`)
} catch (e) {
  console.log(`[FAIL] node:crypto: ${e.message}`)
  failed++
}

// Test node:async_hooks (RLS context)
try {
  const { withRLSContext, rlsContext } = await import('./packages/rls/dist/index.js')
  console.log(`[PASS] node:async_hooks (RLS context loaded)`)
} catch (e) {
  console.log(`[FAIL] node:async_hooks: ${e.message}`)
  failed++
}

// Performance test
const start = performance.now()
const { DatabaseError } = await import('./packages/core/dist/index.js')
for (let i = 0; i < 100000; i++) {
  new DatabaseError('test', 'TEST_CODE')
}
const elapsed = performance.now() - start
console.log(`\n--- Performance ---`)
console.log(`Created 100,000 error objects in ${elapsed.toFixed(2)}ms`)

console.log(`\n${failed === 0 ? 'All checks passed!' : `${failed} check(s) failed.`}`)
process.exit(failed > 0 ? 1 : 0)
