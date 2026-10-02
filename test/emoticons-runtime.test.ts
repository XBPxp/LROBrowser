// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchRuntimeEmoticons } from '../scripts/lastro-emoticons.mjs';

const vendor = readFileSync('vendor/v2/Online.js', 'utf8');
function region(source: string, name: string) {
  const start = source.indexOf(`//#region ${name}`), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error(`Missing native region: ${name}`);
  return source.slice(start, end + '//#endregion'.length);
}
function parse(name: string) {
  return ts.createSourceFile(name, region(vendor, name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
const guiFile = parse('src/UI/GUIComponent.js');
let guiClass: ts.ClassExpression | undefined;
function findGui(node: ts.Node) {
  if (ts.isClassExpression(node) && node.name?.text === 'GUIComponent') guiClass = node;
  ts.forEachChild(node, findGui);
}
findGui(guiFile);
if (!guiClass) throw new Error('Missing native GUIComponent class');
const guiMethods = ['constructor', 'getRoot', 'prepare', '_prepare', 'append', 'remove', 'focus', '_getZIndex', '_setZIndex', '_createUIProxy', '_setupMouseMode'].map(name => {
  const matches = guiClass!.members.filter(member => name === 'constructor' ? ts.isConstructorDeclaration(member)
    : ts.isMethodDeclaration(member) && member.name.getText(guiFile) === name);
  if (matches.length !== 1) throw new Error(`Missing native GUI method: ${name}`);
  return matches[0]!.getText(guiFile);
}).join('\n');
const chatFile = parse('src/UI/Components/ChatBox/ChatBox.js');
const commandFile = parse('src/Controls/ProcessCommand.js');
function namedFunction(file: ts.SourceFile, name: string) {
  const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (matches.length !== 1) throw new Error(`Missing native function: ${name}`);
  return matches[0]!.getText(file);
}
function assignedFunction(file: ts.SourceFile, target: string) {
  const matches: ts.FunctionExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.left.getText(file) === target && ts.isFunctionExpression(node.right)) matches.push(node.right);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1) throw new Error(`Missing native assignment: ${target}`);
  return matches[0]!.getText(file);
}
const chatHelpers = [namedFunction(chatFile, '_root$18'), namedFunction(chatFile, 'extractChatMessage$1')].join('\n');
const chatSubmit = assignedFunction(chatFile, 'ChatBox.submit');
const processCommand = namedFunction(commandFile, 'processCommand');
const packetStart = vendor.indexOf('  PACKET.CZ.REQ_EMOTION = function PACKET_CZ_REQ_EMOTION()');
const packetEnd = vendor.indexOf('  PACKET.CZ.REQ_USER_COUNT =', packetStart);
if (packetStart < 0 || packetEnd < 0) throw new Error('Missing native emotion packet factory/build');
const packet = vendor.slice(packetStart, packetEnd);
const modules = [
  'src/DB/Emotions.js', 'src/Utils/BinaryWriter.js', 'src/UI/Components/ChatBox/ChatBox.html?raw',
  'src/UI/Components/ShortCuts/ShortCuts.html?raw', 'src/UI/Components/Emoticons/Emoticons.html?raw',
  'src/UI/Components/Emoticons/Emoticons.css?raw', 'src/UI/Components/Emoticons/Emoticons.js',
];
const native = modules.map(name => region(vendor, name)).join('\n');
const patched = patchRuntimeEmoticons(native);

function maskInputBodies(source: string) {
  const name = 'src/UI/Components/Emoticons/Emoticons.js', text = region(source, name);
  const offset = source.indexOf(text);
  const file = ts.createSourceFile('Emoticons.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = ['onSelectEmoticon', 'onPlayEmoticon'].map(name => {
    const matches = file.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1 || !matches[0]!.body) throw new Error(`Missing mask target: ${name}`);
    const body = matches[0]!.body;
    return { start: offset + body.getStart(file), end: offset + body.end };
  });
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + '{ /* input body */ }' + output.slice(edit.end);
  }
  return output;
}

interface Component {
  name: string; _host: HTMLElement | null; __loaded: boolean; __active: boolean;
  getRoot(): ShadowRoot; append(): void; remove(): void; submit(): void;
  movePage(direction: number): void;
  ui: { is(selector: string): boolean; show(): void; hide(): void } | null;
}
interface Packet { type: number; build(): { buffer: ArrayBuffer } }
const fixtures: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function runtime(source = patched, options: { chatPrepared?: boolean; macroPrepared?: boolean } = {}) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({} as CanvasRenderingContext2D));
  const errors: unknown[] = [], frames: number[][] = [];
  const send = vi.fn((packet: Packet) => frames.push(Array.from(new Uint8Array(packet.build().buffer))));
  const error = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
  window.addEventListener('error', error);
  const manager = { components: {} as Record<string, Component>, addComponent(component: Component) {
    this.components[component.name] = component;
    Object.assign(component, { manager: this });
    return component;
  } };
  const context = vm.createContext({
    document, window, Event, HTMLElement, console,
    MouseMode: { CROSS: 0, STOP: 1, FREEZE: 2 }, Mouse: { intersect: true }, SessionStorage_default: { FreezeUI: false },
    CSS_NUMBER: { zIndex: true, opacity: true }, _Cursor: null, _EntityManager: null, Common_default$1: '',
    _ensureDeps() {}, setLastROInnerHTML: (target: HTMLElement, html: string) => { target.innerHTML = html; },
    // Window geometry persistence does not participate in the click-to-command path.
    lastroUiWindowAppend: (_component: unknown, _prefs: unknown, append: () => void) => append(),
    __esmMin: (fn: () => void) => { let loaded = false; return () => { if (!loaded) { loaded = true; fn(); } }; },
    Preferences: { get: (_key: string, defaults: Record<string, unknown>) => ({ ...defaults, save() {} }) },
    Renderer: { height: 768, width: 1024 }, Entity: class { renderLayer() {} }, SpriteRenderer: { bind2DContext() {} },
    Client: { loadFiles: (_paths: string[], callback: (act: unknown, spr: unknown) => void) => callback({
      actions: Array.from({ length: 87 }, () => ({ animations: Array.from({ length: 5 }, () => ({ layers: [{ pos: [0, 0] }] })) })),
    }, {}), loadFile: vi.fn() },
    Network: { sendPacket: send }, PACKET: { CZ: {} },
    CommandStore: {}, aliases: {}, DB: { getMessage: (id: number) => String(id) }, _historyMessage: { push: vi.fn() },
    UIManager: manager, prepareChat: options.chatPrepared !== false, prepareMacro: options.macroPrepared !== false,
  });
  for (const dependency of ['Client', 'Preferences$1', 'Renderer', 'SpriteRenderer', 'Entity$1', 'UIManager', 'GUIComponent', 'ChatBox', 'ShortCuts', 'CodepageManager']) context[`init_${dependency}`] = () => {};
  vm.runInContext(`class GUIComponent {
    static MouseMode = MouseMode;
    ${guiMethods}
    _processAllDataAttrs() {} _setupScrollbars() {} _bindKeyDown() {} _unbindKeyDown() {} _fixPositionOverflow() {}
    _setupShadowCursorEvents() {} draggable() {}
  }
  ${source}
  init_Emotions(); init_BinaryWriter();
  ${packet}
  init_ChatBox$2(); init_ShortCuts$2();
  var ChatBox = new GUIComponent('ChatBox');
  ChatBox.render = () => ChatBox_default$2;
  UIManager.addComponent(ChatBox);
  if (prepareChat) ChatBox.append();
  var ChatBox_default = ChatBox;
  ${chatHelpers}
  ${processCommand}
  var ProcessCommand_default = { processCommand };
  ChatBox.submit = ${chatSubmit};
  var ShortCuts_default = new GUIComponent('ShortCuts');
  ShortCuts_default.render = () => ShortCuts_default$2;
  UIManager.addComponent(ShortCuts_default);
  if (prepareMacro) { ShortCuts_default.append(); ShortCuts_default.ui.hide(); }
  init_Emoticons(); Emoticons.append(); Emoticons.onShortCut({ cmd: 'TOGGLE' });
  `, context);
  const chat = context.ChatBox as Component, macro = context.ShortCuts_default as Component, emoticons = context.Emoticons as Component;
  const submit = vi.fn(chat.submit.bind(chat));
  chat.submit = submit;
  const message = () => chat.getRoot()?.querySelector<HTMLElement>('.input .message');
  const macroInput = () => macro.getRoot()?.querySelector<HTMLInputElement>('input.macro_');
  const emit = (element: Element, name: string) => element.dispatchEvent(new MouseEvent(name, { bubbles: true, composed: true, button: 0 }));
  const fixture = {
    context, chat, macro, emoticons, submit, send, frames, errors, message, macroInput, emit,
    single(canvas: Element) { emit(canvas, 'mousedown'); emit(canvas, 'mouseup'); emit(canvas, 'click'); },
    double(canvas: Element) { this.single(canvas); this.single(canvas); emit(canvas, 'dblclick'); },
    canvas() { return emoticons.getRoot().querySelector<HTMLCanvasElement>('canvas[data-index="2"]')!; },
    showMacro() {
      macro.ui!.show();
      Object.defineProperty(macro._host!, 'offsetParent', { configurable: true, get: () => document.body });
      macroInput()!.classList.add('input_macro_focus');
    },
    dispose() {
      for (const component of [emoticons, chat, macro]) component.remove();
      window.removeEventListener('error', error);
    },
  };
  fixtures.push(fixture);
  return fixture;
}

describe('native Emoticons click-to-command migration', () => {
  it('reproduces the old missing html/val methods before submit while manual commands still build native packets', () => {
    const h = runtime(native);
    expect(h.message()).not.toBeNull();
    h.single(h.canvas()); h.emit(h.canvas(), 'dblclick');
    expect(h.errors.map(String)).toEqual([
      expect.stringContaining('html is not a function'), expect.stringContaining('html is not a function'),
    ]);
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    h.showMacro(); h.single(h.canvas());
    expect(String(h.errors.at(-1))).toContain('val is not a function');
    h.message()!.textContent = '/ho'; h.chat.submit();
    expect(h.frames).toEqual([[0xbf, 0, 2]]);
  });

  it('selects and plays all 64 real catalog icons through native page/event/command/packet paths', () => {
    const h = runtime(), visited: string[] = [];
    const focus = vi.spyOn(h.message()!, 'focus');
    for (let page = 0; page < 3; page++) {
      const canvases = Array.from(h.emoticons.getRoot().querySelectorAll('canvas'));
      expect(canvases).toHaveLength(page < 2 ? 30 : 4);
      for (const canvas of canvases) {
        const index = canvas.getAttribute('data-index')!;
        const command = h.context.Emotions_default.names[index] as string;
        const type = h.context.Emotions_default.commands[command] as number;
        const count = h.frames.length;
        h.single(canvas);
        expect(h.message()?.textContent, `${index}: single click`).toBe('/' + command);
        expect(h.frames).toHaveLength(count);
        h.double(canvas);
        expect(h.submit, `${index}: double click submits once`).toHaveBeenCalledTimes(count + 1);
        expect(h.frames.at(-1), `${index}: native REQ_EMOTION bytes`).toEqual([0xbf, 0, type]);
        expect(h.frames).toHaveLength(count + 1);
        expect(h.message()?.textContent).toBe('');
        visited.push(index);
      }
      h.emoticons.movePage(1);
    }
    expect(new Set(visited).size).toBe(64);
    expect(focus).toHaveBeenCalledTimes(64 * 3);
    expect(h.errors).toEqual([]);
  });

  it('writes/selects the chosen visible macro without changing chat, while a double click still plays in chat', () => {
    const h = runtime();
    h.showMacro();
    h.message()!.textContent = '已有聊天';
    const macro = h.macroInput()!, select = vi.spyOn(macro, 'select');
    h.single(h.canvas());
    expect(macro.value).toBe('/ho');
    expect(select).toHaveBeenCalledOnce();
    expect([macro.selectionStart, macro.selectionEnd]).toEqual([0, 3]);
    expect(h.message()?.textContent).toBe('已有聊天');
    expect(h.send).not.toHaveBeenCalled();
    h.emit(h.canvas(), 'dblclick');
    expect(h.submit).toHaveBeenCalledOnce();
    expect(h.frames).toEqual([[0xbf, 0, 2]]);
    expect(macro.value).toBe('/ho');
    expect(h.errors).toEqual([]);
  });

  it.each(['hidden', 'detached', 'hidden attribute'] as const)('ignores an old selected macro when its host is %s', (state) => {
    const h = runtime();
    h.showMacro(); h.macroInput()!.value = '原宏';
    if (state === 'hidden') h.macro.ui!.hide();
    else if (state === 'detached') h.macro._host!.remove();
    else h.macro._host!.hidden = true;
    h.single(h.canvas());
    expect(h.macroInput()?.value).toBe('原宏');
    expect(h.message()?.textContent).toBe('/ho');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.errors).toEqual([]);
  });

  it('falls back to chat when the shortcuts window has not been prepared', () => {
    const h = runtime(patched, { macroPrepared: false });
    expect(h.macro._host).toBeNull();
    h.single(h.canvas());
    expect(h.message()?.textContent).toBe('/ho');
    h.emit(h.canvas(), 'dblclick');
    expect(h.frames).toEqual([[0xbf, 0, 2]]);
    expect(h.errors).toEqual([]);
  });

  it('can fill and play with hidden chat without forcing the chat window or input into view', () => {
    const h = runtime();
    h.chat.ui!.hide();
    const input = h.chat.getRoot().querySelector<HTMLElement>('.input')!;
    input.style.display = 'none';
    h.single(h.canvas()); h.emit(h.canvas(), 'dblclick');
    expect(h.frames).toEqual([[0xbf, 0, 2]]);
    expect(h.chat._host?.style.display).toBe('none');
    expect(input.style.display).toBe('none');
    expect(h.errors).toEqual([]);
  });

  it.each([null, '', '-1', '1.5', '9999', 'constructor', '__proto__'] as const)('ignores invalid icon index %s without changing existing input or submitting', index => {
    const h = runtime(), canvas = h.canvas();
    h.message()!.textContent = '原输入';
    if (index === null) canvas.removeAttribute('data-index');
    else canvas.setAttribute('data-index', index);
    h.single(canvas); h.emit(canvas, 'dblclick');
    expect(h.message()?.textContent).toBe('原输入');
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.errors).toEqual([]);
  });

  it('ignores content-area events outside a canvas', () => {
    const h = runtime(), content = h.emoticons.getRoot().querySelector('.content')!;
    const span = document.createElement('span'); span.dataset.index = '2'; content.append(span);
    h.message()!.textContent = '原输入';
    h.single(span); h.emit(span, 'dblclick');
    expect(h.message()?.textContent).toBe('原输入');
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.errors).toEqual([]);
  });

  it.each(['unprepared', 'missing input', 'missing submit'] as const)('does not submit when chat is %s', state => {
    const h = runtime(patched, { chatPrepared: state !== 'unprepared' });
    if (state === 'missing input') h.message()!.remove();
    else if (state === 'missing submit') Object.assign(h.chat, { submit: undefined });
    h.single(h.canvas()); h.emit(h.canvas(), 'dblclick');
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.errors).toEqual([]);
  });

  it('keeps the retained canvas event bindings functional after native remove and append', () => {
    const h = runtime(), canvas = h.canvas(), host = h.emoticons._host;
    h.emoticons.remove(); h.emoticons.append();
    h.single(canvas); h.emit(canvas, 'dblclick');
    expect(h.emoticons._host).toBe(host);
    expect(h.submit).toHaveBeenCalledOnce();
    expect(h.frames).toEqual([[0xbf, 0, 2]]);
    expect(h.errors).toEqual([]);
  });
});

describe('scoped Emoticons patch contract', () => {
  const emoticons = region(native, 'src/UI/Components/Emoticons/Emoticons.js');

  it('leaves a source without the Emoticons component unchanged', () => {
    const source = 'const unrelated = "onPlayEmoticon";\r\n' + region(native, 'src/DB/Emotions.js');
    expect(patchRuntimeEmoticons(source)).toBe(source);
  });

  it('is idempotent and preserves all bytes outside the two input function bodies, including prefix and suffix', () => {
    const prefix = 'const sentinel = "\\n keep prefix";\r\n/* prefix sentinel */\r\n';
    const suffix = '\r\n/* suffix sentinel */\r\n' + packet;
    const source = prefix + emoticons + suffix, repaired = patchRuntimeEmoticons(source);
    expect(repaired).not.toBe(source);
    expect(patchRuntimeEmoticons(repaired)).toBe(repaired);
    expect(maskInputBodies(repaired)).toBe(maskInputBodies(source));
    expect(repaired.startsWith(prefix)).toBe(true);
    expect(repaired.endsWith(suffix)).toBe(true);
    for (const name of modules.filter(name => name !== 'src/UI/Components/Emoticons/Emoticons.js')) {
      expect(region(patched, name), name).toBe(region(native, name));
    }
  });

  it.each([
    { name: 'duplicate region', source: emoticons + '\n' + emoticons, reason: 'duplicate-region' },
    { name: 'missing end', source: emoticons.slice(0, emoticons.lastIndexOf('//#endregion')), reason: 'missing-region-end' },
    { name: 'missing handler', source: emoticons.replace('function onPlayEmoticon(canvas)', 'function removedPlayEmoticon(canvas)'), reason: 'onPlayEmoticon' },
    { name: 'body drift', source: emoticons.replace('ChatBox_default.submit();', 'ChatBox_default.submit("changed");'), reason: 'onPlayEmoticon:body' },
    { name: 'malformed source', source: emoticons.replace('function onPlayEmoticon(canvas)', 'function onPlayEmoticon(canvas'), reason: 'invalid-source' },
  ])('rejects $name without broadening the transformation', ({ source, reason }) => {
    expect(() => patchRuntimeEmoticons(source)).toThrow('anchor:emoticons:' + reason);
  });
});
