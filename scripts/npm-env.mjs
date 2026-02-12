#!/usr/bin/env node
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

try {
  const lines = readFileSync('.env', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  console.warn('No .env file found — relying on existing environment variables.');
}

const args = process.argv.slice(2).join(' ');
execSync(`npm ${args}`, { stdio: 'inherit', env: process.env });
