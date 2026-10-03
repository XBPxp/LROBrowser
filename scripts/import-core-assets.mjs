import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';
import process from 'node:process';
import { patchGuildEmblemRequestCallbacks, patchTrustedTypesDomWrites } from './patch-v2-runtime.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(new URL('../config/core-asset-roots.json', import.meta.url), 'utf8'));

function fail(code, file) {
  throw new Error(JSON.stringify({ code, ...(file ? { file } : {}) }));
}

function requireAbsolute(value, flag) {
  if (!value || !path.isAbsolute(value)) fail(`${flag}-absolute-required`);
  return path.resolve(value);
}

async function ensureSafeRoot(root, flag) {
  const info = await lstat(root).catch(() => null);
  if (!info?.isDirectory()) fail(`${flag}-root-invalid`);
}

function safeRelative(value) {
  if (!value || value.includes('\\') || path.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) fail('invalid-path');
  return value;
}

async function filesUnder(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    safeRelative(name);
    if (entry.isSymbolicLink()) fail('symlink', name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, name));
    else if (entry.isFile()) files.push(name);
    else fail('unsupported-file', name);
  }
  return files.sort();
}

function kindFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.lua') return 'lua';
  if (extension === '.lub') return 'lub';
  if (extension === '.wasm') return 'wasm';
  if (extension === '.json') return 'data-json';
  if (extension === '.csv' || extension === '.otf' || extension === '.ttf' || extension === '.txt') return 'passive';
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return 'runtime';
  fail('unsupported-executable', file);
}

async function addFile(entries, destinations, source, destination, kind, output) {
  safeRelative(destination);
  if (destinations.has(destination)) fail('duplicate-destination', destination);
  destinations.add(destination);
  let bytes = await readFile(source);
  if (kind === 'runtime' && /runtime\/(?:Online\.js|[^/]+\.mjs)$/.test(destination)
    && path.basename(destination) !== 'lastro-trusted-dom.mjs') {
    let text = bytes.toString('utf8');
    if (path.basename(destination) === 'lastro-account-login.mjs') {
      text = text.replaceAll('../accounts/account-storage.mjs', './account-storage.mjs');
    }
    if (path.basename(destination) === 'lastro-guild-emblem-request.mjs') {
      text = patchGuildEmblemRequestCallbacks(text);
    }
    bytes = Buffer.from(patchTrustedTypesDomWrites(text));
  }
  const target = path.join(output, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  entries.push({ path: destination, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), kind });
}

export async function importCoreAssets({ coreRoot, moduleRoot, runtimePath, output }) {
  const core = requireAbsolute(coreRoot, 'core-root');
  const modules = requireAbsolute(moduleRoot ?? path.join(repo, 'vendor/v2'), 'module-root');
  const destinationRoot = path.resolve(output ?? path.join(repo, 'generated/core'));
  await ensureSafeRoot(core, 'core');
  await ensureSafeRoot(modules, 'module');
  const entries = [];
  const destinations = new Set();
  for (const relative of await filesUnder(core)) {
    if (relative === 'executable-assets.json') continue;
    await addFile(entries, destinations, path.join(core, relative), relative, kindFor(relative), destinationRoot);
  }
  if (runtimePath) {
    const runtime = requireAbsolute(runtimePath, 'runtime');
    const runtimeBytes = await readFile(runtime);
    const text = runtimeBytes.toString('utf8');
    const wasmMatches = [...text.matchAll(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/g)];
    if (wasmMatches.length > 1) fail('duplicate-wasm');
    if (wasmMatches.length === 1 && !destinations.has('wasm/liblua5.1.wasm')) {
      const wasmPath = path.join(destinationRoot, 'wasm/liblua5.1.wasm');
      const wasmBytes = Buffer.from(wasmMatches[0][1], 'base64');
      await mkdir(path.dirname(wasmPath), { recursive: true });
      await writeFile(wasmPath, wasmBytes);
      destinations.add('wasm/liblua5.1.wasm');
      entries.push({ path: 'wasm/liblua5.1.wasm', bytes: wasmBytes.length, sha256: createHash('sha256').update(wasmBytes).digest('hex'), kind: 'wasm' });
    }
    await addFile(entries, destinations, runtime, 'runtime/Online.js', 'runtime', destinationRoot);
  }
  for (const relative of config.runtimeFiles ?? []) {
    safeRelative(relative);
    await addFile(entries, destinations, path.join(repo, relative), `runtime/${path.basename(relative)}`, 'runtime', destinationRoot);
  }
  for (const relative of await filesUnder(modules)) {
    if (relative === 'Online.js' || relative === 'lastro-navigation-debug.mjs'
      || !/\.(?:[cm]?js)$/i.test(relative) || /\.test\.mjs$/i.test(relative)) continue;
    const patchedWorker = runtimePath && ['ThreadEventHandler.js', 'LastROThreadEventHandler.js', 'PathFindingWorker.js'].includes(relative);
    const inputRoot = patchedWorker ? path.dirname(runtimePath) : modules;
    await addFile(entries, destinations, path.join(inputRoot, relative), `runtime/${path.basename(relative)}`, 'runtime', destinationRoot);
  }
  if (runtimePath) {
    await addFile(entries, destinations, path.join(path.dirname(runtimePath), 'lastro-resource-loader.js'),
      'runtime/lastro-resource-loader.js', 'runtime', destinationRoot);
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifest = { files: entries };
  await mkdir(destinationRoot, { recursive: true });
  await writeFile(path.join(destinationRoot, 'executable-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: {
    'core-root': { type: 'string' }, 'module-root': { type: 'string' }, runtime: { type: 'string' }, output: { type: 'string' },
  } });
  const manifest = await importCoreAssets({
    coreRoot: values['core-root'] ?? path.join(repo, 'vendor/core'),
    moduleRoot: values['module-root'] ?? path.join(repo, 'vendor/v2'),
    runtimePath: values.runtime ?? path.join(repo, 'generated/runtime/Online.js'), output: values.output,
  });
  process.stdout.write(JSON.stringify({ files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) }) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
