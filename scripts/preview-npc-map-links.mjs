// Generated NpcBox methods and RO skin. Offline announcement/teleport QA only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';
import ts from 'typescript';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const source = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = new Set(['Common_default$1', 'NpcBox_default$1', 'NpcBox_default$2', 'WinPopup_default$1', 'WinPopup_default$2']);
const values = {}, methods = {}, helpers = [], hotkeyHelpers = [];
let installer, button, dataAttrs, draggable, promptMethod, dialogFallback, closeAppear;
const popupHelpers = [], keyMethods = [];
function visit(node) {
  if (ts.isBinaryExpression(node)) {
    const name = node.left.getText(source);
    if (wanted.has(name) && ts.isStringLiteral(node.right)) values[name] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[name] ?? '') + node.right.text : node.right.text;
    if (name === 'UIButton' && ts.isClassExpression(node.right)) button = node.right.getText(source);
    if (/^NpcBox\.(init|onRemove|onKeyDown|setText|addNext|addClose|next|close)$/.test(name) && ts.isFunctionExpression(node.right)) methods[name] = node.getText(source) + ';';
  }
  if (ts.isFunctionDeclaration(node) && ['lastroUiInputFrame', 'lastroUiLogicalPointer', 'lastroUiDragBounds'].includes(node.name?.text)) helpers.push(node.getText(source));
  if (ts.isFunctionDeclaration(node) && ['lastroHotkeyId', 'lastroHotkeyComponentVisible', 'lastroHotkeyEditable'].includes(node.name?.text)) hotkeyHelpers.push(node.getText(source));
  if (ts.isFunctionDeclaration(node) && ['_popupPosition', '_createButton'].includes(node.name?.text)) popupHelpers.push(node.getText(source));
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'showPromptBox') promptMethod = node.getText(source).replace(/^static\s+/, '');
  if ((ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) && node.name?.text === 'installLastroNpcMapLinks') installer = node.getText(source);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'installLastroNpcDialogButtonFallback') dialogFallback = node.getText(source);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'onCloseAppear') closeAppear = node.getText(source);
  if (ts.isMethodDeclaration(node) && node.parent.name?.getText(source) === 'GUIComponent') {
    if (node.name.getText(source) === 'processDataAttrs') dataAttrs = node.getText(source);
    if (node.name.getText(source) === 'draggable') draggable = node.getText(source);
    if (['_bindKeyDown', '_unbindKeyDown'].includes(node.name.getText(source))) keyMethods.push(node.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of wanted) if (!values[name]) throw new Error('Missing generated NPC template: ' + name);
if (!installer || !button || !dataAttrs || !draggable || !promptMethod || !dialogFallback || !closeAppear || popupHelpers.length !== 2 || keyMethods.length !== 2 || hotkeyHelpers.length !== 3 || Object.keys(methods).length !== 8)
  throw new Error('Generate final runtime containing installLastroNpcMapLinks before running this preview');
const regionStart = runtime.indexOf('//#region src/UI/Components/NpcBox/NpcBox.js');
const regionEnd = runtime.indexOf('//#endregion', regionStart);
const npcSource = ts.createSourceFile('NpcBox.js', runtime.slice(regionStart, regionEnd), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const formatters = npcSource.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['processNAVITags', 'processItemTags', 'processColorCodes', 'processText', '_isVisible$1'].includes(node.name?.text)).map(node => node.getText(npcSource));
if (formatters.length !== 5 || !methods['NpcBox.setText'].includes('_lastroMapLinks.render')) throw new Error('Missing final patched NPC text methods');

const assets = new Set();
for (const match of values.NpcBox_default$2.matchAll(/(?:data-(?:background|hover|down|active)|bg|hover|down|src)="([^"]+\.bmp)"/g)) assets.add(match[1]);
for (const asset of ['win_msgbox.bmp', 'btn_ok.bmp', 'btn_ok_a.bmp', 'btn_ok_b.bmp', 'btn_cancel.bmp', 'btn_cancel_a.bmp', 'btn_cancel_b.bmp']) assets.add(asset);
const directory = 'generated/npc-map-links-assets';
await mkdir(directory, { recursive: true });
for (const asset of assets) {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  for (const cache of ['generated/chat-map-links-assets', 'generated/ui-state-assets', 'generated/navigation-assets', 'generated/quests-assets', 'generated/basic-info-assets']) {
    try { await writeFile(directory + '/' + filename, await readFile(cache + '/' + filename)); break; }
    catch { /* Shared cache checks other existing previews before passive fetch. */ }
  }
}
const { manifest, failures } = await cacheNativeUiAssets([...assets], directory);
await writeFile('generated/npc-map-links-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));

const fixture = String.raw`
import { setLastROInnerHTML } from './npc-map-links-trusted-dom.mjs';
const values = VALUES, manifest = MANIFEST, assetDirectory = 'npc-map-links-assets', sourceHash = SOURCE_HASH;
NATIVE_BMP
window.addEventListener('error', event => { document.body.dataset.fixtureError = event.message; document.querySelector('#status').textContent = event.message; });
const plane = document.querySelector('#native-plane');
let zoom = 1, topIndex = 50, _needCleanUp = false, _snapCache = [], fontReady = false, assetsReady = false;
const Mouse = { screen: { x: 0, y: 0, width: innerWidth, height: innerHeight } };
window.addEventListener('mousemove', event => { Mouse.screen.x = event.pageX; Mouse.screen.y = event.pageY; }, true);
window.addEventListener('mousedown', event => { Mouse.screen.x = event.pageX; Mouse.screen.y = event.pageY; }, true);
const Renderer = { get width() { return innerWidth / zoom; }, get height() { return innerHeight / zoom; } };
const _Renderer = Renderer, UI_default = { windowmagnet: false };
const DB = { INTERFACE_PATH: '', getMessage: (_id, fallback = '') => fallback };
const missingButtonArtwork = new URL(location.href).searchParams.get('button-artwork') === 'missing';
const Client = { loadFile: (asset, done) => {
  if (missingButtonArtwork && /^btn_(?:close|next)(?:_[ab])?\.bmp$/.test(asset)) return;
  decodeBmp(asset).then(done).catch(assetError);
},
  loadFiles: (assets, done) => Promise.all(assets.map(decodeBmp)).then(values => done?.(...values)).catch(assetError) };
const _Client = Client, _DB = DB;
const ItemInfo_default = { uid: null, append() {}, remove() {}, setItem() {} };
const Navigation_default = { uid: null, show() {}, hide() {}, setNaviInfo() {} };
const NpcMenu_default = { _host: null }, InputBox_default = { _host: null }, KEYS = {
  ENTER: 13, SPACE: 32, ESCAPE: 27,
  getDeepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  },
};
NATIVE_INPUT_HELPERS
NATIVE_HOTKEY_HELPERS
class GUIComponent {
  NATIVE_DATA_ATTRS
  constructor(name, css) { this.name = name; this._cssText = css; this.__active = false; this.magnet = {}; }
  getRoot() { return this._shadow; }
  clone(name) { const clone = new GUIComponent(name, this._cssText); clone.render = this.render; return clone; }
  append() {
    if (!this._host) {
      this._host = document.createElement('div'); this._host.id = this.name;
      Object.assign(this._host.style, { position: 'absolute', fontSize: '12px', lineHeight: '1.2', zIndex: '50' });
      this._shadow = this._host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = values.Common_default$1 + this._cssText;
      const container = this._container = document.createElement('div'); container.className = 'ui-component-root'; setLastROInnerHTML(container, this.render());
      this._shadow.append(style, container); plane.append(this._host);
      this._shadow.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
      this.init(); this._host.remove();
    }
    plane.append(this._host); this.__active = true; this._host.style.display = ''; this.onAppend?.(); this.focus(); this._bindKeyDown();
  }
  remove() { this.__active = false; this.onRemove?.(); this._unbindKeyDown(); this._host.remove(); report(); }
  focus() { this._host.style.zIndex = String(++topIndex); }
  NATIVE_DRAGGABLE
  NATIVE_KEY_METHODS
}
customElements.define('ui-button', NATIVE_BUTTON);
NATIVE_FORMATTERS
NATIVE_POPUP_HELPERS
const WinPopup = new GUIComponent('WinPopup', values.WinPopup_default$1);
WinPopup.render = () => values.WinPopup_default$2;
const UIManager = { components: { NpcMenu: NpcMenu_default, InputBox: InputBox_default }, getComponent: () => WinPopup, NATIVE_PROMPT_METHOD };
const NpcBox = new GUIComponent('NpcBox', values.NpcBox_default$1);
UIManager.components.NpcBox = NpcBox;
NpcBox.render = () => values.NpcBox_default$2; NpcBox.ownerID = 0;
NATIVE_METHODS
const NpcBox_default = NpcBox;
NATIVE_CLOSE_APPEAR
(NATIVE_DIALOG_FALLBACK)(NpcBox);
const packets = [], closeRecords = [], errors = [], checks = [];
let failMode = false, pendingVersion = 0, activePrompt = null;
NpcBox.onClosePressed = gid => { closeRecords.push(gid); NpcBox.remove(); report(); };
NpcBox.onNextPressed = () => {};
(NATIVE_INSTALLER)(NpcBox, {
  setHtml: setLastROInnerHTML,
  labelFor: mapname => mapname === 'lhz_dun03' ? '生体实验室3层' : mapname,
  showPrompt: (message, yes, no) => {
    activePrompt = UIManager.showPromptBox(message, 'ok', 'cancel', yes, no);
    Object.assign(activePrompt._host.style, { left: '240px', top: '145px' });
    activePrompt.onRemove = report;
    report(); return activePrompt;
  },
  cancelPending: () => { pendingVersion++; },
  onError: error => { errors.push(error.message); report(); },
  teleport: async mapname => {
    const version = ++pendingVersion; checks.push({ mapname, status: 'pending' }); report();
    await new Promise(resolve => setTimeout(resolve, 200));
    if (version !== pendingVersion || !NpcBox._lastroMapLinks.canSend(mapname)) return false;
    if (failMode) { checks.at(-1).status = 'failed'; errors.push('模拟：地图资源预检失败'); report(); return false; }
    checks.at(-1).status = 'approved';
    NpcBox._lastroMapLinks.commit(mapname, () => packets.push({ mapname, type: 0, x: 0, y: 0, itemid: 14527, offline: true })); report();
    return true;
  },
});
const samples = missingButtonArtwork ? ['[罗密欧]', '我会在外面等着你。'] : ['^0000FF[MVP公告板]^000000', '巴风特：已死亡，复活剩余 1小时20分钟。',
  '超魔导师凯瑟琳：存活（离线文本样本）。', '^nMapName^lhz_dun03'];
function restore() {
  if (NpcBox.__active) NpcBox.remove();
  packets.length = closeRecords.length = errors.length = checks.length = 0;
  NpcBox.append(); for (const text of samples) NpcBox.setText(text, 900001); onCloseAppear({ NAID: 900001 }); report();
}
function applyScale() {
  plane.style.zoom = String(zoom); plane.style.width = innerWidth / zoom + 'px'; plane.style.height = innerHeight / zoom + 'px';
  if (NpcBox._host) { NpcBox._host.style.left = '40px'; NpcBox._host.style.top = '30px'; }
  Mouse.screen.width = innerWidth; Mouse.screen.height = innerHeight; report();
}
let latest = null, reporting = false;
function report() {
  if (reporting) return; reporting = true;
  requestAnimationFrame(() => {
    reporting = false;
    const root = NpcBox.getRoot(), rect = NpcBox._host?.getBoundingClientRect();
    latest = { sourceHash, zoom, fontReady, assetsReady, wire: 0, dialogVisible: NpcBox.__active && NpcBox._host?.isConnected,
      promptVisible: !!activePrompt?.__active, promptText: activePrompt?.getRoot().querySelector('.text')?.textContent || '',
      text: root?.querySelector('.content')?.textContent || '', ownerID: NpcBox.ownerID,
      links: [...root?.querySelectorAll('a.lastro-npc-map-link') || []].map(link => ({ label: link.textContent, mapname: link.dataset.map, busy: link.hasAttribute('aria-busy') })),
      packets: [...packets], closeRecords: [...closeRecords], errors: [...errors], checks: [...checks],
      rect: rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, failMode };
    Object.assign(document.body.dataset, { ready: 'true', wire: '0', dialogVisible: String(latest.dialogVisible), fontReady: String(fontReady), assetsReady: String(assetsReady),
      packetCount: String(packets.length), closeCount: String(closeRecords.length), mapname: packets.at(-1)?.mapname || '', packets: JSON.stringify(packets),
      errors: JSON.stringify(errors), links: JSON.stringify(latest.links), metrics: JSON.stringify(latest) });
    document.querySelector('#metrics').textContent = JSON.stringify(latest, null, 2);
    document.querySelector('#status').textContent = errors.at(-1) || (packets.length ? '已记录离线传送，原生对话已关闭' : '点击蓝色地图名称进行离线检查');
  });
}
Object.defineProperty(window, '__npcMapLinksPreview', { value: Object.freeze({ get metrics() { return latest; } }) });
document.querySelector('#restore').addEventListener('click', restore);
document.querySelector('#failure').addEventListener('click', event => { failMode = !failMode; event.currentTarget.textContent = '模拟预检失败：' + (failMode ? '开' : '关'); report(); });
document.querySelector('#zoom').addEventListener('change', event => { zoom = Number(event.target.value); applyScale(); });
window.addEventListener('resize', applyScale);
restore(); applyScale();
await Promise.all([400, 500, 700].map(weight => document.fonts.load(weight + ' 12px MiSans', '公告板生体实验室'))); await document.fonts.ready; fontReady = true;
await Promise.all(Object.keys(manifest).map(decodeBmp)); assetsReady = true; report();
`;
const replacements = { VALUES: JSON.stringify(values), MANIFEST: JSON.stringify(manifest), SOURCE_HASH: JSON.stringify(sourceHash), NATIVE_BMP: NATIVE_BMP_PREVIEW_SOURCE,
  NATIVE_INPUT_HELPERS: helpers.join('\n'), NATIVE_DATA_ATTRS: dataAttrs, NATIVE_DRAGGABLE: draggable, NATIVE_BUTTON: button,
  NATIVE_HOTKEY_HELPERS: hotkeyHelpers.join('\n'),
  NATIVE_FORMATTERS: formatters.join('\n'), NATIVE_METHODS: Object.values(methods).join('\n'), NATIVE_INSTALLER: installer,
  NATIVE_DIALOG_FALLBACK: dialogFallback, NATIVE_CLOSE_APPEAR: closeAppear };
Object.assign(replacements, { NATIVE_POPUP_HELPERS: popupHelpers.join('\n'), NATIVE_PROMPT_METHOD: promptMethod, NATIVE_KEY_METHODS: keyMethods.join('\n') });
const js = fixture.replace(/\b(?:VALUES|MANIFEST|SOURCE_HASH|NATIVE_BMP|NATIVE_INPUT_HELPERS|NATIVE_HOTKEY_HELPERS|NATIVE_DATA_ATTRS|NATIVE_DRAGGABLE|NATIVE_BUTTON|NATIVE_FORMATTERS|NATIVE_METHODS|NATIVE_INSTALLER|NATIVE_DIALOG_FALLBACK|NATIVE_CLOSE_APPEAR|NATIVE_POPUP_HELPERS|NATIVE_PROMPT_METHOD|NATIVE_KEY_METHODS)\b/g, token => replacements[token]);
const syntax = ts.createSourceFile('npc-map-links-preview.mjs', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
if (syntax.parseDiagnostics.length) throw new Error('Invalid generated NPC fixture syntax');
await writeFile('generated/npc-map-links-preview.mjs', js);
await writeFile('generated/npc-map-links-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NPC 公告板地图链接预览</title><link rel="stylesheet" href="/fonts/misans.css">
<style>html{font-size:16px}body{margin:0;font:400 12px/1.2 Arial,'Microsoft YaHei',MiSans,"LastRO Glyph Fallback",sans-serif;font-size-adjust:none;color:#222;background:#edf0ed}header{padding:10px;background:white}h1{font-size:16px;font-weight:400;margin:0 0 8px}nav{display:flex;gap:8px;align-items:center}button,select{font:inherit;min-height:26px}p{margin:7px 0 0}main{display:flex;flex-wrap:wrap;gap:14px;padding:12px}#viewport{width:640px;height:440px;background:linear-gradient(20deg,#6c8154,#435944);position:relative;overflow:hidden}#native-plane{position:absolute;left:0;top:0}pre{font:11px/1.3 monospace;max-width:400px;max-height:440px;overflow:auto;margin:0}#assets:empty{display:none}#assets{color:#900;white-space:pre-wrap}</style>
<body><header><h1>原生 NPC 公告板 · 地图链接离线验收</h1><nav><button id="restore">复原公告板</button><button id="failure">模拟预检失败：关</button><label>缩放 <select id="zoom"><option value="1">100%</option><option value="1.5">150%</option></select></label><span id="status"></span></nav><p>公告板文字为本地样本。预检与传送仅写入页面记录，不连接账号或游戏服务器。</p><div id="assets">${failures.join('\n')}</div></header>
<main><div id="viewport"><div id="native-plane"></div></div><pre id="metrics"></pre></main><script type="module" src="./npc-map-links-preview.mjs"></script></body></html>`);
console.log(JSON.stringify({ html: 'generated/npc-map-links-preview.html', sourceHash, assets: Object.keys(manifest).length, failures }, null, 2));
