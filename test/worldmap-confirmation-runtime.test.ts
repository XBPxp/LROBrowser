// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeLastroMapLoadFailure } from '../scripts/lastro-map-load-diagnostic.mjs';
import { createLastroWorldMapTeleport } from '../scripts/lastro-worldmap-teleport.mjs';
import { createLastroTeleportPreflight } from '../scripts/lastro-teleport-preflight.mjs';
import { resolveLastroMapResourceName } from '../scripts/lastro-map-resource-name.mjs';
import { createWorldMapIndex, installLastroWorldMap, WORLD_MAP_HTML, WORLD_MAP_CSS } from '../scripts/lastro-worldmap.mjs';
import worldMapLayout from '../scripts/lastro-worldmap-layout.json';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';
import { mapBinaryFixture } from './map-binary-fixture';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
// Extract the actual build-time patch declaration without loading unrelated
// skill-data readers into a browser URL environment.
const patcher = readFileSync('scripts/patch-v2-runtime.mjs', 'utf8');
const declaration = (name: string) => nodeText(patcher, node => ts.isFunctionDeclaration(node) && node.name?.text === name).replace(/^export\s+/, '');
const portrait = nodeText(readFileSync('scripts/lastro-monster-portrait.mjs', 'utf8'), node => ts.isFunctionDeclaration(node) && node.name?.text === 'createMonsterPortraitLoader');
const createMonsterPortraitLoader = vm.runInNewContext(`(${portrait.replace(/^export\s+/, '')})`);
const resourceLoader = vm.runInNewContext(`(${declaration('teleportResourceLoaderCode')})`, { resolveLastroMapResourceName });
const patchRuntimeWorldMap = vm.runInNewContext(`(${declaration('patchRuntimeWorldMap')})`, {
  createLastroWorldMapTeleport, createLastroTeleportPreflight, createWorldMapIndex, installLastroWorldMap,
  WORLD_MAP_HTML, WORLD_MAP_CSS, createMonsterPortraitLoader, worldMapLayout,
  teleportResourceLoaderCode: resourceLoader, fail: (code: string) => { throw new Error(code); },
}) as (source: string) => string;
const runtime = patchRuntimeWorldMap(native);
const begin = runtime.indexOf('const lastroWorldMapPreflight =');
const installation = runtime.slice(begin, runtime.indexOf('WorldMap = new GUIComponent', begin));
if (begin < 0 || !installation) throw new Error('Missing world map confirmation integration');
const { buildPrivateAirshipRequest } = await import(pathToFileURL(resolve('vendor/v2/lastro-v1-migration.mjs')).href);

function region(name: string) {
  const start = native.indexOf('//#region ' + name), end = native.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + name);
  return native.slice(start, end);
}
function nodeText(source: string, predicate: (node: ts.Node, file: ts.SourceFile) => boolean) {
  const file = ts.createSourceFile('worldmap-prompt.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches: string[] = [];
  const visit = (node: ts.Node) => { if (predicate(node, file)) matches.push(node.getText(file)); ts.forEachChild(node, visit); };
  visit(file); if (matches.length !== 1) throw new Error('Missing or ambiguous native prompt fixture');
  return matches[0]!;
}
const uiRegion = region('src/UI/UIManager.js'), guiRegion = region('src/UI/GUIComponent.js');
const promptMethod = nodeText(uiRegion, (node, file) => ts.isMethodDeclaration(node) && node.name.getText(file) === 'showPromptBox');
const promptHelpers = ['_createButton', '_popupPosition'].map(name => nodeText(uiRegion, node => ts.isFunctionDeclaration(node) && node.name?.text === name)).join('\n');
const guiMethods = ['append', 'remove', '_bindKeyDown', '_unbindKeyDown'].map(name => nodeText(guiRegion,
  (node, file) => ts.isMethodDeclaration(node) && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent)) && node.name.getText(file) === name)).join('\n');
const cleanups: Array<() => void> = [];

interface NativePrompt {
  __active: boolean; _host: HTMLElement; _shadow: ShadowRoot;
  onRemove?(): void; remove(): void;
}
type TeleportApi = { request(mapid: string, label?: string): Promise<boolean>; cancelPending(): void };

function fixture() {
  const packets: unknown[] = [], reads: string[] = [], events: string[] = [], prompts: NativePrompt[] = [];
  const rsw = mapBinaryFixture('rsw');
  new Uint8Array(rsw).set(new TextEncoder().encode('terrain.gnd'), 51);
  new Uint8Array(rsw).set(new TextEncoder().encode('collision.gat'), 91);
  const gnd = mapBinaryFixture('gnd'); new DataView(gnd).setFloat32(14, 10, true);
  const gat = new ArrayBuffer(94); new Uint8Array(gat).set([71, 82, 65, 84, 1, 2]);
  new DataView(gat).setUint32(6, 2, true); new DataView(gat).setUint32(10, 2, true);
  const files: Record<string, ArrayBuffer> = { 'data/ein_fild04.rsw': rsw, 'data/terrain.gnd': gnd, 'data/collision.gat': gat };
  const win = document.defaultView!, mouse = { intersect: true }, session = { FreezeUI: false };
  const removed = vi.fn(() => events.push('remove'));
  const context = vm.createContext({ document, window: win, Event: win.Event, Mouse: mouse, SessionStorage_default: session,
    MouseMode: { FREEZE: 2 }, queueMicrotask, setLastROInnerHTML, removed,
    __esmMin: (initialize: () => void) => initialize,
  });
  const ui = vm.runInContext(`
    class GUIComponent {
      static processDataAttrs() {}
      constructor(name) {
        this.name = name; this.__active = false; this.__loaded = false; this.mouseMode = MouseMode.FREEZE;
        this._host = document.createElement('div'); this._shadow = this._host.attachShadow({mode:'open'});
        this.onRemove = removed;
      }
      prepare() { this.__loaded = true; setLastROInnerHTML(this._shadow, WinPopup_default$2); this.init?.(); }
      draggable() {} _setupScrollbars() {} _fixPositionOverflow() {} focus() {}
      ${guiMethods}
    }
    const _Cursor = null;
    ${region('src/UI/Components/WinPopup/WinPopup.html?raw')}
    init_WinPopup$2();
    ${promptHelpers}
    class NativeUI { ${promptMethod} }
    ({NativeUI, GUIComponent});
  `, context) as {
    NativeUI: { getComponent?: unknown; showPromptBox(message: string, yes: string, no: string, onYes: () => void, onNo: () => void): NativePrompt };
    GUIComponent: new (name: string) => NativePrompt;
  };
  ui.NativeUI.getComponent = vi.fn(() => ({ clone: (name: string) => {
    const prompt = new ui.GUIComponent(name); prompts.push(prompt); return prompt;
  } }));
  const showPrompt = vi.fn((message: string, yes: string, no: string, onYes: () => void, onNo: () => void) =>
    ui.NativeUI.showPromptBox(message, yes, no, () => { events.push('yes'); onYes(); }, () => { events.push('no'); onNo(); }));
  const popup = vi.fn(), state = { currentMap: 'izlude.gat', loading: false };
  let profile = 5;
  const api = new Function('Thread', 'DB', 'MapRenderer', 'Configs', 'PACKET', 'Network', 'buildPrivateAirshipRequest', 'normalizeLastROTeleportMap', 'UIManager', 'console', 'describeLastroMapLoadFailure', `
    ${installation}
    return lastroWorldMapTeleport;
  `)({ send: (type: string, input: { filename: string }, callback: (bytes: ArrayBuffer | null, error?: string) => void) => {
    expect(type).toBe('GET_FILE'); reads.push(input.filename); events.push('resource');
    queueMicrotask(() => callback(files[input.filename] ?? null, files[input.filename] ? undefined : 'http-404'));
  } }, { mapalias: {} }, state, { get: () => profile }, { CZ: { PRIVATE_AIRSHIP_REQUEST: class {} } },
  { sendPacket: (packet: unknown) => packets.push(packet) }, buildPrivateAirshipRequest, (map: string) => map.replace(/\.gat$/i, ''),
  { showErrorBox: popup, showPromptBox: showPrompt }, { warn: () => {} }, describeLastroMapLoadFailure) as TeleportApi;
  const button = (name: 'ok' | 'cancel', index = prompts.length - 1) => {
    const node = prompts[index]?._shadow.querySelector<HTMLButtonElement>(`[data-background="btn_${name}.bmp"]`);
    if (!node) throw new Error('Missing native confirmation button'); return node;
  };
  cleanups.push(() => { api.cancelPending(); prompts.forEach(prompt => prompt.remove()); });
  return { api, prompts, packets, reads, events, showPrompt, popup, removed, button, mouse, session, state, setProfile: () => { profile++; } };
}
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

describe('native world map confirmation integration', () => {
  it('starts resource checks only after the real native OK button removes its popup and approves', async () => {
    const f = fixture(), result = f.api.request('ein_fild04', '艾音布罗克原野');
    expect(f.showPrompt).toHaveBeenCalledWith('是否传送到艾音布罗克原野？\nein_fild04', 'ok', 'cancel', expect.any(Function), expect.any(Function));
    expect(f.prompts[0]?._host.isConnected).toBe(true);
    expect(f.prompts[0]?._shadow.querySelector('.text')?.textContent).toBe('是否传送到艾音布罗克原野？\nein_fild04');
    expect(f.session.FreezeUI).toBe(true);
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]);
    f.button('ok').click();
    expect(f.events).toEqual(['remove', 'yes']);
    expect(f.prompts[0]?._host.isConnected).toBe(false);
    expect(await result).toBe(true);
    expect(f.reads).toEqual(['data/ein_fild04.rsw', 'data/terrain.gnd', 'data/collision.gat']);
    expect(f.packets).toEqual([expect.objectContaining({ mapname: 'ein_fild04', type: 0, x: 0, y: 0, itemid: 14527 })]);
    expect(f.removed).toHaveBeenCalledOnce(); expect(f.session.FreezeUI).toBe(false);
    f.button('ok').click(); await Promise.resolve(); expect(f.packets).toHaveLength(1);
  });

  it('cancels through the real native Cancel button without fetching or sending', async () => {
    const f = fixture(), result = f.api.request('ein_fild04');
    f.button('cancel').click(); expect(await result).toBe(false);
    expect(f.events).toEqual(['remove', 'no']);
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]); expect(f.popup).not.toHaveBeenCalled();
    expect(f.prompts[0]?._host.isConnected).toBe(false); expect(f.session.FreezeUI).toBe(false);
  });

  it.each(['remove', 'close'])('settles a pending %s without approving and allows a fresh confirmation', async action => {
    const f = fixture(), first = f.api.request('ein_fild04');
    if (action === 'remove') f.prompts[0]!.remove(); else f.api.cancelPending();
    expect(await first).toBe(false);
    f.button('ok').click(); await Promise.resolve();
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]); expect(f.popup).not.toHaveBeenCalled();
    const second = f.api.request('ein_fild04'); expect(f.prompts).toHaveLength(2);
    f.button('ok').click(); expect(await second).toBe(true); expect(f.packets).toHaveLength(1);
  });

  it.each(['map', 'profile', 'loading'])('does not fetch or send from a stale confirmation after %s changes', async change => {
    const f = fixture(), result = f.api.request('ein_fild04');
    if (change === 'map') f.state.currentMap = 'payon.gat';
    if (change === 'profile') f.setProfile();
    if (change === 'loading') f.state.loading = true;
    f.button('ok').click(); expect(await result).toBe(false);
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]);
    expect(f.popup).toHaveBeenCalledExactlyOnceWith('当前地图或区服已变化，请重新选择地点。');
  });

  it('keeps one native prompt during repeated clicks and sends only its original target', async () => {
    const f = fixture(), first = f.api.request('ein_fild04', '艾音布罗克原野');
    expect(await f.api.request('payon', '斐扬')).toBe(false);
    expect(await f.api.request('ein_fild04')).toBe(false);
    expect(f.prompts).toHaveLength(1); expect(f.showPrompt).toHaveBeenCalledOnce();
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]);
    f.button('ok').click(); expect(await first).toBe(true);
    expect(f.packets).toEqual([expect.objectContaining({ mapname: 'ein_fild04' })]);
  });
});
