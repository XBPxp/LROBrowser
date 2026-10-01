// Generated native BasicInfo factory, templates and UI assets. Offline QA only:
// toolbar destinations are local recorders, never game windows or packets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const source = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = new Set(['Common_default$1', 'BasicInfoV4_default$1', 'BasicInfoV4_default$2', 'BasicInfoV5_default$1', 'BasicInfoV5_default$2']);
const values = {}, elements = {}, configs = {}, helpers = {};
let dataAttrs, factory, jobFunction, jobLabels, jobConst, uiMessages, messageFactory, messageMethod, tableLoader;
function visit(node) {
  if (ts.isBinaryExpression(node)) {
    const left = node.left.getText(source);
    if (wanted.has(left) && ts.isStringLiteral(node.right)) values[left] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[left] ?? '') + node.right.text : node.right.text;
    if (['UIButton', 'UIText', 'UIImage'].includes(left) && ts.isClassExpression(node.right)) elements[left] = node.right.getText(source);
    if (left === 'JobConst_default' && ts.isObjectLiteralExpression(node.right)) jobConst = vm.runInNewContext('(' + node.right.getText(source) + ')');
    if (['BasicInfoV4_default', 'BasicInfoV5_default'].includes(left) && ts.isCallExpression(node.right) && node.right.expression.getText(source) === 'createBasicInfo') {
      configs[left.replace('_default', '')] = node.right.arguments[0].getText(source);
    }
  }
  if (ts.isFunctionDeclaration(node)) {
    if (node.name?.text === 'createBasicInfo') factory = node.getText(source);
    if (node.name?.text === 'lastroJobDisplayName') jobFunction = node.getText(source);
    if (node.name?.text === 'loadTable') tableLoader = node.getText(source);
    if (/^lastroBasicInfo/.test(node.name?.text || '') || node.name?.text === 'lastroUiWindowAppend') helpers[node.name.text] = node.getText(source);
  }
  if (ts.isMethodDeclaration(node)) {
    if (node.name?.getText(source) === 'processDataAttrs') dataAttrs = node.getText(source).replace(/^static\s+/, '');
    if (node.name?.getText(source) === 'getMessage') messageMethod = node.getText(source).replace(/^static\s+/, '');
  }
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(source);
    if (name === 'lastroJobLabels') jobLabels = JSON.parse(node.initializer.getText(source));
    if (name === 'lastroUiMessages') uiMessages = JSON.parse(node.initializer.getText(source));
    if (name === 'LastROUiMessages') messageFactory = node.initializer.getText(source);
    if (/^lastroBasicInfo/.test(name) && node.initializer && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) helpers[name] = 'const ' + name + ' = ' + node.initializer.getText(source) + ';';
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of wanted) if (!values[name]) throw new Error('Missing generated BasicInfo string: ' + name);
if (!factory || !dataAttrs || !jobFunction || !jobLabels || !jobConst || !messageFactory || !messageMethod || !tableLoader || Object.keys(elements).length !== 3 || Object.keys(configs).length !== 2) throw new Error('Missing generated BasicInfo factory/dependencies');

function region(path) {
  const begin = runtime.indexOf('//#region ' + path), end = runtime.indexOf('//#endregion', begin);
  if (begin < 0 || end < begin) throw new Error('Missing native loader region: ' + path);
  return runtime.slice(begin, end);
}
const targaSource = region('src/Loaders/Targa.js');
const cardSource = await readFile('generated/core/runtime/lastro-card-collection-ui.mjs', 'utf8');
const cardAst = ts.createSourceFile('card-menu.mjs', cardSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const cardFunctions = cardAst.statements.filter(node => ts.isFunctionDeclaration(node) && ['resolveMenuButtonTagName', 'installLastROCardMenuButton'].includes(node.name?.text)).map(node => node.getText(cardAst).replace(/^export\s+/, ''));
if (cardFunctions.length !== 2) throw new Error('Missing native BasicInfo card menu helper');

const assets = new Set(['menu_icon/bt_card.bmp', 'menu_icon/bt_card_press.bmp', 'basic_interface/viewon.bmp', 'basic_interface/viewoff.bmp']);
for (const name of ['BasicInfoV4_default$2', 'BasicInfoV5_default$2']) {
  for (const match of values[name].matchAll(/(?:data-(?:background|hover|down|active|mini-background)|bg|hover|down|src)="([^";]+\.(?:bmp|tga))"/g)) assets.add(match[1]);
  for (const match of values[name].matchAll(/data-preload="([^"]+)"/g)) for (const asset of match[1].split(';')) assets.add(asset);
}
const assetDirectory = 'generated/basic-info-assets';
await mkdir(assetDirectory, { recursive: true });
// Reuse the typography QA's already decoded native source BMP cache.
for (const asset of assets) {
  if (!asset.endsWith('.bmp')) continue;
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  try { await writeFile(assetDirectory + '/' + filename, await readFile('generated/client-typography-assets/' + filename)); }
  catch { /* The shared passive-resource cache fetches missing assets. */ }
}
const { manifest, failures } = await cacheNativeUiAssets([...assets].filter(asset => asset.endsWith('.bmp')), assetDirectory);
const tgaAssets = [...assets].filter(asset => asset.endsWith('.tga'));
if (tgaAssets.length) {
  const bundle = await build({ entryPoints: ['src/resources/resource-resolver.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
  const resolver = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const targaContext = vm.createContext({ Uint8Array, __esmMin: fn => fn });
  vm.runInContext(targaSource + '\ninit_Targa();', targaContext);
  for (const asset of tgaAssets) {
    const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.tga';
    try {
      let bytes;
      try { bytes = await readFile(assetDirectory + '/' + filename); } catch { /* Fetch only the allowlisted passive texture. */ }
      if (!bytes) {
        for (const candidate of resolver.buildResourcePathCandidates('data/texture/유저인터페이스/' + asset)) {
          for (const root of resolver.DEFAULT_RESOURCE_ROOTS) {
            const url = new globalThis.URL(candidate, root);
            if (!['https://game.lastro.cn', 'https://rodata.ltsd.ro'].includes(url.origin)) throw new Error('Unexpected passive resource origin');
            try {
              const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(10000), credentials: 'omit', redirect: 'error' });
              if (!response.ok) continue;
              const data = new Uint8Array(await response.arrayBuffer());
              if (data.byteLength < 18 || data.byteLength > 16 * 1024 * 1024) continue;
              const image = new targaContext.Targa(); image.load(data);
              bytes = data; break;
            } catch { /* Try the next allowlisted passive path. */ }
          }
          if (bytes) break;
        }
      }
      if (!bytes) throw new Error('Native TGA unavailable');
      const image = new targaContext.Targa(); image.load(new Uint8Array(bytes));
      await writeFile(assetDirectory + '/' + filename, bytes); manifest[asset] = filename;
    } catch (error) { failures.push(asset + ': ' + error.message); }
  }
  await writeFile(assetDirectory + '/index.json', JSON.stringify(manifest, null, 2) + '\n');
}

// Match production TXT -> CSV -> scoped overrides rather than using CSV alone.
const txtBytes = await readFile('generated/client-typography-assets/msgstringtable.txt');
const csvBytes = await readFile('generated/core/data/msgstringtable.csv');
const messageContext = vm.createContext({ console, txtBytes, csvBytes,
  CodepageManager: { decode: (bytes, charset) => new globalThis.TextDecoder(charset || 'utf-8').decode(bytes) },
  Client: { loadFile: (_filename, done) => done(txtBytes) }, userCharpage: 'gbk' });
vm.runInContext('const LastROUiMessages = ' + messageFactory + ';\nconst MsgStringTable = {};\n' + tableLoader + '\n' +
  'loadTable("data/msgstringtable.txt", "#", 1, (id, value) => { MsgStringTable[id] = value; }, () => { LastROUiMessages.loadCsv(csvBytes, MsgStringTable, bytes => CodepageManager.decode(bytes, "utf-8")); }, true);\nglobalThis.messages = MsgStringTable;', messageContext);

const fixture = String.raw`
function __esmMin(fn) { return fn; }
NATIVE_TARGA
init_Targa();
function decodeAsset(asset) {
  if (!asset.endsWith('.tga')) return decodeBmp(asset);
  if (!decoded.has(asset)) decoded.set(asset, fetch('./basic-info-assets/' + manifest[asset]).then(response => {
    if (!response.ok) throw new Error('Cannot load native TGA: ' + asset);
    return response.arrayBuffer();
  }).then(buffer => { const image = new Targa(); image.load(new Uint8Array(buffer)); return image.getDataURL(); }));
  return decoded.get(asset);
}
const Client = { loadFile: (asset, done) => decodeAsset(asset).then(done).catch(assetError),
  loadFiles: (files, done) => Promise.all(files.map(decodeAsset)).then(values => done?.(...values)).catch(assetError) };
const MsgStringTable = messages;
const LastROUiMessages = NATIVE_MESSAGE_FACTORY;
const DB = { INTERFACE_PATH: '', NATIVE_MESSAGE_METHOD };
const _Client = Client, _DB = DB;
let lastroJobLabelsById;
function init_JobConst() {}
const MonsterTable_default = { 4010: 'High Wizard', 4255: 'ARCH_MAGE', 4055: 'WARLOCK' };
NATIVE_JOB_DISPLAY
const SessionStorage_default = {};
const Renderer = { width: 2000, height: 2000 };
const samples = [], preferences = new Map(), toolbarEvents = [];
const Preferences = { get: (key, defaults) => {
  if (!preferences.has(key)) preferences.set(key, { ...defaults, save() { report(); } });
  return preferences.get(key);
} };
const UIManager = { addComponent: component => component };
function destination(name) { const toggle = () => { toolbarEvents.push(name); report(); }; return { toggle, getUI: () => ({ toggle }), ui: { toggle } }; }
const InventoryController = destination('Inventory'), WinStatsController = destination('WinStats'), EquipmentController = destination('Equipment'),
  Controller$4 = destination('SkillList'), Escape_default = destination('Escape'), controller = destination('PartyFriends'), Guild_default = destination('Guild'),
  ChatRoomCreate_default = destination('ChatRoomCreate'), WorldMap_default = destination('WorldMap'), CardConnection2 = destination('CardConnection2'),
  Bank_default = destination('Bank'), Controller$3 = destination('Quest'), Rodex_default = destination('Rodex'), Navigation_default = destination('Navigation'),
  CheckAttendance_default = destination('CheckAttendance'), Achievement_default = destination('Achievement'), Reputation_default = destination('Reputation');
const Configs = { get: () => true }, PacketVerManager_default = { value: 20211103 };
let fontReady = false, assetsReady = false, lastMetrics = null;
const observer = new MutationObserver(() => report());
class GUIComponent {
  static NATIVE_DATA_ATTRS
  constructor(name, css) { this.name = name; this._cssText = css; this.__loaded = false; this.magnet = {}; }
  getRoot() { return this._root; }
  append() {
    if (this.__loaded) return;
    this.__loaded = true; this._host = document.createElement('div'); this._host.id = this.name;
    Object.assign(this._host.style, { position: 'absolute', color: '#000', fontSize: '12px', lineHeight: '1.2', zIndex: '50' });
    this._root = this._host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = values.Common_default$1 + this._cssText;
    const container = document.createElement('div'); setLastROInnerHTML(container, this.render());
    this._root.append(style, container); this._plane.append(this._host);
    this._root.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
    this.init?.(); this.onAppend?.();
    observer.observe(this._root, { attributes: true, subtree: true, childList: true, characterData: true });
    observer.observe(this._host, { attributes: true, attributeFilter: ['style'] });
  }
  draggable() {
    this._root.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.composedPath().some(node => ['BUTTON', 'UI-BUTTON', 'INPUT', 'SELECT'].includes(node.tagName))) return;
      const left = this._host.offsetLeft, top = this._host.offsetTop, x = event.clientX, y = event.clientY;
      const move = next => { this._host.style.left = Math.max(0, left + (next.clientX - x) / this._scale) + 'px'; this._host.style.top = Math.max(0, top + (next.clientY - y) / this._scale) + 'px'; };
      const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop, { once: true }); event.preventDefault();
    });
  }
}
NATIVE_CARD_MENU
NATIVE_BASIC_INFO_FACTORY
const presets = {
  normal: { hp: 54672, maxhp: 67265, sp: 3640, maxsp: 3640, ap: 100, maxap: 200, blvl: 99, jlvl: 70, bexp: 100, jexp: 100, weight: 9480, maxweight: 47090, zeny: 607877 },
  low: { hp: 1234, maxhp: 67265, sp: 240, maxsp: 3640, ap: 0, maxap: 200, blvl: 100, jlvl: 71, bexp: 28.5, jexp: 36.5, weight: 14000, maxweight: 47090, zeny: 104805 },
  full: { hp: 67265, maxhp: 67265, sp: 3640, maxsp: 3640, ap: 200, maxap: 200, blvl: 250, jlvl: 70, bexp: 100, jexp: 100, weight: 46500, maxweight: 47090, zeny: 999999999 },
};
let state = { ...presets.normal };
function applyState() {
  for (const { component, version } of samples) {
    component.update('name', '熊本胖');
    component.update('job', version === 'BasicInfoV5' ? JobConst_default.ARCH_MAGE : JobConst_default.WIZARD_H);
    for (const type of ['hp', 'sp', 'ap']) component.update(type, state[type], state['max' + type]);
    component.update('blvl', state.blvl); component.update('jlvl', state.jlvl);
    component.update('bexp', state.bexp, 100); component.update('jexp', state.jexp, 100);
    component.update('weight', state.weight, state.maxweight); component.update('zeny', state.zeny);
  }
  for (const input of document.querySelectorAll('[data-field]')) input.value = state[input.dataset.field];
  report();
}
function box(element) { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; }
function textBoxes(element) {
  const boxes = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (rect.width && rect.height) boxes.push({ text: node.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  }
  return boxes;
}
function report() {
  const activeVersion = document.getElementById('version').value;
  const results = samples.filter(sample => sample.version === activeVersion).map(({ component, scale, version, plane }) => {
    const root = component.getRoot(), host = component._host, panel = root.querySelector('#' + version), bounds = box(panel);
    const selectors = ['.topbar .right', '.large .title', '.large .name', '.large .job', '.hp_bar_perc', '.sp_bar_perc', '.ap_bar_perc', '.hp_perc', '.sp_perc', '.ap_perc',
      '.blvl', '.jlvl', '.bexp', '.jexp', '.extra', '.small .line1', '.small .line2', '.small .line3', '.small .line4', '.small .hpcontainer', '.small .spcontainer', '.btn_open', '.btn_close', '.buttons'];
    const nodes = selectors.flatMap(selector => [...root.querySelectorAll(selector)].map(element => {
      const style = getComputedStyle(element); return { selector, text: element.textContent.trim(), rect: box(element), textRects: fontReady ? textBoxes(element) : [],
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, display: style.display };
    }).filter(node => node.rect.width && node.rect.height));
    const textOverflow = nodes.filter(node => node.selector !== '.buttons' && node.textRects.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1));
    const visibleButtons = [...root.querySelectorAll('.buttons > [id]')].filter(element => getComputedStyle(element).display !== 'none').map(element => element.id);
    const totalWidth = Math.max(host.offsetWidth, host.scrollWidth), totalHeight = Math.max(host.offsetHeight, host.scrollHeight);
    // Fit the QA card around native layout; never change native component sizing.
    const width = (totalWidth + 20) * scale + 'px', height = (totalHeight + 20) * scale + 'px';
    if (plane.style.width !== width) plane.style.width = width;
    if (plane.style.height !== height) plane.style.height = height;
    return { version, scale, mode: panel.classList.contains('small') ? 'small' : 'large', host: box(host), panel: bounds,
      hostLayout: { offsetWidth: host.offsetWidth, offsetHeight: host.offsetHeight, scrollWidth: host.scrollWidth, scrollHeight: host.scrollHeight }, nodes, textOverflow, visibleButtons };
  });
  lastMetrics = { sourceHash, activeVersion, fontReady, assetsReady, packets: 0, state: { ...state }, toolbarEvents: [...toolbarEvents], samples: results };
  document.body.dataset.basicInfoMetrics = JSON.stringify(lastMetrics); document.body.dataset.fontReady = String(fontReady); document.body.dataset.assetsReady = String(assetsReady);
  document.body.dataset.packets = '0'; document.body.dataset.activeVersion = activeVersion; document.body.dataset.modes = JSON.stringify(results.map(sample => [sample.scale, sample.mode]));
  document.body.dataset.textOverflow = JSON.stringify(results.map(sample => ({ scale: sample.scale, count: sample.textOverflow.length })));
  document.getElementById('state').textContent = results.map(sample => sample.scale * 100 + '%：' + (sample.mode === 'small' ? '折叠' : '展开')).join(' · ');
  return lastMetrics;
}
for (const version of ['BasicInfoV4', 'BasicInfoV5']) {
  for (const scale of [1, 1.5]) {
    const article = document.createElement('article'); article.dataset.version = version; article.dataset.scale = String(scale);
    const label = document.createElement('h2'); label.textContent = version + ' · ' + scale * 100 + '%';
    const plane = document.createElement('div'); plane.className = 'plane';
    article.append(label, plane); document.getElementById('windows').append(article);
    const config = nativeConfigs[version];
    const component = createBasicInfo({ ...config, name: version + '-' + scale * 100, prefKey: version + '-' + scale * 100 });
    component._scale = scale; component._plane = plane; component.append(); component._host.style.zoom = String(scale);
    samples.push({ version, scale, component, plane });
  }
}
function showVersion() {
  document.querySelectorAll('article[data-version]').forEach(article => { article.hidden = article.dataset.version !== document.getElementById('version').value; }); report();
}
document.getElementById('version').addEventListener('change', showVersion);
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { state = { ...presets[button.dataset.preset] }; applyState(); }));
document.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', () => {
  const value = Number(input.value); if (!Number.isFinite(value) || value < 0) return;
  state[input.dataset.field] = input.dataset.field.startsWith('max') ? Math.max(1, value) : value; applyState();
}));
document.getElementById('toggle').addEventListener('click', () => {
  samples.filter(sample => sample.version === document.getElementById('version').value).forEach(({ component }) => component.toggleMode()); report();
});
document.getElementById('toolbar').addEventListener('click', () => {
  samples.filter(sample => sample.version === document.getElementById('version').value).forEach(({ component }) => component.toggleButtons({ stopImmediatePropagation() {} })); report();
});
Object.defineProperty(window, 'lastroBasicInfoQA', { value: Object.freeze({ get metrics() { return lastMetrics; }, sourceHash }), writable: false, configurable: false });
applyState(); showVersion();
await Promise.all([400, 500, 700].map(weight => document.fonts.load(weight + ' 12px MiSans', '基本信息负重')));
await document.fonts.ready; fontReady = true;
await Promise.all(Object.keys(manifest).map(decodeAsset)); assetsReady = true;
report();
`;
const nativeConfigs = {};
for (const [name, text] of Object.entries(configs)) nativeConfigs[name] = vm.runInNewContext('(' + text + ')', values);
const js = [
  'import { setLastROInnerHTML } from "./basic-info-trusted-dom.mjs";',
  'const values = ' + JSON.stringify(values) + ';', 'const nativeConfigs = ' + JSON.stringify(nativeConfigs) + ';',
  'const manifest = ' + JSON.stringify(manifest) + ';', 'const sourceHash = ' + JSON.stringify(sourceHash) + ';', 'const assetDirectory = "basic-info-assets";',
  'const messages = ' + JSON.stringify(messageContext.messages) + ';', 'const lastroUiMessages = ' + JSON.stringify(uiMessages) + ';',
  'const lastroJobLabels = ' + JSON.stringify(jobLabels) + ';', 'const JobConst_default = ' + JSON.stringify(jobConst) + ';',
  NATIVE_BMP_PREVIEW_SOURCE,
  ...Object.values(helpers),
  fixture.replace('NATIVE_TARGA', targaSource).replace('NATIVE_MESSAGE_FACTORY', messageFactory).replace('NATIVE_MESSAGE_METHOD', messageMethod)
    .replace('NATIVE_JOB_DISPLAY', jobFunction).replace('NATIVE_DATA_ATTRS', dataAttrs).replace('NATIVE_CARD_MENU', cardFunctions.join('\n'))
    .replace('NATIVE_BASIC_INFO_FACTORY', factory).replace('for (const version of',
      Object.entries(elements).map(([name, code]) => 'customElements.define(' + JSON.stringify({ UIButton: 'ui-button', UIText: 'ui-text', UIImage: 'ui-image' }[name]) + ', ' + code + ');').join('\n') + '\nfor (const version of'),
].join('\n');
const syntax = ts.createSourceFile('basic-info-preview.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
if (syntax.parseDiagnostics.length) throw new Error('Invalid BasicInfo fixture: ' + syntax.parseDiagnostics.map(diagnostic => diagnostic.messageText).join('; '));
await writeFile('generated/basic-info-preview.js', js);
await writeFile('generated/basic-info-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
const fields = [['hp', 'HP'], ['maxhp', 'HP 上限'], ['sp', 'SP'], ['maxsp', 'SP 上限'], ['ap', 'AP'], ['maxap', 'AP 上限'], ['blvl', 'Base Lv'], ['jlvl', 'Job Lv'], ['bexp', 'Base EXP %'], ['jexp', 'Job EXP %'], ['weight', '负重原始值'], ['maxweight', '负重上限原始值'], ['zeny', '金币']];
await writeFile('generated/basic-info-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LASTRO 原生基本信息预览</title><link rel="stylesheet" href="/fonts/misans.css">
<style>body{margin:0;padding:16px;background:#34423b;color:#eaf2ed;font:400 12px/1.2 Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size-adjust:none;font-synthesis:none}header,main{max-width:1100px;margin:auto}h1{font-size:18px;font-weight:400;margin:0 0 8px}h2{font-size:13px;font-weight:400;margin:0 0 10px}nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center}button,select,input{font:inherit}#windows{display:grid;grid-template-columns:max-content max-content;gap:24px;margin-top:16px}article{padding:12px;background:#27352b;border-radius:4px}article[hidden]{display:none}.plane{position:relative;background:linear-gradient(115deg,#766645,#344c37);min-width:240px;min-height:320px}details{margin:10px 0}#fields{display:flex;gap:8px;flex-wrap:wrap;padding:10px 0}#fields label{display:grid;gap:3px}input{width:88px}#assets{color:#ffd0b8;white-space:pre-wrap}#state{margin-left:8px}@media(max-width:850px){#windows{display:block}article{width:fit-content;margin-bottom:16px}}</style>
<header><h1>原生基本信息 · 展开 / 折叠预览</h1><nav><select id="version"><option value="BasicInfoV4">BasicInfoV4（当前普通职业）</option><option value="BasicInfoV5">BasicInfoV5（四转 / AP）</option></select><button id="toggle">展开 / 折叠</button><button id="toolbar">显示 / 收起菜单</button><button data-preset="normal">截图状态</button><button data-preset="low">低 HP / SP</button><button data-preset="full">满值 / 高负重</button><span id="state"></span></nav><details><summary>本地状态更新</summary><div id="fields">${fields.map(([name, label]) => `<label>${label}<input type="number" min="0" step="any" data-field="${name}"></label>`).join('')}</div></details><p id="assets">${failures.join('\n')}</p></header><main id="windows"></main>
<script type="module" src="./basic-info-preview.js"></script></html>`);
console.log('Native BasicInfo artwork: ' + Object.keys(manifest).length + '/' + assets.size);
if (failures.length) console.warn(failures.join('\n'));
console.log('Source SHA256: ' + sourceHash);
console.log('Preview: /generated/basic-info-preview.html');
