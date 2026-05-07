#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';

const HOST = '127.0.0.1';
const PORT = 4173;
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
  const command = `npx vite preview --host ${HOST} --port ${PORT} --strictPort`;

  server = spawn(command, {
    stdio: 'pipe',
    shell: true,
    detached: !isWindows,
    windowsHide: true
  });

  server.stdout.on('data', (d) => process.stdout.write(`[vite-preview] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[vite-preview-err] ${d}`));
  server.on('error', (err) => {
    console.error('Failed to spawn vite preview:', err);
  });

  try {
    const html = await fetchWithRetry(BASE, 60, 500);
    if (!html.includes('IHPU TrykkAnalyse')) {
      throw new Error('Title "IHPU TrykkAnalyse" missing from preview HTML');
    }
    if (!html.includes('./assets/')) {
      throw new Error('Built assets path "./assets/" missing from preview HTML — production bundle not loaded');
    }

    const assetMatch = html.match(/\.\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    if (!assetMatch) {
      throw new Error('Hashed JS asset reference not found in preview HTML');
    }
    const assetPath = `${BASE}/assets/${assetMatch[1]}`;
    const assetText = await fetchWithRetry(assetPath, 10, 200);
    if (!assetText.includes('Bootstrap OK')) {
      throw new Error(`"Bootstrap OK" missing from production bundle ${assetMatch[1]}`);
    }

    console.log('SMOKE PROD PASS');
  } finally {
    killTree();
    await sleep(500);
  }
}

main().catch((err) => {
  console.error('SMOKE PROD FAIL');
  console.error(err);
  killTree();
  process.exit(1);
});
