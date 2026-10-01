import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { createServer as createTcpServer } from 'node:net';
import type { ViteDevServer } from 'vite';
import { createLocalServer, runtimeNeedsPreparation, SERVER_KIND, SERVER_ROOT, SERVER_STATUS_PATH } from '../scripts/local-server.mjs';
import { ownsProcess } from '../scripts/local-server-control.mjs';
import { REQUIRED_HEADERS } from '../scripts/iwa-security.mjs';

describe('independent local client server', () => {
  let server: ViteDevServer, url: string;
  let ready = true;
  const instanceId = randomUUID();
  beforeAll(async () => {
    const reservation = createTcpServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const reserved = reservation.address();
    if (!reserved || typeof reserved === 'string') throw new Error('Missing test port');
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    server = await createLocalServer({ port: reserved.port, instanceId, ready: () => ready });
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing local TCP address');
    expect(address.address).toBe('127.0.0.1');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await server?.close(); });

  it('serves the original app with IWA headers and without an HMR client', async () => {
    const response = await globalThis.fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(REQUIRED_HEADERS['Content-Security-Policy']);
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(await response.text()).not.toContain('/@vite/client');
  }, 15000); // Allow cold Vite startup while the full suite parses native bundles.
  it('transforms the actual startup module without losing its staged runtime import', async () => {
    // A direct runtime download can succeed even while this import-analysis
    // step fails, preventing the browser from executing main.ts at all.
    const main = await globalThis.fetch(url + '/src/main.ts');
    expect(main.status).toBe(200);
    expect(await main.text()).toContain('/src/runtime/client-bootstrap.ts');
    const bootstrap = await globalThis.fetch(url + '/src/runtime/client-bootstrap.ts');
    const code = await bootstrap.text();
    expect(bootstrap.status).toBe(200);
    expect(code).toMatch(/import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*["']\/runtime\/Online\.js["']\s*\)/);
    expect(code).not.toContain('/@fs/');
    expect(code).not.toContain('/generated/runtime/Online.js');
  }, 15000);
  it.each(['/runtime/Online.js', '/runtime/LastROThreadEventHandler.js', '/runtime/lastro-account-login.mjs', '/core/executable-assets.json'])('serves the native route %s', async route => {
    const response = await globalThis.fetch(url + route);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(route.endsWith('.json') ? 'application/json' : 'text/javascript');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    if (route === '/runtime/Online.js') expect(await response.text()).toBe(await readFile('generated/runtime/Online.js', 'utf8'));
  }, 15000);
  it('reports the exact managed instance without caching', async () => {
    const response = await globalThis.fetch(url + SERVER_STATUS_PATH);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ kind: SERVER_KIND, root: SERVER_ROOT, pid: process.pid, instanceId, ready: true });
  });
  it('rejects an occupied port instead of changing the installed client address', async () => {
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    await expect(createLocalServer({ port: address.port })).rejects.toThrow('already in use');
  });
  it('returns resource errors rather than HTML during preparation or for missing code', async () => {
    ready = false;
    try {
      const response = await globalThis.fetch(url + '/core/executable-assets.json');
      expect(response.status).toBe(503); expect(response.headers.get('retry-after')).toBe('2');
      expect(await response.json()).toMatchObject({ error: 'Client resources are being prepared' });
    } finally { ready = true; }
    const missing = await globalThis.fetch(url + '/runtime/no-such-runtime.js');
    expect(missing.status).toBe(404); expect(missing.headers.get('content-type')).toContain('application/json');
  });
  it('blocks encoded traversal out of the staged resources', async () => {
    const response = await globalThis.fetch(url + '/core/%2e%2e%2fscripts/prepare-runtime.mjs');
    expect(response.status).toBe(403);
  });
});

describe('local launcher ownership and readiness', () => {
  it('does not treat a reused PID or another project as the server to stop', () => {
    const instanceId = randomUUID();
    const command = `"${process.execPath}" "${path.join(SERVER_ROOT, 'scripts/local-server.mjs')}" --managed ${instanceId}`;
    const state = { kind: SERVER_KIND, root: SERVER_ROOT, pid: 1234, instanceId };
    const info = { ProcessId: 1234, ExecutablePath: process.execPath, CommandLine: command };
    expect(ownsProcess(state, info)).toBe(true);
    expect(ownsProcess(state, { ...info, CommandLine: 'node unrelated-server.js' })).toBe(false);
    expect(ownsProcess(state, { ...info, ProcessId: 4321 })).toBe(false);
    expect(ownsProcess({ ...state, root: 'other-project' }, info)).toBe(false);
    expect(ownsProcess({ ...state, instanceId: randomUUID() }, info)).toBe(false);
    expect(ownsProcess(state, null)).toBe(false);
  });
  it('detects missing or interrupted staging before listening', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lastro-local-server-'));
    try {
      expect(await runtimeNeedsPreparation(directory)).toBe(true);
      await mkdir(path.join(directory, 'generated/runtime'), { recursive: true });
      await mkdir(path.join(directory, 'generated/core'), { recursive: true });
      await writeFile(path.join(directory, 'generated/runtime/Online.js'), 'ready');
      await writeFile(path.join(directory, 'generated/runtime/LastROThreadEventHandler.js'), 'ready');
      await writeFile(path.join(directory, 'generated/core/executable-assets.json'), '{');
      expect(await runtimeNeedsPreparation(directory)).toBe(true);
      await writeFile(path.join(directory, 'generated/core/executable-assets.json'), JSON.stringify({ files: [{ path: 'missing.js' }] }));
      expect(await runtimeNeedsPreparation(directory)).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
