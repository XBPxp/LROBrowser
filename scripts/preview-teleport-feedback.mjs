// Offline QA of the built client's activity navigation, native prompt and notice.
// Network.sendPacket below records locally; no game connection is constructed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';
import ts from 'typescript';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const file = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const values = {}, functions = {}, assignments = {};
const strings = new Set(['Common_default$1', 'WinPopup_default$1', 'WinPopup_default$2', 'Announce_default$1', 'Announce_default$2']);
const names = new Set(['_popupPosition', '_createButton', 'showLastroTeleportNotice', 'normalizeLastROTeleportMap', 'normalizeMapName']);
const methods = new Set(['Announce.init', 'Announce.onRemove', 'Announce.timeEnd', 'Announce.set', 'Navigation.navigateTo', 'Navigation.waitForMapData', 'Navigation.findClosestWalkableCell', 'Navigation.findPath', 'MapPathFinder.findPathBetweenMaps', 'PACKET.ZC.PRIVATE_AIRSHIP_RESPONSE']);
let prompt, chatFactory, feedback;
function visit(node) {
  if (ts.isBinaryExpression(node)) {
    const key = node.left.getText(file);
    if (strings.has(key) && ts.isStringLiteral(node.right)) {
      if (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) values[key] += node.right.text;
      else values[key] = node.right.text;
    }
    if (methods.has(key)) assignments[key] = node.getText(file) + ';';
  }
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) functions[node.name.text] = node.getText(file);
  if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'showPromptBox') prompt = node.getText(file).replace(/^static\s+/, '');
  if (ts.isVariableDeclaration(node) && node.initializer) {
    if (node.name.getText(file) === 'LastROChatMapLinks') chatFactory = node.initializer.getText(file);
    if (node.name.getText(file) === 'lastroPrivateAirshipFeedback') feedback = node.initializer.getText(file);
  }
  ts.forEachChild(node, visit);
}
visit(file);
for (const key of strings) if (!values[key]) throw new Error('Missing native UI string: ' + key);
for (const key of names) if (!functions[key]) throw new Error('Missing generated function: ' + key);
for (const key of methods) if (!assignments[key]) throw new Error('Missing native method: ' + key);
if (!prompt || !chatFactory || !feedback) throw new Error('Final teleport runtime is not ready');
const assets = ['win_msgbox.bmp', 'btn_ok.bmp', 'btn_ok_a.bmp', 'btn_ok_b.bmp', 'btn_cancel.bmp', 'btn_cancel_a.bmp', 'btn_cancel_b.bmp'];
const assetDirectory = 'teleport-feedback-assets';
const { manifest, failures } = await cacheNativeUiAssets(assets, 'generated/' + assetDirectory);
await mkdir('generated', { recursive: true });
await writeFile('generated/teleport-feedback-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));

const environment = String.raw`
const state = { wirePackets: 0, packets: [], paths: [], sequence: [], responses: [], chat: [], rejected: [], notices: [], popupCount: 0 };
function snapshot() {
  return { ...state, map: MapRenderer.currentMap, noticeVisible: !!Announce._host?.isConnected,
    noticeText: state.notices.at(-1)?.text || '', noticeLife: state.notices.at(-1)?.life || 0,
    noticeCanvas: Announce.canvas ? { width: Announce.canvas.width, height: Announce.canvas.height, font: Announce.ctx.font } : null,
    nativeNavigation: Navigation._lastRequest || null, showWindow: Navigation._lastRequest?.showWindow,
    popupVisible: !!document.getElementById('WinPrompt'), sourceHash };
}
function report() {
  const current = snapshot();
  for (const [key, value] of Object.entries(current)) {
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (document.body.dataset[key] !== text) document.body.dataset[key] = text;
  }
  const metrics = document.getElementById('metrics'), text = JSON.stringify(current, null, 2);
  if (metrics.textContent !== text) metrics.textContent = text;
  const message = document.getElementById('notice-message');
  if (message.textContent !== current.noticeText) message.textContent = current.noticeText;
  return current;
}
Object.defineProperty(window, '__teleportFeedbackPreview', { get: () => structuredClone(snapshot()) });
function setBackground(element, asset) {
  if (!asset) return;
  element.dataset.previewAsset = asset;
  decodeBmp(asset).then(url => { if (element.dataset.previewAsset === asset) element.style.backgroundImage = 'url("' + url + '")'; }).catch(assetError);
}
class GUIComponent {
  constructor(name, css) { this.name = name; this.css = css; }
  clone(name) { const clone = new GUIComponent(name, this.css); clone.render = this.render; return clone; }
  getRoot() { return this._container; }
  static processDataAttrs(element) {
    const normal = element.dataset.background;
    setBackground(element, normal);
    if (element.tagName === 'BUTTON') { element.type = 'button'; element.setAttribute('aria-label', normal?.startsWith('btn_ok') ? '确定' : '取消'); }
    for (const [event, attribute] of [['mouseenter', 'hover'], ['mousedown', 'down'], ['mouseup', 'hover'], ['mouseleave', 'background']]) {
      element.addEventListener(event, () => setBackground(element, element.dataset[attribute] || normal));
    }
  }
  append() {
    if (!this._host) {
      this._host = document.createElement('div'); this._host.id = this.name;
      Object.assign(this._host.style, { position: 'fixed', zIndex: '80', fontSize: '12px', lineHeight: '1.2', color: '#000', fontFamily: 'Arial, "Microsoft YaHei", MiSans, "LastRO Glyph Fallback", sans-serif', fontWeight: '400', fontSizeAdjust: 'none' });
      this._shadow = this._host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = values['Common_default$1'] + this.css;
      this._container = document.createElement('div'); this._container.className = 'ui-component-root';
      setLastROInnerHTML(this._container, this.render()); this._shadow.append(style, this._container);
      document.body.append(this._host);
      this._container.querySelectorAll('[data-background]').forEach(GUIComponent.processDataAttrs);
      this.init?.();
      if (this.name === 'WinPrompt') state.popupCount++;
    } else document.body.append(this._host);
    this.__active = true; report();
  }
  remove() { this.__active = false; this.onRemove?.(); this._host?.remove(); report(); }
  draggable() {
    this._host.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.composedPath().some(node => node.tagName === 'BUTTON')) return;
      const x = event.clientX, y = event.clientY, left = this._host.offsetLeft, top = this._host.offsetTop;
      const move = next => { this._host.style.left = left + next.clientX - x + 'px'; this._host.style.top = top + next.clientY - y + 'px'; };
      const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop, { once: true }); event.preventDefault();
    });
  }
}
const Announce = new GUIComponent('Announce', values['Announce_default$1']);
Announce.render = () => values['Announce_default$2'];
const Announce_default = Announce;
const WinPopup = new GUIComponent('WinPopup', values['WinPopup_default$1']);
WinPopup.render = () => values['WinPopup_default$2'];
const Renderer = { get width() { return window.innerWidth; } };
const Events = { setTimeout: (callback, ms) => window.setTimeout(() => { callback(); report(); }, ms), clearTimeout: id => window.clearTimeout(id) };
let _timer$2 = 0, _life$1 = 20000;
function init_Announce() {}
const MapRenderer = { currentMap: 'force_map3.gat', loading: false };
const SessionStorage_default = { Entity: { position: [25.4, 40.7] } };
const Altitude = { width: 300, height: 300 };
// Native navigateTo distinguishes a prepared/connected host from its lazy-init path.
// Keep the offline host mounted and hidden, as after real background initialization.
const navigationRoot = document.createElement('div'); navigationRoot.id = 'offline-navigation-root'; navigationRoot.style.display = 'none';
setLastROInnerHTML(navigationRoot, '<input class="services-toggle" type="checkbox">'); document.body.append(navigationRoot);
const Navigation = { __loaded: true, _host: navigationRoot, getRoot: () => navigationRoot, loadMap() {}, prepare() {}, append() { throw new Error('Background navigation unexpectedly opened its UI'); }, ui: { hide() {} }, clearPath() {}, setTargetCoordinatesText() {}, setTargetCoordinatesBlinking() {} };
const Navigation_default = Navigation, MapPathFinder = {};
const _mapData = { map: 'force_map3', width: 300, height: 300, cellTypes: new Uint8Array(90000).fill(1), walkableType: 1 };
let _finalTargetData = null, _targetData = null, _pathUpdateLock = false, _path = [];
const _pathFindingWorker = { id: 1, postMessage: request => {
  // The real request carries 90,000 GAT cells. Keep QA output small enough for AX.
  const { type, startX, startY, endX, endY, workerId, mapData } = request;
  state.paths.push({ type, startX, startY, endX, endY, workerId,
    mapData: mapData ? { map: mapData.map, width: mapData.width, height: mapData.height } : undefined });
  state.sequence.push('native-path'); report();
} };
function init_Navigation() { state.sequence.push('init-navigation'); }
function init_SessionStorage() {}
function init_Altitude() {}
function initializePathFindingWorker() {}
function resetPathFindingWorker() {}
function getCurrentMap() { return MapRenderer.currentMap.toLowerCase().replace(/\.gat$/i, ''); }
function getPlayerPosition() { return { x: 25, y: 41 }; }
const DB = { getNaviLinkTable: () => [] };
const LastROTools = { _lastroPanels: { cancelRoute() { state.sequence.push('cancel-old-route'); } }, _lastroTeleportRejected(message, response) { state.rejected.push({ message, response }); report(); } };
const ChatBox_default = { TYPE: { ERROR: 1 }, FILTER: { PUBLIC_LOG: 1 }, addText(message) {
  state.chat.push(message); const row = document.createElement('div'); row.className = 'error'; row.textContent = message; document.getElementById('chat-log').append(row); report();
} };
const PACKET = { CZ: { PRIVATE_AIRSHIP_REQUEST: class {} }, ZC: {} };
const Network = { sendPacket(packet) { state.packets.push({ ...packet }); state.sequence.push('offline-airship-record'); report(); } };
function buildPrivateAirshipRequest(target) { return { ...target, itemid: 14527 }; }
`;
const setup = String.raw`
const nativeSet = Announce.set;
Announce.set = function(text, color, options) { state.notices.push({ text, color, life: options?.life, at: Date.now() }); nativeSet.call(this, text, color, options); report(); };
const nativeNavigate = Navigation.navigateTo;
Navigation.navigateTo = function(request) { this._lastRequest = { ...request }; return nativeNavigate.call(this, request); };
const chat = document.getElementById('chat');
LastROChatMapLinks.render(chat, "[随机事件] 10秒后召唤师将在迷宫举办魔物派对(<span class='mapname' data-map='force_map3#100#184'>点击前往</span>).");
chat.addEventListener('click', event => { const link = event.target.closest('a.mapname'); if (!link) return; event.preventDefault(); LastROChatMapLinks.request(link); report(); });
document.querySelectorAll('[data-response]').forEach(button => button.addEventListener('click', () => {
  const response = Number(button.dataset.response); state.responses.push({ opcode: '0x0A4A', response });
  const packet = new PACKET.ZC.PRIVATE_AIRSHIP_RESPONSE({ readLong: () => response }); lastroPrivateAirshipFeedback(packet); report();
}));
document.getElementById('map').addEventListener('change', event => { MapRenderer.currentMap = event.target.value; report(); });
document.getElementById('loading').addEventListener('change', event => { MapRenderer.loading = event.target.checked; report(); });
document.getElementById('reset').addEventListener('click', () => location.reload());
Promise.all([document.fonts.load('400 12px MiSans'), document.fonts.load('500 12px MiSans'), document.fonts.load('700 12px MiSans'), ...Object.keys(manifest).map(decodeBmp)]).then(() => { document.body.dataset.fontReady = 'true'; document.body.dataset.assetsReady = String(Object.keys(manifest).length); report(); });
report();
`;
const source = [
  'import { setLastROInnerHTML } from "./teleport-feedback-trusted-dom.mjs";',
  'const values = ' + JSON.stringify(values) + ';',
  'const manifest = ' + JSON.stringify(manifest) + ';',
  'const assetDirectory = ' + JSON.stringify(assetDirectory) + ';',
  'const sourceHash = ' + JSON.stringify(createHash('sha256').update(runtime).digest('hex')) + ';',
  NATIVE_BMP_PREVIEW_SOURCE, environment, ...Object.values(functions),
  'const UIManager = { getComponent: () => WinPopup, ' + prompt + ' };',
  ...Object.values(assignments),
  'const LastROChatMapLinks = ' + chatFactory + ';',
  'const lastroPrivateAirshipFeedback = ' + feedback + ';', setup,
].join('\n');
await writeFile('generated/teleport-feedback-preview.mjs', source);
await writeFile('generated/teleport-feedback-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原生活动寻路与传送反馈预览</title><link rel="stylesheet" href="/fonts/misans.css"><style>
body{margin:0;padding:84px 24px 24px;background:#223028;color:#eee;font:14px Arial,'Microsoft YaHei',MiSans,"LastRO Glyph Fallback",sans-serif;font-weight:400;font-size-adjust:none}h1{font-size:19px}nav{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button,select{font:inherit}header p{margin:8px 0}.chatbox{max-width:920px;margin-top:22px;background:#131915;border:1px solid #d1c3ad;border-radius:4px}.tabs{display:flex;border-bottom:1px solid #d1c3ad}.tabs span{padding:6px 18px;border-right:1px solid #d1c3ad}.messages{padding:10px 12px;line-height:1.6;min-height:90px;color:#ff3939;font-size:16px}a.mapname{color:#ffd76b;text-decoration:underline;cursor:pointer}.error{color:#ff4d4d}pre{max-height:280px;overflow:auto;max-width:920px;font:12px monospace;background:#17231c;padding:12px}#assets:empty{display:none}#assets{color:#ffb49f}#notice-message{font-size:12px;color:#ffe588}
</style><header><h1>原生活动寻路与传送反馈 · 离线 QA</h1><p>实际构建的活动适配器、Navigation、RO 确认窗口及 Announce 画布。游戏包只记录在本页，联网游戏包始终为 0。</p><nav>
<label>当前地图 <select id="map"><option value="force_map3.gat">活动地图（同地图）</option><option value="prontera.gat">普隆德拉（跨地图）</option></select></label><label><input type="checkbox" id="loading">地图加载中</label>
<button data-response="2">响应 2：缺少凭证</button><button data-response="3">响应 3：地图禁止</button><button data-response="4">响应 4：未知地图</button><button id="reset">复原预览</button></nav><div id="assets">${failures.join('\n')}</div><p id="notice-message" aria-live="polite"></p></header>
<section class="chatbox"><div class="tabs"><span>一般信息</span><span>战役信息</span></div><div class="messages"><div id="chat"></div><div id="chat-log"></div></div></section><pre id="metrics"></pre><script type="module" src="./teleport-feedback-preview.mjs"></script></html>`);
console.log('Preview: /generated/teleport-feedback-preview.html');
console.log('Native BMP: ' + Object.keys(manifest).length + '/' + assets.length);
if (failures.length) console.warn(failures.join('\n'));
