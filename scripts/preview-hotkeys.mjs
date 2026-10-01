// Offline native shortcut editor and keyboard routing; no game connection.
import { readFile, writeFile } from 'node:fs/promises';
import console from 'node:console';
import process from 'node:process';
import ts from 'typescript';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const { patchRuntimeHotkeys } = await import('./lastro-hotkeys.mjs');
const patched = process.argv.includes('--native')
  ? await readFile('vendor/v2/Online.js', 'utf8')
  : runtime.includes('function lastroHotkeyId(') ? runtime : patchRuntimeHotkeys(runtime);
const source = ts.createSourceFile('Online.js', patched, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function region(path) {
  const value = new RegExp('//#region ' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\r?\\n[\\s\\S]*?//#endregion').exec(patched)?.[0];
  if (!value) throw new Error('Missing native hotkey region: ' + path);
  return value;
}
function literal(path) {
  const file = ts.createSourceFile('native.js', region(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let result;
  function visit(node) { if (ts.isBinaryExpression(node) && ts.isStringLiteral(node.right)) result = node.right.text; ts.forEachChild(node, visit); }
  visit(file);
  if (result == null) throw new Error('Missing native hotkey literal: ' + path);
  return result;
}
const pieces = [
  region('src/Controls/KeyEventHandler.js'),
  region('src/Preferences/ShortCutControls.js'),
  region('src/Controls/BattleMode.js'),
  region('src/UI/Components/ShortCutOption/ShortCutOption.js'),
];
const values = {
  shortcutHtml: literal('src/UI/Components/ShortCutOption/ShortCutOption.html?raw'),
  shortcutCss: literal('src/UI/Components/ShortCutOption/ShortCutOption.css?raw'),
  chatHtml: literal('src/UI/Components/ChatBox/ChatBox.html?raw'),
  chatCss: literal('src/UI/Components/ChatBox/ChatBox.css?raw'),
};
const methods = {}, elements = {}, helpers = [];
function visit(node) {
  if (ts.isBinaryExpression(node) && ts.isFunctionExpression(node.right) && ['ChatBox.onKeyDown', 'ChatBox.processBattleMode', 'ChatBox.onShortCut'].includes(node.left.getText(source))) methods[node.left.getText(source)] = node.right.getText(source);
  if (ts.isBinaryExpression(node) && node.left.getText(source) === 'Common_default$1' && ts.isStringLiteral(node.right)) values.commonCss = node.right.text;
  if (ts.isBinaryExpression(node) && ['UIButton', 'UIText', 'UIImage'].includes(node.left.getText(source)) && ts.isClassExpression(node.right)) elements[node.left.getText(source)] = node.right.getText(source);
  if (ts.isMethodDeclaration(node) && ['processDataAttrs', '_bindKeyDown', '_unbindKeyDown'].includes(node.name?.getText(source))) methods[node.name.getText(source)] = node.getText(source).replace(/^static\s+/, '');
  if (ts.isFunctionDeclaration(node) && node.name && (/lastro.*(?:key|hotkey|shortcut)/i.test(node.name.text) || node.name.text === 'shouldLetChatInputHandleVerticalArrows')) {
    const code = node.getText(source);
    if (!pieces.some(piece => piece.includes(code))) helpers.push(code);
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (!values.commonCss || Object.keys(elements).length !== 3 || Object.keys(methods).length < 5) throw new Error('Missing native hotkey methods');
const assets = new Set();
for (const html of [values.shortcutHtml, values.chatHtml]) for (const match of html.matchAll(/(?:data-(?:background|hover|down)|bg|hover|down|src)="([^";]+\.bmp)"/g)) assets.add(match[1]);
const { manifest, failures } = await cacheNativeUiAssets([...assets], 'generated/hotkey-assets');
const messages = Object.fromEntries((await readFile('generated/core/data/msgstringtable.csv', 'utf8')).split(/\r?\n/).map((line, index) => [index, line.slice(line.indexOf(line.includes('\t') ? '\t' : ',') + 1)]));
const initializers = pieces.join('\n').match(/\binit_[\w$]+\(/g) || [];
const definitions = new Set((pieces.join('\n').match(/\b(?:var|function) (init_[\w$]+)/g) || []).map(text => text.split(' ').at(-1)));
const stubs = [...new Set(initializers.map(text => text.slice(0, -1)))].filter(name => !definitions.has(name));

const prelude = String.raw`
let previewFontsLoaded = false;
document.body.dataset.fontReady = 'false';
const previewFontWeights = [400, 500, 700];
const previewFontsReady = Promise.all(previewFontWeights.map(weight => document.fonts.load(weight + ' 12px "MiSans"', 'LASTRO 活动传送中文字体测试'))).then(async faces => {
  await document.fonts.ready;
  previewFontsLoaded = faces.every(group => group.some(face => face.family.replace(/["']/g, '') === 'MiSans' && face.status === 'loaded')) && previewFontWeights.every(weight => document.fonts.check(weight + ' 12px "MiSans"'));
  document.body.dataset.fontReady = String(previewFontsLoaded);
  document.body.dataset.fontWeights = previewFontWeights.join(',');
  if (!previewFontsLoaded) document.body.dataset.fontFailure = 'MiSans 字体未加载';
  return previewFontsLoaded;
}).catch(error => { document.body.dataset.fontReady = 'false'; document.body.dataset.fontFailure = error.message; return false; });

const actions = [];
const preferencePrefix = 'lastro:preview-hotkeys:';
function record(component, command) { actions.push({ component, command }); report(); }
const Preferences = {
  get(name, defaults) {
    let value = structuredClone(defaults);
    try { value = Object.assign(value, JSON.parse(localStorage.getItem(preferencePrefix + name) || '{}')); } catch {}
    value.save = () => { localStorage.setItem(preferencePrefix + name, JSON.stringify(value)); document.body.dataset.saved = name; report(); };
    return value;
  },
};
const DB = { INTERFACE_PATH: '', getMessage: (id, fallback = '') => messages[id] || fallback };
const Client = { loadFile: (asset, done) => decodeBmp(asset).then(done).catch(assetError) };
const _DB = DB, _Client = Client;
const Controls_default = Preferences.get('Controls', { attackTargetMode: 0, joySense: 1, joyQuick: 1, joyDeadline: 10, joyReverseStick: false, joyAutoHide: false, joyDisableVirtualMouse: false });
const ProcessCommand_default = { processCommand: command => record('slashcommand', command) };
const components = {};
const UIManager = {
  components,
  addComponent(component) { components[component.name] = component; component.manager = this; return component; },
  getComponent(name) { return components[name] || { onShortCut: key => record(name, key.cmd), updateAllTooltips() {} }; },
};
const __esmMin = factory => { let initialized = false; return () => { if (!initialized) { initialized = true; factory(); } }; };
class GUIComponent {
  static MouseMode = { STOP: 1 };
  constructor(name, css) { this.name = name; this.css = css; this.__active = false; this.__loaded = false; }
  getRoot() { return this._shadow; }
  append(target = document.getElementById('editor')) {
    if (!this.__loaded) {
      this._host = document.createElement('div'); this._host.id = this.name;
      Object.assign(this._host.style, { position: 'relative', left: '0px', top: '0px', width: '430px', height: '465px', zIndex: '50', fontFamily: "Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif", fontSizeAdjust: 'none' });
      this._shadow = this._host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = values.commonCss + this.css;
      const container = document.createElement('div'); setLastROInnerHTML(container, this.render()); this._shadow.append(style, container);
      this._shadow.querySelectorAll('[data-background],[data-hover],[data-down],[data-text]').forEach(GUIComponent.processDataAttrs);
      this.ui = { is: () => this.isVisible(), show: () => { this._host.style.display = ''; }, hide: () => { this._host.style.display = 'none'; } };
      this.__loaded = true; this.init?.();
      this._shadow.addEventListener('click', () => queueMicrotask(report));
      new MutationObserver(() => report()).observe(this._shadow, { subtree: true, attributes: true, childList: true, characterData: true });
    }
    this.__active = true; this._host.style.display = ''; target.append(this._host);
    if (this.onKeyDown) this._bindKeyDown(); this.onAppend?.();
    this._host.style.left = '0px'; this._host.style.top = '0px'; report();
  }
  remove() { this.onRemove?.(); this.__active = false; this._unbindKeyDown(); this._host?.remove(); report(); }
  isVisible() { return !!this.__active && !!this._host?.isConnected && this._host.style.display !== 'none'; }
  draggable() {}
  focus() { if (this._host) this._host.style.zIndex = '50'; }
  placeOnTop() { this.focus(); }
  NATIVE_BIND_KEYDOWN
  NATIVE_UNBIND_KEYDOWN
}
GUIComponent.processDataAttrs = NATIVE_DATA_ATTRS;
function report() {
  if (!previewFontsLoaded) return;
  if (typeof ShortCutOption === 'undefined' || !ShortCutOption?._shadow) return;
  const root = ShortCutOption.getRoot();
  const selected = root.querySelector('td.selected');
  Object.assign(document.body.dataset, {
    capturing: String(ShortCutOption.isCapturing), editorVisible: String(ShortCutOption.isVisible()),
    selected: selected?.dataset.button || '', pending: JSON.stringify(ShortCutsTemp),
    shortcuts: JSON.stringify(ShortCutControls_default.ShortCuts), actions: JSON.stringify(actions.slice(-20)),
    actionCount: String(actions.length), focused: KEYS.getDeepActiveElement()?.className || document.activeElement?.tagName || '',
  });
  document.getElementById('state').textContent = '录制：' + (ShortCutOption.isCapturing ? selected?.dataset.button || '活动' : '关闭') + ' · 本地动作：' + actions.length;
  document.getElementById('action-log').textContent = actions.slice(-8).map(action => action.component + ' · ' + action.command).join('\n');
}
window.addEventListener('keydown', event => {
  const snapshot = { key: event.key, code: event.code, which: event.which, alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey, composing: event.isComposing, trusted: event.isTrusted };
  // A native dispatch can perform a microtask checkpoint between listeners.
  // Sample in the next task so the native handlers have finished canceling it.
  setTimeout(() => queueMicrotask(() => { snapshot.prevented = event.defaultPrevented; document.body.dataset.lastKey = JSON.stringify(snapshot); document.getElementById('last-key').textContent = JSON.stringify(snapshot); report(); }), 0);
}, true);
`;

const postlude = String.raw`
init_KeyEventHandler(); init_ShortCutControls(); init_BattleMode();
const ChatBox = new GUIComponent('ChatBox', values.chatCss);
ChatBox.render = () => values.chatHtml;
ChatBox.captureKeyEvents = true;
ChatBox.activeTab = 0;
ChatBox.init = function () {
  const root = this.getRoot(); root.querySelector('.input').style.display = 'none'; root.querySelector('.battlemode').style.display = 'block';
  root.querySelector('.contentwrapper').innerHTML = '<div class="content active" data-content="0">本地键盘测试：此处不会连接游戏。</div>';
};
ChatBox.submit = function () {
  const root = this.getRoot(), input = root.querySelector('.input'), message = root.querySelector('.input-chatbox'), mode = root.querySelector('.battlemode');
  if (message.textContent.trim()) { record('local-chat', message.textContent); message.textContent = ''; }
  else { const opening = input.style.display === 'none'; input.style.display = opening ? 'block' : 'none'; mode.style.display = opening ? 'none' : 'block'; if (opening) message.focus(); }
};
ChatBox.updateHeight = () => record('ChatBox', 'resize');
const _root$18 = () => ChatBox.getRoot();
const ChatBoxSettings_default = { updateTab() {} };
const _historyMessage = { previous: () => '', next: () => '' }, _historyNickName = _historyMessage;
ChatBox.processBattleMode = NATIVE_PROCESS_BATTLE;
ChatBox.onKeyDown = NATIVE_CHAT_KEYDOWN;
ChatBox.onShortCut = NATIVE_CHAT_SHORTCUT;
UIManager.addComponent(ChatBox);
ChatBox.append(document.getElementById('chat')); Object.assign(ChatBox._host.style, { width: '600px', height: '160px' });
init_ShortCutOption(); ShortCutOption.append();
document.getElementById('open').addEventListener('click', () => ShortCutOption.append());
document.getElementById('close').addEventListener('click', () => ShortCutOption.remove());
document.getElementById('game-focus').addEventListener('click', () => document.getElementById('game-area').focus());
document.getElementById('chat-focus').addEventListener('click', () => { ChatBox.getRoot().querySelector('.input').style.display = 'block'; ChatBox.getRoot().querySelector('.battlemode').style.display = 'none'; ChatBox.getRoot().querySelector('.input-chatbox').focus(); });
document.getElementById('reset-local').addEventListener('click', () => { for (const key of Object.keys(localStorage)) if (key.startsWith(preferencePrefix)) localStorage.removeItem(key); location.reload(); });
document.getElementById('game-area').addEventListener('pointerdown', event => { if (event.target === event.currentTarget) event.currentTarget.focus(); });
Promise.all(Object.keys(manifest).map(decodeBmp)).then(() => { document.body.dataset.assetsReady = 'true'; report(); });
previewFontsReady.then(() => requestAnimationFrame(report));
`;

const js = [
  'import { setLastROInnerHTML } from "./hotkey-trusted-dom.mjs";',
  'const values = ' + JSON.stringify(values) + ';', 'const messages = ' + JSON.stringify(messages) + ';',
  'const manifest = ' + JSON.stringify(manifest) + '; const assetDirectory = "hotkey-assets";',
  NATIVE_BMP_PREVIEW_SOURCE,
  prelude.replace('NATIVE_BIND_KEYDOWN', methods._bindKeyDown).replace('NATIVE_UNBIND_KEYDOWN', methods._unbindKeyDown).replace('NATIVE_DATA_ATTRS', 'function (' + methods.processDataAttrs.slice(methods.processDataAttrs.indexOf('(') + 1)),
  ...Object.entries(elements).map(([name, code]) => 'customElements.define(' + JSON.stringify({ UIButton: 'ui-button', UIText: 'ui-text', UIImage: 'ui-image' }[name]) + ', ' + code + ');'),
  'const ShortCutOption_default$2 = values.shortcutHtml, ShortCutOption_default$1 = values.shortcutCss;',
  ...stubs.map(name => 'function ' + name + '() {}'), ...helpers, ...pieces,
  postlude.replace('NATIVE_PROCESS_BATTLE', methods['ChatBox.processBattleMode']).replace('NATIVE_CHAT_KEYDOWN', methods['ChatBox.onKeyDown']).replace('NATIVE_CHAT_SHORTCUT', methods['ChatBox.onShortCut'] || 'function () {}'),
].join('\n');
await writeFile('generated/hotkey-preview.js', js);
await writeFile('generated/hotkey-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
await writeFile('generated/hotkey-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LASTRO 原生快捷键离线测试</title><link rel="stylesheet" href="/fonts/misans.css">
<style>body{margin:16px;background:#27333c;color:#edf5fa;font-family:Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size:12px;line-height:1.2;font-size-adjust:none}header{font-size:14px;font-size-adjust:none}h1{font-size:19px;margin:0 0 8px}header button{font:inherit}#workspace{display:flex;gap:32px;margin-top:16px}#editor{width:432px;height:468px;color:black}#game-area{outline:1px solid #63727c;width:620px;min-height:465px;padding:12px;box-sizing:border-box}#chat{position:relative;color:black;height:165px}#game-area:focus{outline-color:#b5ebc5}pre{white-space:pre-wrap;overflow-wrap:anywhere}#assets{color:#ffc4b2}</style><header><h1>LASTRO · 原生快捷键离线测试</h1><div><button id="open">打开快捷键设置</button> <button id="close">关闭设置</button> <button id="game-focus">回到游戏区域</button> <button id="chat-focus">输入聊天文字</button> <button id="reset-local">清除本地预览配置</button></div><p id="state"></p><p id="assets">${failures.join('\n')}</p></header><main id="workspace"><div id="editor"></div><div id="game-area" tabindex="0"><p>在左侧点快捷键格，按组合键，再点原生“确定”。保存仅限此离线预览，动作只记录在下方。</p><div id="chat"></div><p>最近键盘事件</p><pre id="last-key"></pre><p>本地动作</p><pre id="action-log"></pre></div></main><script type="module" src="./hotkey-preview.js"></script></html>`);
console.log('Native hotkey artwork: ' + Object.keys(manifest).length + '/' + assets.size);
if (failures.length) console.warn(failures.join('\n'));
console.log('Preview: /generated/hotkey-preview.html');
