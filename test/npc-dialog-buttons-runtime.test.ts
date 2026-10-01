// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchRuntimeNpcDialogButtons } from '../scripts/lastro-npc-dialog-buttons.mjs';
import { patchRuntimeHotkeys } from '../scripts/lastro-hotkeys.mjs';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
const patched = patchRuntimeNpcDialogButtons(native);
function region(source: string, name: string) {
  const start = source.indexOf('//#region ' + name), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native module: ' + name);
  return source.slice(start, end);
}
function nodeText(source: string, predicate: (node: ts.Node, file: ts.SourceFile) => boolean) {
  const file = ts.createSourceFile('npc-fixture.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches: string[] = [];
  function visit(node: ts.Node) { if (predicate(node, file)) matches.push(node.getText(file)); ts.forEachChild(node, visit); }
  visit(file);
  if (matches.length !== 1) throw new Error('Missing/ambiguous native node');
  return matches[0]!;
}
const guiSource = region(native, 'src/UI/GUIComponent.js');
const guiMethods = ['constructor', 'getRoot', 'prepare', '_prepare', 'append', 'remove', '_bindKeyDown', '_unbindKeyDown', '_createUIProxy']
  .map(name => nodeText(guiSource, (node, file) => name === 'constructor' ? ts.isConstructorDeclaration(node)
    : ts.isMethodDeclaration(node) && ts.isClassExpression(node.parent) && node.parent.name?.text === 'GUIComponent'
      && node.name.getText(file) === name)).join('\n');
const packetSource = ['REQ_NEXT_SCRIPT', 'CLOSE_DIALOG'].map(name => {
  const start = native.indexOf('  PACKET.CZ.' + name + ' =');
  const end = native.indexOf('\n  PACKET.CZ.', native.indexOf('prototype.build', start));
  if (start < 0 || end < start) throw new Error('Missing native NPC request');
  return native.slice(start, end);
}).join('\n');
const hotkeys = patchRuntimeHotkeys(native);
const hotkeyFunctions = ['lastroHotkeyId', 'lastroHotkeyComponentVisible', 'lastroHotkeyEditable'].map(name =>
  nodeText(hotkeys.slice(0, hotkeys.indexOf('//#region src/Controls/KeyEventHandler.js')),
    node => ts.isFunctionDeclaration(node) && node.name?.text === name)).join('\n');
const hotkeyNpc = nodeText(region(hotkeys, 'src/UI/Components/NpcBox/NpcBox.js'), (node, file) =>
  ts.isBinaryExpression(node) && node.left.getText(file) === 'NpcBox.onKeyDown') + ';';

interface NativeNpc {
  __active: boolean; __loaded: boolean; ownerID: number; _host: HTMLElement; _keyHandler: unknown;
  ui: { is(selector: string): boolean };
  getRoot(): ShadowRoot; append(): void; remove(): void;
}
interface Button extends HTMLElement { _update(): void; disabled: boolean; }
type Packet = { NAID: number; constructor: { name: string }; build(): { buffer: ArrayBuffer } };
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); });
async function flush() { for (let index = 0; index < 6; index++) await Promise.resolve(); }

function fixture(source = patched, mode: 'immediate' | 'delayed' | 'failed' = 'delayed', useHotkeys = true) {
  const frame = document.createElement('iframe'); document.body.appendChild(frame);
  const win = frame.contentWindow as Window & typeof globalThis, doc = win.document;
  const pending: Array<{ path: string; callback(value: unknown): void }> = [];
  const sent: Array<{ name: string; NAID: number; bytes: number[] }> = [];
  const hooks = new Map<string, (packet: Record<string, unknown>) => void>();
  const menu = { __active: false, _host: null }, input = { __active: false, _host: null };
  const logs = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  const components: Record<string, NativeNpc> = {};
  const context = vm.createContext({ window: win, document: doc, HTMLElement: win.HTMLElement, Event: win.Event,
    customElements: win.customElements, console: logs,
    getComputedStyle(element: HTMLElement) {
      // jsdom does not apply Shadow DOM styles. Use the native .btn default
      // when no inline state has arrived, while retaining real host styles.
      return element.matches('ui-button.btn')
        ? { display: element.style.display || 'none' } : win.getComputedStyle(element);
    },
    __esmMin: (initialize: () => void) => { let loaded = false; return () => { if (!loaded) { loaded = true; initialize(); } }; },
    _ensureDeps() {}, Common_default$1: '', MouseMode: { STOP: 1, FREEZE: 2 }, CSS_NUMBER: { zIndex: true, opacity: true },
    _Cursor: null, Mouse: { intersect: true }, SessionStorage_default: { FreezeUI: false },
    Renderer: { width: 1024, height: 720 }, DB: { INTERFACE_PATH: 'data/texture/유저인터페이스/' },
    Client: { loadFile(path: string, callback: (value: unknown) => void) {
      pending.push({ path, callback });
      if (mode === 'immediate') callback('data:image/png;base64,AA==');
    } },
    Targa: class { load() { throw new Error('Invalid image'); } },
    NpcMenu_default: menu, InputBox_default: input,
    ItemInfo_default: { uid: 0 }, Navigation_default: { uid: '', _host: null },
    UIManager: { components, addComponent(component: NativeNpc & { name: string }) {
      components[component.name] = component; return component;
    } },
    KEYS: { ENTER: 13, SPACE: 32, ESCAPE: 27, getDeepActiveElement: () => {
      let element = doc.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return element;
    } },
    PACKET: { CZ: {}, ZC: new Proxy({}, { get: (_target, name) => String(name) }) },
    Network: {
      hookPacket(name: string, callback: (packet: Record<string, unknown>) => void) { hooks.set(name, callback); },
      sendPacket(packet: Packet) { sent.push({ name: packet.constructor.name, NAID: packet.NAID, bytes: [...new Uint8Array(packet.build().buffer)] }); },
    },
  });
  const modules = [
    'src/UI/Elements/UIButton.js', 'src/UI/Components/NpcBox/NpcBox.html?raw',
    'src/UI/Components/NpcBox/NpcBox.css?raw', 'src/UI/Components/NpcBox/NpcBox.js',
    'src/Engine/MapEngine/NPC.js', 'src/Utils/BinaryWriter.js',
  ].map(name => region(source, name)).join('\n');
  for (const match of modules.matchAll(/\b(init_[\w$]+)\(\);/g)) context[match[1]!] = () => {};
  vm.runInContext(`
    class GUIComponent {
      static MouseMode = MouseMode;
      ${guiMethods}
      _processAllDataAttrs() {} _setupMouseMode() {} _setupScrollbars() {}
      _fixPositionOverflow() {} draggable() {} focus() {}
    }
    ${modules}
    init_UIButton(); init_BinaryWriter();
    ${packetSource}
    init_NPC(); NPCEngine$2();
    ${useHotkeys ? hotkeyFunctions + '\n' + hotkeyNpc : ''}
  `, context);
  const npc = context.NpcBox_default as NativeNpc;
  const packet = (name: string, id = 42, msg = '[罗密欧]\n我会在外面等着你。') => {
    const callback = hooks.get(name);
    if (!callback) throw new Error('Missing native NPC hook: ' + name);
    callback({ NAID: id, msg });
  };
  const button = (name: 'next' | 'close') => npc.getRoot().querySelector<Button>('.' + name)!;
  const key = (name: 'Enter' | 'Escape' | ' ', repeat = false) => {
    const event = new win.KeyboardEvent('keydown', { key: name, code: name === ' ' ? 'Space' : name,
      which: name === 'Enter' ? 13 : name === 'Escape' ? 27 : 32, repeat, bubbles: true, cancelable: true });
    win.dispatchEvent(event); return event;
  };
  const complete = (name: 'next' | 'close', value: unknown = 'data:image/png;base64,AA==') => {
    const load = pending.find(row => row.path.endsWith('btn_' + name + '.bmp'));
    if (!load) throw new Error('Missing actual UIButton image request');
    load.callback(value);
  };
  cleanup.push(() => { npc.remove(); win.close(); frame.remove(); });
  return { win, doc, npc, hooks, packet, button, key, complete, pending, sent, logs, context, menu, input };
}

describe('NPC terminal button protocol state', () => {
  it('reproduces the native layout-dependent CLOSE_DIALOG loss with a connected active dialog', () => {
    const f = fixture(native);
    f.packet('SAY_DIALOG');
    expect(f.npc.__active).toBe(true); expect(f.npc._host.isConnected).toBe(true);
    expect(f.npc._host.offsetParent).toBeNull(); expect(f.npc.ui.is(':visible')).toBe(false);
    f.packet('CLOSE_DIALOG');
    expect(f.button('close').style.display).toBe('');
    expect(f.button('close').textContent).toBe('');
    expect(f.key('Escape').defaultPrevented).toBe(false);
    expect(f.npc.__active).toBe(true); expect(f.sent).toEqual([]);
  });

  it('keeps terminal CLOSE_DIALOG after NEXT and sends exactly the native requests', () => {
    const f = fixture();
    f.packet('SAY_DIALOG', 42, '第一页'); f.packet('WAIT_DIALOG');
    expect(f.button('next').style.display).toBe('block');
    f.button('next').click();
    expect(f.button('next').style.display).toBe('none');
    expect(f.sent).toEqual([{ name: 'PACKET_CZ_REQ_NEXT_SCRIPT', NAID: 42, bytes: [185, 0, 42, 0, 0, 0] }]);
    f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    expect(f.npc.getRoot().querySelector('.content')?.textContent).toBe('[罗密欧]\n我会在外面等着你。');
    expect(f.button('close').style.display).toBe('block');
    expect(f.button('close').textContent).toBe('关闭');
    f.button('close').click();
    expect(f.npc.__active).toBe(false); expect(f.npc._host.isConnected).toBe(false); expect(f.npc.ownerID).toBe(0);
    expect(f.sent).toEqual([
      { name: 'PACKET_CZ_REQ_NEXT_SCRIPT', NAID: 42, bytes: [185, 0, 42, 0, 0, 0] },
      { name: 'PACKET_CZ_CLOSE_DIALOG', NAID: 42, bytes: [70, 1, 42, 0, 0, 0] },
    ]);
  });

  it('records terminal state when temporarily hidden without reappending or showing the dialog', () => {
    const f = fixture(); f.packet('SAY_DIALOG');
    const append = vi.spyOn(f.npc, 'append');
    f.npc._host.style.display = 'none'; f.packet('CLOSE_DIALOG');
    expect(f.button('close').style.display).toBe('block');
    expect(f.npc._host.style.display).toBe('none'); expect(append).not.toHaveBeenCalled();
    f.key('Escape'); expect(f.sent).toEqual([]);
    f.npc._host.style.display = ''; f.key('Escape');
    expect(f.sent).toEqual([{ name: 'PACKET_CZ_CLOSE_DIALOG', NAID: 42, bytes: [70, 1, 42, 0, 0, 0] }]);
  });

  it('ignores terminal packets before initialization, after removal and for an unrelated NPC', () => {
    const f = fixture();
    f.packet('CLOSE_DIALOG'); expect(f.npc.__loaded).toBe(false);
    f.packet('SAY_DIALOG'); f.npc.remove(); f.packet('CLOSE_DIALOG');
    expect(f.npc._host.isConnected).toBe(false); expect(f.button('close').style.display).toBe('none');
    f.packet('SAY_DIALOG', 99, '另一个NPC'); f.packet('CLOSE_DIALOG', 42);
    expect(f.npc.ownerID).toBe(99); expect(f.button('close').style.display).toBe('none');
    f.key('Enter'); f.key('Escape'); expect(f.sent).toEqual([]);
    f.packet('CLOSE_DIALOG', 99); f.key('Enter');
    expect(f.sent).toEqual([{ name: 'PACKET_CZ_CLOSE_DIALOG', NAID: 99, bytes: [70, 1, 99, 0, 0, 0] }]);
  });

  it('does not revive a detached active dialog or alter the matching server-driven CLOSE_SCRIPT', () => {
    const f = fixture(); f.packet('SAY_DIALOG');
    f.npc._host.remove(); f.packet('CLOSE_DIALOG');
    expect(f.npc.__active).toBe(true); expect(f.npc._host.isConnected).toBe(false);
    expect(f.button('close').style.display).toBe('');
    f.npc.append(); f.packet('WAIT_DIALOG');
    f.packet('CLOSE_SCRIPT', 77); expect(f.npc.__active).toBe(true);
    f.context.NpcMenu_default.remove = vi.fn();
    f.packet('CLOSE_SCRIPT'); expect(f.npc.__active).toBe(false); expect(f.sent).toEqual([]);
    expect(f.npc.getRoot().querySelector('.content')?.textContent).toBe('');
    f.packet('CLOSE_DIALOG'); expect(f.npc._host.isConnected).toBe(false);
  });

  it('does not invent a close button for messages, menus, input or while waiting for the next page', () => {
    const f = fixture(); f.packet('SAY_DIALOG');
    expect(f.button('close').style.display).toBe('');
    f.key('Enter'); f.key('Escape'); expect(f.sent).toEqual([]);
    f.packet('WAIT_DIALOG'); f.key('Enter');
    expect(f.sent).toHaveLength(1); expect(f.button('close').style.display).toBe('');
    f.key('Escape'); expect(f.sent).toHaveLength(1);
    f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    const host = f.doc.createElement('div'); f.doc.body.append(host);
    Object.assign(f.menu, { _host: host, __active: true });
    f.key('Enter'); expect(f.sent).toHaveLength(1);
    Object.assign(f.menu, { __active: false }); Object.assign(f.input, { _host: host, __active: true });
    f.key('Escape'); expect(f.sent).toHaveLength(1);
    Object.assign(f.input, { __active: false }); f.key('Escape');
    expect(f.sent).toHaveLength(2);
  });

  it.each(['Enter', 'Escape', ' '] as const)('closes with %s and removes its native keyboard listener', name => {
    const f = fixture(); f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    expect(f.key(name, true).defaultPrevented).toBe(true); expect(f.sent).toEqual([]);
    expect(f.key(name).defaultPrevented).toBe(true);
    expect(f.npc._keyHandler).toBeNull();
    f.key(name); expect(f.sent).toHaveLength(1);
  });
});

describe('NPC button asset fallback through native UIButton', () => {
  it('retains original BMP appearance when image callbacks complete synchronously', async () => {
    const f = fixture(patched, 'immediate'); f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    await flush();
    for (const name of ['next', 'close'] as const) {
      expect(f.button(name).style.backgroundImage).toContain('data:image/png');
      expect(f.button(name).classList.contains('lastro-npc-button-fallback')).toBe(false);
    }
    const style = f.npc.getRoot().querySelector('style[data-component="NpcBox"]')?.textContent;
    expect(style).toContain('#NpcBox .btn { color: transparent; }');
    expect(f.pending).toHaveLength(6);
  });

  it('shows readable native-size buttons during loading, then swaps back to their native BMPs', async () => {
    const f = fixture(); f.packet('SAY_DIALOG'); f.packet('WAIT_DIALOG');
    expect(f.button('next').classList.contains('lastro-npc-button-fallback')).toBe(true);
    expect(f.button('next').textContent).toBe('下一步');
    f.complete('next'); await flush();
    expect(f.button('next').classList.contains('lastro-npc-button-fallback')).toBe(false);
    f.key('Enter'); f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    expect(f.button('close').classList.contains('lastro-npc-button-fallback')).toBe(true);
    f.complete('close'); await flush();
    expect(f.button('close').classList.contains('lastro-npc-button-fallback')).toBe(false);
    f.key('Escape'); expect(f.sent).toHaveLength(2);
  });

  it('remains closable when an image never loads or fails native Targa decoding', async () => {
    const f = fixture(patched, 'failed'); f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    // The ArrayBuffer exercises UIButton's actual decode-error branch.
    f.complete('close', vm.runInContext('new ArrayBuffer(4)', f.context)); await flush();
    expect(f.logs.error).toHaveBeenCalledWith('Invalid image');
    expect(f.button('close').classList.contains('lastro-npc-button-fallback')).toBe(true);
    expect(f.button('close').getAttribute('aria-label')).toBe('关闭');
    f.button('close').click(); expect(f.sent).toHaveLength(1); expect(f.npc.__active).toBe(false);
  });

  it('disconnects its observer on removal and resynchronizes assets and protocol state on reopening', async () => {
    const f = fixture(); const disconnect = vi.spyOn(f.win.MutationObserver.prototype, 'disconnect');
    f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    const close = f.button('close'); f.npc.remove();
    expect(disconnect).toHaveBeenCalledOnce();
    f.complete('close'); await flush();
    expect(close.classList.contains('lastro-npc-button-fallback')).toBe(true);
    f.packet('CLOSE_DIALOG'); expect(close.style.display).toBe('none');
    f.packet('SAY_DIALOG', 101, '新的对话');
    expect(f.button('close')).toBe(close); expect(close.classList.contains('lastro-npc-button-fallback')).toBe(false);
    expect(close.style.display).toBe('none');
    f.packet('CLOSE_DIALOG', 101); f.key('Enter');
    expect(f.sent).toEqual([{ name: 'PACKET_CZ_CLOSE_DIALOG', NAID: 101, bytes: [70, 1, 101, 0, 0, 0] }]);
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('reapplies the fallback if the native button clears its image and leaves other UI components unchanged', async () => {
    const f = fixture(patched, 'immediate'); f.packet('SAY_DIALOG'); f.packet('CLOSE_DIALOG');
    f.button('close').style.backgroundImage = ''; await flush();
    expect(f.button('close').classList.contains('lastro-npc-button-fallback')).toBe(true);
    expect(region(patched, 'src/UI/Elements/UIButton.js')).toBe(region(native, 'src/UI/Elements/UIButton.js'));
    expect(region(patched, 'src/UI/GUIComponent.js')).toBe(guiSource);
    expect(region(patched, 'src/UI/Components/NpcMenu/NpcMenu.js')).toBe(region(native, 'src/UI/Components/NpcMenu/NpcMenu.js'));
  });
});

describe('strict NPC dialog patch anchors', () => {
  it('keeps independent minimal runtime fixtures unchanged', () => {
    const source = 'const unrelated = 1;'; expect(patchRuntimeNpcDialogButtons(source)).toBe(source);
  });
  it('rejects double installation and changed native close handlers instead of silently skipping the fix', () => {
    expect(() => patchRuntimeNpcDialogButtons(patched)).toThrow('already-installed');
    expect(() => patchRuntimeNpcDialogButtons(native.replace('function onCloseAppear(pkt)', 'function otherCloseHandler(pkt)'))).toThrow('close-handler');
    const engine = region(native, 'src/Engine/MapEngine/NPC.js');
    expect(() => patchRuntimeNpcDialogButtons(native.replace(engine,
      engine.replace('NpcBox_default.ui && NpcBox_default.ui.is(":visible")', 'NpcBox_default.__active')))).toThrow('close-body');
  });
  it('rejects missing/duplicate NPC modules or changed component/style registration', () => {
    expect(() => patchRuntimeNpcDialogButtons(region(native, 'src/UI/Components/NpcBox/NpcBox.js') + '\n//#endregion')).toThrow('src/Engine/MapEngine/NPC.js');
    expect(() => patchRuntimeNpcDialogButtons(native + '\n' + region(native, 'src/UI/Components/NpcBox/NpcBox.js'))).toThrow('src/UI/Components/NpcBox/NpcBox.js');
    expect(() => patchRuntimeNpcDialogButtons(native.replace('NpcBox_default = UIManager.addComponent(NpcBox)', 'NpcBox_default = otherComponent'))).toThrow('register');
    expect(() => patchRuntimeNpcDialogButtons(native.replace('#NpcBox .btn {', '#NpcBox .different {'))).toThrow('button-css');
  });
});
