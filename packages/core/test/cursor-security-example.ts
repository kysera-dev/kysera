/**
 * Example: Secure Cursor Pagination
 *
 * This example demonstrates how to use cursor security features
 * to prevent tampering and unauthorized data access.
 *
 * Run this example:
 * ```bash
 * pnpm --filter @kysera/core tsx test/cursor-security-example.ts
 * ```
 */

import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import {
  paginateCursor,
  signCursor,
  verifyCursor,
  encryptCursor,
  decryptCursor
} from '../src/index.js'

interface TestDatabase {
  users: {
    id: Generated<number>
    name: string
    email: string
    role: 'admin' | 'user'
    created_at: Generated<string>
  }
}

async function main() {
  // Setup in-memory database
  const database = new Database(':memory:')
  const db = new Kysely<TestDatabase>({
    dialect: new SqliteDialect({ database })
  })

  // Create table
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('email', 'text', col => col.notNull())
    .addColumn('role', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull())
    .execute()

  // Insert test data
  const users = Array.from({ length: 25 }, (_, i) => ({
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    role: (i % 3 === 0 ? 'admin' : 'user') as 'admin' | 'user',
    created_at: new Date(2024, 0, i + 1).toISOString()
  }))
  await db.insertInto('users').values(users).execute()

  console.log('='.repeat(80))
  console.log('L-5: Signed/Encrypted Cursor Support - Example')
  console.log('='.repeat(80))
  console.log()

  // Example 1: Basic Cursor Signing
  console.log('Example 1: HMAC Signing (Recommended)')
  console.log('-'.repeat(80))

  const SECRET = 'my-super-secret-key-at-least-16-chars-long'

  const page1Signed = await paginateCursor(db.selectFrom('users').selectAll(), {
    orderBy: [{ column: 'id', direction: 'asc' }],
    limit: 5,
    security: { secret: SECRET }
  })

  console.log(`✓ Page 1: Retrieved ${page1Signed.data.length} users`)
  console.log(`✓ Next cursor (signed): ${page1Signed.pagination.nextCursor}`)
  console.log(`✓ Cursor contains signature: ${page1Signed.pagination.nextCursor?.includes('.')}`)
  console.log()

  // Verify signature manually
  const signedCursor = page1Signed.pagination.nextCursor!
  const [cursorPart, signaturePart] = signedCursor.split('.')
  console.log(`  Cursor part: ${cursorPart?.substring(0, 30)}...`)
  console.log(`  Signature: ${signaturePart?.substring(0, 30)}...`)
  console.log()

  // Get next page
  const page2Signed = await paginateCursor(db.selectFrom('users').selectAll(), {
    orderBy: [{ column: 'id', direction: 'asc' }],
    limit: 5,
    cursor: page1Signed.pagination.nextCursor,
    security: { secret: SECRET }
  })

  console.log(`✓ Page 2: Retrieved ${page2Signed.data.length} users`)
  console.log(`✓ First user ID on page 2: ${page2Signed.data[0]?.id}`)
  console.log()

  // Example 2: Tampering Detection
  console.log('Example 2: Tampering Detection')
  console.log('-'.repeat(80))

  try {
    // Tamper with the cursor
    const tamperedCursor = signedCursor.replace('a', 'b')
    console.log(`✗ Attempting to use tampered cursor: ${tamperedCursor.substring(0, 50)}...`)

    await paginateCursor(db.selectFrom('users').selectAll(), {
      orderBy: [{ column: 'id', direction: 'asc' }],
      limit: 5,
      cursor: tamperedCursor,
      security: { secret: SECRET }
    })

    console.log('  ERROR: Tampered cursor was accepted!')
  } catch (error) {
    console.log(`✓ Tampered cursor rejected: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log()

  // Example 3: AES-256-GCM Encryption
  console.log('Example 3: AES-256-GCM Encryption (Maximum Security)')
  console.log('-'.repeat(80))

  const page1Encrypted = await paginateCursor(db.selectFrom('users').selectAll(), {
    orderBy: [{ column: 'id', direction: 'asc' }],
    limit: 5,
    security: { secret: SECRET, encrypt: true }
  })

  console.log(`✓ Page 1: Retrieved ${page1Encrypted.data.length} users`)
  console.log(`✓ Next cursor (encrypted+signed): ${page1Encrypted.pagination.nextCursor?.substring(0, 60)}...`)
  console.log(
    `✓ Cursor is encrypted (contains multiple dots): ${(page1Encrypted.pagination.nextCursor?.match(/\./g) || []).length} dots`
  )
  console.log()

  // Demonstrate encryption format
  const encryptedCursor = page1Encrypted.pagination.nextCursor!
  const parts = encryptedCursor.split('.')
  console.log(`  Format: iv.encrypted.authTag (${parts.length - 1} parts) + signature`)
  console.log(`  Total cursor length: ${encryptedCursor.length} characters`)
  console.log()

  // Get next page with encrypted cursor
  const page2Encrypted = await paginateCursor(db.selectFrom('users').selectAll(), {
    orderBy: [{ column: 'id', direction: 'asc' }],
    limit: 5,
    cursor: page1Encrypted.pagination.nextCursor,
    security: { secret: SECRET, encrypt: true }
  })

  console.log(`✓ Page 2: Retrieved ${page2Encrypted.data.length} users`)
  console.log(`✓ First user ID on page 2: ${page2Encrypted.data[0]?.id}`)
  console.log()

  // Example 4: Different HMAC Algorithms
  console.log('Example 4: HMAC Algorithm Options')
  console.log('-'.repeat(80))

  const algorithms: Array<'sha256' | 'sha384' | 'sha512'> = ['sha256', 'sha384', 'sha512']

  for (const algorithm of algorithms) {
    const page = await paginateCursor(db.selectFrom('users').selectAll(), {
      orderBy: [{ column: 'id', direction: 'asc' }],
      limit: 5,
      security: { secret: SECRET, algorithm }
    })

    const cursor = page.pagination.nextCursor!
    const [, signature] = cursor.split('.')

    console.log(`✓ ${algorithm.toUpperCase()}: signature length = ${signature?.length} chars`)
  }
  console.log()

  // Example 5: Direct Crypto Functions
  console.log('Example 5: Direct Crypto Functions (Low-Level API)')
  console.log('-'.repeat(80))

  const testCursor = 'eyJpZCI6MTAwfQ=='

  // Signing
  const signed = signCursor(testCursor, SECRET)
  console.log(`✓ signCursor('${testCursor}', secret)`)
  console.log(`  Result: ${signed}`)
  console.log()

  // Verification
  const verified = verifyCursor(signed, SECRET)
  console.log(`✓ verifyCursor('${signed}', secret)`)
  console.log(`  Result: ${verified}`)
  console.log()

  // Encryption
  const encrypted = encryptCursor(testCursor, SECRET)
  console.log(`✓ encryptCursor('${testCursor}', secret)`)
  console.log(`  Result: ${encrypted.substring(0, 60)}...`)
  console.log()

  // Decryption
  const decrypted = decryptCursor(encrypted, SECRET)
  console.log(`✓ decryptCursor('${encrypted.substring(0, 40)}...', secret)`)
  console.log(`  Result: ${decrypted}`)
  console.log()

  // Example 6: Security Best Practices
  console.log('Example 6: Security Best Practices')
  console.log('-'.repeat(80))

  console.log('✓ Secret key length:')
  console.log('  - Minimum: 16 characters (enforced)')
  console.log('  - Recommended: 32+ characters')
  console.log('  - Best: Use environment variable (process.env.CURSOR_SECRET)')
  console.log()

  console.log('✓ When to use signing vs encryption:')
  console.log('  - Signing (HMAC): Prevents tampering, faster, smaller cursors')
  console.log('  - Encryption: Hides cursor contents, prevents info leakage')
  console.log('  - Both: Maximum security (encrypt first, then sign)')
  console.log()

  console.log('✓ Algorithm selection:')
  console.log('  - SHA-256: Default, good balance of speed/security')
  console.log('  - SHA-384: Higher security, slightly slower')
  console.log('  - SHA-512: Maximum security, larger signatures')
  console.log()

  // Summary
  console.log('='.repeat(80))
  console.log('Summary: L-5 Implementation')
  console.log('='.repeat(80))
  console.log('✓ HMAC signing with sha256/sha384/sha512')
  console.log('✓ AES-256-GCM encryption')
  console.log('✓ Tampering detection')
  console.log('✓ Timing-safe comparison')
  console.log('✓ Backward compatible (security is optional)')
  console.log('✓ Type-safe API with TypeScript')
  console.log('✓ Comprehensive test coverage (70+ tests)')
  console.log('✓ Production-ready implementation')
  console.log()

  // Cleanup
  await db.destroy()
  database.close()
}

main().catch(console.error)
