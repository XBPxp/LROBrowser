// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLastroChatMapLinks } from '../scripts/lastro-chat-map-links.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

const message = "[活动] <span class='mapname' data-map='force_map3#100#184'>点击前往</span>";
afterEach(() => document.body.replaceChildren());
function helper(currentMap = 'force_map3') {
  const state = { map: currentMap, allowed: true };
  const navigate = vi.fn(), teleport = vi.fn(), onError = vi.fn();
  let yes: () => void = () => {}, no: () => void = () => {};
  const showPrompt = vi.fn((_message: string, accept: () => void, cancel: () => void) => { yes = accept; no = cancel; return {}; });
  const links = createLastroChatMapLinks({ setHtml: setLastROInnerHTML, showPrompt, teleport, navigate, onError,
    getMap: () => state.map, canTeleport: () => state.allowed });
  const parent = document.createElement('div'); links.render(parent, message); document.body.append(parent);
  const link = parent.querySelector('a')!;
  return { links, link, state, navigate, teleport, onError, showPrompt, yes: () => yes(), no: () => no() };
}

describe('activity link same-map helper', () => {
  it.each(['force_map3', 'FORCE_MAP3.GAT', ' force_map3.rsw '])('navigates directly on %s without prompt or airship', map => {
    const f = helper(map); expect(f.links.request(f.link)).toBe(true);
    expect(f.navigate).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
    expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.teleport).not.toHaveBeenCalled();
  });
  it('allows native walking when the private-airship packet is unavailable', () => {
    const f = helper(); f.state.allowed = false; f.links.request(f.link);
    expect(f.navigate).toHaveBeenCalledOnce(); expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.teleport).not.toHaveBeenCalled();
  });
  it('freshly compares the map when native confirmation completes', () => {
    const f = helper('prontera'); f.links.request(f.link); expect(f.showPrompt).toHaveBeenCalledOnce();
    f.state.map = 'FORCE_MAP3.GAT'; f.state.allowed = false; f.yes(); f.yes();
    expect(f.navigate).toHaveBeenCalledOnce(); expect(f.teleport).not.toHaveBeenCalled();
  });
  it('keeps cross-map confirmation and checks availability again at confirmation', () => {
    const f = helper('prontera'); f.links.request(f.link); expect(f.teleport).not.toHaveBeenCalled(); f.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
    f.links.request(f.link); f.state.allowed = false; f.yes(); expect(f.teleport).toHaveBeenCalledOnce();
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('cancel does not travel even when the player moved to the target map', () => {
    const f = helper('prontera'); f.links.request(f.link); f.state.map = 'force_map3'; f.no();
    expect(f.navigate).not.toHaveBeenCalled(); expect(f.teleport).not.toHaveBeenCalled();
  });
  it('recovers a navigation error without falling back to an airship request', () => {
    const f = helper(); f.navigate.mockImplementation(() => { throw new Error('地图未就绪'); });
    expect(f.links.request(f.link)).toBe(false); expect(f.onError).toHaveBeenCalledOnce();
    expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.teleport).not.toHaveBeenCalled();
  });
});

function loadRuntimeFixtureCode() {
  const runtime = readFileSync('generated/runtime/Online.js', 'utf8');
  const prefixEnd = runtime.indexOf('//#region');
  if (prefixEnd < 0) throw new Error('Missing final generated runtime prefix');
  const region = (path: string) => {
    const marker = '//#region ' + path, start = runtime.indexOf(marker);
    if (start < 0 || runtime.indexOf(marker, start + marker.length) >= 0) throw new Error('Missing/ambiguous final runtime region: ' + path);
    const end = runtime.indexOf('//#endregion', start);
    if (end < start) throw new Error('Unterminated final runtime region: ' + path);
    return runtime.slice(start, end);
  };
  // Inspect only the real adapter and its dependencies, once. Cache source text,
  // not a full bundle AST or the mutable state belonging to each test instance.
  const source = [runtime.slice(0, prefixEnd),
    region('src/UI/Components/Navigation/MapPathFinder.js'),
    region('src/UI/Components/Navigation/Navigation.js'),
    region('src/UI/Components/LastROTools/LastROTools.js'),
  ].join('\n');
  const file = ts.createSourceFile('activity-fixture.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let factory: ts.CallExpression | undefined;
  const functions = new Map<string, string>(), navigation: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'LastROChatMapLinks' && node.initializer && ts.isCallExpression(node.initializer)) factory = node.initializer;
    if (ts.isFunctionDeclaration(node) && ['normalizeLastROTeleportMap', 'normalizeMapName'].includes(node.name?.text || '')) functions.set(node.name!.text, node.getText(file));
    if (ts.isBinaryExpression(node) && ['Navigation.navigateTo', 'Navigation.waitForMapData', 'Navigation.findClosestWalkableCell', 'Navigation.findPath', 'MapPathFinder.findPathBetweenMaps'].includes(node.left.getText(file))) navigation.push(node.getText(file) + ';');
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!factory || !functions.has('normalizeLastROTeleportMap') || !functions.has('normalizeMapName') || navigation.length !== 5) throw new Error('Missing final generated same-map fixture');
  const argument = factory.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument) || !argument.properties.some(node => node.name?.getText(file) === 'navigate')) throw new Error('Generated activity navigation adapter is not ready');
  return `${[...functions.values()].join('\n')}\n${navigation.join('\n')}\nconst adapters=${argument.getText(file)}; const links=${factory.expression.getText(file)}(adapters); ({links,adapters});`;
}
const runtimeFixtureCode = loadRuntimeFixtureCode();

function runtimeFixture(dataMap = 'force_map3#100#184') {
  const root = document.createElement('div'); root.innerHTML = '<input class="services-toggle" type="checkbox">'; document.body.append(root);
  const calls: string[] = [], postMessage = vi.fn(() => calls.push('path')), send = vi.fn(), notice = vi.fn(), warn = vi.fn();
  const map = { currentMap: 'force_map3.gat', loading: false };
  const session: { Entity: { position: number[] } | null } = { Entity: { position: [25.4, 40.7] } };
  const prompts: { yes: () => void; no: () => void }[] = [];
  const altitude = { width: 300, height: 300 };
  const cancelRoute = vi.fn(() => calls.push('cancel'));
  const nav = { __loaded: true, _host: root, getRoot: () => root, loadMap: vi.fn(), prepare: vi.fn(), append: vi.fn(), ui: { hide: vi.fn() },
    clearPath: vi.fn(), setTargetCoordinatesText: vi.fn(), setTargetCoordinatesBlinking: vi.fn() };
  const context = vm.createContext({ document, crypto: globalThis.crypto, queueMicrotask, setLastROInnerHTML,
    MapRenderer: map, SessionStorage_default: session, Altitude: altitude,
    init_Navigation: vi.fn(), init_SessionStorage: vi.fn(), init_Altitude: vi.fn(),
    LastROTools: { _lastroPanels: { cancelRoute } }, Navigation: nav, Navigation_default: nav, MapPathFinder: {},
    _mapData: { map: 'force_map3', width: 300, height: 300, cellTypes: new Uint8Array(90000).fill(1), walkableType: 1 },
    _finalTargetData: null, _targetData: null, _pathUpdateLock: false, _path: [], _pathFindingWorker: { id: 1, postMessage },
    initializePathFindingWorker: vi.fn(), resetPathFindingWorker: vi.fn(),
    getCurrentMap: () => map.currentMap.toLowerCase().replace(/\.gat$/i, ''),
    getPlayerPosition: () => ({ x: 25, y: 41 }), DB: { getNaviLinkTable: () => [] },
    showLastroTeleportNotice: notice, console: { warn },
    UIManager: { showPromptBox: vi.fn((_message: string, _ok: string, _cancel: string, yes: () => void, no: () => void) => { prompts.push({ yes, no }); return {}; }) },
    PACKET: { CZ: { PRIVATE_AIRSHIP_REQUEST: class {} } }, Network: { sendPacket: send },
    buildPrivateAirshipRequest: (value: object) => ({ ...value, itemid: 14527 }),
  });
  const result = vm.runInContext(runtimeFixtureCode, context) as {
    links: ReturnType<typeof createLastroChatMapLinks>; adapters: { getMap(): string; canTeleport(): boolean; navigate(target: { mapname: string; x: number; y: number }): void } };
  const parent = document.createElement('div'); result.links.render(parent, `[活动] <span class="mapname" data-map="${dataMap}">点击前往</span>`); document.body.append(parent);
  return { ...result, link: parent.querySelector('a')!, map, session, altitude, nav, context, calls, postMessage, send, notice, cancelRoute, prompts };
}

describe('final runtime activity navigation adapter', () => {
  it('uses real native same-map path methods in the background after canceling the old route', () => {
    const f = runtimeFixture(); f.map.currentMap = 'FORCE_MAP3.GAT'; f.links.request(f.link);
    expect(f.calls).toEqual(['cancel', 'path']); expect(f.postMessage).toHaveBeenCalledOnce();
    expect(f.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'findPath', startX: 25, startY: 41, endX: 100, endY: 184 }));
    expect(f.context._finalTargetData).toMatchObject({ map: 'force_map3', x: 100, y: 184, showWindow: false });
    expect(f.send).not.toHaveBeenCalled(); expect(f.prompts).toHaveLength(0); expect(f.nav.append).not.toHaveBeenCalled();
  });
  it('confirms a map-only activity on the current map and sends its native default coordinates', () => {
    const f = runtimeFixture('force_map3');
    expect(f.links.request(f.link)).toBe(true);
    expect(f.prompts).toHaveLength(1); expect(f.postMessage).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    f.prompts[0]!.yes();
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mapname: 'force_map3', x: 0, y: 0, type: 1, itemid: 14527 }));
    expect(f.postMessage).not.toHaveBeenCalled();
  });
  it('gates loading state and canonicalizes the actual current map', () => {
    const f = runtimeFixture(); f.map.currentMap = 'FORCE_MAP3.GAT'; expect(f.adapters.getMap()).toBe('force_map3');
    f.map.loading = true; expect(f.adapters.getMap()).toBe(''); expect(f.adapters.canTeleport()).toBe(false);
    expect(f.links.request(f.link)).toBe(false); expect(f.prompts).toHaveLength(0); expect(f.postMessage).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([null, [NaN, 40], [25, Infinity]])('shows native feedback when the player position is unavailable: %s', position => {
    const f = runtimeFixture(); f.session.Entity = position ? { position } : null; f.links.request(f.link);
    expect(f.notice).toHaveBeenCalledOnce(); expect(f.cancelRoute).not.toHaveBeenCalled(); expect(f.postMessage).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([[100, 300], [300, 184], [0, 300]])('rejects missing/short GAT bounds %s × %s without canceling another route', (width, height) => {
    const f = runtimeFixture(); f.altitude.width = width; f.altitude.height = height; f.links.request(f.link);
    expect(f.notice).toHaveBeenCalledOnce(); expect(f.cancelRoute).not.toHaveBeenCalled(); expect(f.postMessage).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('keeps cross-map type-1 activity confirmation and reacts to a map change while the prompt is open', () => {
    const f = runtimeFixture(); f.map.currentMap = 'prontera.gat'; f.links.request(f.link);
    expect(f.prompts).toHaveLength(1); expect(f.send).not.toHaveBeenCalled();
    f.map.currentMap = 'force_map3.gat'; f.prompts[0]!.yes(); expect(f.postMessage).toHaveBeenCalledOnce(); expect(f.send).not.toHaveBeenCalled();
    f.map.currentMap = 'payon.gat'; f.links.request(f.link); f.prompts[1]!.yes();
    expect(f.send).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184, type: 1, itemid: 14527 });
  });
});
