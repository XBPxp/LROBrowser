import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patchRuntimeWorldMap } from '../scripts/patch-v2-runtime.mjs';
import { describeLastroMapLoadFailure } from '../scripts/lastro-map-load-diagnostic.mjs';
import { mapBinaryFixture } from './map-binary-fixture';

const { buildPrivateAirshipRequest } = await import(new URL('../vendor/v2/lastro-v1-migration.mjs', import.meta.url).href);
const runtime = patchRuntimeWorldMap(readFileSync('vendor/v2/Online.js', 'utf8'));
const begin = runtime.indexOf('const lastroWorldMapPreflight =');
const installation = runtime.slice(begin, runtime.indexOf('WorldMap = new GUIComponent', begin));
if (begin < 0 || !installation) throw new Error('Missing world map resource gate');

function resources() {
  const rsw = mapBinaryFixture('rsw');
  new Uint8Array(rsw).set(new TextEncoder().encode('terrain.gnd'), 51);
  new Uint8Array(rsw).set(new TextEncoder().encode('collision.gat'), 91);
  const gnd = mapBinaryFixture('gnd'); new DataView(gnd).setFloat32(14, 10, true);
  const gat = new ArrayBuffer(94);
  new Uint8Array(gat).set([71, 82, 65, 84, 1, 2]);
  new DataView(gat).setUint32(6, 2, true); new DataView(gat).setUint32(10, 2, true);
  return { 'data/ein_fild04.rsw': rsw, 'data/terrain.gnd': gnd, 'data/collision.gat': gat } as Record<string, ArrayBuffer | null>;
}

function fixture(files = resources(), aliases: Record<string, string> = {}) {
  const packets: unknown[] = [], reads: string[] = [], pending: Array<() => void> = [];
  const popup = vi.fn();
  const state = { currentMap: 'izlude.gat', loading: false };
  let manual = false, profile = 5;
  const api = new Function('Thread', 'DB', 'MapRenderer', 'Configs', 'PACKET', 'Network', 'buildPrivateAirshipRequest', 'normalizeLastROTeleportMap', 'UIManager', 'console', 'describeLastroMapLoadFailure', `
    ${installation}
    return lastroWorldMapTeleport;
  `)({ send: (type: string, input: { filename: string }, callback: (bytes: ArrayBuffer | null, error?: string) => void) => {
    expect(type).toBe('GET_FILE'); reads.push(input.filename);
    const complete = () => callback(files[input.filename] ?? null, files[input.filename] ? undefined : 'http-404');
    if (manual) pending.push(complete); else queueMicrotask(complete);
  } }, { mapalias: aliases }, state, { get: () => profile }, { CZ: { PRIVATE_AIRSHIP_REQUEST: class {} } },
  { sendPacket: (packet: unknown) => packets.push(packet) }, buildPrivateAirshipRequest, (map: string) => map.replace(/\.gat$/i, ''),
  { showErrorBox: popup, showPromptBox: (_message: string, _yes: string, _no: string, approve: () => void) => { approve(); return {}; } },
  { warn: () => {} }, describeLastroMapLoadFailure);
  return { api, packets, reads, popup, state, pending, manual: () => { manual = true; }, setProfile: () => { profile++; } };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('serialized world map teleport resource gate', () => {
  it('checks the actual scene references then sends the original map-level packet once', async () => {
    const f = fixture();
    expect(await f.api.request('ein_fild04')).toBe(true);
    expect(f.reads).toEqual(['data/ein_fild04.rsw', 'data/terrain.gnd', 'data/collision.gat']);
    expect(f.packets).toEqual([expect.objectContaining({ mapname: 'ein_fild04', type: 0, x: 0, y: 0, itemid: 14527 })]);
  });

  it.each(['scene', 'ground', 'collision', 'invalid-ground'])('keeps the current map and sends no packet for a failed %s', async kind => {
    const files = resources();
    if (kind === 'scene') files['data/ein_fild04.rsw'] = null;
    if (kind === 'ground') files['data/terrain.gnd'] = null;
    if (kind === 'collision') files['data/collision.gat'] = null;
    if (kind === 'invalid-ground') files['data/terrain.gnd'] = new ArrayBuffer(100);
    const f = fixture(files);
    expect(await f.api.request('ein_fild04')).toBe(false);
    expect(f.packets).toEqual([]);
    expect(f.state.currentMap).toBe('izlude.gat');
    expect(f.popup).toHaveBeenCalledOnce();
    expect(f.popup).toHaveBeenCalledWith(expect.stringContaining('传送失败：'));
  });

  it('applies native file aliases without rewriting the server target', async () => {
    const f = fixture(resources(), { 'alias.rsw': 'ein_fild04.rsw' });
    expect(await f.api.request('alias')).toBe(true);
    expect(f.reads[0]).toBe('data/ein_fild04.rsw');
    expect(f.packets).toEqual([expect.objectContaining({ mapname: 'alias', type: 0 })]);
  });

  it('waits past eight seconds and ignores callbacks arriving after the raw read timeout', async () => {
    const f = fixture(); f.manual();
    const result = f.api.request('ein_fild04');
    await vi.advanceTimersByTimeAsync(8001);
    expect(f.popup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(65000 - 8001);
    expect(await result).toBe(false);
    expect(f.popup).toHaveBeenCalledWith(expect.stringContaining('地图资源下载超时'));
    f.pending[0]!(); await Promise.resolve();
    expect(f.packets).toEqual([]);
  });

  it.each(['cancel', 'map', 'profile'])('prevents a late warp after %s', async change => {
    const f = fixture(); f.manual();
    const result = f.api.request('ein_fild04');
    await vi.advanceTimersByTimeAsync(0);
    if (change === 'cancel') f.api.cancelPending();
    if (change === 'map') f.state.currentMap = 'payon.gat';
    if (change === 'profile') f.setProfile();
    f.pending[0]!();
    // Complete any remaining checks; stale origin checks stop further reads.
    for (let index = 1; index < 5; index++) { await vi.advanceTimersByTimeAsync(0); f.pending[index]?.(); }
    expect(await result).toBe(false);
    expect(f.packets).toEqual([]);
  });
});
