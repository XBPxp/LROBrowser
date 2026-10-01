// Offline QA uses the generated NPC store, quantity dialog, and ScrollBar.
// Only local cached artwork is copied; no accounts, network, or game service.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';
import ts from 'typescript';
import { NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const file = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const values = {}, helpers = [];
const wanted = new Set(['Common_default$1', 'NpcStore_default$1', 'NpcStore_default$2', 'InputBox_default$1', 'InputBox_default$2']);
const helperNames = new Set(['installLastroStoreScroll', 'lastroUiInputFrame', 'lastroUiLogicalPointer', 'lastroUiDragBounds',
  'lastroHotkeyId', 'lastroHotkeyComponentVisible', 'lastroHotkeyEditable']);
let dataAttrs, scrollbar;
function visit(node) {
  if (ts.isBinaryExpression(node) && wanted.has(node.left.getText(file)) && ts.isStringLiteral(node.right)) {
    const name = node.left.getText(file);
    values[name] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[name] || '') + node.right.text : node.right.text;
  }
  if (ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text)) helpers.push(node.getText(file));
  if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'processDataAttrs') dataAttrs = node.getText(file);
  if (ts.isClassExpression(node) && node.name?.text === 'ScrollBar') scrollbar = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
for (const name of wanted) if (!values[name]) throw new Error('Missing generated template/CSS: ' + name);
if (!dataAttrs || !scrollbar || !helpers.some(code => code.startsWith('function installLastroStoreScroll('))) {
  throw new Error('Build the final runtime with the NPC store-scroll patch before generating this preview');
}
function region(name) {
  const start = runtime.indexOf('//#region ' + name), end = runtime.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing generated region: ' + name);
  return runtime.slice(start, end);
}
const nativeStore = region('src/UI/Components/NpcStore/NpcStore.js');
const nativeInput = region('src/UI/Components/InputBox/InputBox.js');
const nativeElements = ['UIButton', 'UIText', 'UIImage'].map(name => region('src/UI/Elements/' + name + '.js')).join('\n');
const assets = new Set(['scroll0up.bmp', 'scroll0down.bmp', 'scroll0mid.bmp', 'scroll0bar_up.bmp', 'scroll0bar_mid.bmp', 'scroll0bar_down.bmp',
  'basic_interface/dialscr_up.bmp', 'basic_interface/dialscr_down.bmp', 'item/빨간포션.bmp', 'item/파란포션.bmp', 'checkbox_0.bmp', 'checkbox_1.bmp',
  'basic_interface/itemwin_mid.bmp']);
for (const text of Object.values(values)) {
  for (const match of text.matchAll(/(?:data-(?:background|hover|down|active)|src|bg|hover|down)="([^"]+\.bmp)"/g)) assets.add(match[1]);
}
const directory = 'generated/store-scroll-assets';
const manifest = {}, placeholders = [];
await mkdir(directory, { recursive: true });
for (const asset of assets) {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  let found = false;
  for (const cache of [directory, 'generated/mail-assets', 'generated/ui-state-assets', 'generated/ui-review-assets',
    'generated/client-typography-assets', 'generated/tools-panels-assets', 'generated/npc-map-links-assets', 'generated/hotkey-assets']) {
    try {
      const bytes = await readFile(cache + '/' + filename);
      if (bytes[0] !== 66 || bytes[1] !== 77) continue;
      await writeFile(directory + '/' + filename, bytes); manifest[asset] = filename; found = true; break;
    } catch { /* Missing artwork receives an explicit offline placeholder. */ }
  }
  if (!found) placeholders.push(asset);
}
await writeFile(directory + '/index.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile('generated/store-scroll-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));

const browser = String.raw`
import { setLastROInnerHTML, setLastROAdjacentHTML, setLastROOuterHTML } from './store-scroll-trusted-dom.mjs';
const values = VALUES, manifest = MANIFEST, placeholders = PLACEHOLDERS, sourceHash = SOURCE_HASH;
const assetDirectory = 'store-scroll-assets';
NATIVE_BMP
window.addEventListener('error', event => { document.body.dataset.fixtureError = event.message; document.querySelector('#assets').textContent = event.message; });
const mount = document.querySelector('#plane'), names = ['红色药水','橙色药水','黄色药水','白色药水','蓝色药水','绿色药水',
  '红色药草','黄色药草','白色药草','蓝色药草','绿色药草','苹果','香蕉','葡萄','胡萝卜','马铃薯','肉','蜂蜜','牛奶',
  '西纳勒叶子','西纳勒叶','芦荟','圣水','万能药','蜂胶','芦荟叶','天地树果实','魔物饲料','糖果','拐杖糖'];
let localActions = [], blockedPackets = 0, currentScenario = 'initial', latest, dragRun = 0;
const placeholder = asset => {
  const button = /btn|button/i.test(asset), h = button ? 20 : /titlebar/.test(asset) ? 17 : /footer|bottom/.test(asset) ? 27 : 32;
  const w = button ? 42 : /item\//.test(asset) ? 24 : 16;
  const label = button ? (/cancel/.test(asset) ? '取消' : /sell/.test(asset) ? '出售' : /buy/.test(asset) ? '购买' : '确认') : '';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="#e5e8ee"/><path d="M0 0H'+w+'V'+h+'H0Z" fill="none" stroke="#909bac"/><text x="21" y="14" text-anchor="middle" font-size="11" fill="#222">'+label+'</text></svg>');
};
const localImage = asset => manifest[asset] ? decodeBmp(asset) : Promise.resolve(placeholder(asset));
const Client = { loadFile: (asset, callback) => localImage(asset).then(callback).catch(assetError),
  loadFiles: (assets, callback) => Promise.all(assets.map(localImage)).then(images => callback(...images)).catch(assetError) };
const DB = { INTERFACE_PATH: '', getItemInfo: id => ({ identifiedResourceName: Number(id) === 505 ? '파란포션' : '빨간포션', unidentifiedResourceName: '빨간포션' }),
  getItemName: item => names[Number(item.ITID) - 501] || '本地示例物品', getMessage: (id, fallback = '') => ({ 1259: '请输入数量', 55: '金币不足', 56: '负重不足', 171: '购买', 172: '出售', 173: '总计', 174: '商店', 175: '取消' }[id] || fallback) };
const _Client = Client, _DB = DB;
const Texture = { load: (url, callback) => { const image = new Image(); image.onload = () => callback.call(image); image.src = url; } };
const Renderer = { get width() { return mount.clientWidth; }, get height() { return mount.clientHeight; } };
const Mouse = { screen: { x: 0, y: 0, width: 900, height: 520 } };
window.addEventListener('mousemove', event => { Mouse.screen.x = event.clientX; Mouse.screen.y = event.clientY; });
const SessionStorage_default = { zeny: 999999999, isTouchDevice: false, Entity: { weight: 0, max_weight: 999999, display: { name: '离线预览角色' } } };
const ItemType_default = { WEAPON: 4, EQUIP: 5, PETEGG: 7, PETEQUIP: 8 };
const inventoryItems = Array.from({ length: 30 }, (_, index) => ({ ITID: 501 + index, index, count: 12, type: 0, price: 100 + index * 10, IsIdentified: true }));
const InventoryController = { getUI: () => ({ npcsalelock: false, getItemByIndex: index => inventoryItems[index], getItemById: id => inventoryItems.find(item => item.ITID === id) }) };
const InventoryItemTransferPriority = { NPC_STORE: 1 };
const Preferences = { get: () => ({ select_all: false, save() {} }) };
const Network = { sendPacket: packet => { blockedPackets++; localActions.push({ type: 'blocked-packet', name: packet.constructor.name }); report(); } };
const PacketVerManager_default = { value: 20211103 };
const PACKET = { CZ: { NPC_TRADE_QUIT: class NPC_TRADE_QUIT {} } };
const ItemInfo_default = { uid: 0, append() {}, remove() {}, setItem: item => { localActions.push({ type: 'item-info', id: item.ITID }); report(); } };
const ChatBox_default = { TYPE: { ERROR: 1 }, FILTER: { PUBLIC_LOG: 1 }, addText: text => { localActions.push({ type: 'notice', text }); report(); } };
const getItemCountUnit = () => '个';
const KEYS = { ENTER: 13, SPACE: 32, ESCAPE: 27, getDeepActiveElement() { let node = document.activeElement; while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement; return node; } };
const UIManager = { components: {}, addComponent(component) { this.components[component.name] = component; return component; }, getComponent: name => name === 'Inventory' ? { name: 'InventoryV3' } : UIManager.components[name] };
function lastroBindNestedWindowState() {} // Geometry persistence is outside this isolated scrollbar fixture.
function __esmMin(init) { let loaded = false; return () => { if (!loaded) { loaded = true; init(); } }; }
const noop = () => {};
const init_DBManager = noop, init_ItemType = noop, init_Client = noop, init_Preferences$1 = noop, init_SessionStorage = noop,
  init_MouseEventHandler = noop, init_NetworkManager = noop, init_PacketVerManager = noop, init_PacketStructure = noop,
  init_KeyEventHandler = noop, init_UIManager = noop, init_GUIComponent = noop, init_ItemInfo = noop, init_ChatBox = noop,
  init_Inventory = noop, init_InventoryItemTransfer = noop, init_Renderer = noop, init_Targa = noop;
const init_NpcStore$2 = noop, init_NpcStore$1 = noop, init_InputBox$2 = noop, init_InputBox$1 = noop;
let topIndex = 50;
class GUIComponent {
  static MouseMode = { FREEZE: 1 };
  NATIVE_DATA_ATTRS
  constructor(name, css) { this.name = name; this.css = css; this.__loaded = false; this.__active = false; }
  getRoot() { return this._shadow; }
  prepare() {
    if (this.__loaded) return;
    this.__loaded = true; this._host = document.createElement('div'); this._host.id = this.name;
    Object.assign(this._host.style, { position: 'absolute', color: '#000', fontSize: '12px', fontFamily: 'MiSans,"LastRO Glyph Fallback",Arial,sans-serif', zIndex: '50' });
    this._shadow = this._host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = values.Common_default$1 + this.css;
    const container = document.createElement('div'); container.className = 'ui-component-root'; setLastROInnerHTML(container, this.render());
    this._shadow.append(style, container);
    mount.append(this._host);
    this._shadow.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
    this.init?.(); this._host.remove();
    this._keyHandler = event => { if (this.__active && this._host.isConnected && this._host.style.display !== 'none') this.onKeyDown?.(event); };
  }
  append() { this.prepare(); this.__active = true; mount.append(this._host); window.addEventListener('keydown', this._keyHandler, !!this.captureKeyEvents); this.onAppend?.(); this.focus(); }
  remove() { if (!this.__active) return; this.onRemove?.(); this.__active = false; this._host.remove(); window.removeEventListener('keydown', this._keyHandler, !!this.captureKeyEvents); report(); }
  focus() { this._host.style.zIndex = String(++topIndex); }
  placeOnTop() { this.focus(); }
  draggable() {}
  isEditableFocused() { const node = KEYS.getDeepActiveElement(); return this.getRoot()?.contains(node) && ['INPUT','TEXTAREA'].includes(node?.tagName); }
}
NATIVE_HELPERS
const ScrollBar = NATIVE_SCROLLBAR;
const _ScrollBar = ScrollBar;
NATIVE_ELEMENTS
function init_Elements() { init_UIButton(); init_UIText(); init_UIImage(); }
const NpcStore_default$1 = values.NpcStore_default$1, NpcStore_default$2 = values.NpcStore_default$2;
const InputBox_default$1 = values.InputBox_default$1, InputBox_default$2 = values.InputBox_default$2;
NATIVE_INPUT
NATIVE_STORE
init_InputBox(); init_NpcStore();
NpcStore.onSubmit = items => { localActions.push({ type: 'submit', items: items.map(item => ({ id: item.ITID, count: item.count })) }); report(); };
const contents = () => [NpcStore.getRoot().querySelector('.InputWindow .content'), NpcStore.getRoot().querySelector('.OutputWindow .content')];
function applyScrollbars() { for (const content of NpcStore.getRoot().querySelectorAll('.content')) ScrollBar.applyDOMScrollbar(content); }
function reset() {
  dragRun++; delete window._OBJ_DRAG_; NpcStore._lastroStoreScroll?.stop(); InputBox_default.remove();
  NpcStore.append(); NpcStore.setType(NpcStore.Type.SELL); NpcStore.setList(inventoryItems.map(item => ({ index: item.index, price: item.price, overchargeprice: item.price })));
  const root = NpcStore.getRoot();
  Object.assign(root.querySelector('.InputWindow').style, { left: '30px', top: '35px' });
  Object.assign(root.querySelector('.OutputWindow').style, { left: '360px', top: '35px' });
  applyScrollbars(); currentScenario = 'initial'; localActions = []; report();
}
function move(index, count = 12, adding = true) {
  const [input, output] = contents();
  transferItem(adding ? input : output, adding ? output : input, adding, index, count);
  localActions.push({ type: 'transfer', index, count, adding }); report();
}
function paneMetrics(content) {
  const rect = content.getBoundingClientRect(), rows = [...content.querySelectorAll(':scope > .item')];
  const visible = rows.filter(row => { const r = row.getBoundingClientRect(); return r.bottom > rect.top + 0.5 && r.top < rect.bottom - 0.5; });
  const last = rows.at(-1), bar = content.querySelector(':scope > .ro-custom-scrollbar');
  const actualBottom = rows.reduce((value, row) => Math.max(value, row.offsetTop + row.offsetHeight), 0);
  return { rows: rows.length, scrollTop: content.scrollTop, scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
    actualBottom, extraBlankHeight: Math.max(0, content.scrollHeight - Math.max(actualBottom, content.clientHeight)),
    visible: visible.map(row => Number(row.dataset.index)), blankViewport: rows.length > 0 && visible.length === 0,
    lastIndex: last ? Number(last.dataset.index) : null, lastVisible: !!last && visible.includes(last),
    scrollbar: bar ? { top: bar.style.top, height: bar.style.height, display: bar.style.display } : null,
    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } };
}
function report() {
  if (!NpcStore?.getRoot()) return;
  latest = { sourceHash, scenario: currentScenario, wire: 0, blockedPackets, active: NpcStore.__active,
    input: paneMetrics(contents()[0]), output: paneMetrics(contents()[1]),
    quantityVisible: !!InputBox_default?._host?.isConnected, localActions: localActions.slice(-8), placeholders };
  document.body.dataset.storeMetrics = JSON.stringify(latest);
  document.body.dataset.ready = 'true';
  document.querySelector('#metrics').textContent = JSON.stringify(latest, null, 2);
}
async function scenario(name) {
  reset(); currentScenario = name;
  const [input, output] = contents();
  if (name === 'delete') {
    input.scrollTop = input.scrollHeight; input._roScrollHandler?.();
    for (let index = 0; index < 26; index++) move(index);
  } else if (name === 'append') {
    for (let index = 0; index < 20; index++) move(index);
    output.scrollTop = 0; output._roScrollHandler?.(); move(20);
  } else if (name === 'quantity') {
    requestMoveItem(0, input, output, true);
  }
  requestAnimationFrame(report);
}
async function simulateEdge(direction) {
  const run = ++dragRun, [content] = contents();
  NpcStore._lastroStoreScroll?.stop();
  const item = content.querySelector('.item'); if (!item) return;
  const transfer = new DataTransfer();
  item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer }));
  const rect = content.getBoundingClientRect(), before = content.scrollTop;
  content.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer,
    clientX: rect.left + rect.width / 2, clientY: direction > 0 ? rect.bottom - 4 : rect.top + 4 }));
  await new Promise(resolve => setTimeout(resolve, 1100));
  if (run !== dragRun) return;
  item.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer }));
  delete window._OBJ_DRAG_; localActions.push({ type: 'edge-drag', direction, before, after: content.scrollTop }); report();
}
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => void scenario(button.dataset.scenario)));
document.querySelector('#new-row').addEventListener('click', () => { const row = contents()[0].querySelector('.item'); if (row) move(Number(row.dataset.index)); });
document.querySelector('#remove-row').addEventListener('click', () => { const row = contents()[1].querySelector('.item'); if (row) move(Number(row.dataset.index), 12, false); });
document.querySelectorAll('[data-edge]').forEach(button => button.addEventListener('click', () => void simulateEdge(Number(button.dataset.edge))));
document.querySelector('#zoom').addEventListener('change', event => { mount.style.zoom = event.target.value; requestAnimationFrame(report); });
ScrollBar.init();
while (!ScrollBar.complete) await new Promise(resolve => setTimeout(resolve, 10));
reset();
document.querySelector('#assets').textContent = placeholders.length ? '本地占位图片：' + placeholders.join('、') : '全部皮肤来自本地原生缓存';
window.__storeScrollPreview = { get metrics() { return latest; }, store: NpcStore, contents, scenario, move, simulateEdge, report };
const poll = setInterval(report, 150);
window.addEventListener('pagehide', () => { clearInterval(poll); NpcStore._lastroStoreScroll?.stop(); });
`;
const replacements = {
  VALUES: JSON.stringify(values), MANIFEST: JSON.stringify(manifest), PLACEHOLDERS: JSON.stringify(placeholders), SOURCE_HASH: JSON.stringify(sourceHash),
  NATIVE_BMP: NATIVE_BMP_PREVIEW_SOURCE, NATIVE_DATA_ATTRS: dataAttrs, NATIVE_HELPERS: helpers.join('\n'), NATIVE_SCROLLBAR: scrollbar,
  NATIVE_ELEMENTS: nativeElements, NATIVE_INPUT: nativeInput, NATIVE_STORE: nativeStore,
};
const code = browser.replace(/\b(?:VALUES|MANIFEST|PLACEHOLDERS|SOURCE_HASH|NATIVE_BMP|NATIVE_DATA_ATTRS|NATIVE_HELPERS|NATIVE_SCROLLBAR|NATIVE_ELEMENTS|NATIVE_INPUT|NATIVE_STORE)\b/g, key => replacements[key]);
await writeFile('generated/store-scroll-preview.js', code);
await writeFile('generated/store-scroll-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NPC 商店滚动离线验证</title>
<link rel="stylesheet" href="/fonts/misans.css"><style>body{margin:0;padding:16px;background:#28363e;color:#e8f0f7;font:13px MiSans,"LastRO Glyph Fallback",Arial,sans-serif}h1{font-size:18px;margin:0 0 8px}header{position:relative;z-index:200}.controls{display:flex;gap:6px;flex-wrap:wrap}.controls button,.controls select{font:inherit}#assets{margin:8px 0;color:#c2d3de;font-size:11px}#stage{position:relative;width:950px;height:500px;border:1px solid #536b79;background:repeating-linear-gradient(45deg,#263b35,#263b35 15px,#2a4039 15px,#2a4039 30px);overflow:auto}#plane{position:relative;width:900px;height:470px;transform-origin:top left}#metrics{font:11px Consolas,monospace;white-space:pre-wrap;max-width:950px}</style>
<header><h1>NPC 商店滚动离线验证</h1><div class="controls"><button data-scenario="initial">重置 30 件物品</button><button data-scenario="delete">滚到底后移出 26 行</button><button data-scenario="append">新增末行自动可见</button><button data-scenario="quantity">原生数量输入</button><button id="new-row">再移入一行</button><button id="remove-row">退回一行</button><button data-edge="1">下沿拖拽 1 秒</button><button data-edge="-1">上沿拖拽 1 秒</button><select id="zoom"><option value="1">100%</option><option value="1.5">150%</option></select></div><div id="assets"></div></header>
<main id="stage"><div id="plane"></div></main><pre id="metrics"></pre><script type="module" src="./store-scroll-preview.js"></script></html>`);
console.log('Preview: /generated/store-scroll-preview.html');
console.log('Native cached artwork: ' + Object.keys(manifest).length + '/' + assets.size + '; offline placeholders: ' + placeholders.length);
