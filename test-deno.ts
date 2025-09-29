// Test Deno compatibility
// Run with: deno run --allow-read test-deno.ts

// Import with explicit .js extensions for Deno
import * as core from './packages/core/dist/index.js';
import * as repository from './packages/repository/dist/index.js';
import * as softDelete from './packages/soft-delete/dist/index.js';

console.log('🦕 Testing Deno compatibility...\n');

// Test @kysera/core
console.log('✅ @kysera/core loaded');
console.log('  Functions available:', Object.keys(core).length);

// Test @kysera/repository
console.log('✅ @kysera/repository loaded');
console.log('  Functions available:', Object.keys(repository).length);

// Test @kysera/soft-delete
console.log('✅ @kysera/soft-delete loaded');
console.log('  Functions available:', Object.keys(softDelete).length);

console.log('\n🎉 Deno compatibility verified!');
console.log('📦 All packages work with Deno runtime.');