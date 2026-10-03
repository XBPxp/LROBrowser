import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, afterEach } from 'vitest';
import { importCoreAssets } from '../scripts/import-core-assets.mjs';
import { readFile, readdir } from 'node:fs/promises';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
    const root = await mkdtemp(path.resolve('generated/core-fixtures-'));
  roots.push(root);
  const core = path.join(root, 'core');
  const modules = path.join(root, 'modules');
  const output = path.join(root, 'output');
  await mkdir(path.join(core, 'data/luafiles514/lua files/sub'), { recursive: true });
  await mkdir(path.join(core, 'data'), { recursive: true });
  await mkdir(path.join(core, 'System/Font'), { recursive: true });
  await mkdir(modules, { recursive: true });
  await writeFile(path.join(core, 'data/luafiles514/lua files/sub/Case.LUB'), 'lub');
  await writeFile(path.join(core, 'data/msgstringtable.csv'), 'message-table');
  await writeFile(path.join(core, 'System/Font/Source Han Sans CN4.otf'), 'Source Han Sans CN4');
  await writeFile(path.join(core, 'System/Font/Source Han Sans CN6.otf'), 'Source Han Sans CN6');
  for (const name of ['Towninfo_cn2_1.lua', 'achievement_list_cn2_06.lua', 'itemInfo_re_59.lua', 'itemInfo_re_61.lua']) await writeFile(path.join(core, 'System', name), name);
  await writeFile(path.join(core, 'data/world.json'), '{}');
  await writeFile(path.join(modules, 'lastro-example.mjs'), 'export const example = 1;');
  await writeFile(path.join(modules, 'ThreadEventHandler.js'), 'var ThreadEventHandler = {};');
  await writeFile(path.join(modules, 'LastROThreadEventHandler.js'), 'var LastROThreadEventHandler = {};');
  return { root, core, modules, output };
}

describe('core executable asset importer', () => {
  it('packages the prepared navigation worker and records its final integrity', async () => {
    const f = await fixture();
    const runtime = path.join(f.root, 'runtime');
    await mkdir(runtime);
    for (const name of ['Online.js', 'ThreadEventHandler.js', 'LastROThreadEventHandler.js', 'lastro-resource-loader.js']) {
      await writeFile(path.join(runtime, name), 'export {};');
    }
    await writeFile(path.join(f.modules, 'PathFindingWorker.js'), 'const nativeNavigationQueue = true;');
    const bytes = Buffer.from('const preparedNavigationQueue = true;\r\n');
    await writeFile(path.join(runtime, 'PathFindingWorker.js'), bytes);
    const options = { coreRoot: f.core, moduleRoot: f.modules, output: f.output, runtimePath: path.join(runtime, 'Online.js') };
    const manifest = await importCoreAssets(options);
    expect(await readFile(path.join(f.output, 'runtime/PathFindingWorker.js'))).toEqual(bytes);
    expect(manifest.files.find(file => file.path === 'runtime/PathFindingWorker.js')).toEqual({
      path: 'runtime/PathFindingWorker.js', kind: 'runtime', bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    await rm(path.join(runtime, 'PathFindingWorker.js'));
    await expect(importCoreAssets(options)).rejects.toThrow(/ENOENT/);
  });

  it('preserves core asset paths, imports bundled fonts, and produces sorted hashes', async () => {
    const f = await fixture();
    const first = await importCoreAssets({ coreRoot: f.core, moduleRoot: f.modules, output: f.output });
    expect(first.files.map(file => file.path)).toEqual([...first.files].map(file => file.path).sort());
    expect(new Set(first.files.map(file => file.path)).size).toBe(first.files.length);
    expect(first.files.map(file => file.path)).toContain('data/luafiles514/lua files/sub/Case.LUB');
    expect(first.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'data/msgstringtable.csv', kind: 'passive' }),
      expect.objectContaining({ path: 'System/Font/Source Han Sans CN4.otf', kind: 'passive' }),
      expect.objectContaining({ path: 'System/Font/Source Han Sans CN6.otf', kind: 'passive' }),
      expect.objectContaining({ path: 'runtime/lastro-example.mjs', kind: 'runtime' }),
    ]));
    expect(await readFile(path.join(f.output, 'data/msgstringtable.csv'), 'utf8')).toBe('message-table');
    expect(await readFile(path.join(f.output, 'System/Font/Source Han Sans CN4.otf'), 'utf8')).toBe('Source Han Sans CN4');
    expect(await readFile(path.join(f.output, 'System/Font/Source Han Sans CN6.otf'), 'utf8')).toBe('Source Han Sans CN6');
    const second = await importCoreAssets({ coreRoot: f.core, moduleRoot: f.modules, output: f.output });
    expect(second).toEqual(first);
  });

  it('rejects symlinked executable inputs', async () => {
    const f = await fixture();
    const directory = path.join(f.root, 'outside');
    await mkdir(directory);
    const file = path.join(directory, 'outside.lua');
    await writeFile(file, 'return "synthetic-linked-executable"');
    const link = path.join(f.core, 'data/luafiles514/lua files/sub/outside.lua');
    // Windows junctions exercise the same rejection without symlink privileges.
    await symlink(process.platform === 'win32' ? directory : file, link, process.platform === 'win32' ? 'junction' : 'file');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    await expect(importCoreAssets({ coreRoot: f.core, moduleRoot: f.modules, output: f.output })).rejects.toThrow(/symlink/);
  });

  it('omits the unused navigation debugging entry from the game package', async () => {
    const f = await fixture();
    await writeFile(path.join(f.modules, 'lastro-navigation-debug.mjs'), 'export const installNavigationDebug = () => {};');
    const manifest = await importCoreAssets({ coreRoot: f.core, moduleRoot: f.modules, output: f.output });
    expect(manifest.files.some(file => file.path === 'runtime/lastro-navigation-debug.mjs')).toBe(false);
    await expect(readFile(path.join(f.output, 'runtime/lastro-navigation-debug.mjs'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(manifest.files.some(file => file.path === 'runtime/lastro-example.mjs')).toBe(true);
  });

  it('rejects unsupported core assets instead of silently changing the package', async () => {
    const f = await fixture();
    await writeFile(path.join(f.core, 'data/luafiles514/lua files/sub/ignored.bmp'), 'unsupported');
    await expect(importCoreAssets({ coreRoot: f.core, moduleRoot: f.modules, output: f.output })).rejects.toThrow(/unsupported-executable/);
  });

  it('fails when a required patched worker is missing instead of emitting an incomplete manifest', async () => {
    const f = await fixture();
    const runtime = path.join(f.root, 'runtime');
    await mkdir(runtime);
    await writeFile(path.join(runtime, 'Online.js'), 'export {};');
    await expect(importCoreAssets({ coreRoot: f.core, moduleRoot: f.modules, output: f.output,
      runtimePath: path.join(runtime, 'Online.js'),
    })).rejects.toThrow(/ENOENT/);
  });

  it('does not rewrite the Trusted Types helper into a self-import', async () => {
    const f = await fixture();
    const runtime = path.join(f.root, 'runtime');
    await mkdir(runtime);
    await writeFile(path.join(runtime, 'Online.js'), 'const node = {}; node.innerHTML = value;');
    await writeFile(path.join(runtime, 'lastro-resource-loader.js'), 'var LastROResources = {};');
    await writeFile(path.join(runtime, 'LastROThreadEventHandler.js'), 'var LastROThreadEventHandler = {};');
    await writeFile(path.join(runtime, 'ThreadEventHandler.js'), 'var ThreadEventHandler = {};');
    const output = path.join(f.root, 'output-with-helper');
    await importCoreAssets({ coreRoot: f.core, moduleRoot: f.modules,
      runtimePath: path.join(runtime, 'Online.js'), output });
    const helper = await readFile(path.join(output, 'runtime/lastro-trusted-dom.mjs'), 'utf8');
    expect(helper).toBe(await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
    expect(helper).toContain('const policies = new WeakMap();');
    expect(helper).not.toContain('__lastroIwaHtmlPolicy');
    expect(helper).not.toContain('from "./lastro-trusted-dom.mjs"');
  });

  it('matches the reviewed baseline file counts', async () => {
    const luaRoot = path.resolve('vendor/core/data/luafiles514/lua files');
    const systemRoot = path.resolve('vendor/core/System');
    const walk = async (root: string, relative = ''): Promise<number[]> => {
      const values: number[] = [];
      for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) values.push(...await walk(root, child));
        else if (entry.isFile() && /\.(?:lua|lub)$/i.test(child)) values.push((await readFile(path.join(root, child))).length);
      }
      return values;
    };
    const lua = await walk(luaRoot);
    const system = await walk(systemRoot);
    expect(lua).toHaveLength(473);
    expect(system).toHaveLength(4);
  });
});
