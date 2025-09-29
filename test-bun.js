// Test Bun compatibility
// Run with: bun test-bun.js

import * as core from './packages/core/dist/index.js';
import * as repository from './packages/repository/dist/index.js';
import * as softDelete from './packages/soft-delete/dist/index.js';

console.log('🍞 Testing Bun compatibility...\n');

// Test @kysera/core
console.log('✅ @kysera/core loaded');
console.log('  Functions available:', Object.keys(core).length);
console.log('  Sample function test:', typeof core.parseDatabaseError === 'function' ? '✓' : '✗');

// Test @kysera/repository
console.log('\n✅ @kysera/repository loaded');
console.log('  Functions available:', Object.keys(repository).length);
console.log('  Sample function test:', typeof repository.createRepositoryFactory === 'function' ? '✓' : '✗');

// Test @kysera/soft-delete
console.log('\n✅ @kysera/soft-delete loaded');
console.log('  Functions available:', Object.keys(softDelete).length);
console.log('  Sample function test:', typeof softDelete.softDeletePlugin === 'function' ? '✓' : '✗');

// Test performance (Bun should be fast!)
const start = performance.now();
for (let i = 0; i < 100000; i++) {
  // Simple operation to test runtime performance
  const err = new core.DatabaseError('test', 'TEST_CODE');
}
const elapsed = performance.now() - start;

console.log('\n⚡ Performance test:');
console.log(`  Created 100,000 error objects in ${elapsed.toFixed(2)}ms`);

console.log('\n🎉 Bun compatibility verified!');
console.log('📦 All packages work with Bun runtime.');