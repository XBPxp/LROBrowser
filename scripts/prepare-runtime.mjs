import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { importCoreAssets } from './import-core-assets.mjs';
import { patchNavigationWorker } from './lastro-navigation-worker.mjs';

const execFileAsync = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const generated = path.join(repo, 'generated');
const moduleRoot = path.join(repo, 'vendor/v2');
const coreRoot = path.join(repo, 'vendor/core');
const runtimeRoot = path.join(generated, 'runtime');
const patchedRuntime = path.join(runtimeRoot, 'Online.js');

await mkdir(generated, { recursive: true });
await rm(runtimeRoot, { recursive: true, force: true });
await rm(path.join(generated, 'core'), { recursive: true, force: true });
await rm(path.join(generated, 'v2'), { recursive: true, force: true });
await rm(path.join(generated, 'v2-manifest.json'), { force: true });
await mkdir(runtimeRoot, { recursive: true });

await execFileAsync(process.execPath, [
  path.join(repo, 'scripts/patch-v2-runtime.mjs'),
  '--input', path.join(moduleRoot, 'Online.js'),
  '--output', patchedRuntime,
  '--manifest', path.join(generated, 'runtime-patch-manifest.json'),
], { cwd: repo });

await execFileAsync(process.execPath, [
  path.join(repo, 'scripts/patch-resource-worker.mjs'), moduleRoot, runtimeRoot,
], { cwd: repo });

await writeFile(path.join(runtimeRoot, 'PathFindingWorker.js'), patchNavigationWorker(
  await readFile(path.join(moduleRoot, 'PathFindingWorker.js'), 'utf8'),
));

const manifest = await importCoreAssets({
  coreRoot,
  moduleRoot,
  runtimePath: patchedRuntime,
  output: path.join(generated, 'core'),
});

process.stdout.write(JSON.stringify({
  modules: moduleRoot,
  core: coreRoot,
  runtimeFiles: manifest.files.length,
}) + '\n');
