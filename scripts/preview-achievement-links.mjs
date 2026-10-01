// Offline QA extracts the generated native achievement window and prompt.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { URL } from 'node:url';
import console from 'node:console';
import { build } from 'esbuild';
import ts from 'typescript';
import { NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const file = ts.createSourceFile('Achievement.preview.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = new Set(['Common_default$1', 'Achievement_default$1', 'Achievement_default$2', 'WinPopup_default$1', 'WinPopup_default$2']);
const values = {}, elements = {}, gui = {}, helpers = {};
let nativeClass, installer, promptMethod;
function visit(node) {
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind)) {
    const name = node.left.getText(file);
    if (wanted.has(name) && ts.isStringLiteral(node.right)) values[name] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[name] || '') + node.right.text : node.right.text;
    if (name === 'AchievementComponent' && ts.isClassExpression(node.right)) nativeClass = node.right.getText(file);
    if (['UIButton', 'UIImage', 'UIText'].includes(name) && ts.isClassExpression(node.right)) elements[name] = node.right.getText(file);
  }
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name?.text === 'installLastroAchievementLinks') installer = node.getText(file);
  if (ts.isFunctionDeclaration(node) && ['getAchievementRewardInfo', 'hasAchievementReward', '_popupPosition', '_createButton',
    'lastroUiInputFrame', 'lastroUiLogicalPointer', 'lastroUiDragBounds', 'UIClamp'].includes(node.name?.text)) helpers[node.name.text] = node.getText(file);
  if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'showPromptBox') promptMethod = node.getText(file).replace(/^static\s+/, '');
  if (ts.isMethodDeclaration(node) && node.parent.name?.getText(file) === 'GUIComponent'
    && ['processDataAttrs', 'draggable', 'clone', '_bindKeyDown', '_unbindKeyDown', '_fixPositionOverflow'].includes(node.name.getText(file))) gui[node.name.getText(file)] = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
for (const name of wanted) if (!values[name]) throw new Error('Missing native template/CSS: ' + name);
if (!nativeClass || !installer || !promptMethod || Object.keys(elements).length !== 3 || Object.keys(gui).length !== 6
  || Object.keys(helpers).length !== 8 || !nativeClass.includes('this._lastroAchievementLinks.render'))
  throw new Error('Build the final achievement-links runtime before generating this preview');

// Extract these real, plain-literal entries without executing Lua or modifying GBK text.
const lua = new TextDecoder('gbk', { fatal: true }).decode(await readFile('vendor/core/System/achievement_list_cn2_06.lua'));
function entry(id) {
  const start = lua.indexOf('[' + id + '] = {');
  if (start < 0) throw new Error('Missing native achievement: ' + id);
  const next = lua.slice(start + 1).search(/\n\[\d{5,}\]\s*=/);
  const raw = lua.slice(start, next < 0 ? undefined : start + 1 + next);
  const string = name => {
    const match = raw.match(new RegExp('\\b' + name + '\\s*=\\s*("(?:\\\\.|[^"\\\\])*")'));
    if (!match) throw new Error('Missing native achievement field: ' + id + ':' + name);
    return JSON.parse(match[1]);
  };
  const number = name => Number(raw.match(new RegExp('\\b' + name + '\\s*=\\s*(\\d+)'))?.[1] || 0);
  return { UI_Type: number('UI_Type'), group: string('group'), major: number('major'), minor: number('minor'), title: string('title'),
    content: { summary: string('summary'), details: string('details') }, resource: { 1: { text: string('text'), count: number('count') } }, reward: {}, score: number('score') };
}
const table = Object.fromEntries([120083, 140001, 130001].map(id => [id, entry(id)]));
const messages = (await readFile('vendor/core/data/msgstringtable.csv', 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/)
  .map(line => line.slice(line.indexOf(',') + 1));
const assets = new Set(['win_msgbox.bmp', 'btn_ok.bmp', 'btn_ok_a.bmp', 'btn_ok_b.bmp', 'btn_cancel.bmp', 'btn_cancel_a.bmp', 'btn_cancel_b.bmp']);
for (const text of Object.values(values)) for (const match of text.matchAll(/(?:data-(?:background|hover|down|active)|bg|hover|down|src)="([^"]+\.bmp)"/g)) assets.add(match[1]);
for (const match of nativeClass.matchAll(/["'](achievement_re\/[^"'${}\r\n]+\.bmp)["']/g)) assets.add(match[1]);
for (const info of Object.values(table)) assets.add('achievement_re/icon_' + info.group.toLowerCase() + '.bmp');
const directory = 'generated/achievement-links-assets';
await mkdir(directory, { recursive: true });
const caches = [], manifest = {}, failures = [];
for (const name of await readdir('generated')) if (name.endsWith('-assets')) {
  try { caches.push({ directory: 'generated/' + name, manifest: JSON.parse(await readFile('generated/' + name + '/index.json', 'utf8')) }); }
  catch { /* Some diagnostic directories contain no UI manifest. */ }
}
let resolver;
await Promise.all([...assets].map(async asset => {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  try {
    let bytes;
    for (const cache of caches) {
      if (!cache.manifest[asset]) continue;
      try { const data = await readFile(cache.directory + '/' + cache.manifest[asset]); if (data[0] === 66 && data[1] === 77) { bytes = data; break; } }
      catch { /* Check another existing offline cache. */ }
    }
    if (!bytes) {
      resolver ||= build({ entryPoints: ['src/resources/resource-resolver.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
        .then(result => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')));
      const resources = await resolver;
      const path = resources.buildResourcePathCandidates('data/texture/유저인터페이스/' + asset)[0];
      const controller = new globalThis.AbortController(), deadline = globalThis.setTimeout(() => controller.abort(), 10000);
      try {
        bytes = await Promise.any(resources.DEFAULT_RESOURCE_ROOTS.map(async root => {
          const url = new URL(path, root);
          if (!['https://game.lastro.cn', 'https://rodata.ltsd.ro'].includes(url.origin)) throw new Error('Unexpected passive artwork origin');
          const response = await globalThis.fetch(url, { signal: controller.signal, redirect: 'error' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = new Uint8Array(await response.arrayBuffer());
          if (data[0] !== 66 || data[1] !== 77) throw new Error('Invalid BMP');
          return data;
        }));
      } finally { globalThis.clearTimeout(deadline); controller.abort(); }
    }
    await writeFile(directory + '/' + filename, bytes); manifest[asset] = filename;
  } catch { failures.push(asset + ': native artwork unavailable within 10 seconds'); }
}));
await writeFile(directory + '/index.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile('generated/achievement-links-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));

const fixture = String.raw`
import { setLastROInnerHTML } from './achievement-links-trusted-dom.mjs';
const values = VALUES, table = TABLE, messages = MESSAGES, manifest = MANIFEST, sourceHash = SOURCE_HASH;
const assetDirectory = 'achievement-links-assets';
const Achievement_default$1 = values.Achievement_default$1, Achievement_default$2 = values.Achievement_default$2;
NATIVE_BMP
const plane = document.querySelector('#native-plane');
const errors = [], checks = [], teleports = [], monsters = [], nativePackets = [], events = [];
let generation = 0, currentMap = 'prontera', failMode = false, activePrompt = null, fontReady = false, assetsReady = false, topIndex = 50;
let MAJOR_CATEGORIES = [], _snapCache = [];
const _preferences$28 = { x: 40, y: 28, save() {} };
const SessionStorage_default = { Achievement: { rank: 1, total_points: 25, current_rank_points: 25, next_rank_points: 100,
  list: Object.fromEntries(Object.keys(table).map(id => [id, { completed: false, count: [2] }])) } };
const DB = { INTERFACE_PATH: '', getMessage: (id, fallback = '') => messages[Number(id)] || fallback,
  getAchievementTable: () => table, getTitleString: () => '', getSkillName: () => '', getItemInfo: () => null };
const Client = { loadFile: (asset, done, failed) => decodeBmp(asset).then(done).catch(error => { if (failed) failed(error); else assetError(error); }),
  loadFiles: (files, done) => Promise.all(files.map(decodeBmp)).then(result => done?.(...result)).catch(assetError) };
const _Client = Client, _DB = DB, _Renderer = { get width() { return innerWidth; }, get height() { return innerHeight; } }, UI_default = { windowmagnet: false };
const Mouse = { screen: { x: 0, y: 0 } };
for (const type of ['mousemove', 'mousedown']) window.addEventListener(type, event => { Mouse.screen.x = event.pageX; Mouse.screen.y = event.pageY; }, true);
const PACKET = { CZ: { REQ_ACH_REWARD: class REQ_ACH_REWARD {} } };
const Network = { sendPacket: packet => { nativePackets.push({ name: packet.constructor.name, ...packet, blocked: true }); report(); } };
const ItemInfo_default = { uid: null, append() {}, remove() {}, setItem() {} };
function lastroUiWindowAppend(_component, _preferences, append) { return append(); }
NATIVE_HELPERS
class GUIComponent {
  NATIVE_GUI
  constructor(name, css) { this.name = name; this._cssText = css; this.__active = false; this.__loaded = false; this.magnet = {}; }
  getRoot() { return this._shadow; }
  prepare() {
    if (this.__loaded) return;
    this._host = document.createElement('div'); this._host.id = this.name;
    Object.assign(this._host.style, { position: 'absolute', fontSize: '12px', lineHeight: '1.2', zIndex: '50' });
    this._shadow = this._host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = values.Common_default$1 + this._cssText;
    this._container = document.createElement('div'); this._container.className = 'ui-component-root'; setLastROInnerHTML(this._container, this.render());
    this._shadow.append(style, this._container); plane.append(this._host); this.__loaded = true;
    this._shadow.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
    this.init?.(); this._host.remove();
  }
  append() { this.prepare(); plane.append(this._host); this.__active = true; this.focus(); this.onAppend?.(); this._bindKeyDown(); }
  remove() {
    this.__active = false; this.onRemove?.(); this._unbindKeyDown();
    this._shadow?.querySelectorAll('*').forEach(node => node.dispatchEvent(new Event('x_remove')));
    this._host?.remove(); report();
  }
  focus() { this._host.style.zIndex = String(++topIndex); }
}
NATIVE_ELEMENTS
const WinPopup = new GUIComponent('WinPopup', values.WinPopup_default$1); WinPopup.render = () => values.WinPopup_default$2;
const UIManager = { getComponent: () => WinPopup, NATIVE_PROMPT };
const AchievementComponent = NATIVE_CLASS;
const component = new AchievementComponent();
(NATIVE_INSTALLER)(component, {
  mapLabel: map => map === 'ra_fild05' ? '奥顿拉草原区域5' : map,
  showPrompt: (message, yes, no) => {
    events.push({ type: 'prompt', message });
    activePrompt = UIManager.showPromptBox(message, 'ok', 'cancel', () => { events.push({ type: 'yes' }); yes(); report(); }, () => { events.push({ type: 'no' }); no(); report(); });
    const removed = activePrompt.onRemove; activePrompt.onRemove = function (...args) { events.push({ type: 'promptRemoved' }); const value = removed?.apply(this, args); report(); return value; };
    report(); return activePrompt;
  },
  showMonster: name => { monsters.push({ name }); events.push({ type: 'monster', name }); report(); },
  cancelPending: () => { generation++; report(); },
  teleport: async map => {
    const version = ++generation, sourceMap = currentMap, check = { map, status: 'pending' }; checks.push(check); report();
    await new Promise(resolve => setTimeout(resolve, 300));
    if (version !== generation || sourceMap !== currentMap || !component._lastroAchievementLinks.canSend(map)) { check.status = 'cancelled'; report(); return false; }
    if (failMode) { check.status = 'failed'; report(); throw new Error('模拟：地图资源预检失败'); }
    check.status = 'approved'; teleports.push({ mapname: map, type: 0, x: 0, y: 0, itemid: 14527, offline: true }); report(); return true;
  },
  onError: error => { errors.push(error.message); report(); },
});
function select(id) {
  const info = table[id];
  if (!component.__active || component._host.style.display === 'none') component.toggle();
  const tab = component.getRoot().querySelectorAll('.major-tab')[info.major]; tab.click();
  const item = [...component.getRoot().querySelectorAll('.ach-item')].find(node => node.querySelector('.title')?.textContent === info.title);
  if (!item) throw new Error('Native achievement list did not create row: ' + id);
  item.click(); report();
}
let reporting = false;
function report() {
  if (reporting) return; reporting = true;
  requestAnimationFrame(() => {
    reporting = false;
    const root = component.getRoot(), visible = !!(component.__active && component._host?.isConnected && component._host.style.display !== 'none');
    const promptVisible = !!(activePrompt?.__active && activePrompt._host?.isConnected);
    const links = [...root?.querySelectorAll('a.lastro-achievement-link') || []].map(link => ({ label: link.textContent, kind: link.dataset.kind, target: link.dataset.target, busy: link.hasAttribute('aria-busy') }));
    const box = node => { const rect = node?.getBoundingClientRect(); return rect && { left: rect.left, top: rect.top, width: rect.width, height: rect.height, position: getComputedStyle(node).position }; };
    const latest = { sourceHash, wire: 0, selected: component.selectedAchId, visible, promptVisible,
      layout: { host: box(component._host), header: box(root?.querySelector('.header')), sidebar: box(root?.querySelector('.sidebar')), list: box(root?.querySelector('.pane-listd')), detail: box(root?.querySelector('.detail-view')) },
      promptText: activePrompt?.getRoot().querySelector('.text')?.textContent || '', details: root?.querySelector('.js-d-desc')?.textContent || '',
      goals: root?.querySelector('.js-d-goals')?.textContent || '', links, currentMap, failMode, checks: [...checks], teleports: [...teleports],
      monsters: [...monsters], errors: [...errors], nativePackets: [...nativePackets], events: [...events], assetsReady, fontReady };
    Object.assign(document.body.dataset, { ready: 'true', wire: '0', sourceHash, selected: String(latest.selected),
      visible: String(visible), promptVisible: String(promptVisible), teleports: JSON.stringify(teleports), teleportCount: String(teleports.length),
      monsters: JSON.stringify(monsters), monsterCount: String(monsters.length), checks: JSON.stringify(checks), errors: JSON.stringify(errors),
      links: JSON.stringify(links), metrics: JSON.stringify(latest), assetsReady: String(assetsReady), fontReady: String(fontReady) });
    document.querySelector('#metrics').textContent = JSON.stringify(latest, null, 2);
  });
}
window.addEventListener('error', event => { document.body.dataset.fixtureError = event.message; document.querySelector('#status').textContent = event.message; });
window.addEventListener('unhandledrejection', event => { document.body.dataset.fixtureError = String(event.reason); });
document.querySelector('#show-map').addEventListener('click', () => select(120083));
document.querySelector('#show-monster').addEventListener('click', () => select(140001));
document.querySelector('#show-item').addEventListener('click', () => select(130001));
document.querySelector('#close').addEventListener('click', () => { component.getRoot().querySelector('.close').click(); report(); });
document.querySelector('#failure').addEventListener('click', event => { failMode = !failMode; event.currentTarget.textContent = '预检失败：' + (failMode ? '开' : '关'); report(); });
document.querySelector('#map-change').addEventListener('click', () => { currentMap = currentMap === 'prontera' ? 'geffen' : 'prontera'; component._lastroAchievementLinks.invalidate(); report(); });
document.querySelector('#restore').addEventListener('click', () => {
  component._lastroAchievementLinks.invalidate(); checks.length = teleports.length = monsters.length = errors.length = nativePackets.length = events.length = 0;
  select(120083);
});
component.prepare(); select(120083);
new MutationObserver(report).observe(component.getRoot(), { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'style'] });
await Promise.allSettled([400, 500, 700].map(weight => document.fonts.load(weight + ' 12px MiSans', '成就奥顿拉蝎子'))); fontReady = true;
await Promise.allSettled(Object.keys(manifest).map(decodeBmp)); assetsReady = true; report();
`;
const replacements = { VALUES: JSON.stringify(values), TABLE: JSON.stringify(table), MESSAGES: JSON.stringify(messages), MANIFEST: JSON.stringify(manifest),
  SOURCE_HASH: JSON.stringify(sourceHash), NATIVE_BMP: NATIVE_BMP_PREVIEW_SOURCE, NATIVE_HELPERS: Object.values(helpers).join('\n'),
  NATIVE_GUI: Object.values(gui).join('\n'), NATIVE_ELEMENTS: Object.entries(elements).map(([name, text]) => 'customElements.define(' + JSON.stringify(name === 'UIButton' ? 'ui-button' : name === 'UIImage' ? 'ui-image' : 'ui-text') + ', ' + text + ');').join('\n'),
  NATIVE_PROMPT: promptMethod, NATIVE_CLASS: nativeClass, NATIVE_INSTALLER: installer };
const js = fixture.replace(/\b(?:VALUES|TABLE|MESSAGES|MANIFEST|SOURCE_HASH|NATIVE_BMP|NATIVE_HELPERS|NATIVE_GUI|NATIVE_ELEMENTS|NATIVE_PROMPT|NATIVE_CLASS|NATIVE_INSTALLER)\b/g, token => replacements[token]);
const syntax = ts.createSourceFile('achievement-links-preview.mjs', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
if (syntax.parseDiagnostics.length) throw new Error('Invalid generated achievement preview syntax');
await writeFile('generated/achievement-links-preview.mjs', js);
await writeFile('generated/achievement-links-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>成就链接离线验证</title><link rel="stylesheet" href="/fonts/misans.css">
<style>body{margin:0;background:#edf0ed;color:#222;font:400 12px/1.2 Arial,'Microsoft YaHei',MiSans,"LastRO Glyph Fallback",sans-serif}header{padding:10px;background:white}h1{font-size:16px;font-weight:400;margin:0 0 8px}nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button{font:inherit;min-height:26px}p{margin:8px 0 0}main{display:flex;flex-wrap:wrap;gap:12px;padding:12px}#viewport{flex:none;position:relative;width:1000px;height:600px;background:linear-gradient(20deg,#6c8154,#435944);overflow:hidden}#native-plane{position:absolute;inset:0}pre{font:11px/1.3 monospace;max-width:380px;max-height:600px;overflow:auto;margin:0}#assets{color:#900;white-space:pre-wrap}#assets:empty{display:none}</style>
<body><header><h1>原生成就窗口 · 链接离线验证</h1><nav><button id="show-map">原表 120083 · 地图</button><button id="show-monster">原表 140001 · 蝎子</button><button id="show-item">原表 130001 · 道具文案</button><button id="failure">预检失败：关</button><button id="close">关闭成就</button><button id="map-change">切换当前地图</button><button id="restore">清空记录并复原</button><span id="status"></span></nav><p>原始 GBK 文案与原生窗口。本页面不连接游戏服务器；确认后模拟 300ms 预检，仅记录传送和怪物搜索。</p><div id="assets">${failures.join('\n')}</div></header>
<main><div id="viewport"><div id="native-plane"></div></div><pre id="metrics"></pre></main><script type="module" src="./achievement-links-preview.mjs"></script></body></html>`);
console.log(JSON.stringify({ html: 'generated/achievement-links-preview.html', sourceHash, assets: Object.keys(manifest).length, failures, wire: 0 }, null, 2));
