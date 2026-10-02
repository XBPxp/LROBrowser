import { describe, expect, it, vi } from 'vitest';
import { createLastroTeleportPreflight } from '../scripts/lastro-teleport-preflight.mjs';

function signature(buffer: ArrayBuffer, value: string, major = 1, minor = 7) {
  new Uint8Array(buffer).set([...value].map((character) => character.charCodeAt(0)));
  new Uint8Array(buffer).set([major, minor], 4);
  return buffer;
}

function rsw(gnd = 'terrain.gnd', gat = 'altitude.gat', major = 1, minor = 9) {
  const version = major + minor / 10;
  const buffer = signature(new ArrayBuffer(300), 'GRSW', major, minor);
  const offset = 6 + (version >= 2.5 ? 4 : 0) + (version >= 2.2 ? 1 : 0);
  for (const [index, name] of [[offset + 40, gnd], [offset + 80, gat]] as const) {
    new Uint8Array(buffer).set([...name].map((character) => character.charCodeAt(0)), index);
  }
  return buffer;
}

function gnd(width = 10, height = 15) {
  const buffer = signature(new ArrayBuffer(46 + 28 * width * height), 'GRGN');
  const view = new DataView(buffer);
  view.setUint32(6, width, true);
  view.setUint32(10, height, true);
  view.setFloat32(14, 10, true);
  view.setUint32(22, 40, true);
  return buffer;
}

function gat(width = 20, height = 30) {
  const buffer = signature(new ArrayBuffer(14 + 20 * width * height), 'GRAT', 1, 2);
  const view = new DataView(buffer);
  view.setUint32(6, width, true);
  view.setUint32(10, height, true);
  return buffer;
}

function fixture(overrides: Record<string, unknown> = {}) {
  let currentMap: unknown = 'izlude.gat';
  const resources: Record<string, unknown> = {
    'data/destination.rsw': rsw(),
    'data/terrain.gnd': gnd(),
    'data/altitude.gat': gat(),
    ...overrides,
  };
  const loadFile = vi.fn(async (name: string) => {
    if (!(name in resources)) throw new Error('not found');
    return resources[name] as ArrayBuffer;
  });
  const getMap = vi.fn(() => currentMap);
  const preflight = createLastroTeleportPreflight({ loadFile, getMap });
  return { ...preflight, loadFile, getMap, setMap: (name: unknown) => { currentMap = name; } };
}

const route = () => ({ outset: ['destination', 3, 4], path: [['destination', 19, 29]] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('teleport resource preflight', () => {
  it('reads RSW resource references instead of assuming all files share a map name', async () => {
    const check = fixture();
    const approval = await check.check(route());
    expect(approval).toMatchObject({ approved: true, token: 1, maps: [{
      mapname: 'destination', width: 20, height: 30,
      rsw: 'data/destination.rsw', gnd: 'data/terrain.gnd', gat: 'data/altitude.gat',
    }] });
    expect(check.loadFile.mock.calls.map(([name]) => name)).toEqual([
      'data/destination.rsw', 'data/terrain.gnd', 'data/altitude.gat',
    ]);
  });

  it.each([[1, 0], [1, 3], [1, 4], [1, 9], [2, 1], [2, 2], [2, 5], [2, 6], [2, 7], [3, 0]])(
    'uses the bundled RSW field layout for version %i.%i', async (major, minor) => {
      const check = fixture({ 'data/destination.rsw': rsw('terrain.gnd', 'altitude.gat', major, minor) });
      await expect(check.check(route())).resolves.toMatchObject({ approved: true });
    },
  );

  it('validates every outset/path point, deduplicates maps, and reuses validated metadata on later checks', async () => {
    const check = fixture({ 'data/other.rsw': rsw() });
    const input = { outset: ['destination', 0, 0], path: [['other', 10, 20], ['destination', 19, 29]] };
    expect((await check.check(input)).maps.map((map) => map.mapname)).toEqual(['destination', 'other']);
    expect(check.loadFile).toHaveBeenCalledTimes(4);
    await check.check(input);
    expect(check.loadFile).toHaveBeenCalledTimes(4);
  });

  it('checks a later destination even if the outset has valid resources', async () => {
    const check = fixture();
    await expect(check.check({ ...route(), path: [['missing', 1, 2]] })).rejects.toMatchObject({
      code: 'RESOURCE_LOAD_FAILED', resource: 'data/missing.rsw',
    });
  });

  it('validates safe RSW directories without changing their raw case or separators for native alias lookup', async () => {
    const check = fixture({
      'data/destination.rsw': rsw('maps\\Terrain.gnd', 'maps/Altitude.gat'),
      'data/maps\\Terrain.gnd': gnd(), 'data/maps/Altitude.gat': gat(),
    });
    await expect(check.check(route())).resolves.toMatchObject({ maps: [{
      gnd: 'data/maps\\Terrain.gnd', gat: 'data/maps/Altitude.gat',
    }] });
    expect(check.loadFile).toHaveBeenCalledWith('data/maps\\Terrain.gnd');
    expect(check.loadFile).not.toHaveBeenCalledWith('data/maps/Terrain.gnd');
  });

  it('normalizes .gat and ASCII case while retaining the complete instance map name', async () => {
    const check = fixture({ 'data/1@abc-test.rsw': rsw() });
    const input = { path: [[' 123#1@ABC-Test.GAT ', 0, 0]] };
    await expect(check.check(input)).resolves.toMatchObject({ maps: [{ mapname: '123#1@abc-test' }] });
    expect(input.path[0]![0]).toBe(' 123#1@ABC-Test.GAT ');
    expect(check.loadFile).toHaveBeenCalledWith('data/1@abc-test.rsw');
  });

  it('accepts exactly 16 map characters, and coordinates at the 16-bit maximum when the GAT permits them', async () => {
    const check = fixture({
      'data/abcdefghijklmnop.rsw': rsw(),
      'data/terrain.gnd': gnd(32768, 1), 'data/altitude.gat': gat(65536, 2),
    });
    await expect(check.check({ path: [['abcdefghijklmnop.gat', 65535, 0]] })).resolves.toMatchObject({ approved: true });
  });

  it.each(['', 'abcdefghijklmnopq', '../izlude', '..\\izlude', '/izlude', 'data/izlude', 'izlude.rsw',
    'izlude.gat.gat', 'izlude%2f', 'izlude:80', 'izlude?x', 'izlude\0', 'izlüde', '地图']) (
    'rejects unsafe map name %j before any resource request', async (name) => {
      const check = fixture();
      await expect(check.check({ path: [[name, 1, 2]] })).rejects.toMatchObject({ code: 'INVALID_MAP' });
      expect(check.loadFile).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 65536, 1.5, NaN, Infinity, '1', null, undefined])(
    'rejects invalid coordinate %j before loading any map', async (coordinate) => {
      const check = fixture();
      await expect(check.check({ path: [['destination', coordinate, 1]] })).rejects.toMatchObject({ code: 'INVALID_COORDINATE' });
      await expect(check.check({ path: [['destination', 1, coordinate]] })).rejects.toMatchObject({ code: 'INVALID_COORDINATE' });
      expect(check.loadFile).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, [], {}, { path: [] }, { path: null, outset: null }, { path: 'destination' },
    { path: [[1, 2, 3]] }, { outset: [0, 0, 0], path: [] },
    { outset: ['destination', 1] }, { path: [['destination', 1, 2, 3]] }])(
    'rejects malformed route %j without filtering away invalid points', async (input) => {
      const check = fixture();
      await expect(check.check(input)).rejects.toBeInstanceOf(Error);
      expect(check.loadFile).not.toHaveBeenCalled();
    },
  );

  it('validates all route inputs before making the first resource request', async () => {
    const check = fixture();
    await expect(check.check({ outset: ['destination', 0, 0], path: [['../unsafe', 0, 0]] }))
      .rejects.toMatchObject({ code: 'INVALID_MAP' });
    expect(check.loadFile).not.toHaveBeenCalled();
  });

  it.each(['../terrain.gnd', 'maps/../../terrain.gnd', '\\terrain.gnd', '/terrain.gnd', 'maps//terrain.gnd',
    './terrain.gnd', 'https://host/terrain.gnd', 'c:\\terrain.gnd', 'terrain%2fgnd.gnd', 'térain.gnd',
    'terrain.gat', ''])('rejects unsafe RSW GND reference %j before requesting it', async (reference) => {
      const check = fixture({ 'data/destination.rsw': rsw(reference) });
      await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
      expect(check.loadFile).toHaveBeenCalledTimes(1);
    });

  it('checks GAT reference safety independently of the GND reference', async () => {
    const check = fixture({ 'data/destination.rsw': rsw('terrain.gnd', '..\\altitude.gat') });
    await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    expect(check.loadFile).toHaveBeenCalledTimes(1);
  });

  it.each([1, 5, 45, 85, 125, 165])('rejects truncated RSW headers/references at %i bytes', async (size) => {
    const check = fixture({ 'data/destination.rsw': rsw().slice(0, size) });
    await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_RESOURCE' });
    expect(check.loadFile).toHaveBeenCalledTimes(1);
  });

  it.each(['data/destination.rsw', 'data/terrain.gnd', 'data/altitude.gat'])('rejects an HTML or wrong-signature body for %s', async (resource) => {
    const check = fixture({ [resource]: new TextEncoder().encode('<html>missing resource</html>'.repeat(10)).buffer });
    await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_RESOURCE', resource });
  });

  it.each([null, undefined, new Uint8Array(100), { width: 20, height: 30, cells: [] }])(
    'rejects non-ArrayBuffer resource values rather than trusting decoded objects', async (value) => {
      const check = fixture({ 'data/destination.rsw': value });
      await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_RESOURCE' });
    },
  );

  it.each([[0, 1], [1, 0], [65537, 1], [1, 65537]])('rejects invalid GAT dimensions %i × %i', async (width, height) => {
    const altitude = gat(1, 1);
    new DataView(altitude).setUint32(6, width, true);
    new DataView(altitude).setUint32(10, height, true);
    const check = fixture({ 'data/altitude.gat': altitude });
    await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_RESOURCE' });
  });

  it('rejects a GAT whose claimed grid extends past its actual cells', async () => {
    const check = fixture({ 'data/altitude.gat': gat().slice(0, -1) });
    await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_RESOURCE', resource: 'data/altitude.gat' });
  });

  it.each([[20, 1], [1, 30], [0, 30], [20, 0]])('rejects a coordinate at or beyond a GAT boundary (%i,%i)', async (x, y) => {
    const check = fixture();
    await expect(check.check({ path: [['destination', x, y]] })).rejects.toMatchObject({ code: 'OUT_OF_BOUNDS' });
  });

  it('uses GAT dimensions rather than the half-size GND grid for coordinates', async () => {
    const check = fixture();
    await expect(check.check({ path: [['destination', 19, 29]] })).resolves.toMatchObject({ approved: true });
  });

  it.each([[21, 30], [20, 31], [10, 15]])('rejects a GAT %i × %i that does not match the GND at double resolution', async (width, height) => {
    const check = fixture({ 'data/altitude.gat': gat(width, height) });
    await expect(check.check({ path: [['destination', 0, 0]] })).rejects.toMatchObject({
      code: 'INVALID_RESOURCE', resource: 'data/altitude.gat',
      message: '地图地形与坐标资源的尺寸不一致：data/destination.rsw',
    });
  });

  it.each([0, -1, NaN, Infinity])('rejects unreasonable GND zoom %j', async (zoom) => {
    const ground = gnd();
    new DataView(ground).setFloat32(14, zoom, true);
    const check = fixture({ 'data/terrain.gnd': ground });
    await expect(check.check(route())).rejects.toMatchObject({ code: 'INVALID_RESOURCE', resource: 'data/terrain.gnd' });
  });

  it.each([undefined, '', '../izlude', 1])('requires a ready current map (%j)', async (map) => {
    const check = fixture();
    check.setMap(map);
    await expect(check.check(route())).rejects.toMatchObject({ code: 'MAP_NOT_READY' });
    expect(check.loadFile).not.toHaveBeenCalled();
  });

  it('does not change destination validation when the route object is modified during a resource read', async () => {
    const pending = deferred<ArrayBuffer>();
    const check = fixture();
    check.loadFile.mockImplementationOnce(() => pending.promise);
    const input = route();
    const approval = check.check(input);
    await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledTimes(1));
    input.path[0]![1] = 65535;
    input.outset[0] = '../unsafe';
    pending.resolve(rsw());
    await expect(approval).resolves.toMatchObject({ approved: true, maps: [{ mapname: 'destination' }] });
  });

  it('cancel settles a pending check immediately and a late resource cannot approve it', async () => {
    const pending = deferred<ArrayBuffer>();
    const check = fixture();
    check.loadFile.mockImplementationOnce(() => pending.promise);
    const outcome = check.check(route()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledTimes(1));
    check.cancel();
    expect(await outcome).toMatchObject({ name: 'AbortError', code: 'CANCELLED' });
    pending.resolve(rsw());
    await Promise.resolve();
    expect(check.loadFile).toHaveBeenCalledTimes(1);
    await expect(check.check(route())).resolves.toMatchObject({ approved: true });
  });

  it('a newer check supersedes an older pending check, even if the old map later loads successfully', async () => {
    const pending = deferred<ArrayBuffer>();
    const check = fixture();
    check.loadFile.mockImplementationOnce(() => pending.promise);
    const old = check.check(route()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledTimes(1));
    const approval = await check.check(route());
    expect(approval).toMatchObject({ approved: true, token: 2 });
    expect(await old).toMatchObject({ name: 'AbortError' });
    pending.resolve(rsw());
    await Promise.resolve();
    expect(check.loadFile).toHaveBeenCalledTimes(4);
  });

  it('an invalid newer check still cancels the previous request', async () => {
    const pending = deferred<ArrayBuffer>();
    const check = fixture();
    check.loadFile.mockImplementationOnce(() => pending.promise);
    const old = check.check(route()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledTimes(1));
    await expect(check.check({ path: [['../unsafe', 0, 0]] })).rejects.toMatchObject({ code: 'INVALID_MAP' });
    expect(await old).toMatchObject({ name: 'AbortError' });
    pending.resolve(rsw());
  });

  it('changing or removing the current map while loading cancels approval', async () => {
    for (const nextMap of ['prontera.gat', undefined]) {
      const pending = deferred<ArrayBuffer>();
      const check = fixture();
      check.loadFile.mockImplementationOnce(() => pending.promise);
      const outcome = check.check(route()).catch((error: unknown) => error);
      await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledTimes(1));
      check.setMap(nextMap);
      pending.resolve(rsw());
      expect(await outcome).toMatchObject({ name: 'AbortError', code: 'CANCELLED' });
      expect(check.loadFile).toHaveBeenCalledTimes(1);
    }
  });

  it('checks the current map again immediately before returning approval', async () => {
    const check = fixture();
    check.getMap.mockImplementation(() => check.loadFile.mock.calls.length >= 3 ? 'other.gat' : 'izlude.gat');
    await expect(check.check(route())).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' });
  });

  it('cancellation wins over a late resource error without an unhandled rejection', async () => {
    const pending = deferred<ArrayBuffer>();
    const check = fixture();
    check.loadFile.mockImplementationOnce(() => pending.promise);
    const outcome = check.check(route()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledTimes(1));
    check.cancel();
    pending.reject(new Error('late HTTP failure'));
    expect(await outcome).toMatchObject({ name: 'AbortError', code: 'CANCELLED' });
  });

  it('is standalone when serialized into the generated runtime', async () => {
    const install = new Function(`return (${createLastroTeleportPreflight.toString()});`)() as typeof createLastroTeleportPreflight;
    const resources: Record<string, ArrayBuffer> = {
      'data/destination.rsw': rsw(), 'data/terrain.gnd': gnd(), 'data/altitude.gat': gat(),
    };
    const check = install({ loadFile: async (name) => resources[name]!, getMap: () => 'izlude.gat' });
    await expect(check.check(route())).resolves.toMatchObject({ approved: true });
  });

  it('returns a concise Chinese resource error without including a loader URL or stack message', async () => {
    const check = fixture();
    check.loadFile.mockRejectedValue(new Error('HTTP 404 https://example.invalid/long/url?token=private-value'));
    await expect(check.check(route())).rejects.toMatchObject({
      message: '无法读取地图资源：data/destination.rsw',
      code: 'RESOURCE_LOAD_FAILED', resource: 'data/destination.rsw',
    });
  });

  it('rechecks coordinates and current map on a warm metadata hit without caching route approval', async () => {
    const check = fixture();
    await check.check(route());
    await expect(check.check({ path: [['destination', 20, 0]] })).rejects.toMatchObject({ code: 'OUT_OF_BOUNDS' });
    await expect(check.check({ path: [['destination', 0, 0]] })).resolves.toMatchObject({ approved: true });
    expect(check.loadFile).toHaveBeenCalledTimes(3);
    check.setMap(undefined);
    await expect(check.check(route())).rejects.toMatchObject({ code: 'MAP_NOT_READY' });
    expect(check.loadFile).toHaveBeenCalledTimes(3);
  });

  it('returns fresh metadata objects so a caller cannot alter the cached dimensions or references', async () => {
    const check = fixture();
    const first = await check.check(route());
    Object.assign(first.maps[0]!, { width: 65536, gat: 'data/unsafe.gat', mapname: 'other' });
    first.maps.push({ ...first.maps[0]! });
    const second = await check.check(route());
    expect(second.maps).toEqual([{ mapname: 'destination', width: 20, height: 30,
      rsw: 'data/destination.rsw', gnd: 'data/terrain.gnd', gat: 'data/altitude.gat' }]);
    await expect(check.check({ path: [['destination', 30, 0]] })).rejects.toMatchObject({ code: 'OUT_OF_BOUNDS' });
    expect(check.loadFile).toHaveBeenCalledTimes(3);
  });

  it('shares physical instance metadata but preserves each full server map ID and its coordinate checks', async () => {
    const check = fixture({ 'data/1@abc.rsw': rsw() });
    const first = await check.check({ path: [['1231@abc', 1, 2], ['4561@abc', 19, 29]] });
    expect(first.maps.map((map) => map.mapname)).toEqual(['1231@abc', '4561@abc']);
    expect(check.loadFile).toHaveBeenCalledTimes(3);
    await check.check({ path: [['789#1@abc', 0, 0]] });
    await expect(check.check({ path: [['789#1@abc', 20, 0]] })).rejects.toMatchObject({ code: 'OUT_OF_BOUNDS' });
    expect(check.loadFile).toHaveBeenCalledTimes(3);
  });

  it('expires metadata five minutes after validation even when it has been used recently', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000_000);
      const check = fixture();
      await check.check(route());
      vi.setSystemTime(1_299_999);
      await check.check(route());
      expect(check.loadFile).toHaveBeenCalledTimes(3);
      vi.setSystemTime(1_300_000);
      await check.check(route());
      expect(check.loadFile).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains at most 64 physical maps and evicts the least recently used map', async () => {
    const loadFile = vi.fn(async (name: string) => name.endsWith('.rsw') ? rsw() : name.endsWith('.gnd') ? gnd() : gat());
    const check = createLastroTeleportPreflight({ loadFile, getMap: () => 'izlude' });
    const visit = (index: number) => check.check({ path: [[`map${index}`, 0, 0]] });
    for (let index = 0; index < 64; index++) await visit(index);
    await visit(0);
    await visit(64);
    await visit(1);
    await visit(0);
    expect(loadFile).toHaveBeenCalledTimes(198);
    expect(loadFile.mock.calls.filter(([name]) => name === 'data/map0.rsw')).toHaveLength(1);
    expect(loadFile.mock.calls.filter(([name]) => name === 'data/map1.rsw')).toHaveLength(2);
  });

  it('clears successful metadata whenever the server profile changes, including switching back', async () => {
    let profile = '1:20260101';
    const check = fixture();
    const preflight = createLastroTeleportPreflight({ loadFile: check.loadFile, getMap: check.getMap, getProfile: () => profile });
    await preflight.check(route());
    await preflight.check(route());
    expect(check.loadFile).toHaveBeenCalledTimes(3);
    profile = '2:20260101';
    await preflight.check(route());
    expect(check.loadFile).toHaveBeenCalledTimes(6);
    profile = '1:20260101';
    await preflight.check(route());
    expect(check.loadFile).toHaveBeenCalledTimes(9);
  });

  it('rejects a profile change during a pending resource read and does not cache its late result', async () => {
    let profile = '1:20260101';
    const pending = deferred<ArrayBuffer>();
    const check = fixture();
    check.loadFile.mockImplementationOnce(() => pending.promise);
    const preflight = createLastroTeleportPreflight({ loadFile: check.loadFile, getMap: check.getMap, getProfile: () => profile });
    const outcome = preflight.check(route()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledTimes(1));
    profile = '2:20260101';
    pending.resolve(rsw());
    expect(await outcome).toMatchObject({ name: 'AbortError', code: 'CANCELLED' });
    await preflight.check(route());
    expect(check.loadFile).toHaveBeenCalledTimes(4);
  });

  it('checks profile and cancellation again before returning a warm approval', async () => {
    let profile = 'one';
    const check = fixture();
    const getProfile = vi.fn(() => profile);
    const preflight = createLastroTeleportPreflight({ loadFile: check.loadFile, getMap: check.getMap, getProfile });
    await preflight.check(route());
    getProfile.mockImplementationOnce(() => 'one').mockImplementation(() => 'two');
    await expect(preflight.check(route())).rejects.toMatchObject({ name: 'AbortError' });
    profile = 'two';
    getProfile.mockImplementation(() => profile);
    await preflight.check(route());
    const warm = preflight.check(route());
    preflight.cancel();
    await expect(warm).rejects.toMatchObject({ name: 'AbortError' });
    expect(check.loadFile).toHaveBeenCalledTimes(6);
  });

  it('does not cache fresh metadata when the route fails coordinate validation', async () => {
    const check = fixture();
    await expect(check.check({ path: [['destination', 20, 0]] })).rejects.toMatchObject({ code: 'OUT_OF_BOUNDS' });
    await check.check(route());
    expect(check.loadFile).toHaveBeenCalledTimes(6);
  });

  it.each(['failure', 'cancel'] as const)('does not cache a completed map when another map ends in %s', async (ending) => {
    const pending = deferred<ArrayBuffer>();
    const check = fixture();
    const nativeLoad = check.loadFile.getMockImplementation()!;
    check.loadFile.mockImplementation((name) => name === 'data/other.rsw' ? pending.promise : nativeLoad(name));
    const outcome = check.check({ path: [['destination', 0, 0], ['other', 0, 0]] }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(check.loadFile).toHaveBeenCalledWith('data/altitude.gat'));
    await Promise.resolve();
    if (ending === 'cancel') check.cancel();
    else pending.resolve(new ArrayBuffer(100));
    expect(await outcome).toMatchObject({ code: ending === 'cancel' ? 'CANCELLED' : 'INVALID_RESOURCE' });
    const before = check.loadFile.mock.calls.length;
    await check.check(route());
    expect(check.loadFile).toHaveBeenCalledTimes(before + 3);
    pending.resolve(rsw());
    await Promise.resolve();
    await check.check(route());
    expect(check.loadFile).toHaveBeenCalledTimes(before + 3);
  });

  it('validates at most two cold physical maps concurrently and returns them in route order', async () => {
    const altitude = new Map(['first', 'second', 'third'].map((name) => [name, deferred<ArrayBuffer>()]));
    let activeMaps = 0;
    let maximum = 0;
    const loadFile = vi.fn(async (resource: string) => {
      const name = resource.slice(5).split('.')[0]!;
      if (resource.endsWith('.rsw')) {
        maximum = Math.max(maximum, ++activeMaps);
        return rsw(`${name}.gnd`, `${name}.gat`);
      }
      if (resource.endsWith('.gnd')) return gnd();
      return altitude.get(name)!.promise.finally(() => { activeMaps--; });
    });
    const check = createLastroTeleportPreflight({ loadFile, getMap: () => 'izlude' });
    const approval = check.check({ path: [['first', 0, 0], ['second', 0, 0], ['third', 0, 0]] });
    await vi.waitFor(() => expect(loadFile).toHaveBeenCalledWith('data/second.gat'));
    expect(loadFile).toHaveBeenCalledWith('data/first.gat');
    expect(loadFile).not.toHaveBeenCalledWith('data/third.rsw');
    altitude.get('second')!.resolve(gat());
    await vi.waitFor(() => expect(loadFile).toHaveBeenCalledWith('data/third.gat'));
    altitude.get('third')!.resolve(gat());
    altitude.get('first')!.resolve(gat());
    expect((await approval).maps.map((map) => map.mapname)).toEqual(['first', 'second', 'third']);
    expect(maximum).toBe(2);
    expect(activeMaps).toBe(0);
    expect(loadFile).toHaveBeenCalledTimes(9);
  });
});
