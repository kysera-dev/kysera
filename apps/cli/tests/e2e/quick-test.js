#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

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