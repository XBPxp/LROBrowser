import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patchRuntimeToolsPanels, patchRuntimeWorldMap } from '../scripts/patch-v2-runtime.mjs';
import { describeLastroMapLoadFailure } from '../scripts/lastro-map-load-diagnostic.mjs';
import { MemoryResourceCache } from '../src/resources/resource-cache';
import { resolvePassiveResource } from '../src/resources/resource-resolver';
import { mapBinaryFixture } from './map-binary-fixture';

const { buildPrivateAirshipRequest } = await import(new URL('../vendor/v2/lastro-v1-migration.mjs', import.meta.url).href);
const vendor = readFileSync('vendor/v2/Online.js', 'utf8');
const toolsRuntime = patchRuntimeToolsPanels(vendor), worldRuntime = patchRuntimeWorldMap(vendor);
const toolsStart = toolsRuntime.indexOf('const lastroSendRouteTeleport =');
const toolsInstallation = toolsRuntime.slice(toolsStart, toolsRuntime.indexOf('(function installLastroToolsPanels', toolsStart));
const worldStart = worldRuntime.indexOf('const lastroWorldMapPreflight =');
const worldInstallation = worldRuntime.slice(worldStart, worldRuntime.indexOf('WorldMap.render =', worldStart));
if (toolsStart < 0 || worldStart < 0 || !toolsInstallation || !worldInstallation) throw new Error('Missing native teleport installation');

function region(name: string, source = vendor) {
  const start = source.indexOf('//#region ' + name), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error('Missing native region: ' + name);
  return ts.createSourceFile(name, source.slice(start, end), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

const worldFile = region('src/UI/Components/WorldMap/WorldMap.js', worldRuntime);
let worldActions = '';
function findWorldActions(node: ts.Node) {
  if (ts.isCallExpression(node) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
    const properties = node.arguments[1].properties.filter(property => ts.isPropertyAssignment(property) && ['navigate', 'teleport', 'cancelTeleport'].includes(property.name.getText(worldFile)));
    if (properties.length === 3) worldActions = '{' + properties.map(property => property.getText(worldFile)).join(',') + '}';
  }
  ts.forEachChild(node, findWorldActions);
}
findWorldActions(worldFile);
if (!worldActions) throw new Error('Missing world map action adapters');

const navigationFile = region('src/UI/Components/Navigation/Navigation.js');
const navigationMethods: Record<string, string> = {};
let nativeNormalizeMap = '';
function findNavigation(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeMapName') nativeNormalizeMap = node.getText(navigationFile);
  if (ts.isBinaryExpression(node) && ts.isFunctionExpression(node.right)) {
    const name = node.left.getText(navigationFile);
    if (['Navigation.clear', 'Navigation.renderCanvas'].includes(name)) navigationMethods[name] = node.right.getText(navigationFile);
  }
  ts.forEachChild(node, findNavigation);
}
findNavigation(navigationFile);
if (Object.keys(navigationMethods).length !== 2 || !nativeNormalizeMap) throw new Error('Missing native navigation methods');

function nativeNavigation(state: { currentMap: string; position: number[] }) {
  const move = vi.fn();
  const navigation = new Function('state', 'requestNavigationMove', `
    ${nativeNormalizeMap}
    let _finalTargetData = null, _targetData = null, _path = [], _isMapClickTarget = false;
    let _lastPathUpdate = 0, _pathUpdateThrottle = 1000, _pathUpdateLock = false;
    const SessionStorage_default = { Entity: { walk: { total: 0 } } };
    const getCurrentMap = () => state.currentMap.replace(/\\.gat$/i, '');
    const getPlayerPosition = () => ({ x: state.position[0], y: state.position[1] });
    const isNavigationTargetReached = () => false;
    const Navigation = {
      _host: null,
      getRoot: () => ({ querySelector: () => null }),
      setLocationTitle() {}, clearPath() { _path = []; },
      navigateTo(options) {
        _finalTargetData = { map: options.endMap, x: options.endX, y: options.endY };
        _targetData = _finalTargetData; _path = [{ x: 0, y: 0 }, _targetData];
      },
      getTarget: () => _finalTargetData,
    };
    Navigation.clear = ${navigationMethods['Navigation.clear']};
    Navigation.renderCanvas = ${navigationMethods['Navigation.renderCanvas']};
    return Navigation;
  `)(state, move);
  navigation.__loaded = true;
  navigation.navigateTo = vi.fn(navigation.navigateTo);
  navigation.clear = vi.fn(navigation.clear);
  navigation.show = vi.fn();
  return { navigation, move };
}

const rendererFile = region('src/Renderer/MapRenderer.js');
let nativeSetMap = '', nativeStripExtension = '';
function findRenderer(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'stripMapExtension') nativeStripExtension = node.getText(rendererFile);
  if (ts.isMethodDeclaration(node) && node.name.getText(rendererFile) === 'setMap') nativeSetMap = node.getText(rendererFile).replace(/^static /, '');
  ts.forEachChild(node, findRenderer);
}
findRenderer(rendererFile);
if (!nativeSetMap || !nativeStripExtension) throw new Error('Missing native scene map normalization');

function nativeSceneFilename(mapname: string): string {
  return new Function('mapname', `
    ${nativeStripExtension}
    let filename;
    const MapRenderer = { loading: false, currentMap: '', free() {} };
    const SoundManager = { stop() {} }, Renderer = { stop() {}, remove() {} };
    const UIManager = { removeComponents() {} }, Cursor = { ACTION: { DEFAULT: 0 }, setType() {} };
    const BGM = { stop() {} }, Background = { setLoading(callback) { callback(); } };
    const Thread = { hook() {}, send(type, file) { filename = file; } };
    function onProgressUpdate() {} function onWorldComplete() {} function onGroundComplete() {}
    function onAltitudeComplete() {} function onModelsComplete() {} function onAnimatedModelComplete() {} function onMapComplete() {}
    ({ ${nativeSetMap} }).setMap.call(MapRenderer, mapname);
    return filename;
  `)(mapname);
}

function resources() {
  const rsw = mapBinaryFixture('rsw');
  new Uint8Array(rsw).set(new TextEncoder().encode('terrain.gnd'), 51);
  new Uint8Array(rsw).set(new TextEncoder().encode('collision.gat'), 91);
  const ground = new Uint8Array(mapBinaryFixture('gnd'));
  const cellOffset = ground.length - 56 - 28;
  const gnd = new ArrayBuffer(ground.length + 3 * 28), expanded = new Uint8Array(gnd);
  expanded.set(ground.subarray(0, cellOffset));
  for (let index = 0; index < 4; index++) expanded.set(ground.subarray(cellOffset, cellOffset + 28), cellOffset + index * 28);
  expanded.set(ground.subarray(cellOffset + 28), cellOffset + 4 * 28);
  const groundView = new DataView(gnd);
  groundView.setUint32(6, 2, true); groundView.setUint32(10, 2, true); groundView.setFloat32(14, 10, true);
  const gat = new ArrayBuffer(14 + 20 * 16);
  new Uint8Array(gat).set([71, 82, 65, 84, 1, 2]);
  new DataView(gat).setUint32(6, 4, true); new DataView(gat).setUint32(10, 4, true);
  return Object.fromEntries([
    ...['izlude', 'izlude_in', 'payon', '1@abc-test'].map(map => [`data/${map}.rsw`, rsw]),
    ['data/terrain.gnd', gnd], ['data/collision.gat', gat],
  ]) as Record<string, ArrayBuffer>;
}

function fixture() {
  const files = resources(), cache = new MemoryResourceCache();
  const reads: string[] = [], urls: string[] = [], packets: Array<{ mapname: string; type: number }> = [], pending: Array<() => Promise<void>> = [];
  const state = { currentMap: 'izlude.gat', loading: false, position: [0, 0] };
  const { navigation, move } = nativeNavigation(state);
  // Supply the native GUI lifecycle required by the shared shortcut-entry capture;
  // this fixture exercises route/navigation lifecycle without appending the UI.
  const tools = { render: vi.fn(() => ''), init: vi.fn(),
    _lastroPanels: { setStatus: vi.fn(), cancelRoute: () => {} } };
  const prompts: Array<{ message: string; yes(): void; no(): void }> = [];
  const uiManager = { showErrorBox: vi.fn(), showPromptBox: vi.fn((message: string, ok: string, cancel: string, yes: () => void, no: () => void) => {
    expect([ok, cancel]).toEqual(['ok', 'cancel']);
    prompts.push({ message, yes, no });
    const popup = { onRemove: () => {}, remove: () => popup.onRemove() };
    return popup;
  }) };
  const actor = { get position() { return state.position; } };
  let manual = false;
  const thread = { send(type: string, input: { filename: string }, callback: (bytes: ArrayBuffer | null, error?: string) => void) {
    expect(type).toBe('GET_FILE'); reads.push(input.filename);
    const complete = async () => {
      try {
        const bytes = await resolvePassiveResource(input.filename, { cache, fetch: async url => {
          urls.push(String(url));
          const path = decodeURIComponent(new URL(String(url)).pathname).replace('/ro/client_re/', '');
          return files[path] ? new Response(files[path], { headers: { 'content-type': 'application/octet-stream' } }) : new Response(null, { status: 404 });
        } });
        callback(bytes);
      } catch (error) { callback(null, String(error)); }
    };
    if (manual) pending.push(complete); else void complete();
  } };
  const network = { sendPacket: (packet: { mapname: string; type: number }) => packets.push(packet) };
  const packet = { CZ: { PRIVATE_AIRSHIP_REQUEST: class {} } }, configs = { get: () => 5 }, db = { mapalias: {} };
  const normalize = (map: string) => map.replace(/\.gat$/i, '').toLowerCase();
  const world = new Function('Thread', 'DB', 'MapRenderer', 'Configs', 'PACKET', 'Network', 'buildPrivateAirshipRequest', 'normalizeLastROTeleportMap', 'UIManager', 'console', 'describeLastroMapLoadFailure', 'GUIComponent', `
    let WorldMap;
    ${worldInstallation}
    return { api: lastroWorldMapTeleport, component: WorldMap };
  `)(thread, db, state, configs, packet, network, buildPrivateAirshipRequest, normalize, uiManager, { warn() {} }, describeLastroMapLoadFailure, class {});
  const route = new Function('Thread', 'MapRenderer', 'SessionStorage_default', 'PACKET', 'Network', 'Configs', 'Navigation_default', 'LastROTools', 'normalizeLastROTeleportMap', 'buildPrivateAirshipRequest', 'DB', 'console', 'WorldMap_default', `
    ${toolsInstallation}
    return { api: lastroVerifiedRouteRequest, navigation: lastroRouteNavigation };
  `)(thread, state, { Entity: actor }, packet, network, configs, navigation, tools, normalize, buildPrivateAirshipRequest, db, { warn() {} }, world.component);
  tools._lastroPanels.cancelRoute = () => route.api.cancel();
  const installActions = new Function('MapRenderer', 'SessionStorage_default', 'Navigation_default', 'LastROTools', 'normalizeLastROTeleportMap', 'showLastroTeleportNotice', 'lastroWorldMapTeleport', `return ${worldActions};`);
  const actions = installActions(state, { Entity: actor }, navigation, tools, normalize, vi.fn(), world.api);
  return { route, world, actions, state, native: navigation, move, tools, reads, urls, packets, pending, prompts, manual: (value: boolean) => { manual = value; } };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('native navigation and resource route lifecycle', () => {
  it('stops the native renderer from sending movement after a route times out', async () => {
    const f = fixture();
    await f.route.api.request({ path: [['izlude', 3, 3]] });
    f.native.renderCanvas(0); expect(f.move).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(180000);
    expect(f.tools._lastroPanels.setStatus).toHaveBeenLastCalledWith('导航超时，请重新选择地点');
    expect(f.native.getTarget()).toBeNull();
    f.native.renderCanvas(0); expect(f.move).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['navigate', 'teleport'])('a world map %s replaces an active tools itinerary without reviving its NPC target', async action => {
    const f = fixture();
    await f.route.api.request({ outset: ['izlude', 0, 0], path: [['izlude', 3, 3], ['izlude_in', 3, 3]] });
    const replacement = f.actions[action]('izlude_in');
    if (action === 'teleport') { expect(f.prompts).toHaveLength(1); f.prompts[0]!.yes(); }
    await replacement;
    f.route.navigation.onMapChanging(); f.state.currentMap = 'izlude_in.gat'; f.route.navigation.onMapChanged();
    expect(f.native.getTarget()).toEqual(action === 'navigate' ? { map: 'izlude_in', x: 0, y: 0 } : null);
    expect(f.native.show).toHaveBeenCalledTimes(action === 'navigate' ? 1 : 0);
    f.route.api.cancel();
  });

  it.each(['world', 'tools'])('a newer %s request cancels the other pending resource check', async newest => {
    const f = fixture(); f.manual(true);
    const old = newest === 'world' ? f.route.api.request({ outset: ['payon', 3, 3] }) : f.actions.teleport('izlude_in');
    if (newest === 'tools') { expect(f.prompts).toHaveLength(1); f.prompts[0]!.yes(); }
    await vi.advanceTimersByTimeAsync(0); expect(f.pending).toHaveLength(1);
    const replacement = newest === 'world' ? f.actions.teleport('izlude_in') : f.route.api.request({ outset: ['payon', 3, 3] });
    if (newest === 'world') { expect(f.prompts).toHaveLength(1); f.prompts[0]!.yes(); }
    expect(await old).toBe(newest === 'world' ? null : false);
    await vi.advanceTimersByTimeAsync(0); expect(f.pending).toHaveLength(2);
    f.manual(false); await f.pending[1]!();
    expect(await replacement).toBe(newest === 'world' ? true : 'teleport');
    await f.pending[0]!();
    expect(f.packets).toEqual([expect.objectContaining({ mapname: newest === 'world' ? 'izlude_in' : 'payon', type: newest === 'world' ? 0 : 1 })]);
    f.route.api.cancel();
  });

  it.each(['123#1@abc-test', '1231@abc-test'])('loads the native scene resource through the real resolver while retaining server instance ID %s', async serverMap => {
    const f = fixture();
    const scene = nativeSceneFilename(serverMap + '.gat');
    const request = f.actions.teleport(serverMap);
    expect(f.prompts).toHaveLength(1); expect(f.reads).toEqual([]); expect(f.packets).toEqual([]);
    f.prompts[0]!.yes();
    expect(await request).toBe(true);
    expect(f.reads[0]).toBe('data/' + scene);
    expect(f.urls.some(url => url.includes('#') || url.includes(serverMap))).toBe(false);
    expect(f.packets).toEqual([expect.objectContaining({ mapname: serverMap, type: 0 })]);
    const forbiddenFetch = vi.fn();
    await expect(resolvePassiveResource('data/' + serverMap.replace(/^1231@/, '123#1@') + '.rsw', { fetch: forbiddenFetch })).rejects.toThrow('forbidden-resource');
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
});
