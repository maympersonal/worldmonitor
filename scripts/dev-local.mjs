#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ENV_LOCAL_FILE = '.env.local';

function parseDotenvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex === -1) return null;

  const key = trimmed.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(equalsIndex + 1).trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  } else {
    const commentIndex = value.search(/\s#/);
    if (commentIndex !== -1) value = value.slice(0, commentIndex).trim();
  }

  return [key, value];
}

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ENV_LOCAL_FILE);
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  let loaded = 0;
  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseDotenvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] == null) {
      process.env[key] = value;
      loaded += 1;
    }
  }

  if (loaded > 0) {
    console.log(`[dev-local] Loaded ${loaded} value(s) from ${ENV_LOCAL_FILE}`);
  }
}

loadEnvLocal();

const args = process.argv.slice(2);

let variant = null;
let cloudFallback = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--variant') {
    variant = args[i + 1] ?? null;
    i += 1;
    continue;
  }
  if (arg === '--cloud-fallback') {
    cloudFallback = 'true';
    continue;
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const requestedSidecarPort = Number(process.env.LOCAL_API_PORT || '46123');
const devPort = process.env.PORT || '3000';
const host = process.env.HOST || '0.0.0.0';

const children = [];
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const proc of children) {
    if (proc.pid && proc.exitCode === null) {
      proc.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 50);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function isPortFree(port, bindHost = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (error) => {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'EADDRINUSE' || code === 'EACCES') {
        resolve(false);
        return;
      }
      resolve(false);
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, bindHost);
  });
}

async function hasLocalApiServer(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/local-status`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return Boolean(payload?.success);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function isTokenProtectedApi(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    // Without "url" this endpoint should return 400 when auth is disabled.
    // If a sidecar was started by Tauri with LOCAL_API_TOKEN, it returns 401.
    const response = await fetch(`http://127.0.0.1:${port}/api/rss-proxy`, {
      signal: controller.signal,
    });
    return response.status === 401;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function findAvailablePort(start, attempts = 20) {
  for (let i = 1; i <= attempts; i += 1) {
    const candidate = start + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function main() {
  let sidecarPort = requestedSidecarPort;
  let shouldStartLocalApi = true;

  const preferredPortFree = await isPortFree(sidecarPort);
  if (!preferredPortFree) {
    const runningLocalApi = await hasLocalApiServer(sidecarPort);
    if (runningLocalApi) {
      const tokenProtected = await isTokenProtectedApi(sidecarPort);
      if (tokenProtected) {
        const nextPort = await findAvailablePort(sidecarPort);
        if (!nextPort) {
          console.error(`[dev-local] Existing API on ${sidecarPort} requires auth and no fallback port was found.`);
          process.exit(1);
        }
        sidecarPort = nextPort;
        console.log(`[dev-local] Existing API on ${requestedSidecarPort} requires token auth; starting a new local API on ${sidecarPort}`);
      } else {
        shouldStartLocalApi = false;
        console.log(`[dev-local] Reusing existing local API on 127.0.0.1:${sidecarPort}`);
      }
    } else {
      const nextPort = await findAvailablePort(sidecarPort);
      if (!nextPort) {
        console.error(`[dev-local] Port ${sidecarPort} is busy and no fallback port was found.`);
        process.exit(1);
      }
      sidecarPort = nextPort;
      console.log(`[dev-local] Port ${requestedSidecarPort} in use by another process; switching local API to ${sidecarPort}`);
    }
  }

  const sharedEnv = {
    ...process.env,
    VITE_USE_LOCAL_API: '1',
    VITE_OPEN_BROWSER: '0',
    VITE_LOCAL_API_TARGET: process.env.VITE_LOCAL_API_TARGET || `http://127.0.0.1:${sidecarPort}`,
    LOCAL_API_PORT: String(sidecarPort),
    LOCAL_API_TOKEN: '',
    LOCAL_API_MODE: process.env.LOCAL_API_MODE || 'local-web',
    LOCAL_API_CLOUD_FALLBACK: cloudFallback ?? process.env.LOCAL_API_CLOUD_FALLBACK ?? 'false',
  };

  if (variant) {
    sharedEnv.VITE_VARIANT = variant;
  }

  console.log(`[dev-local] Starting Vite on http://${host}:${devPort}`);
  console.log(`[dev-local] VITE_USE_LOCAL_API=1, LOCAL_API_CLOUD_FALLBACK=${sharedEnv.LOCAL_API_CLOUD_FALLBACK}`);

  if (shouldStartLocalApi) {
    console.log(`[dev-local] Starting local API sidecar on 127.0.0.1:${sidecarPort}`);
    spawnChild('node', ['src-tauri/sidecar/local-api-server.mjs'], 'local-api', sharedEnv);
  }

  spawnChild(npmCmd, ['run', 'dev', '--', '--host', host, '--port', devPort], 'vite', sharedEnv);
}

function spawnChild(command, commandArgs, name, env) {
  const child = spawn(command, commandArgs, {
    stdio: 'inherit',
    env,
  });
  children.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const proc of children) {
      if (proc.pid && proc.exitCode === null) {
        proc.kill('SIGTERM');
      }
    }

    if (signal) {
      console.error(`[dev-local] ${name} stopped by signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });

  return child;
}

main().catch((error) => {
  console.error('[dev-local] Startup failed:', error);
  process.exit(1);
});
