#!/usr/bin/env node

/**
 * @kysera/cli - Command-line interface for Kysera ORM
 *
 * This is the main entry point for the CLI application.
 * It handles environment setup and launches the main CLI.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { cli } from './cli.js';

// Get package directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version info
const packagePath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

// Set CLI version globally for use in commands
process.env['KYSERA_CLI_VERSION'] = packageJson.version;

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Launch CLI
cli(process.argv).catch((error) => {
  console.error('CLI Error:', error);
  process.exit(1);
});
