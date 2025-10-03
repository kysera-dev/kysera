#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '../../dist/index.js');
const projectName = 'quick-test';
const projectDir = path.join('/tmp', projectName);

console.log('Testing CLI init command...');
console.log('CLI Path:', CLI_PATH);
console.log('Node Path:', process.execPath);

const child = spawn(process.execPath, [
  CLI_PATH,
  'init',
  projectName,
  '--database', 'sqlite',
  '--no-install',
  '--no-git'
], {
  cwd: '/tmp',
  env: { ...process.env, NODE_ENV: 'test' },
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log(`Process exited with code ${code}`);
});

child.on('error', (err) => {
  console.error('Error:', err);
});