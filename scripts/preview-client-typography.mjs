// Offline typography QA: generated native templates, styles, data attributes,
// and safe numeric UI updates. No game initialization or network packets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import console from 'node:console';
import ts from 'typescript';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const source = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const wanted = new Set(['Common_default$1', 'BasicInfoV1_default$1', 'BasicInfoV1_default$2',
  'InventoryV3_default$1', 'InventoryV3_default$2', 'ChatBox_default$1', 'ChatBox_default$2']);
const values = {}, elements = {};
let dataAttrsMethod, uiMessages = {}, messageFactory, messageMethod, tableLoader;
function visit(node) {
  if (ts.isBinaryExpression(node) && wanted.has(node.left.getText(source)) && ts.isStringLiteral(node.right)) {
    const name = node.left.getText(source);
    values[name] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[name] ?? '') + node.right.text : node.right.text;
  }
  if (ts.isBinaryExpression(node) && ['UIButton', 'UIText', 'UIImage'].includes(node.left.getText(source)) && ts.isClassExpression(node.right)) {
    elements[node.left.getText(source)] = node.right.getText(source);
  }
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'processDataAttrs') dataAttrsMethod = node.getText(source).replace(/^static\s+/, '');
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'lastroUiMessages') uiMessages = JSON.parse(node.initializer.getText(source));
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'LastROUiMessages') messageFactory = node.initializer.getText(source);
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'getMessage') messageMethod = node.getText(source).replace(/^static\s+/, '');
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadTable') tableLoader = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of wanted) if (!values[name]) throw new Error('Missing native typography string: ' + name);
if (!dataAttrsMethod || !messageFactory || !messageMethod || !tableLoader || Object.keys(elements).length !== 3) throw new Error('Missing native typography elements');

function nativeRegion(path) {
  const begin = runtime.indexOf('//#region src/UI/Components/' + path + '.js');
  const end = runtime.indexOf('//#endregion', begin);
  if (begin < 0 || end < begin) throw new Error('Missing native typography region: ' + path);
  return ts.createSourceFile(path + '.js', runtime.slice(begin, end), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
function nativeMethods(path, names) {
  const ast = nativeRegion(path), methods = {};
  function collect(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) methods[node.name.text] = node.getText(ast);
    if (ts.isBinaryExpression(node) && names.includes(node.left.getText(ast)) && ts.isFunctionExpression(node.right)) methods[node.left.getText(ast)] = node.right.getText(ast);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  for (const name of names) if (!methods[name]) throw new Error('Missing native typography method: ' + name);
  return methods;
}
const basic = nativeMethods('BasicInfo/BasicInfoCommon', ['updateBar', 'Component.update']);
const inventory = nativeMethods('Inventory/InventoryCommon', ['Component.resize']);
const chat = nativeMethods('ChatBox/ChatBox', ['clampChatFontScale', 'ChatBox.applyFontScale']);
const windows = [
  { name: 'BasicInfoV1', label: '基本信息', width: 220, height: 171, html: values.BasicInfoV1_default$2, css: values.BasicInfoV1_default$1 },
  { name: 'InventoryV3', label: '物品栏', width: 279, height: 194, html: values.InventoryV3_default$2, css: values.InventoryV3_default$1 },
  { name: 'ChatBox', label: '聊天', width: 600, height: 191, html: values.ChatBox_default$2, css: values.ChatBox_default$1 },
];
const assets = new Set();
for (const sample of windows) {
  for (const match of sample.html.matchAll(/(?:data-(?:background|hover|down|active)|bg|hover|down|src)="([^";]+\.bmp)"/g)) assets.add(match[1]);
  for (const match of sample.html.matchAll(/data-preload="([^"]+)"/g)) for (const asset of match[1].split(';')) assets.add(asset);
}
const { manifest, failures } = await cacheNativeUiAssets([...assets], 'generated/client-typography-assets');
// Native DB loads the selected client's TXT first; its Chinese entries survive
// CSV loading. Reading only the Taiwanese CSV produces different visible labels.
const messagePath = 'generated/client-typography-assets/msgstringtable.txt';
let txtBytes;
try { txtBytes = await readFile(messagePath); }
catch {
  const roots = ['https://game.lastro.cn/ro/client_re/', 'https://rodata.ltsd.ro/ro/client_re/'];
  txtBytes = await Promise.any(roots.map(async root => {
    const response = await globalThis.fetch(root + 'data/msgstringtable.txt', { signal: globalThis.AbortSignal.timeout(15000), redirect: 'error', credentials: 'omit' });
    if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) throw new Error('Native message TXT unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('Invalid native message TXT');
    return bytes;
  }));
  await writeFile(messagePath, txtBytes);
}
const csvBytes = await readFile('generated/core/data/msgstringtable.csv');
const messageContext = vm.createContext({
  console, txtBytes, csvBytes,
  CodepageManager: { decode: (bytes, charset) => new globalThis.TextDecoder(charset || 'utf-8').decode(bytes) },
  Client: { loadFile: (_filename, done) => done(txtBytes) },
  userCharpage: 'gbk',
});
vm.runInContext('const LastROUiMessages = ' + messageFactory + ';\nconst MsgStringTable = {};\n' + tableLoader + '\n' +
  'loadTable("data/msgstringtable.txt", "#", 1, (id, value) => { MsgStringTable[id] = value; }, () => { LastROUiMessages.loadCsv(csvBytes, MsgStringTable, bytes => CodepageManager.decode(bytes, "utf-8")); }, true);\n' +
  'globalThis.messages = MsgStringTable;', messageContext);
const messages = messageContext.messages;

const setupSource = String.raw`
const MsgStringTable = messages;
const LastROUiMessages = NATIVE_MESSAGE_FACTORY;
const DB = { INTERFACE_PATH: '', NATIVE_MESSAGE_METHOD };
const Client = {
  loadFile: (asset, done) => decodeBmp(asset).then(done).catch(assetError),
  loadFiles: (assets, done) => Promise.all(assets.map(decodeBmp)).then(values => done?.(...values)).catch(assetError),
};
const _Client = Client, _DB = DB;
const samples = [];
let fontsReady = false, assetsReady = false, lastMetrics = null;
document.body.dataset.fontReady = 'false';
document.body.dataset.assetsReady = 'false';
const chatMapLinks = createLastroChatMapLinks({ setHtml: setLastROInnerHTML, showPrompt: () => undefined, teleport: () => {} });
function setAll(root, selector, text) { root.querySelectorAll(selector).forEach(node => { node.textContent = text; }); }
function fillBasic(root) {
  const Component = { getRoot: () => root };
  const SessionStorage_default = {};
  const barScale = 1.27, hasApBar = false;
  NATIVE_BASIC_BAR;
  Component.update = NATIVE_BASIC_UPDATE;
  Component.update('name', '熊本胖');
  setAll(root, '.job_value', '超级魔导师');
  Component.update('hp', 55559, 67265);
  Component.update('sp', 3640, 3640);
  Component.update('blvl', 99);
  Component.update('jlvl', 70);
  Component.update('bexp', 18, 100);
  Component.update('jexp', 100, 100);
  Component.update('weight', 42420, 47090);
  Component.update('zeny', 60480579);
}
function fillInventory(root, host) {
  const Component = { getRoot: () => root, _host: host, updateScroll() {} };
  const resizableHeight = false;
  Component.resize = NATIVE_INVENTORY_RESIZE;
  Component.resize(7, 4);
  // Native countLabel() includes ' / ' for V1/V2/V3 (favoriteTab=true).
  setAll(root, '.ncnt', '4 / '); setAll(root, '.mcnt', '100');
  root.querySelector('.item.tab').classList.add('selected');
}
function fillChat(root) {
  const row = root.querySelector('.header tr');
  for (const [name, active] of [[DB.getMessage(1291), true], [DB.getMessage(1292), false]]) {
    const tab = document.createElement('td'); tab.className = 'tab';
    const container = document.createElement('div'); if (active) container.className = 'on';
    const input = document.createElement('input'); input.type = 'text'; input.value = name; input.readOnly = true;
    container.append(input); tab.append(container); row.insertBefore(tab, row.querySelector('.opttab'));
  }
  const content = document.createElement('div'); content.className = 'content active';
  root.querySelector('.contentwrapper').append(content);
  for (const [text, color] of [
    ['当前为1线路支持离线战斗', '#95ef95'],
    ['经验倍率: 200.0%', '#95ef95'],
    ['掉宝倍率: 150.0%', '#95ef95'],
    ["[随机事件] 请注意!! 海边之都 克魔岛 城正在被魔物入侵 请勇士们消灭入侵者(<span class='mapname' data-map='cmd_fild01#100#184'>点击前往</span>)", '#ffd43b'],
    ['所有邀请组队被接受', '#ffff73'],
    ['离线反馈: 负重超过90%时，无法攻击和使用技能，自动丢弃、自动存、', '#fff'],
  ]) {
    const line = document.createElement('div'); line.style.color = color;
    chatMapLinks.render(line, text); content.append(line);
  }
  root.querySelector('.contentwrapper').style.height = '126px';
  root.querySelector('.username').value = DB.getMessage(85) || '';
  const ChatBox = {}, _preferences$41 = { fontScale: 1 };
  function _root$18() { return root; }
  NATIVE_CHAT_FONT_CLAMP;
  ChatBox.applyFontScale = NATIVE_CHAT_FONT_SCALE;
  ChatBox.applyFontScale();
}
function mount(name, scale) {
  const sample = windows.find(window => window.name === name);
  const slot = document.querySelector('[data-sample="' + name + '"][data-scale="' + scale + '"]');
  const plane = document.createElement('div'); plane.className = 'plane';
  plane.style.width = sample.width * scale + 'px'; plane.style.height = sample.height * scale + 'px';
  const host = document.createElement('div'); host.className = 'native-host';
  Object.assign(host.style, { position: 'relative', left: '0px', top: '0px', width: sample.width + 'px', height: sample.height + 'px', zoom: String(scale), color: '#000' });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = commonCss + sample.css;
  const container = document.createElement('div'); setLastROInnerHTML(container, sample.html);
  root.append(style, container); plane.append(host); slot.append(plane);
  root.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
  if (name === 'BasicInfoV1') fillBasic(root);
  if (name === 'InventoryV3') fillInventory(root, host);
  if (name === 'ChatBox') fillChat(root);
  samples.push({ name, scale, root, host });
}
function rect(element) {
  const box = element.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
}
function textBoxes(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), boxes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const box of range.getClientRects()) if (box.width && box.height) boxes.push({ text: node.textContent, x: box.x, y: box.y, right: box.right, bottom: box.bottom });
  }
  return boxes;
}
const coreSelectors = {
  BasicInfoV1: ['.large .title', '.large .name', '.large .job', '.hp_title', '.sp_title', '.hp_bar_perc', '.sp_bar_perc', '.hp_perc', '.sp_perc', '.large .blvl', '.large .jlvl', '.large .extra'],
  InventoryV3: ['.titlebar .text', '.tabs .tab', '.footer', '.ncnt', '.mcnt', '.droplock', '.compare', '.extend'],
  ChatBox: ['.header .tab input', '.content > div', '.content .mapname', '.username', '.input-chatbox'],
};
function measure() {
  if (!fontsReady || !assetsReady) return lastMetrics;
  const results = samples.map(({ name, scale, root, host }) => {
    const panel = rect(root.querySelector(name === 'ChatBox' ? '#chatbox' : '#' + name));
    const nodes = coreSelectors[name].flatMap(selector => [...root.querySelectorAll(selector)].map(element => {
      const style = getComputedStyle(element), box = rect(element);
      return { selector, text: element.value ?? element.textContent.trim(), rect: box, textRects: textBoxes(element), fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontSize: style.fontSize, fontSizeAdjust: style.fontSizeAdjust, fontSynthesis: style.fontSynthesis, lineHeight: style.lineHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: style.overflowX };
    }).filter(node => node.rect.width && node.rect.height));
    const controlOverflow = nodes.filter(node => node.rect.x < panel.x - 1 || node.rect.right > panel.right + 1);
    const textOverflow = nodes.filter(node => node.textRects.some(box => box.x < panel.x - 1 || box.right > panel.right + 1));
    return { name, scale, host: rect(host), panel, nodes, controlOverflow, textOverflow };
  });
  lastMetrics = { sourceHash, fontReady: fontsReady, assetsReady, fontWeightLoaded: 400, samples: results };
  document.body.dataset.typography = JSON.stringify(lastMetrics);
  document.body.dataset.fontWeights = JSON.stringify(results.map(sample => ({ name: sample.name, scale: sample.scale, nodes: sample.nodes.map(node => ({ selector: node.selector, weight: node.fontWeight, size: node.fontSize })) })));
  document.body.dataset.controlOverflow = String(results.reduce((count, sample) => count + sample.controlOverflow.length, 0));
  document.body.dataset.textOverflow = String(results.reduce((count, sample) => count + sample.textOverflow.length, 0));
  return lastMetrics;
}
Object.defineProperty(window, 'lastroClientTypographyQA', { configurable: false, writable: false, value: Object.freeze({
  get metrics() { return lastMetrics ? structuredClone(lastMetrics) : null; },
  get sourceHash() { return sourceHash; },
}) });
for (const sample of windows) for (const scale of [1, 1.5]) mount(sample.name, scale);
document.fonts.load('400 12px "MiSans"', '熊本胖 超级魔导师 基本信息 物品栏 活动传送 负重 职业等级 0123456789 HP SP Base Lv Job Lv').then(async faces => {
  await document.fonts.ready;
  fontsReady = faces.some(face => face.family.replace(/["']/g, '') === 'MiSans' && face.status === 'loaded') && document.fonts.check('400 12px "MiSans"');
  document.body.dataset.fontReady = String(fontsReady);
  if (!fontsReady) document.body.dataset.fontFailure = 'MiSans 400 字体未加载';
  requestAnimationFrame(measure);
}).catch(error => { document.body.dataset.fontFailure = error.message; });
Promise.all(Object.keys(manifest).map(decodeBmp)).then(() => {
  assetsReady = true; document.body.dataset.assetsReady = 'true'; requestAnimationFrame(measure);
}).catch(assetError);
window.addEventListener('resize', () => requestAnimationFrame(measure));
`;
const fixtureSource = setupSource
  .replace('NATIVE_MESSAGE_FACTORY', messageFactory)
  .replace('NATIVE_MESSAGE_METHOD', messageMethod)
  .replace('NATIVE_BASIC_BAR;', basic.updateBar)
  .replace('NATIVE_BASIC_UPDATE', basic['Component.update'])
  .replace('NATIVE_INVENTORY_RESIZE', inventory['Component.resize'])
  .replace('NATIVE_CHAT_FONT_CLAMP;', chat.clampChatFontScale)
  .replace('NATIVE_CHAT_FONT_SCALE', chat['ChatBox.applyFontScale']);
const setupBoundary = fixtureSource.indexOf('const samples = []');
const js = [
  'import { setLastROInnerHTML } from "./client-typography-trusted-dom.mjs";',
  'import { createLastroChatMapLinks } from "./client-typography-map-links.mjs";',
  'const windows = ' + JSON.stringify(windows) + ';',
  'const sourceHash = ' + JSON.stringify(sourceHash) + ';',
  'const commonCss = ' + JSON.stringify(values.Common_default$1) + ';',
  'const manifest = ' + JSON.stringify(manifest) + ';',
  'const messages = ' + JSON.stringify(messages) + ';',
  'const lastroUiMessages = ' + JSON.stringify(uiMessages) + ';',
  'const assetDirectory = "client-typography-assets";', NATIVE_BMP_PREVIEW_SOURCE,
  fixtureSource.slice(0, setupBoundary),
  'const GUIComponent = {' + dataAttrsMethod + '};',
  ...Object.entries(elements).map(([name, code]) => 'customElements.define(' + JSON.stringify({ UIButton: 'ui-button', UIText: 'ui-text', UIImage: 'ui-image' }[name]) + ', ' + code + ');'),
  fixtureSource.slice(setupBoundary),
].join('\n');
const syntax = ts.createSourceFile('typography-preview.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
if (syntax.parseDiagnostics.length) throw new Error('Invalid typography fixture: ' + syntax.parseDiagnostics.map(diagnostic => diagnostic.messageText).join('; '));
await mkdir('generated', { recursive: true });
await writeFile('generated/client-typography-preview.js', js);
await writeFile('generated/client-typography-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
await writeFile('generated/client-typography-map-links.mjs', await readFile('scripts/lastro-chat-map-links.mjs', 'utf8'));
const card = (sample, scale) => `<article data-sample="${sample.name}" data-scale="${scale}"><h3>${sample.label} · ${scale * 100}%</h3></article>`;
await writeFile('generated/client-typography-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LASTRO 原生窗口字体预览</title>
<link rel="stylesheet" href="/fonts/misans.css">
<style>body{margin:0;padding:16px;background:#34423b;color:#eaf2ed;font:400 12px/1.2 Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size-adjust:none;font-synthesis:none}header,main{max-width:1530px;margin:auto}h1{font-size:18px;font-weight:400;margin:0 0 8px}h2,h3{font-size:13px;font-weight:400;margin:0 0 8px}header{margin-bottom:16px}.columns{display:grid;grid-template-columns:310px 465px;gap:16px 24px;margin-bottom:16px}article{padding:12px;background:#27352b;border-radius:4px;width:fit-content}.plane{position:relative;background:linear-gradient(115deg,#766645,#344c37);border-radius:2px}.native-host{font-size:12px;line-height:1.2}.chat-columns{grid-template-columns:600px 900px}#assets{white-space:pre-wrap;color:#ffd0b8}@media(max-width:1575px){.chat-columns{display:block}.chat-columns article{margin-bottom:16px}}@media(max-width:850px){.columns{display:block}.columns article{margin-bottom:16px}}</style>
<header><h1>LASTRO · 原生窗口字体预览</h1><h2>最终生成模板与 CSS · Arial / 微软雅黑常规 400 · 100% / 150%</h2><p id="assets">${failures.join('\n')}</p></header>
<main><section class="columns">${windows.filter(sample => sample.name !== 'ChatBox').map(sample => [1, 1.5].map(scale => card(sample, scale)).join('')).join('')}</section><section class="columns chat-columns">${[1, 1.5].map(scale => card(windows[2], scale)).join('')}</section></main>
<script type="module" src="./client-typography-preview.js"></script></html>`);
console.log('Native typography artwork: ' + Object.keys(manifest).length + '/' + assets.size);
if (failures.length) console.warn(failures.join('\n'));
console.log('Source SHA256: ' + sourceHash);
console.log('Preview: /generated/client-typography-preview.html');
