#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';

const HOST = '127.0.0.1';
const PORT = 5173;
const BASE = `http://${HOST}:${PORT}`;
const isWindows = process.platform === 'win32';

let server;

function killTree() {
  if (!server || server.killed || !server.pid) return;
  try {
    if (isWindows) {
      spawn('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid, 'SIGTERM');
    }
  } catch {
    /* server already gone */
  }
}

async function fetchWithRetry(url, attempts = 60, delayMs = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function main() {
  // Single-string command form avoids Node 24's DEP0190 warning when shell:true.
  // Args are static constants (HOST/PORT defined above), so no injection risk.
  const command = `npx vite --host ${HOST} --port ${PORT} --strictPort`;

  server = spawn(command, {
    stdio: 'pipe',
    shell: true,
    detached: !isWindows,
    windowsHide: true
  });

  server.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[vite-err] ${d}`));
  server.on('error', (err) => {
    console.error('Failed to spawn vite:', err);
  });

  try {
    const html = await fetchWithRetry(BASE, 60, 500);
    if (!html.includes('IHPU TrykkAnalyse')) {
      throw new Error('Title "IHPU TrykkAnalyse" missing from served HTML');
    }
    if (!html.includes('id="app"')) {
      throw new Error('App mount point #app missing from served HTML');
    }

    const mainTs = await fetchWithRetry(`${BASE}/src/main.ts`, 10, 200);
    if (!mainTs.includes('Bootstrap OK')) {
      throw new Error('"Bootstrap OK" missing from transformed /src/main.ts');
    }
    if (!mainTs.includes('Ingen data lastet')) {
      throw new Error('"Ingen data lastet" missing from transformed /src/main.ts');
    }

    console.log('SMOKE WEB PASS');
  } finally {
    killTree();
    await sleep(500);
  }
}

main().catch((err) => {
  console.error('SMOKE WEB FAIL');
  console.error(err);
  killTree();
  process.exit(1);
});
