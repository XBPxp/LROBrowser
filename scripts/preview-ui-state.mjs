// Offline browser QA: generated inventory factories, Preferences, window-state
// helper and pickup installer. The GUI adapter only supplies DOM lifecycle/drag.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';
import vm from 'node:vm';
import ts from 'typescript';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const source = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const wanted = new Set(['Common_default$1', 'InventoryV0_default$1', 'InventoryV0_default$2',
  'InventoryV3_default$1', 'InventoryV3_default$2', 'ItemObtain_default$1', 'ItemObtain_default$2']);
const values = {}, configs = {};
const inputHelpers = [];
let factory, stateHelper, lootInstaller, dataAttrs, draggable, messageFactory, uiMessages = {};
function visit(node) {
  if (ts.isBinaryExpression(node)) {
    const left = node.left.getText(source);
    if (wanted.has(left) && ts.isStringLiteral(node.right))
      values[left] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[left] ?? '') + node.right.text : node.right.text;
    if (['InventoryV0_default', 'InventoryV3_default'].includes(left) && ts.isCallExpression(node.right) && node.right.expression.getText(source) === 'createInventory')
      configs[left.replace('_default', '')] = node.right.arguments[0].getText(source);
  }
  if (ts.isFunctionDeclaration(node)) {
    if (node.name?.text === 'createInventory') factory = node.getText(source);
    if (node.name?.text === 'lastroUiWindowAppend') stateHelper = node.getText(source);
    if (['lastroUiInputFrame', 'lastroUiLogicalPointer', 'lastroUiDragBounds'].includes(node.name?.text)) inputHelpers.push(node.getText(source));
  }
  if (ts.isFunctionExpression(node) && node.name?.text === 'installLastroLootList') lootInstaller = node.getText(source);
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'processDataAttrs') dataAttrs = node.getText(source);
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'draggable' && node.parent.name?.getText(source) === 'GUIComponent') draggable = node.getText(source);
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(source) === 'LastROUiMessages') messageFactory = node.initializer?.getText(source);
    if (node.name.getText(source) === 'lastroUiMessages') uiMessages = JSON.parse(node.initializer.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of wanted) if (!values[name]) throw new Error('Missing generated native string: ' + name);
if (!factory || !stateHelper || !lootInstaller || !dataAttrs || !draggable || inputHelpers.length !== 3 || Object.keys(configs).length !== 2)
  throw new Error('Final generated runtime with UI-state/pickup patches is required');
function region(path) {
  const start = runtime.indexOf('//#region ' + path), end = runtime.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + path);
  return runtime.slice(start, end);
}
const preferenceSource = region('src/Core/Preferences.js');
const messages = {};
if (messageFactory) {
  const messageApi = vm.runInNewContext('(' + messageFactory + ')');
  messageApi.loadCsv(await readFile('generated/core/data/msgstringtable.csv'), messages,
    bytes => new globalThis.TextDecoder().decode(bytes));
}
Object.assign(messages, uiMessages);
const nativeConfigs = Object.fromEntries(Object.entries(configs).map(([key, code]) => [key, vm.runInNewContext('(' + code + ')', values)]));

const assets = new Set(['inventory/item_drop_lock_on.bmp', 'inventory/item_drop_lock_off.bmp',
  'inventory/item_compare_on.bmp', 'inventory/item_compare_off.bmp']);
// Only V0 uses tab-sprite BMPs and it has three tabs; V3 draws its fourth tab.
for (let i = 1; i <= 3; i++) assets.add('basic_interface/tab_itm_0' + i + '.bmp');
for (const name of ['InventoryV0_default$2', 'InventoryV3_default$2', 'ItemObtain_default$2']) {
  for (const match of values[name].matchAll(/data-(?:background|hover|down|active)="([^"]+\.bmp)"/g)) assets.add(match[1]);
  for (const match of values[name].matchAll(/data-preload="([^"]+)"/g)) for (const asset of match[1].split(';')) assets.add(asset.trim());
}
const directory = 'generated/ui-state-assets';
await mkdir(directory, { recursive: true });
for (const asset of assets) {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  for (const cache of ['generated/client-typography-assets', 'generated/ui-review-assets', 'generated/basic-info-assets', 'generated/native-ui-assets']) {
    try { await writeFile(directory + '/' + filename, await readFile(cache + '/' + filename)); break; }
    catch { /* The shared native cache checks other cached previews next. */ }
  }
}
const { manifest, failures } = await cacheNativeUiAssets([...assets], directory);
await writeFile('generated/ui-state-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));

const browserSource = String.raw`
import { setLastROInnerHTML } from './ui-state-trusted-dom.mjs';
const PREFIX = 'UIStatePreview:';
const sourceHash = SOURCE_HASH;
const values = VALUES, configs = CONFIGS, messages = MESSAGES;
const manifest = MANIFEST, assetDirectory = 'ui-state-assets';
const nativeFailures = FAILURES;
window.addEventListener('error', event => {
  document.body.dataset.fixtureError = event.message;
  document.querySelector('#assets').textContent = event.message;
});
NATIVE_BMP
const params = new URLSearchParams(location.search);
if (!params.has('canvas')) {
  // The previous iframe saves on pagehide. Clear only in the new parent after
  // that final save has completed and before the new canvas can load prefs.
  if (window.localStorage.getItem(PREFIX + 'resetPending') === '1') {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
  }
  const frame = document.querySelector('iframe');
  let latest = null;
  function command(action, value) { frame.contentWindow?.postMessage({ type: 'UIStatePreview:command', action, value }, location.origin); }
  function applySize() {
    const [width, height] = document.querySelector('#viewport').value.split('x').map(Number);
    frame.style.width = width + 'px'; frame.style.height = height + 'px';
    document.body.dataset.viewport = width + 'x' + height;
    window.localStorage.setItem(PREFIX + 'viewport', width + 'x' + height);
  }
  document.querySelector('#viewport').addEventListener('change', applySize);
  document.querySelector('#zoom').addEventListener('change', event => command('zoom', Number(event.target.value)));
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => command(button.dataset.command)));
  document.querySelector('#reload').addEventListener('click', () => location.reload());
  document.querySelector('#reset').addEventListener('click', () => {
    window.localStorage.setItem(PREFIX + 'resetPending', '1');
    location.reload();
  });
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.type !== 'UIStatePreview:metrics') return;
    latest = event.data.metrics;
    Object.assign(document.body.dataset, { ready: 'true', wire: String(latest.wire), zoom: String(latest.zoom),
      windows: JSON.stringify(latest.windows), loot: JSON.stringify(latest.loot), storage: JSON.stringify(latest.storage), fontReady: String(latest.fontReady) });
    document.querySelector('#metrics').textContent = JSON.stringify(latest, null, 2);
    document.querySelector('#zoom').value = String(latest.zoom);
  });
  Object.defineProperty(window, '__uiStatePreview', { value: Object.freeze({ get metrics() { return latest; } }) });
  const storedViewport = window.localStorage.getItem(PREFIX + 'viewport');
  if ([...document.querySelector('#viewport').options].some(option => option.value === storedViewport)) document.querySelector('#viewport').value = storedViewport;
  applySize();
  frame.src = './ui-state-preview.html?canvas=1';
} else {
  document.body.className = 'canvas';
  document.querySelector('header').remove(); document.querySelector('#qa').remove();
  const plane = document.createElement('div'); plane.id = 'native-plane'; document.body.append(plane);
  const localStorage = { getItem: key => window.localStorage.getItem(PREFIX + key),
    setItem: (key, value) => window.localStorage.setItem(PREFIX + key, value) };
  function __esmMin(fn) { return fn; }
  NATIVE_PREFERENCES
  init_Preferences$1();
  NATIVE_STATE_HELPER
  NATIVE_INPUT_HELPERS
  let zoom = Number(localStorage.getItem('zoom')) || 1, topIndex = 50, fontReady = false, wire = 0, activePointer;
  const Mouse = { screen: { x: 0, y: 0, width: innerWidth, height: innerHeight } };
  const Renderer = { get width() { return innerWidth; }, get height() { return innerHeight; } };
  const _Renderer = Renderer, UI_default = { windowmagnet: false };
  let _snapCache = [];
  const sampleNames = { 501: '红色药水', 502: '橙色药水', 503: '黄色药水', 504: '白色药水', 505: '蓝色药水', 506: '绿色药水' };
  const icon = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M9 2h6v6l5 8v6H4v-6l5-8Z" fill="#b8302d" stroke="#572426"/><path d="M9 2h6v3H9z" fill="#d5af71"/></svg>');
  const Client = { loadFile: (path, callback) => (path.startsWith('item/') ? Promise.resolve(icon) : decodeBmp(path)).then(callback).catch(assetError),
    loadFiles: (paths, callback) => Promise.all(paths.map(decodeBmp)).then(results => callback?.(...results)).catch(assetError) };
  const DB = { INTERFACE_PATH: '', getMessage: (id, fallback = '') => messages[id] || fallback,
    getItemInfo: () => ({ identifiedResourceName: 'offline', unidentifiedResourceName: 'offline' }),
    getItemName: item => sampleNames[item.ITID] || '离线物品' };
  const _Client = Client, _DB = DB;
  const UIVersionManager = { getInventoryVersion: () => 3 };
  const UIManager = { addComponent: component => component };
  const BasicInfoController = { getUI: () => ({ _host: null }) };
  const Network = { hookPacket() {}, sendPacket() { wire++; report(); } }, PACKET = { ZC: {}, CZ: {} };
  const ChatBox_default = { addText() {}, TYPE: {}, FILTER: {} };
  const components = [];
  class GUIComponent {
    NATIVE_DATA_ATTRS
    constructor(name, css) { this.name = name; this._cssText = css; this.magnet = {}; this.__loaded = false; this.__active = false; }
    getRoot() { return this._shadow; }
    prepare() {
      if (this.__loaded) return;
      this.__loaded = true; this._host = document.createElement('div'); this._host.id = this.name;
      Object.assign(this._host.style, { position: 'absolute', zIndex: '50', fontSize: '12px', lineHeight: '1.2' });
      this._shadow = this._host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = values.Common_default$1 + this._cssText;
      const container = this._container = document.createElement('div'); container.className = 'ui-component-root'; setLastROInnerHTML(container, this.render());
      this._shadow.append(style, container);
      this.ui = { show: () => this._host.style.display = '', hide: () => this._host.style.display = 'none', is: () => this._host.style.display !== 'none' };
      this._shadow.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
      plane.append(this._host); this.init?.(); this._host.remove();
      this._shadow.addEventListener('mousedown', event => {
        activePointer = this; this.focus(); updateMouse(event);
      }, true);
    }
    append(target = plane) {
      this.__active = true; this.prepare(); target.append(this._host); this.onAppend?.(); this._fixPositionOverflow(); this.focus();
    }
    remove() { this.onRemove?.(); this.__active = false; this._host?.remove(); report(); }
    focus() { this._host.style.zIndex = String(++topIndex); }
    placeOnTop() { this.focus(); }
    _fixPositionOverflow() {}
    NATIVE_DRAGGABLE
  }
  NATIVE_INVENTORY_FACTORY
  const previouslySaved = Object.fromEntries(Object.keys(configs).map(name => [name, !!localStorage.getItem(name)]));
  for (const [name, config] of Object.entries(configs)) {
    // A new QA page explicitly opens both demos before the native append.
    // Subsequent reloads use the saved native show/reduce values unchanged.
    if (!previouslySaved[name]) localStorage.setItem(name, JSON.stringify({ _version: 1, show: true }));
    const component = createInventory(config); components.push(component); component.append();
    if (!previouslySaved[name]) {
      component._host.style.display = ''; component._host.style.left = (name === 'InventoryV0' ? 24 : 390) + 'px'; component._host.style.top = '50px';
      for (const key of ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']) component.magnet[key] = false;
      component._lastroWindowState.save(); component._lastroWindowState.fit();
    }
  }
  const loot = new GUIComponent('ItemObtain', values.ItemObtain_default$1); loot.render = () => values.ItemObtain_default$2;
  const Events = { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window) };
  (NATIVE_LOOT_INSTALLER)(loot, { DB, Client, Events }, 4000);
  const motionEvents = [];
  let pickupIndex = 0;
  function pickup(burst = false) {
    loot.append(plane);
    if (!loot._previewMotionBound) {
      loot._previewMotionBound = true;
      for (const type of ['animationstart', 'animationend', 'animationcancel']) loot.getRoot().addEventListener(type, event => {
        motionEvents.push({ type, name: event.animationName, elapsed: event.elapsedTime, at: performance.now() }); report();
      });
    }
    for (let i = 0; i < (burst ? 8 : 1); i++) loot.set({ ITID: 501 + (pickupIndex++ % 6), IsIdentified: true, count: i + 1, index: pickupIndex, cards: [pickupIndex] });
    report();
  }
  function updateMouse(event) {
    if (!activePointer) return;
    // The generated native handlers now perform their own scale conversion.
    // Match the real MouseEventHandler's page coordinates, never convert twice.
    Mouse.screen.x = event.pageX; Mouse.screen.y = event.pageY;
    Mouse.screen.width = innerWidth; Mouse.screen.height = innerHeight;
  }
  window.addEventListener('mousemove', updateMouse, true);
  window.addEventListener('mouseup', event => { updateMouse(event); queueMicrotask(() => { activePointer = null; report(); }); }, true);
  function cursorClassTick() {
    document.body.classList.add('custom-cursor');
    requestAnimationFrame(cursorClassTick);
  }
  requestAnimationFrame(cursorClassTick);
  function applyZoom() {
    plane.style.zoom = String(zoom); plane.style.width = innerWidth / zoom + 'px'; plane.style.height = innerHeight / zoom + 'px';
    for (const component of components) component._lastroWindowState?.fit();
    loot.onResize?.(); report();
  }
  function bounds(host) {
    if (!host?.isConnected || host.style.display === 'none') return { visible: false };
    const rect = host.getBoundingClientRect();
    return { visible: true, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
      layoutWidth: host.offsetWidth, layoutHeight: host.offsetHeight, scale: host.style.scale || '1',
      withinViewport: rect.left >= -0.6 && rect.top >= -0.6 && rect.right <= innerWidth + 0.6 && rect.bottom <= innerHeight + 0.6 };
  }
  let latest = null, reporting = false;
  function report() {
    if (reporting) return; reporting = true;
    requestAnimationFrame(() => {
      reporting = false;
      const storage = {};
      for (const key of Object.keys(window.localStorage)) if (key.startsWith(PREFIX)) {
        const text = window.localStorage.getItem(key); try { storage[key.slice(PREFIX.length)] = JSON.parse(text); } catch { storage[key.slice(PREFIX.length)] = text; }
      }
      latest = { sourceHash, wire, zoom, fontReady, viewport: { width: innerWidth, height: innerHeight }, storage,
        windows: Object.fromEntries(components.map(component => {
          const root = component.getRoot(), panel = root.querySelector('.panel');
          return [component.name, { ...bounds(component._host), structure: {
            wrapperHeight: component._container.offsetHeight,
            innerHeight: root.querySelector('#' + component.name)?.offsetHeight,
            panelDisplay: panel ? getComputedStyle(panel).display : null,
            panelHeight: panel?.offsetHeight,
            contentHeight: root.querySelector('.content')?.offsetHeight,
            footer: bounds(root.querySelector('.footer')),
            resize: bounds(root.querySelector('.footer .extend')),
          } }];
        })),
        loot: { ...bounds(loot._host), cards: loot.getRoot()?.querySelectorAll('.loot-row').length || 0, motionEvents: motionEvents.slice(-40) },
        assetFailures: nativeFailures };
      Object.assign(document.body.dataset, { ready: 'true', wire: String(wire), metrics: JSON.stringify(latest), fontReady: String(fontReady) });
      parent.postMessage({ type: 'UIStatePreview:metrics', metrics: latest }, location.origin);
    });
  }
  Object.defineProperty(window, '__uiStatePreview', { value: Object.freeze({ get metrics() { return latest; } }) });
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'UIStatePreview:command') return;
    const { action, value } = event.data;
    if (action === 'zoom' && [1, 1.5].includes(value)) { zoom = value; localStorage.setItem('zoom', String(zoom)); applyZoom(); }
    else if (action === 'loot') pickup();
    else if (action === 'burst') pickup(true);
    else if (action === 'reappend') for (const component of components) { component.remove(); component.append(); }
    else {
      const component = components.find(component => component.name === action);
      if (component) { component.toggle(); component._lastroWindowState.save(); component._lastroWindowState.fit(); }
    }
    report();
  });
  window.addEventListener('resize', applyZoom);
  const observer = new MutationObserver(report);
  for (const component of components) observer.observe(component._host, { attributes: true, subtree: true, childList: true });
  Promise.all([400, 500, 700].map(weight => document.fonts.load(weight + ' 12px MiSans', '物品栏红色药水'))).then(() => document.fonts.ready).then(() => { fontReady = true; report(); });
  applyZoom();
  setInterval(report, 500);
}
`;
const replacements = { SOURCE_HASH: JSON.stringify(sourceHash), VALUES: JSON.stringify(values), CONFIGS: JSON.stringify(nativeConfigs), MESSAGES: JSON.stringify(messages),
  MANIFEST: JSON.stringify(manifest), FAILURES: JSON.stringify(failures), NATIVE_BMP: NATIVE_BMP_PREVIEW_SOURCE,
  NATIVE_PREFERENCES: preferenceSource, NATIVE_STATE_HELPER: stateHelper, NATIVE_INPUT_HELPERS: inputHelpers.join('\n'), NATIVE_DATA_ATTRS: dataAttrs, NATIVE_DRAGGABLE: draggable,
  NATIVE_INVENTORY_FACTORY: factory, NATIVE_LOOT_INSTALLER: lootInstaller };
const moduleSource = browserSource.replace(/\b(?:SOURCE_HASH|VALUES|CONFIGS|MESSAGES|MANIFEST|FAILURES|NATIVE_BMP|NATIVE_PREFERENCES|NATIVE_STATE_HELPER|NATIVE_INPUT_HELPERS|NATIVE_DATA_ATTRS|NATIVE_DRAGGABLE|NATIVE_INVENTORY_FACTORY|NATIVE_LOOT_INSTALLER)\b/g,
  token => replacements[token]);
await writeFile('generated/ui-state-preview.mjs', moduleSource);
await writeFile('generated/ui-state-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原生窗口保存与拾取卡片验收</title>
<link rel="stylesheet" href="/fonts/misans.css"><style>
html{font-size:16px}body{margin:0;font:400 13px/1.3 Arial,"Microsoft YaHei",MiSans,"LastRO Glyph Fallback",sans-serif;font-size-adjust:none;background:#e8e8e8;color:#222}
header{padding:8px 12px;background:white}h1{font-size:16px;margin:0 0 5px}nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center}button,select{font:inherit;min-height:26px}p{margin:5px 0 0}#qa{padding:8px 12px;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}iframe{border:1px solid #888;background:#6b8068;flex:none}pre{font:11px/1.3 monospace;max-height:500px;max-width:280px;overflow:auto;margin:0}.canvas{overflow:hidden;font-size:12px;line-height:1.2;background:linear-gradient(25deg,#547254,#84966a)}#native-plane{position:absolute;left:0;top:0}#assets:empty{display:none}.canvas #assets{position:absolute;bottom:0;color:#900;background:white;z-index:5000}
</style><body><header><h1>原生窗口保存与拾取卡片验收（离线）</h1><nav>
<label>视口 <select id="viewport"><option>960x560</option><option>640x360</option><option>360x240</option><option>360x600</option></select></label>
<label>缩放 <select id="zoom"><option value="1">100%</option><option value="1.5">150%</option></select></label>
<button data-command="InventoryV0">开关旧版物品栏</button><button data-command="InventoryV3">开关新版物品栏</button><button data-command="reappend">移除后重新显示</button>
<button data-command="loot">拾取一条</button><button data-command="burst">拾取八条</button><button id="reload">整页刷新</button><button id="reset">重置预览设置</button>
</nav><p>拖动原生标题栏、右下角改变大小；折叠或关闭后重开、刷新。仅保存 UIStatePreview: 前缀，游戏网络隔离。</p></header>
<div id="qa"><iframe title="原生客户端测试视口"></iframe><pre id="metrics">等待原生窗口</pre></div><div id="assets"></div><script type="module" src="./ui-state-preview.mjs"></script></body></html>`);
console.log(JSON.stringify({ html: 'generated/ui-state-preview.html', module: 'generated/ui-state-preview.mjs', sourceHash, assets: Object.keys(manifest).length, failures }, null, 2));
