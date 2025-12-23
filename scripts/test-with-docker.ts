#!/usr/bin/env node

import { DockerCompose } from '../packages/core/test/utils/docker.js'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DOCKER_PATH = '/usr/local/bin/docker'

/**
 * Run tests with Docker databases
 */
async function runTests() {
  const docker = new DockerCompose({
    dockerPath: DOCKER_PATH,
    configFile: join(__dirname, '../docker-compose.test.yml'),
    projectName: 'kysera-test'
  })

  console.log('🐳 Starting Docker containers...')

  try {
    // Check if Docker is available
    if (!docker.isAvailable()) {
      console.error('❌ Docker is not available at', DOCKER_PATH)
      console.log('ℹ️  Running tests with SQLite only...')
      execSync('pnpm test', { stdio: 'inherit' })
      return
    }

    // Start containers
    await docker.up()
    console.log('✅ Docker containers started')

    // Set environment variables for database connections
    process.env.TEST_POSTGRES = 'true'
    process.env.TEST_MYSQL = 'true'
    process.env.POSTGRES_HOST = 'localhost'
    process.env.POSTGRES_PORT = '5432'
    process.env.POSTGRES_USER = 'test'
    process.env.POSTGRES_PASSWORD = 'test'
    process.env.POSTGRES_DATABASE = 'kysera_test'
    process.env.MYSQL_HOST = 'localhost'
    process.env.MYSQL_PORT = '3306'
    process.env.MYSQL_USER = 'test'
    process.env.MYSQL_PASSWORD = 'test'
    process.env.MYSQL_DATABASE = 'kysera_test'

    // Run tests
    console.log('🧪 Running tests...')
    execSync('pnpm test:multi-db', { stdio: 'inherit' })

    console.log('✅ All tests completed successfully')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  } finally {
    // Clean up containers
    console.log('🧹 Cleaning up Docker containers...')
    await docker.down()
  }
}

// Handle SIGINT (Ctrl+C) gracefully
process.on('SIGINT', async () => {
  console.log('\n🛑 Received interrupt signal, cleaning up...')
  const docker = new DockerCompose({
    dockerPath: DOCKER_PATH,
    configFile: join(__dirname, '../docker-compose.test.yml'),
    projectName: 'kysera-test'
  })
  await docker.down()
  process.exit(0)
})

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
