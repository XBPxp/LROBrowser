// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeLastroMapLoadFailure } from '../scripts/lastro-map-load-diagnostic.mjs';
import type { NpcMapComponent, NpcMapLinksApi } from '../scripts/lastro-npc-map-links.mjs';
import { patchRuntimeNpcMapLinks } from '../scripts/lastro-npc-map-links.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';
import { mapBinaryFixture } from './map-binary-fixture';

const { buildPrivateAirshipRequest } = await import(pathToFileURL(resolve('vendor/v2/lastro-v1-migration.mjs')).href);
const runtime = readFileSync('generated/runtime/Online.js', 'utf8');
const native = readFileSync('vendor/v2/Online.js', 'utf8');
function region(source: string, name: string) {
  const start = source.indexOf('//#region ' + name), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + name);
  return source.slice(start, end);
}
function nodes(source: string, predicate: (node: ts.Node, file: ts.SourceFile) => boolean) {
  const file = ts.createSourceFile('npc-runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches: string[] = [];
  const visit = (node: ts.Node) => { if (predicate(node, file)) matches.push(node.getText(file)); ts.forEachChild(node, visit); };
  visit(file); if (matches.length !== 1) throw new Error('Missing/ambiguous native fixture');
  return matches[0]!;
}
const gui = region(native, 'src/UI/GUIComponent.js');
const guiMethod = (name: string) => nodes(gui, (node, file) => ts.isMethodDeclaration(node)
  && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent)) && node.name.getText(file) === name);
const ui = region(native, 'src/UI/UIManager.js');
const promptMethod = nodes(ui, (node, file) => ts.isMethodDeclaration(node) && node.name.getText(file) === 'showPromptBox');
const promptHelpers = ['_createButton', '_popupPosition'].map(name => nodes(ui, node => ts.isFunctionDeclaration(node) && node.name?.text === name)).join('\n');
const inputKeyDown = nodes(region(runtime, 'src/UI/Components/InputBox/InputBox.js'), (node, file) => ts.isBinaryExpression(node) && node.left.getText(file) === 'InputBox.onKeyDown');
const hotkeys = ts.createSourceFile('hotkeys.mjs', readFileSync('scripts/lastro-hotkeys.mjs', 'utf8'), ts.ScriptTarget.Latest, true);
const hotkeyHelpers = hotkeys.statements.filter(node => ts.isFunctionDeclaration(node) && ['lastroHotkeyId', 'lastroHotkeyComponentVisible', 'lastroHotkeyEditable'].includes(node.name?.text ?? '')).map(node => node.getText(hotkeys)).join('\n');
const begin = runtime.indexOf('const lastroNpcMapPreflight =');
const installation = runtime.slice(begin, runtime.indexOf('NpcBox_default = UIManager.addComponent(NpcBox);', begin));
if (begin < 0 || !installation.includes('lastroNpcMapTeleport')) throw new Error('Missing NPC map resource gate');
// The final component registration also installs its scoped button fallback.
// Execute that real dependency alongside the extracted map-link installation.
const dialogButtonFallback = nodes(region(runtime, 'src/UI/Components/NpcBox/NpcBox.js'),
  node => ts.isFunctionDeclaration(node) && node.name?.text === 'installLastroNpcDialogButtonFallback');
const cleanups: Array<() => void> = [];

interface NativeDialog {
  __active: boolean; _host: HTMLElement; _shadow: ShadowRoot;
  captureKeyEvents?: boolean;
  onRemove?(): void; onKeyDown?(event: KeyboardEvent): unknown;
  getRoot(): ShadowRoot; append(): void; remove(): void;
  _bindKeyDown(): void; _unbindKeyDown(): void;
}

function nativePrompts(mouse: { intersect: boolean }, session: { FreezeUI: boolean }) {
  const win = document.defaultView!;
  const inputValidate = vi.fn(), made: NativeDialog[] = [];
  const context = vm.createContext({ window: win, document, Event: win.Event, Mouse: mouse, SessionStorage_default: session,
    MouseMode: { FREEZE: 2 }, validate$1: inputValidate,
    getComputedStyle: win.getComputedStyle.bind(win),
    KEYS: { ENTER: 13, SPACE: 32, ESCAPE: 27, getDeepActiveElement: () => document.activeElement },
  });
  const bindings = vm.runInContext(`
    class GUIComponent {
      static processDataAttrs() {}
      constructor(name) {
        this.name = name; this.__active = false; this.__loaded = false; this.mouseMode = MouseMode.FREEZE;
        this._host = document.createElement('div'); this._shadow = this._host.attachShadow({mode:'open'});
        this._shadow.innerHTML = '<div class="text"></div><div class="btns"></div><input>';
      }
      prepare() { this.__loaded = true; this.init?.(); }
      getRoot() { return this._shadow; }
      draggable() {} _setupScrollbars() {} _fixPositionOverflow() {} focus() {}
      ${guiMethod('append')}
      ${guiMethod('remove')}
      ${guiMethod('_bindKeyDown')}
      ${guiMethod('_unbindKeyDown')}
      ${guiMethod('isEditableFocused')}
    }
    const _Cursor = null;
    ${promptHelpers}
    ${hotkeyHelpers}
    class UIManager { static components = {}; ${promptMethod} }
    const InputBox = new GUIComponent('InputBox'); InputBox.captureKeyEvents = true;
    ${inputKeyDown};
    ({GUIComponent, UIManager, InputBox});
  `, context) as { GUIComponent: new (name: string) => NativeDialog; UIManager: { getComponent?: unknown; showPromptBox(text: string, yes: string, no: string, onYes: () => void, onNo: () => void): NativeDialog }; InputBox: NativeDialog };
  bindings.UIManager.getComponent = vi.fn(() => ({ clone: (name: string) => { const prompt = new bindings.GUIComponent(name); made.push(prompt); return prompt; } }));
  cleanups.push(() => { made.forEach(prompt => prompt.remove()); bindings.InputBox.remove(); });
  return { ui: bindings.UIManager, input: bindings.InputBox, inputValidate };
}

function resources() {
  const rsw = mapBinaryFixture('rsw');
  new Uint8Array(rsw).set(new TextEncoder().encode('terrain.gnd'), 51);
  new Uint8Array(rsw).set(new TextEncoder().encode('collision.gat'), 91);
  const gnd = mapBinaryFixture('gnd'); new DataView(gnd).setFloat32(14, 10, true);
  const gat = new ArrayBuffer(94);
  new Uint8Array(gat).set([71, 82, 65, 84, 1, 2]);
  new DataView(gat).setUint32(6, 2, true); new DataView(gat).setUint32(10, 2, true);
  return { 'data/lhz_dun03.rsw': rsw, 'data/terrain.gnd': gnd, 'data/collision.gat': gat } as Record<string, ArrayBuffer | null>;
}

function fixture(files = resources()) {
  const host = document.createElement('div'), root = host.attachShadow({ mode: 'open' });
  document.body.append(host);
  const content = document.createElement('div'); root.append(content);
  const packets: unknown[] = [], reads: string[] = [], pending: Array<() => void> = [];
  const popup = vi.fn(), notice = vi.fn(), label = vi.fn((map: string) => map === 'lhz_dun03.gat' ? '生体实验室3层' : map);
  const state = { currentMap: 'izlude.gat', loading: false };
  const menu = { __active: false, _host: document.createElement('div') };
  const mouse = { intersect: false }, session = { FreezeUI: true };
  const prompts = nativePrompts(mouse, session), input = prompts.input;
  const confirmations: Array<{ prompt: NativeDialog; yes(): void; no(): void }> = [];
  const showPrompt = vi.fn((message: string, yes: string, no: string, onYes: () => void, onNo: () => void) => {
    const prompt = prompts.ui.showPromptBox(message, yes, no, onYes, onNo);
    confirmations.push({ prompt, yes: onYes, no: onNo }); return prompt;
  });
  let manual = false, profile = 5;
  const npc: NpcMapComponent = {
    ownerID: 42, __active: true, _host: host, getRoot: () => root,
    next: vi.fn(), setText: vi.fn(), addNext: vi.fn(), addClose: vi.fn(),
    onRemove: () => { npc.ownerID = 0; content.replaceChildren(); },
    close: vi.fn(() => {
      packets.push({ kind: 'CLOSE_DIALOG', ownerID: npc.ownerID });
      npc.__active = false; host.remove(); npc.onRemove?.();
    }),
  };
  const api: NpcMapLinksApi = new Function('NpcBox', 'Thread', 'DB', 'MapRenderer', 'Configs', 'PACKET', 'Network', 'buildPrivateAirshipRequest', 'normalizeLastROTeleportMap', 'UIManager', 'console', 'describeLastroMapLoadFailure', 'setLastROInnerHTML', 'NpcMenu_default', 'InputBox_default', 'showLastroTeleportNotice', 'Mouse', 'SessionStorage_default', `
    ${dialogButtonFallback}
    ${installation}
    return NpcBox._lastroMapLinks;
  `)(npc, { send: (type: string, input: { filename: string }, callback: (bytes: ArrayBuffer | null, error?: string) => void) => {
    expect(type).toBe('GET_FILE'); reads.push(input.filename);
    const complete = () => callback(files[input.filename] ?? null, files[input.filename] ? undefined : 'http-404');
    if (manual) pending.push(complete); else queueMicrotask(complete);
  } }, { mapalias: {}, getMapName: label }, state, { get: () => profile }, { CZ: { PRIVATE_AIRSHIP_REQUEST: class {} } },
  { sendPacket: (packet: unknown) => packets.push(packet) }, buildPrivateAirshipRequest, (map: string) => map.replace(/\.gat$/i, ''),
  { showErrorBox: popup, showPromptBox: showPrompt }, { warn: () => {} }, describeLastroMapLoadFailure, setLastROInnerHTML, menu, input, notice, mouse, session);
  npc.init?.();
  api.render(content, '(Lv.160) 暗•超魔导师 凯特莉娜 位于地图\n^nMapName^lhz_dun03', text => text);
  const link = content.querySelector('a');
  if (!link) throw new Error('Missing native NPC map link');
  cleanups.push(() => api.invalidate());
  const answer = async (yes = true, index = confirmations.length - 1) => {
    const prompt = confirmations[index]?.prompt; if (!prompt) throw new Error('Missing native confirmation');
    prompt.getRoot().querySelector<HTMLButtonElement>(`[data-background="btn_${yes ? 'ok' : 'cancel'}.bmp"]`)!.click();
    await vi.advanceTimersByTimeAsync(0);
  };
  const key = (key: string, options: KeyboardEventInit = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...options });
    window.dispatchEvent(event); return event;
  };
  return { api, npc, host, content, link, packets, reads, popup, notice, label, state, menu, input, pending, mouse, session,
    showPrompt, confirmations, answer, key, inputValidate: prompts.inputValidate,
    manual: () => { manual = true; }, setProfile: () => { profile++; } };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); vi.useRealTimers(); document.body.replaceChildren(); });

describe('packaged MVP map link teleport adapter', () => {
  it('keeps the MVP board open and shows a native notice when the map-only target is the current map', async () => {
    const f = fixture(); f.state.currentMap = 'lhz_dun03.gat';
    const result = f.api.request(f.link); await f.answer(); expect(await result).toBe(false);
    expect(f.notice).toHaveBeenCalledExactlyOnceWith('已在目标地图。');
    expect(f.packets).toEqual([]); expect(f.reads).toEqual([]);
    expect(f.host.isConnected).toBe(true);
  });
  it('checks scene references and sends one original map-level warp then closes the native dialog', async () => {
    const f = fixture();
    expect(f.label).toHaveBeenCalledWith('lhz_dun03.gat', 'lhz_dun03');
    expect(f.content.textContent).not.toContain('^nMapName^');
    const result = f.api.request(f.link);
    expect(f.showPrompt).toHaveBeenCalledWith(expect.stringContaining('生体实验室3层'), 'ok', 'cancel', expect.any(Function), expect.any(Function));
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]);
    await f.answer(); expect(await result).toBe(true);
    expect(f.reads).toEqual(['data/lhz_dun03.rsw', 'data/terrain.gnd', 'data/collision.gat']);
    expect(f.packets).toEqual([
      { kind: 'CLOSE_DIALOG', ownerID: 42 },
      expect.objectContaining({ mapname: 'lhz_dun03', type: 0, x: 0, y: 0, itemid: 14527 }),
    ]);
    expect(f.host.isConnected).toBe(false);
    expect(f.popup).not.toHaveBeenCalled();
  });

  it.each(['scene', 'ground', 'collision', 'corrupt-ground'])('keeps the board visible with no packets for failed %s', async kind => {
    const files = resources();
    if (kind === 'scene') files['data/lhz_dun03.rsw'] = null;
    if (kind === 'ground') files['data/terrain.gnd'] = null;
    if (kind === 'collision') files['data/collision.gat'] = null;
    if (kind === 'corrupt-ground') files['data/terrain.gnd'] = new ArrayBuffer(100);
    const f = fixture(files);
    const result = f.api.request(f.link); await f.answer(); expect(await result).toBe(false);
    expect(f.packets).toEqual([]);
    expect(f.host.isConnected).toBe(true);
    expect(f.link.textContent).toBe('生体实验室3层');
    expect(f.link.hasAttribute('aria-busy')).toBe(false);
    expect(f.popup).toHaveBeenCalledOnce();
  });

  it('coalesces repeated clicks during preflight', async () => {
    const f = fixture(); f.manual();
    const first = f.api.request(f.link);
    expect(await f.api.request(f.link)).toBe(false);
    expect(f.showPrompt).toHaveBeenCalledOnce(); expect(f.reads).toEqual([]);
    await f.answer(); expect(await f.api.request(f.link)).toBe(false);
    for (let index = 0; index < 4; index++) { await vi.advanceTimersByTimeAsync(0); f.pending[index]?.(); }
    expect(await first).toBe(true);
    expect(f.packets).toHaveLength(2);
  });

  it.each(['cancel', 'external-remove', 'next'])('cancels a native confirmation on %s before any files or warp and rejects its old callback', async how => {
    const f = fixture(); const first = f.api.request(f.link), old = f.confirmations[0]!;
    if (how === 'cancel') await f.answer(false);
    else if (how === 'external-remove') { old.prompt.remove(); await vi.advanceTimersByTimeAsync(0); }
    else f.npc.next();
    old.yes(); expect(await first).toBe(false);
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]); expect(old.prompt._host.isConnected).toBe(false);
    expect(f.mouse.intersect).toBe(false); expect(f.session.FreezeUI).toBe(true);
    const send = vi.fn(); expect(() => f.api.commit('lhz_dun03', send)).toThrow(expect.objectContaining({ name: 'AbortError' }));
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['menu', 'input'] as const)('opens a confirmation for a mouse click while %s is still displayed', async name => {
    const f = fixture();
    if (name === 'menu') { f.menu.__active = true; document.body.append(f.menu._host); } else f.input.append();
    f.link.click(); expect(f.showPrompt).toHaveBeenCalledOnce(); expect(f.reads).toEqual([]); expect(f.packets).toEqual([]);
    await f.answer();
    expect(f.packets).toEqual([{ kind: 'CLOSE_DIALOG', ownerID: 42 }, expect.objectContaining({ mapname: 'lhz_dun03', type: 0, x: 0, y: 0, itemid: 14527 })]);
    expect(f.inputValidate).not.toHaveBeenCalled();
  });

  it.each(['menu', 'input'] as const)('keeps confirmed mouse authorization when %s appears during preflight', async name => {
    const f = fixture(); f.manual(); const result = f.api.request(f.link); await f.answer();
    if (name === 'menu') { f.menu.__active = true; document.body.append(f.menu._host); } else f.input.append();
    for (let index = 0; index < 4; index++) { f.pending[index]?.(); await vi.advanceTimersByTimeAsync(0); }
    expect(await result).toBe(true);
    expect(f.packets).toEqual([{ kind: 'CLOSE_DIALOG', ownerID: 42 }, expect.objectContaining({ mapname: 'lhz_dun03', type: 0 })]);
  });

  it('prioritizes native prompt Enter over an earlier InputBox capture binding and restores NPC freeze and input keys', async () => {
    const f = fixture(); f.manual(); f.input.append();
    f.key('Enter'); expect(f.inputValidate).toHaveBeenCalledTimes(1); f.inputValidate.mockClear();
    const result = f.api.request(f.link), prompt = f.confirmations[0]!.prompt;
    expect(f.key('Enter').defaultPrevented).toBe(true); await vi.advanceTimersByTimeAsync(0);
    expect(prompt._host.isConnected).toBe(false); expect(f.inputValidate).not.toHaveBeenCalled();
    expect(f.reads).toEqual(['data/lhz_dun03.rsw']); expect(f.packets).toEqual([]);
    expect(f.mouse.intersect).toBe(false); expect(f.session.FreezeUI).toBe(true);
    f.key('Enter'); expect(f.inputValidate).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 4; index++) { f.pending[index]?.(); await vi.advanceTimersByTimeAsync(0); }
    expect(await result).toBe(true); expect(f.packets).toHaveLength(2);
  });

  it('consumes repeat and IME keys before InputBox, cancels with Escape, and restores the original input capture', async () => {
    const f = fixture(); f.input.append(); const result = f.api.request(f.link);
    for (const options of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) expect(f.key('Enter', options).defaultPrevented).toBe(true);
    expect(f.inputValidate).not.toHaveBeenCalled(); expect(f.reads).toEqual([]); expect(f.packets).toEqual([]);
    expect(f.key('Escape').defaultPrevented).toBe(true); expect(await result).toBe(false);
    expect(f.mouse.intersect).toBe(false); expect(f.session.FreezeUI).toBe(true);
    f.key('Enter'); expect(f.inputValidate).toHaveBeenCalledTimes(1); expect(f.packets).toEqual([]);
  });

  it.each(['Enter', ' '])('activates a focused native cancel button with %j instead of authorizing a warp', async key => {
    const f = fixture(); f.input.append(); const result = f.api.request(f.link);
    f.confirmations[0]!.prompt.getRoot().querySelector<HTMLButtonElement>('[data-background="btn_cancel.bmp"]')!.focus();
    expect(f.key(key).defaultPrevented).toBe(true); expect(await result).toBe(false);
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]); expect(f.inputValidate).not.toHaveBeenCalled();
    expect(f.host.isConnected).toBe(true);
  });

  it('restores the original InputBox capture if creating the native prompt throws', async () => {
    const f = fixture(); f.input.append(); f.showPrompt.mockImplementationOnce(() => { throw new Error('native popup failed'); });
    expect(await f.api.request(f.link)).toBe(false); expect(f.popup).toHaveBeenCalledOnce();
    expect(f.reads).toEqual([]); expect(f.packets).toEqual([]); expect(f.host.isConnected).toBe(true);
    f.key('Enter'); expect(f.inputValidate).toHaveBeenCalledTimes(1);
  });

  it.each(['removed-link', 'removed-host', 'hidden', 'inactive', 'owner', 'tampered-map', 'next', 'map', 'profile'])('rejects a late warp after %s', async change => {
    const f = fixture(); f.manual();
    const result = f.api.request(f.link);
    await f.answer();
    if (change === 'removed-link') f.link.remove();
    if (change === 'removed-host') f.host.remove();
    if (change === 'hidden') f.host.style.display = 'none';
    if (change === 'inactive') f.npc.__active = false;
    if (change === 'owner') f.npc.ownerID = 43;
    if (change === 'tampered-map') f.link.dataset.map = 'prontera';
    if (change === 'next') f.npc.next();
    if (change === 'map') f.state.currentMap = 'payon.gat';
    if (change === 'profile') f.setProfile();
    for (let index = 0; index < 4; index++) { f.pending[index]?.(); await vi.advanceTimersByTimeAsync(0); }
    expect(await result).toBe(false);
    expect(f.packets).toEqual([]);
  });

  it('fails loudly on native anchor drift while skipping unrelated small fixtures', () => {
    const vendor = readFileSync('vendor/v2/Online.js', 'utf8');
    expect(patchRuntimeNpcMapLinks('const unrelated = 1;', '() => {}')).toBe('const unrelated = 1;');
    expect(() => patchRuntimeNpcMapLinks(vendor.replace('div.innerHTML = processText(text);', 'div.textContent = text;'), '() => {}')).toThrow('anchor:npc-map-links');
  });
});
