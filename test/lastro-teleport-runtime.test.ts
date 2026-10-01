import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateMapBinary } from '../src/resources/map-binary-validation';
import { patchRuntimeToolsPanels } from '../scripts/patch-v2-runtime.mjs';
import { mapBinaryFixture } from './map-binary-fixture';

const { buildPrivateAirshipRequest } = await import(new URL('../vendor/v2/lastro-v1-migration.mjs', import.meta.url).href);
const runtime = patchRuntimeToolsPanels(readFileSync('vendor/v2/Online.js', 'utf8'));
const begin = runtime.indexOf('const lastroSendRouteTeleport =');
const end = runtime.indexOf('(function installLastroToolsPanels', begin);
if (begin < 0 || end < begin) throw new Error('Missing prepared teleport runtime');
const installation = runtime.slice(begin, end);

function resources() {
  const rsw = mapBinaryFixture('rsw');
  new Uint8Array(rsw).set(new TextEncoder().encode('terrain.gnd'), 51);
  new Uint8Array(rsw).set(new TextEncoder().encode('collision.gat'), 91);
  const ground = new Uint8Array(mapBinaryFixture('gnd'));
  // Keep the original 1.9 texture/tile records and water tail; repeat its cell.
  const cellOffset = ground.length - 56 - 28;
  const gnd = new ArrayBuffer(ground.length + 3 * 28), expandedGround = new Uint8Array(gnd);
  expandedGround.set(ground.subarray(0, cellOffset));
  for (let index = 0; index < 4; index++) expandedGround.set(ground.subarray(cellOffset, cellOffset + 28), cellOffset + index * 28);
  expandedGround.set(ground.subarray(cellOffset + 28), cellOffset + 4 * 28);
  const groundView = new DataView(gnd);
  groundView.setUint32(6, 2, true); groundView.setUint32(10, 2, true); groundView.setFloat32(14, 10, true);
  const altitude = new Uint8Array(mapBinaryFixture('gat'));
  const gat = new ArrayBuffer(14 + 20 * 16), expandedAltitude = new Uint8Array(gat);
  expandedAltitude.set(altitude.subarray(0, 14));
  for (let index = 0; index < 16; index++) expandedAltitude.set(altitude.subarray(14), 14 + index * 20);
  new DataView(gat).setUint32(6, 4, true); new DataView(gat).setUint32(10, 4, true);
  validateMapBinary('terrain.gnd', gnd); validateMapBinary('collision.gat', gat);
  return { 'data/prontera.rsw': rsw, 'data/terrain.gnd': gnd, 'data/collision.gat': gat } as Record<string, ArrayBuffer | null>;
}

function fixture(files = resources(), aliases: Record<string, string> = {}) {
  const packets: unknown[] = [], events: string[] = [];
  const pending: Array<() => void> = [];
  const mapRenderer = { currentMap: 'izlude.gat', loading: false };
  const actor = { position: [0, 0] };
  const navigation = { __loaded: true, show: vi.fn(), clear: vi.fn(), navigateTo: vi.fn() };
  // The runtime captures the native GUI lifecycle before installing either view.
  // This resource-gate fixture does not append the component or render its UI.
  const tools = { render: vi.fn(() => ''), init: vi.fn(),
    _lastroPanels: { setStatus: vi.fn() }, _lastroTeleportRejected: undefined as undefined | ((message: string) => void) };
  let autoComplete = true;
  const thread = { send: (type: string, input: { filename: string }, callback: (bytes: ArrayBuffer | null, error?: string) => void) => {
    expect(type).toBe('GET_FILE'); events.push(input.filename);
    const complete = () => callback(files[input.filename] ?? null, files[input.filename] ? undefined : 'http-404');
    if (autoComplete) queueMicrotask(complete); else pending.push(complete);
  } };
  const worldMap = { _lastroTeleport: { cancelPending: vi.fn() } };
  const exposed = new Function('Thread', 'MapRenderer', 'SessionStorage_default', 'PACKET', 'Network', 'Configs', 'Navigation_default', 'LastROTools', 'normalizeLastROTeleportMap', 'buildPrivateAirshipRequest', 'DB', 'console', 'WorldMap_default', `
    ${installation}
    return { api: lastroVerifiedRouteRequest, routeNavigation: lastroRouteNavigation };
  `)(thread, mapRenderer, { Entity: actor }, { CZ: { PRIVATE_AIRSHIP_REQUEST: class {} } },
    { sendPacket: (packet: unknown) => { events.push('packet'); packets.push(packet); } }, { get: () => 5 }, navigation, tools,
    (value: string) => value.replace(/\.gat$/i, ''), buildPrivateAirshipRequest, { mapalias: aliases }, { warn: () => {} }, worldMap);
  return { ...exposed, mapRenderer, actor, navigation, packets, events, pending, tools, worldMap, setManual: () => { autoComplete = false; } };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('prepared teleport runtime resource gate', () => {
  it('walks to an explicit quest point on the current map after resource approval without opening navigation UI', async () => {
    const f = fixture(); f.mapRenderer.currentMap = 'prontera.gat';
    expect(await f.api.request({ outset: ['prontera', 3, 3], path: [['prontera', 3, 3]], direct: true })).toBe('navigation');
    expect(f.packets).toEqual([]);
    expect(f.navigation.navigateTo).toHaveBeenCalledExactlyOnceWith({
      startMap: 'prontera.gat', startX: 0, startY: 0, endMap: 'prontera', endX: 3, endY: 3, showWindow: false,
    });
    expect(f.navigation.show).not.toHaveBeenCalled();
    expect(f.events.slice(0, 3)).toEqual(['data/prontera.rsw', 'data/terrain.gnd', 'data/collision.gat']);
    f.api.cancel();
  });

  it('connects server rejection feedback to the waiting route without a later timeout or walk', async () => {
    const f = fixture();
    expect(await f.api.request({ outset: ['prontera', 0, 0], path: [['prontera', 3, 3]] })).toBe('teleport');
    f.tools._lastroTeleportRejected?.('传送失败：背包中没有 VIP 卡或传送券。');
    expect(f.tools._lastroPanels.setStatus).toHaveBeenLastCalledWith('传送失败：背包中没有 VIP 卡或传送券。');
    expect(vi.getTimerCount()).toBe(0);
    f.mapRenderer.currentMap = 'prontera.gat'; f.routeNavigation.onMapChanged();
    await vi.advanceTimersByTimeAsync(180000);
    expect(f.navigation.navigateTo).not.toHaveBeenCalled();
    expect(f.packets).toHaveLength(1);
  });
  it('checks real RSW references before constructing the original teleport packet', async () => {
    const f = fixture();
    expect(await f.api.request({ outset: ['prontera', 0, 0], path: [['prontera', 1, 1]] })).toBe('teleport');
    expect(f.events).toEqual(['data/prontera.rsw', 'data/terrain.gnd', 'data/collision.gat', 'packet']);
    expect(f.packets).toEqual([expect.objectContaining({ mapname: 'prontera', x: 0, y: 0, type: 1, itemid: 14527 })]);
    f.api.cancel();
  });

  it.each(['missing map', 'missing ground', 'out of bounds'])('sends no packet for %s', async failure => {
    const files = resources();
    if (failure === 'missing ground') files['data/terrain.gnd'] = null;
    const f = fixture(files);
    const map = failure === 'missing map' ? 'unknown' : 'prontera';
    await expect(f.api.request({ outset: [map, failure === 'out of bounds' ? 4 : 0, 0] })).rejects.toThrow();
    expect(f.packets).toEqual([]); f.api.cancel();
  });

  it('uses the native alias while preserving the requested server map name', async () => {
    const f = fixture(resources(), { 'dali02.rsw': 'prontera.rsw' });
    expect(await f.api.request({ outset: ['dali02', 0, 0] })).toBe('teleport');
    expect(f.events[0]).toBe('data/prontera.rsw');
    expect(f.packets).toEqual([expect.objectContaining({ mapname: 'dali02' })]); f.api.cancel();
  });

  it('returns from a timed-out raw read without sending when its callback later arrives', async () => {
    const f = fixture(); f.setManual();
    const result = f.api.request({ outset: ['prontera', 0, 0] });
    const rejected = expect(result).rejects.toThrow('无法读取地图资源');
    await vi.advanceTimersByTimeAsync(65000); await rejected;
    expect(f.pending).toHaveLength(1); f.pending[0]!(); await Promise.resolve();
    expect(f.packets).toEqual([]); f.api.cancel();
  });

  it('navigates a same-map route through the prepared adapter without showing a navigation window', async () => {
    const f = fixture(); f.mapRenderer.currentMap = 'prontera.gat';
    expect(await f.api.request({ outset: ['prontera', 0, 0], path: [['prontera', 3, 3]] })).toBe('navigation');
    expect(f.navigation.navigateTo).toHaveBeenCalledExactlyOnceWith({
      startMap: 'prontera.gat', startX: 0, startY: 0, endMap: 'prontera', endX: 3, endY: 3, showWindow: false,
    });
    expect(f.navigation.show).not.toHaveBeenCalled();
    expect(f.packets).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(f.navigation.navigateTo).toHaveBeenCalledOnce();
    expect(f.navigation.show).not.toHaveBeenCalled(); f.api.cancel();
  });

  it('continues a confirmed teleport route after map readiness without showing a navigation window', async () => {
    const f = fixture();
    expect(await f.api.request({ outset: ['prontera', 0, 0], path: [['prontera', 3, 3]] })).toBe('teleport');
    expect(f.packets).toEqual([expect.objectContaining({ mapname: 'prontera', x: 0, y: 0, type: 1 })]);
    expect(f.navigation.navigateTo).not.toHaveBeenCalled(); expect(f.navigation.show).not.toHaveBeenCalled();
    f.routeNavigation.onMapChanging(); f.mapRenderer.loading = true; f.mapRenderer.currentMap = 'prontera.gat';
    f.actor.position = [0, 1];
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.navigation.navigateTo).not.toHaveBeenCalled();
    f.mapRenderer.loading = false; f.routeNavigation.onMapChanged();
    expect(f.navigation.navigateTo).toHaveBeenCalledExactlyOnceWith({
      startMap: 'prontera.gat', startX: 0, startY: 1, endMap: 'prontera', endX: 3, endY: 3, showWindow: false,
    });
    expect(f.navigation.show).not.toHaveBeenCalled(); expect(f.packets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(f.navigation.navigateTo).toHaveBeenCalledOnce();
    expect(f.navigation.show).not.toHaveBeenCalled(); f.api.cancel();
  });
});
