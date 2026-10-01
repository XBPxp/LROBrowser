// Small, offline layout fixture with actual native templates, CSS, and elements.
import { readFile, writeFile } from 'node:fs/promises';
import console from 'node:console';
import ts from 'typescript';
import { patchRuntimeUiLayout } from './lastro-ui-layout.mjs';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const source = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const values = {}, elements = {};
let dataAttrsMethod, cartResize, addSkillMini, addSkillBig, escapeHtml;
const skillSelectors = [];
function visit(node) {
  if (ts.isBinaryExpression(node) && node.left.getText(source) === 'Common_default$1' && ts.isStringLiteral(node.right)) values.common = node.right.text;
  if (ts.isBinaryExpression(node) && ['UIButton', 'UIText', 'UIImage'].includes(node.left.getText(source)) && ts.isClassExpression(node.right)) elements[node.left.getText(source)] = node.right.getText(source);
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'processDataAttrs') dataAttrsMethod = node.getText(source).replace(/^static\s+/, '');
  if (ts.isBinaryExpression(node) && node.left.getText(source) === 'CartItems.resize' && ts.isFunctionExpression(node.right)) cartResize = node.right.getText(source);
  if (ts.isBinaryExpression(node) && node.left.getText(source) === 'Component.addSkillMini' && ts.isFunctionExpression(node.right)) addSkillMini = node.right.getText(source);
  if (ts.isBinaryExpression(node) && node.left.getText(source) === 'Component.addSkillBig' && ts.isFunctionExpression(node.right)) addSkillBig = node.right.getText(source);
  if (ts.isFunctionDeclaration(node) && ['skillLevelSelectUp', 'skillLevelSelectDown'].includes(node.name?.text) && node.parameters.length === 2) skillSelectors.push(node.getText(source));
  if (ts.isFunctionDeclaration(node) && node.name?.text === '_escapeHTML$2') escapeHtml = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (!values.common || !dataAttrsMethod || !cartResize || !addSkillMini || !addSkillBig || skillSelectors.length !== 2 || !escapeHtml || Object.keys(elements).length !== 3) throw new Error('Missing native layout dependencies');
const windows = [
  { name: 'CashShop', label: '商城', path: 'CashShop/CashShop', width: 723, height: 540 },
  { name: 'ChatRoomCreate', label: '创建聊天室', path: 'ChatRoomCreate/ChatRoomCreate', width: 280, height: 160 },
  { name: 'CartItems', label: '手推车', path: 'CartItems/CartItems', width: 247, height: 210 },
  { name: 'StorageV3', label: '仓库', path: 'Storage/StorageV3/Storage', width: 280, height: 340 },
  { name: 'InventoryV3', label: '物品栏', path: 'Inventory/InventoryV3/InventoryV3', width: 280, height: 230 },
  { name: 'SkillListV2', label: '技能列表', path: 'SkillList/SkillListV2/SkillListV2', width: 280, height: 390 },
  { name: 'SkillListV2Tree', label: '技能树', path: 'SkillList/SkillListV2/SkillListV2', width: 550, height: 435 },
  { name: 'SkillListV2Minimum', label: '技能列表 · 原生最小高度128', path: 'SkillList/SkillListV2/SkillListV2', width: 280, height: 306 },
  { name: 'ChatBoxSettings', label: '聊天记录设置', path: 'ChatBoxSettings/ChatBoxSettings', width: 255, height: 250 },
  { name: 'GraphicsOption', label: '图像设置 · 基本', path: 'GraphicsOption/GraphicsOption', width: 460, height: 300, natural: true },
  { name: 'GraphicsOptionAdvanced', label: '图像设置 · 高级', path: 'GraphicsOption/GraphicsOption', width: 520, height: 620, natural: true },
];
function getString(text, path, extension) {
  const region = new RegExp('//#region src/UI/Components/' + path + '\\.' + extension + '\\?raw\\r?\\n[\\s\\S]*?//#endregion').exec(text)?.[0];
  if (!region) throw new Error('Missing native region: ' + path + '.' + extension);
  const file = ts.createSourceFile('region.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let result;
  function find(node) { if (ts.isBinaryExpression(node) && ts.isStringLiteral(node.right)) result = node.right.text; ts.forEachChild(node, find); }
  find(file);
  if (result == null) throw new Error('Missing native literal');
  return result;
}
const patched = patchRuntimeUiLayout(runtime);
const assets = new Set(['item/mg_firebolt.bmp', 'item/al_heal.bmp', 'item/wz_jupitel.bmp', 'item/wz_earthspike.bmp', 'item/wz_meteor.bmp', 'item/wz_frostnova.bmp', 'item/mg_firewall.bmp', 'item/wz_stormgust.bmp', 'item/wz_heavendrive.bmp', 'item/hw_magicpower.bmp', 'basic_interface/arw_left.bmp', 'basic_interface/arw_right.bmp']);
for (const window of windows) {
  window.html = getString(runtime, window.path, 'html');
  // Keep a before/after comparison after prepare has integrated the same fix.
  window.css = getString(runtime, window.path, 'css').split('\n/* LASTRO scoped UI layout: ')[0];
  window.fixedCss = getString(patched, window.path, 'css');
  for (const match of window.html.matchAll(/(?:data-(?:background|hover|down|active)|bg|hover|down|src)="([^";]+\.bmp)"/g)) assets.add(match[1]);
  for (const match of window.html.matchAll(/data-preload="([^"]+)"/g)) for (const asset of match[1].split(';')) assets.add(asset);
}
const { manifest, failures } = await cacheNativeUiAssets([...assets], 'generated/ui-review-assets');
const messageLines = (await readFile('generated/core/data/msgstringtable.csv', 'utf8')).split(/\r?\n/);
const messages = Object.fromEntries(messageLines.map((line, index) => [index, line.slice(line.indexOf(line.includes('\t') ? '\t' : ',') + 1)]));

const fixture = String.raw`
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

const DB = { INTERFACE_PATH: '', getMessage: (id, fallback = '') => messages[id] || fallback };
const Client = {
  loadFile: (asset, done) => decodeBmp(asset).then(done).catch(assetError),
  loadFiles: (assets, done) => Promise.all(assets.map(decodeBmp)).then(values => done?.(...values)).catch(assetError),
};
const _Client = Client, _DB = DB;
const roots = [];
function nativeSkills(root) {
  const _btnIncSkill = root.querySelector('.content > .btn.levelup');
  _btnIncSkill.remove();
  const _points = 10, _rArrow = '', _lArrow = '', hasTabs = false, _list = [];
  const SkillInfo = {
    19: { SkillName: '火焰精灵之愤怒', Name: 'mg_firebolt', bSeperateLv: false },
    28: { SkillName: '古代神圣守护者的终极祝福', Name: 'al_heal', bSeperateLv: false },
    29: { SkillName: '冒险者觉醒的古代神圣守护者终极祝福', Name: 'al_heal', bSeperateLv: false },
  };
  const Component = {
    getRoot: () => root,
    parseHTML() { this.querySelectorAll('[data-background],[data-hover],[data-down]').forEach(GUIComponent.processDataAttrs); },
    onIncreaseSkill(id) { document.body.dataset.skillAction = 'increase:' + id; },
    onUpdateSkill() {},
  };
  // Its native closure contains only UI state for these local rows.
  const makeRow = NATIVE_SKILL_ROW_FACTORY;
  for (const SKID of [19, 28, 29]) makeRow.call(Component, { SKID, level: 10, type: 1, spcost: 20, upgradable: true });
}
function nativeSkillTree(root) {
  const SkillInfo = {
    1: { SkillName: '雷鸣术', Name: 'wz_jupitel', bSeperateLv: true },
    2: { SkillName: '地震术', Name: 'wz_earthspike', bSeperateLv: true },
    3: { SkillName: '火之猎杀', Name: 'wz_meteor', bSeperateLv: true },
    4: { SkillName: '火柱攻击', Name: 'mg_firebolt', bSeperateLv: false },
    5: { SkillName: '火狩芽', Name: 'mg_firewall', bSeperateLv: false },
    6: { SkillName: '霜冻之术', Name: 'wz_frostnova', bSeperateLv: true },
    7: { SkillName: '暴风雪', Name: 'wz_stormgust', bSeperateLv: true },
    8: { SkillName: '重力原野', Name: 'wz_heavendrive', bSeperateLv: true },
    9: { SkillName: '魔力增幅', Name: 'hw_magicpower', bSeperateLv: true },
  };
  const skillPosition = [{}, { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 7, 7: 14, 8: 15, 9: 16 }], hasTabs = true;
  const _rArrow = '', _lArrow = '', Component = { getRoot: () => root };
  const makeCell = NATIVE_SKILL_CELL_FACTORY;
  for (const [SKID, level] of [[1, 10], [2, 3], [3, 2], [4, 1], [5, 1], [6, 0], [7, 10], [8, 5], [9, 10]])
    makeCell.call(Component, { SKID, level, type: 1, upgradable: false });
  for (const [selector, asset] of [['.currentDown', 'basic_interface/arw_left.bmp'], ['.currentUp', 'basic_interface/arw_right.bmp']])
    decodeBmp(asset).then(image => root.querySelectorAll('.skillCol ' + selector).forEach(button => { button.style.backgroundImage = 'url("' + image + '")'; }));
}
function populate(root, name) {
  const set = (selector, text) => { const node = root.querySelector(selector); if (node) node.textContent = text; };
  if (name === 'CashShop') set('#cashpoint span', '2228');
  if (name === 'ChatRoomCreate') { root.querySelector('.title').value = '米德加尔特冒险交流聊天室'; root.querySelector('.password').value = 'password'; }
  if (name === 'CartItems') {
    set('.ncnt', '100'); set('.mcnt', '100'); set('.nwt', '7899'); set('.mwt', '8000');
  }
  if (name === 'StorageV3') { set('.current', '599'); set('.limit', '600'); root.querySelector('.search-input').value = '古老冒险者的华丽纪念徽章'; }
  if (name === 'InventoryV3') {
    // InventoryCommon.countLabel() includes this separator for V1/V2/V3.
    set('.ncnt', '599 / '); set('.mcnt', '600');
    root.querySelectorAll('.deallock_off,.deallock_on').forEach(node => node.classList.add('hidden'));
  }
  if (name === 'SkillListV2' || name === 'SkillListV2Minimum') {
    const height = name === 'SkillListV2Minimum' ? 128 : 320;
    root.querySelector('.contentbig').style.display = 'none';
    Object.assign(root.querySelector('.content').style, { display: 'block', width: '256px', height: height + 'px' });
    root.querySelector('#tab-1-mini').checked = true;
    // Native resize() assigns dimensions to the absolute mini tab panels.
    root.querySelectorAll('.tab-content-mini').forEach(node => Object.assign(node.style, { width: '256px', height: height + 'px' }));
    root.querySelector('.extend').style.display = '';
    root.querySelectorAll('.footer .btn').forEach(node => { node.style.display = 'none'; });
    nativeSkills(root);
  }
  if (name === 'SkillListV2Tree') {
    root.querySelector('.content').style.display = 'none';
    Object.assign(root.querySelector('.contentbig').style, { display: 'block', width: '544px', height: '384px' });
    root.querySelector('#tab-1').checked = true;
    root.querySelector('.extend').style.display = 'none';
    root.querySelectorAll('.footer .btn').forEach(node => { node.style.display = 'block'; });
    nativeSkillTree(root);
  }
  if (name === 'GraphicsOptionAdvanced') {
    root.querySelectorAll('.tab-content,.tab-button').forEach(node => node.classList.remove('selected'));
    root.querySelector('#advanced').classList.add('selected');
    root.querySelector('[data-tab="advanced"]').classList.add('selected');
  }
}
function rect(element) { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; }
function textRects(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const boxes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const box of range.getClientRects()) boxes.push({ text: node.textContent.trim(), x: box.x, y: box.y, right: box.right, bottom: box.bottom });
  }
  return boxes;
}
function metrics(root) {
  const selectors = ['.container', '.head', 'input.title', '.type', '.mode', '.footer', '.cnt', '.wt', '.search-input', '.search-button', '.storage-order-by', '.expand', '.ncnt', '.mcnt', '.droplock', '.compare', '.name', '.levelupcontainer', '.consume', '.content', '.contentbig', '.tab-content-mini', '.tab-label', '.tab-label-mini', '.titlebar .right', '.listoption button', '.tab-content.selected td', '.tab-button', '.skillCol .icon img', '.skillCol .selectable', '.skillCol .level', '.skillCol .currentDown', '.skillCol .currentUp'];
  const data = {};
  for (const selector of selectors) data[selector] = [...root.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width).map(node => ({ text: node.textContent, value: node.value, rect: rect(node), textRects: textRects(node), font: getComputedStyle(node).font, opacity: getComputedStyle(node).opacity, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  return data;
}
function report() {
  if (!previewFontsLoaded) return;
  document.body.dataset.geometry = JSON.stringify(roots.map(({ root, kind }) => ({ kind, data: metrics(root) })));
  document.body.dataset.fontReady = String(previewFontsLoaded);
}
function show(name) {
  roots.length = 0;
  const sample = windows.find(window => window.name === name);
  for (const kind of ['current', 'fixed']) {
    const plane = document.getElementById(kind); plane.replaceChildren();
    plane.style.height = sample.height + 'px'; plane.style.width = Math.max(300, sample.width + 20) + 'px';
    const host = document.createElement('div'); host.id = kind + '-' + name; Object.assign(host.style, { position: 'relative', color: '#000', width: sample.width + 'px', height: sample.height + 'px', top: '0px', left: '0px', fontFamily: "Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif", fontSizeAdjust: 'none' });
    if (sample.natural) Object.assign(host.style, { display: 'inline-block', width: 'max-content', height: 'auto' });
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = values.common + (kind === 'current' ? sample.css : sample.fixedCss);
    const container = document.createElement('div'); container.innerHTML = sample.html; root.append(style, container); plane.append(host);
    root.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
    if (name === 'CartItems') cartResize.call({ getRoot: () => root, _host: host }, 6, 4);
    populate(root, name);
    roots.push({ root, kind });
  }
  document.body.dataset.component = name;
  previewFontsReady.then(() => document.fonts.ready).then(() => requestAnimationFrame(report));
  Promise.all(Object.keys(manifest).map(decodeBmp)).then(() => { document.body.dataset.assetsReady = 'true'; report(); });
}
document.getElementById('component').addEventListener('change', event => show(event.target.value));
document.getElementById('measure').addEventListener('click', report);
document.getElementById('scale').addEventListener('change', event => {
  const scale = Number(event.target.value); document.getElementById('review').style.zoom = String(scale); document.body.dataset.scale = String(scale); requestAnimationFrame(report);
});
show('ChatRoomCreate');
`;
const js = [
  'import { setLastROInnerHTML } from "./ui-review-trusted-dom.mjs";',
  'const windows = ' + JSON.stringify(windows) + ';', 'const values = ' + JSON.stringify(values) + ';',
  'const manifest = ' + JSON.stringify(manifest) + ';', 'const messages = ' + JSON.stringify(messages) + ';',
  'const assetDirectory = "ui-review-assets";', NATIVE_BMP_PREVIEW_SOURCE,
  'const GUIComponent = {' + dataAttrsMethod + '};',
  'const cartResize = ' + cartResize + ';',
  escapeHtml,
  ...skillSelectors,
  fixture.split('const roots = [];')[0],
  ...Object.entries(elements).map(([name, code]) => 'customElements.define(' + JSON.stringify({ UIButton: 'ui-button', UIText: 'ui-text', UIImage: 'ui-image' }[name]) + ', ' + code + ');'),
  'const roots = [];', fixture.split('const roots = [];')[1].replace('NATIVE_SKILL_ROW_FACTORY', addSkillMini).replace('NATIVE_SKILL_CELL_FACTORY', addSkillBig),
].join('\n');
await writeFile('generated/ui-review-preview.js', js);
await writeFile('generated/ui-review-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
await writeFile('generated/ui-review-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LASTRO 原生窗口布局复核</title>
<link rel="stylesheet" href="/fonts/misans.css">
<style>body{margin:0;padding:16px;background:#27333c;color:#edf5fa;font-family:Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size:12px;font-size-adjust:none;line-height:1.2}header{font-size:14px;font-size-adjust:none}h1{font-size:19px;margin:0 0 10px}.controls{display:flex;gap:8px}#review{display:flex;align-items:start;gap:50px;margin-top:20px;padding-bottom:20px}h2{font-size:14px;font-size-adjust:none}.plane{position:relative}#assets{white-space:pre-wrap;color:#ffc4b2}select,header button{font:inherit}</style>
<header><h1>LASTRO · 原生窗口布局复核</h1><div class="controls"><select id="component">${windows.map(window => `<option value="${window.name}">${window.label}</option>`).join('')}</select><select id="scale"><option value="1">100%</option><option value="1.5">150%</option></select><button id="measure">记录文字与控件尺寸</button></div><p id="assets">${failures.join('\n')}</p></header><main id="review"><section><h2>原生布局</h2><div class="plane" id="current"></div></section><section><h2>修复后布局</h2><div class="plane" id="fixed"></div></section></main><script type="module" src="./ui-review-preview.js"></script></html>`);
console.log('Native layout artwork: ' + Object.keys(manifest).length + '/' + assets.size);
if (failures.length) console.warn(failures.join('\n'));
console.log('Preview: /generated/ui-review-preview.html');
