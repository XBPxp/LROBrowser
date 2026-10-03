// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchRuntimeShopTitles } from '../scripts/lastro-shop-titles.mjs';

const vendor = readFileSync('vendor/v2/Online.js', 'utf8');
const paths = ['src/Preferences/Map.js', 'src/Controls/ProcessCommand.js', 'src/Renderer/Entity/EntityRoom.js'];
function region(source: string, name: string) {
  const start = source.indexOf('//#region ' + name), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + name);
  return source.slice(start, end + '//#endregion'.length);
}
const focused = paths.map(name => region(vendor, name)).join('\n');
const parse = (source: string) => ts.createSourceFile('Native.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function namedFunction(source: string, name: string) {
  const file = parse(source), found = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (found.length !== 1) throw new Error('Missing native function: ' + name);
  return found[0]!.getText(file);
}
function assignment(source: string, name: string) {
  const file = parse(source), found: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.left.getText(file) === name) found.push(node.right);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (found.length !== 1) throw new Error('Missing native assignment: ' + name);
  return found[0]!.getText(file);
}
function classMethods(path: string, names: string[]) {
  const source = region(vendor, path), file = parse(source);
  let nativeClass: ts.ClassExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isClassExpression(node) && node.name?.text === 'GUIComponent') nativeClass = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!nativeClass) throw new Error('Missing native GUIComponent class');
  return names.map(name => {
    const found = nativeClass!.members.filter(member => name === 'constructor' ? ts.isConstructorDeclaration(member)
      : ts.isMethodDeclaration(member) && member.name.getText(file) === name);
    if (found.length !== 1) throw new Error('Missing native GUI method: ' + name);
    return found[0]!.getText(file);
  }).join('\n');
}
const guiMethods = classMethods('src/UI/GUIComponent.js', [
  'constructor', 'getRoot', 'prepare', '_prepare', 'append', 'remove', 'clone', 'focus', '_getZIndex', '_setZIndex', '_createUIProxy', '_setupMouseMode',
]);
const chatSource = region(vendor, 'src/UI/Components/ChatBox/ChatBox.js');
const chatHelpers = ['_root$18', 'extractChatMessage$1'].map(name => namedFunction(chatSource, name)).join('\n');
const chatSubmit = assignment(chatSource, 'ChatBox.submit');
const each = namedFunction(region(vendor, 'src/Renderer/EntityManager.js'), 'forEach');
const controlFile = parse(region(vendor, 'src/Controls/EntityControl.js'));
let roomEnter = '';
function findRoomEnter(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(controlFile) === 'onRoomEnter') roomEnter = 'function() ' + node.body!.getText(controlFile);
  ts.forEachChild(node, findRoomEnter);
}
findRoomEnter(controlFile);
if (!roomEnter) throw new Error('Missing native room enter handler');
const emotionStart = vendor.indexOf('  PACKET.CZ.REQ_EMOTION = function PACKET_CZ_REQ_EMOTION()');
const emotionEnd = vendor.indexOf('  PACKET.CZ.REQ_USER_COUNT =', emotionStart);
if (emotionStart < 0 || emotionEnd < emotionStart) throw new Error('Missing native emotion packet factory/build');
const emotionPacket = vendor.slice(emotionStart, emotionEnd);
const common = [
  'src/UI/Components/ChatBox/ChatBox.html?raw', 'src/UI/Components/EntityRoom/EntityRoom.html?raw',
  'src/UI/Components/EntityRoom/EntityRoom.css?raw', 'src/UI/Components/EntityRoom/EntityRoom.js',
  'src/Preferences/Controls.js', 'src/DB/Emotions.js', 'src/Utils/BinaryWriter.js',
].map(name => region(vendor, name)).join('\n');

interface Component {
  _host: HTMLElement; __active: boolean; getRoot(): ShadowRoot; append(): void; remove(): void; submit(): void;
  onEnter: (() => void) | null; onAppend: () => void;
}
interface Room {
  type: number; id: number; title: string; text: string; count: number; limit: number; display: boolean; node: Component | null;
  create(title: string, id: number, type: number, clickable: boolean): void; remove(): void; clean(): void; render(matrix: number[]): void;
  refreshShopTitleVisibility(): boolean;
}
interface PreferenceRecord { [key: string]: unknown; }
type SavedPreferences = Record<string, PreferenceRecord>;
const fixtures: Array<{ dispose(): void }> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function runtime(source = patchRuntimeShopTitles(focused), saved: SavedPreferences = {}) {
  const messages = vi.fn(), send = vi.fn(), save = vi.fn(), projection = vi.fn(), history = vi.fn(), ordinaryTalk = vi.fn();
  const callbacks: Array<() => void> = [], entities: Array<{ room: Room }> = [];
  const manager = { components: {} as Record<string, Component>, addComponent(component: Component & { name: string }) {
    this.components[component.name] = component; Object.assign(component, { manager: this }); return component;
  } };
  const context = vm.createContext({
    document, window, Event, HTMLElement, console, CSS_NUMBER: { zIndex: true, opacity: true }, Common_default$1: '',
    MouseMode: { CROSS: 0, STOP: 1, FREEZE: 2 }, Mouse: { intersect: true }, SessionStorage_default: { FreezeUI: false },
    _Cursor: null, _EntityManager: { setOverEntity: vi.fn() }, _list: entities,
    _ensureDeps() {}, setLastROInnerHTML: (target: HTMLElement, html: string) => { target.innerHTML = html; },
    __esmMin: (callback: () => void) => { let loaded = false; return () => { if (!loaded) { loaded = true; callback(); } }; },
    Preferences: { get: (name: string, defaults: PreferenceRecord) => ({ ...defaults, ...saved[name], save() {
      saved[name] = Object.fromEntries(Object.entries(this).filter(([key]) => key !== 'save')); save(name);
    } }) },
    Configs: { get: () => false }, DB: { INTERFACE_PATH: 'interface/', getMessage: (id: number) => 'message:' + id },
    Client: { loadFile: (path: string, callback: (url: string) => void) => callbacks.push(() => callback(path)) },
    UIManager: manager, EntityManager: {}, gl_matrix_default: { vec4: { transformMat4: (out: Float32Array) => {
      projection(); out[0] = out[1] = out[2] = 0; out[3] = 1;
    } } },
    Network: { sendPacket: send }, PACKET: { CZ: {
      REQ_BUY_FROMMC: class { AID = 0; }, REQ_CLICK_TO_BUYING_STORE: class { makerAID = 0; }, REQ_ENTER_ROOM: class { roomID = 0; passwd = ''; },
    } },
    ChatRoom_default: {}, _historyMessage: { push: history }, _historyNickName: { push: vi.fn(), previous: vi.fn() },
  });
  for (const match of (source + common).matchAll(/\b(init_[A-Za-z0-9_$]+)\(\)/g)) context[match[1]!] = () => {};
  vm.runInContext(`class GUIComponent {
    static MouseMode = MouseMode;
    ${guiMethods}
    _processAllDataAttrs() {} _setupScrollbars() {} _bindKeyDown() {} _unbindKeyDown() {} _fixPositionOverflow() {}
    _setupShadowCursorEvents() {}
  }
  ${common}
  init_ChatBox$2(); init_Controls(); init_Emotions(); init_BinaryWriter();
  ${emotionPacket}
  var ChatBox = new GUIComponent('ChatBox'); ChatBox.render = () => ChatBox_default$2;
  UIManager.addComponent(ChatBox); ChatBox.append();
  var ChatBox_default = ChatBox;
  ChatBox.TYPE = {INFO:1,BLUE:2}; ChatBox.FILTER={PUBLIC_LOG:0}; ChatBox.addText = messages;
  ChatBox.onRequestTalk = ordinaryTalk; ChatBox.PrivateMessageStorage = {};
  ${chatHelpers}
  ChatBox.submit = ${chatSubmit};
  ${each}
  EntityManager.forEach = forEach;
  ${source}
  init_Map(); init_ProcessCommand(); init_EntityRoom$1(); init_EntityRoom();
  globalThis.nativeRoomEnter = ${roomEnter};
  `, Object.assign(context, { messages, ordinaryTalk }));
  const chat = context.ChatBox as Component;
  save.mockClear();
  const command = (text: string) => {
    chat.getRoot().querySelector<HTMLElement>('.input-chatbox')!.textContent = text;
    chat.submit();
  };
  const create = (type: number, title = '标题<&>', id = 123) => {
    const owner = { room: null as Room | null, onRoomEnter: context.nativeRoomEnter as () => void };
    const RoomClass = context.Room as new(owner: unknown) => Room;
    const room = new RoomClass(owner); owner.room = room; entities.push({ room });
    room.title = 'metadata-title'; room.text = 'metadata-text'; room.count = 2; room.limit = 8;
    room.create(title, id, type, true);
    return room;
  };
  const f = { context, chat, messages, send, save, projection, history, ordinaryTalk, callbacks, entities, saved, command, create,
    map: () => context.Map_default as { showshop?: boolean },
    flushIcon() { const callback = callbacks.shift(); if (!callback) throw new Error('No icon callback'); callback(); },
    dispose() { for (const entity of entities) entity.room.clean(); chat.remove(); },
  };
  fixtures.push(f); return f;
}
function meta(room: Room) {
  return { type: room.type, id: room.id, title: room.title, text: room.text, count: room.count, limit: room.limit, display: room.display };
}
const display = (room: Room) => room.node!._host.style.display;

describe('native /showshop command and shop title visibility', () => {
  it('reproduces the unregistered upstream command through real ChatBox.submit without a server packet', () => {
    const f = runtime(focused); f.command('/showshop');
    expect(f.messages).toHaveBeenCalledWith('message:95', 1, 0);
    expect(f.send).not.toHaveBeenCalled(); expect(f.ordinaryTalk).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
    expect(f.history).toHaveBeenCalledWith('/showshop');
  });
  it('defaults to visible and registers only showshop while retaining native aliases and other commands', () => {
    const original = runtime(focused), f = runtime(); expect(f.map().showshop).toBe(true);
    expect(Object.keys(f.context.CommandStore as object).filter(key => key !== 'showshop')).toEqual(Object.keys(original.context.CommandStore as object));
    expect(f.context.aliases).toEqual(original.context.aliases);
    f.command('/commands'); expect(f.messages.mock.calls.flat().join(' ')).toContain('/showshop');
    f.command('/nc'); expect(f.save).toHaveBeenCalledWith('Controls');
    f.command('/ho'); expect(Array.from(new Uint8Array(f.send.mock.calls.at(-1)![0].build().buffer))).toEqual([0xbf, 0, 2]);
    f.command('/SHOWSHOP'); expect(f.messages).toHaveBeenLastCalledWith('message:95', 1, 0);
  });
  it('toggles both store kinds immediately while retaining native room metadata and chat-room titles', () => {
    const f = runtime(), rooms = [0, 1, 2, 3].map(type => f.create(type));
    for (const room of rooms) { f.flushIcon(); room.render([]); }
    const before = rooms.map(meta); f.command('/showshop');
    expect(f.map().showshop).toBe(false); expect(rooms.map(display)).toEqual(['none', 'none', '', '']);
    expect(rooms.map(meta)).toEqual(before); expect(f.save).toHaveBeenCalledTimes(1); expect(f.save).toHaveBeenCalledWith('Map');
    f.command('/showshop'); expect(rooms.map(display)).toEqual(['', '', '', '']); expect(rooms.map(meta)).toEqual(before);
    expect(f.send).not.toHaveBeenCalled(); expect(f.ordinaryTalk).not.toHaveBeenCalled();
  });
  it.each([['off', false], ['0', false], ['on', true], ['1', true], ['OFF', false], ['ON', true]] as const)('accepts explicit %s via the native parser', (argument, enabled) => {
    const f = runtime(); f.command('/showshop off'); f.save.mockClear();
    f.command('/showshop  ' + argument); expect(f.map().showshop).toBe(enabled);
    expect(f.save).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['maybe', 'off extra', 'true', '2'])('does not change or save state for invalid parameters %s', argument => {
    const f = runtime(); f.command('/showshop off'); f.save.mockClear(); f.messages.mockClear();
    f.command('/showshop ' + argument); expect(f.map().showshop).toBe(false);
    expect(f.save).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.messages.mock.calls.flat().join(' ')).toContain('/showshop');
  });
  it('reloads a saved disabled preference and applies it to newly created shops after a map change', () => {
    const saved: SavedPreferences = {}, first = runtime(undefined, saved); first.command('/showshop off');
    const second = runtime(undefined, saved); expect(second.map().showshop).toBe(false);
    const old = second.create(1); expect(display(old)).toBe('none'); old.clean(); second.flushIcon();
    expect(old.node).toBeNull(); expect(() => old.render([])).not.toThrow();
    const next = second.create(0); expect(display(next)).toBe('none'); second.flushIcon();
    expect(display(next)).toBe('none'); expect(next.node!._host.isConnected).toBe(true);
    second.command('/showshop on'); expect(display(next)).toBe('');
  });
  it.each([0, 1])('keeps a new store type %i hidden through actual prepare/onAppend and asynchronous icon loading', type => {
    const f = runtime(); f.command('/showshop off'); const room = f.create(type);
    const node = room.node!; expect(node.__active).toBe(true); expect(node._host.isConnected).toBe(true); expect(display(room)).toBe('none');
    f.flushIcon(); expect(room.display).toBe(true); expect(display(room)).toBe('none');
    expect(node.getRoot().querySelector('.title')!.textContent).toBe('标题<&>');
    expect(node._host.style.zIndex).toBe('45'); // Native onAppend still executes.
    room.render([]); expect(f.projection).not.toHaveBeenCalled();
    f.command('/showshop on'); room.render([]); expect(f.projection).toHaveBeenCalledOnce();
    expect(display(room)).toBe(''); expect(node._host.style.top).toMatch(/^\d+px$/);
  });
  it('uses the current setting when the asynchronous icon resolves after a visibility toggle', () => {
    const f = runtime(), room = f.create(1); f.command('/showshop off'); f.flushIcon();
    expect(room.display).toBe(true); expect(display(room)).toBe('none');
    f.command('/showshop on'); expect(display(room)).toBe('');
  });
  it.each(['remove', 'clean'] as const)('does not reattach a closed shop after a late icon callback following %s', close => {
    const f = runtime(), room = f.create(1), node = room.node!; room[close]();
    expect(node._host.isConnected).toBe(false); expect(() => f.flushIcon()).not.toThrow();
    expect(node._host.isConnected).toBe(false); expect(() => room.render([])).not.toThrow();
    f.command('/showshop off'); f.command('/showshop on'); expect(node._host.isConnected).toBe(false);
  });
  it('keeps an existing hidden store hidden when its same native node is reopened', () => {
    const f = runtime(), room = f.create(1); f.flushIcon(); f.command('/showshop off'); const node = room.node!;
    room.remove(); room.create('重新开店', 456, 0, true); expect(room.node).toBe(node);
    expect(node._host.isConnected).toBe(true); expect(display(room)).toBe('none'); f.flushIcon(); expect(display(room)).toBe('none');
  });
  it.each(['inline', 'block'])('does not restore the old %s display onto a new native clone after cleaning the same room', previousDisplay => {
    const f = runtime(), room = f.create(1); f.flushIcon(); const previousNode = room.node!;
    previousNode._host.style.display = previousDisplay; f.command('/showshop off'); room.clean();
    room.create('新商店', 456, 0, true); const newNode = room.node!;
    expect(newNode).not.toBe(previousNode); expect(newNode._host.isConnected).toBe(true); expect(display(room)).toBe('none');
    expect(previousNode._host.isConnected).toBe(false); f.flushIcon(); f.command('/showshop on');
    expect(display(room)).toBe(''); expect(previousNode._host.isConnected).toBe(false);
    expect(newNode.getRoot().querySelector('.title')!.textContent).toBe('新商店'); expect(room.id).toBe(456);
  });
  it.each([2, 3])('restores a reused hidden shop node when it becomes chat-room type %i', type => {
    const f = runtime(), room = f.create(1); f.flushIcon(); const node = room.node!; node._host.style.display = 'block';
    f.command('/showshop off'); expect(display(room)).toBe('none'); room.create('聊天房间', 999, type, true);
    expect(room.node).toBe(node); expect(display(room)).toBe('block'); expect(room.type).toBe(type); expect(room.id).toBe(999);
    f.flushIcon(); expect(display(room)).toBe('block'); expect(node.getRoot().querySelector('.title')!.textContent).toBe('聊天房间');
  });
  it('retains unrelated chat-room styles and restores only the shop display value owned by the helper', () => {
    const f = runtime(), shop = f.create(1), chat = f.create(2); f.flushIcon(); f.flushIcon();
    shop.node!._host.style.display = 'inline'; chat.node!._host.style.display = 'none';
    f.command('/showshop off'); f.command('/showshop on'); expect(display(shop)).toBe('inline'); expect(display(chat)).toBe('none');
  });
  it.each([0, 1])('retains native title mousedown protection and double-click store packet for type %i', type => {
    const f = runtime(), room = f.create(type); f.flushIcon(); f.command('/showshop off'); f.command('/showshop on');
    const button = room.node!.getRoot().querySelector('button')!, downstream = vi.fn();
    window.addEventListener('mousedown', downstream);
    try {
      const event = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true, button: 0 });
      button.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(downstream).not.toHaveBeenCalled();
      button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })); expect(f.send).toHaveBeenCalledOnce();
      expect(f.send.mock.calls[0]![0]).toMatchObject(type === 0 ? { makerAID: 123 } : { AID: 123 });
    } finally { window.removeEventListener('mousedown', downstream); }
  });
  it('does not add a server close packet or destroy the native title control when hiding', () => {
    const f = runtime(), room = f.create(1); f.flushIcon(); const node = room.node!;
    f.command('/showshop off'); expect(room.node).toBe(node); expect(node.__active).toBe(true); expect(node._host.isConnected).toBe(true);
    expect(room.display).toBe(true); expect(f.send).not.toHaveBeenCalled();
  });
});

describe('shop title patch boundary', () => {
  it('changes only the three intended regions of the complete production snapshot', () => {
    const full = patchRuntimeShopTitles(vendor);
    const mask = (source: string) => paths.reduce((text, name) => text.replace(region(text, name), '/* intended ' + name + ' */'), source);
    expect(mask(full)).toBe(mask(vendor));
    expect(full).toContain('refreshShopTitleVisibility');
    for (const name of paths) expect(region(full, name)).toBe(region(patchRuntimeShopTitles(focused), name));
  });
  it('accepts LF and CRLF region input without changing runtime behavior', () => {
    for (const source of [focused.replace(/\r\n/g, '\n'), focused.replace(/\r?\n/g, '\r\n')]) {
      const f = runtime(patchRuntimeShopTitles(source)); f.command('/showshop off'); const room = f.create(1); f.flushIcon();
      expect(display(room)).toBe('none'); f.command('/showshop on'); expect(display(room)).toBe('');
    }
  });
  it('leaves unrelated partial source untouched and rejects duplicated native regions', () => {
    expect(patchRuntimeShopTitles('const untouched = 1;')).toBe('const untouched = 1;');
    expect(() => patchRuntimeShopTitles(focused + '\n' + region(vendor, paths[0]!))).toThrow('anchor:shop-titles:');
  });
  it('rejects a changed native command registry rather than silently installing into an unknown context', () => {
    expect(() => patchRuntimeShopTitles(focused.replace('  CommandStore = {', '  CommandStoreChanged = {'))).toThrow('anchor:shop-titles:');
  });
});
