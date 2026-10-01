// Offline QA: generated native quest factories and packet handlers, with local
// recorders for outgoing actions. No socket, worker, login or game connection.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';
import vm from 'node:vm';
import ts from 'typescript';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';
import { extractWorldMapFixture } from './extract-worldmap-fixture.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
if (!runtime.includes('/* lastro-quest-integration */')) throw new Error('Generated runtime lacks the final quest integration. Build it before generating this preview.');
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const worldMapFixture = extractWorldMapFixture(runtime);
const source = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = new Set(['Common_default$1', 'Quest_default$1', 'Quest_default$2', 'QuestV1_default$1', 'QuestV1_default$2',
  'QuestHelper_default$1', 'QuestHelper_default$2', 'QuestHelperV1_default$1', 'QuestHelperV1_default$2',
  'QuestWindow_default$1', 'QuestWindow_default$2', 'MiniMapV2_default$1', 'MiniMapV2_default$2']);
const values = {}, elements = {}, functions = {}, configSource = {};
let dataAttrs, monsterNames, messageFactory, messageMethod, uiMessages;
function visit(node) {
  if (ts.isBinaryExpression(node)) {
    const left = node.left.getText(source);
    if (wanted.has(left) && ts.isStringLiteral(node.right)) values[left] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[left] ?? '') + node.right.text : node.right.text;
    if (['UIButton', 'UIText', 'UIImage'].includes(left) && ts.isClassExpression(node.right)) elements[left] = node.right.getText(source);
    if (left === 'MonsterNameTable_default' && ts.isObjectLiteralExpression(node.right)) monsterNames = vm.runInNewContext('(' + node.right.getText(source) + ')');
    if (['Quest_default', 'QuestV1_default', 'QuestHelper_default', 'QuestHelperV1_default'].includes(left) && ts.isCallExpression(node.right)) configSource[left.replace('_default', '')] = node.right.arguments[0].getText(source);
  }
  if (ts.isFunctionDeclaration(node) && ['createMiniMap', 'loadTable', 'parseQuestEntry', 'sanitizeHtml'].includes(node.name?.text)) functions[node.name.text] = node.getText(source);
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'processDataAttrs') dataAttrs = node.getText(source).replace(/^static\s+/, '');
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'getMessage') messageMethod = node.getText(source).replace(/^static\s+/, '');
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(source) === 'lastroUiMessages') uiMessages = JSON.parse(node.initializer.getText(source));
    if (node.name.getText(source) === 'LastROUiMessages') messageFactory = node.initializer.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of wanted) if (!values[name]) throw new Error('Missing generated quest string: ' + name);
if (!dataAttrs || !monsterNames || !messageFactory || !messageMethod || !uiMessages || Object.keys(elements).length !== 3 || Object.keys(configSource).length !== 4 || Object.keys(functions).length !== 4) throw new Error('Missing generated quest dependencies');
function region(path) {
  const start = runtime.indexOf('//#region ' + path), end = runtime.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing generated quest region: ' + path);
  return runtime.slice(start, end);
}
const nativeSource = [region('src/UI/Components/Quest/QuestHelperCommon.js'), region('src/UI/Components/Quest/Quest/QuestWindow.js'),
  region('src/UI/Components/Quest/QuestCommon.js'), region('src/Engine/MapEngine/Quest.js')].join('\n');
const configs = Object.fromEntries(Object.entries(configSource).map(([name, code]) => [name, vm.runInNewContext('(' + code + ')', {
  ...values, QuestHelper_default: 'QuestHelper', QuestHelperV1_default: 'QuestHelperV1', QuestWindow_default: 'QuestWindow',
})]));

// Parse the packaged GBK table with the same native loader/parser as DBManager.
const questBytes = await readFile('generated/core/data/questid2display.txt');
const msgBytes = await readFile('generated/client-typography-assets/msgstringtable.txt');
const csvBytes = await readFile('generated/core/data/msgstringtable.csv');
const tableContext = vm.createContext({ questBytes, msgBytes, csvBytes, console, QuestInfo: {},
  Client: { loadFile: (path, done) => done(path.includes('questid') ? questBytes : msgBytes) },
  CodepageManager: { decode: (bytes, charset) => new globalThis.TextDecoder(charset || 'gbk').decode(bytes) }, userCharpage: 'gbk' });
vm.runInContext(functions.loadTable + '\n' + functions.parseQuestEntry + '\nconst MsgStringTable = {};\nconst LastROUiMessages = ' + messageFactory + ';\n' +
  'loadTable("data/questid2display.txt", "#", 6, parseQuestEntry, () => {}, false, "gbk");\n' +
  'loadTable("data/msgstringtable.txt", "#", 1, (id, value) => { MsgStringTable[id] = value; }, () => { LastROUiMessages.loadCsv(csvBytes, MsgStringTable, bytes => CodepageManager.decode(bytes, "utf-8")); }, true);\nglobalThis.messages = MsgStringTable;', tableContext);
const questTable = Object.fromEntries([30001, 30090].map(id => [id, tableContext.QuestInfo[id]]));
if (Object.values(questTable).some(value => !value?.Title)) throw new Error('Missing current native sample quest entries');
questTable[900001] = { Title: '离线示例：明确坐标的任务', Summary: '仅用于检查前往链接，不代表服务器任务', IconName: 'ico_nq.bmp',
  Description: '拜访<NAVI>普隆德拉示例地点<INFO>prontera,156,191,0,000,0</INFO></NAVI>。\n此坐标是明确标记的离线样本；点击只记录本地操作。' };
const mobData = JSON.parse(await readFile('generated/core/data/world/mob-data.json', 'utf8'));
const worldData = JSON.parse(await readFile('generated/core/data/world/world-data.json', 'utf8'));
const monsterCatalog = Object.fromEntries([1002, 1191, 1474, 1775].map(id => [id, { id, name: mobData[id]?.kName || monsterNames[id] || String(id),
  nativeName: monsterNames[id], maps: Object.entries(worldData).filter(([, map]) => Array.isArray(map.mobs) && map.mobs.some(mob => Number(mob) === id)).map(([mapId, map]) => ({ id: mapId, name: map.name || mapId })) }]));

const assets = new Set(['map/dali.bmp', 'map/map_arrow.bmp', 'item/SG_FEEL.bmp', 'basic_interface/tab_que_01.bmp', 'basic_interface/tab_que_02.bmp', 'basic_interface/tab_que_03.bmp',
  'basic_interface/quest_window.bmp', 'renew_questui/bg_quest1.bmp', 'renew_questui/bg_quest2.bmp', 'renew_questui/bg_quest3.bmp', 'renew_questui/bg_quest4.bmp',
  'renew_questui/bg_questsub.bmp', 'renew_questui/bg_questlist.bmp', 'renew_questui/bg_questlist_check.bmp', 'renew_questui/img_poring.bmp', 'renew_questui/ico_nq.bmp',
  'renew_questui/checkbox_on.bmp', 'renew_questui/checkbox_off.bmp', 'renew_questui/bt_check_on.bmp', 'renew_questui/bt_check_off.bmp',
  'information/store.bmp', 'information/weaponshop.bmp', 'information/armorshops.bmp', 'information/smithy.bmp', 'information/guide.bmp', 'information/inn.bmp', 'information/kafra.bmp']);
for (const [name, text] of Object.entries(values)) if (name.endsWith('$2')) {
  for (const match of text.matchAll(/(?:data-(?:background|hover|down|active)|bg|hover|down|src)="([^";]+\.bmp)"/g)) assets.add(match[1]);
  for (const match of text.matchAll(/data-preload="([^"]+)"/g)) for (const asset of match[1].split(';')) assets.add(asset);
}
for (const match of nativeSource.matchAll(/\$\{DB\.INTERFACE_PATH\}([^`$]+\.bmp)/g)) assets.add(match[1]);
const assetDirectory = 'generated/quests-assets';
await mkdir(assetDirectory, { recursive: true });
for (const asset of assets) {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  for (const cache of ['generated/navigation-ui-assets', 'generated/basic-info-assets', 'generated/client-typography-assets']) {
    try { await writeFile(assetDirectory + '/' + filename, await readFile(cache + '/' + filename)); break; } catch { /* Existing shared caches are optional. */ }
  }
}
const { manifest, failures } = await cacheNativeUiAssets([...assets], assetDirectory);
await writeFile(assetDirectory + '/report.json', JSON.stringify({ manifest, failures }, null, 2) + '\n');

const fixture = String.raw`
function __esmMin(fn) { let done = false; return () => { if (!done) { done = true; fn(); } }; }
function init_Preferences$1() {} function init_UIManager() {} function init_GUIComponent() {}
function init_QuestWindow$1() {} function init_QuestWindow$2() {}
const QuestWindow_default$1 = values.QuestWindow_default$1, QuestWindow_default$2 = values.QuestWindow_default$2;
const MsgStringTable = messages, LastROUiMessages = NATIVE_MESSAGE_FACTORY;
const DB = { INTERFACE_PATH: '', NATIVE_MESSAGE_METHOD,
  getQuestInfo: id => questTable[id] || { Title: 'Unknown Quest', Summary: '', Description: '', IconName: 'ico_nq.bmp' },
  getMonsterName: id => monsterNames[id] ?? 'Unknown', getItemInfo: () => ({}), getTownInfo: () => [], mapalias: {} };
function assetName(path) { return String(path).replace(/\\/g, '/').replace(/^data\/texture\//, '').replace(/^유저인터페이스\//, ''); }
const Client = { loadFile: (path, done, fail) => decodeBmp(assetName(path)).then(done).catch(error => { fail?.(error); assetError(error); }),
  loadFiles: (files, done) => Promise.all(files.map(path => decodeBmp(assetName(path)))).then(urls => done?.(...urls)).catch(assetError) };
const _Client = Client, _DB = DB;
const UIManager = { addComponent: component => component };
const Altitude = { width: 400, height: 400 };
const preferences = new Map(), events = [], chatMessages = [], renderers = new Set();
const Preferences = { get: (name, defaults) => {
  if (!preferences.has(name)) preferences.set(name, { ...defaults, x: 16, y: 128, show: true, save() { queueMicrotask(report); } });
  return preferences.get(name);
} };
const Renderer = { get width() { return innerWidth; }, get height() { return innerHeight; }, tick: 0, render: callback => renderers.add(callback) };
const MapRenderer = { currentMap: 'dali.gat', loading: false };
const SessionStorage_default = { Entity: { position: [200, 200], direction: 0, walk: { total: 0 }, dialog: { set: (text, color) => events.push({ type: 'dialog', text, color }) } } };
const KEYS = { CTRL: false, ESCAPE: 27 }, Configs = { get: key => key === 'lastroProtocol' };
const ChatBox_default = { TYPE: { ADMIN: 1, SELF: 2 }, FILTER: { QUEST: 1 }, addText: text => chatMessages.push(text) };
class ActiveQuestPacket {} class HuntingListPacket {}
const PACKET = { CZ: { ACTIVE_QUEST: ActiveQuestPacket, HUNTINGLIST: HuntingListPacket } };
const Network = { sendPacket: packet => {
  events.push({ type: packet instanceof ActiveQuestPacket ? 'local-active-quest' : 'local-hunting-query', questID: packet.questID, active: packet.active });
  if (packet instanceof ActiveQuestPacket) queueMicrotask(() => { onActiveQuest(packet); report(); });
}, hookPacket() {} };
const ItemInfo_default = { uid: null, append() {}, remove() {}, setItem: value => events.push({ type: 'item', value }) };
const Navigation_default = { uid: null, _host: null, show() {}, hide() {}, setNaviInfo: (info, name) => { events.push({ type: 'native-navigation', info, name }); report(); } };
const LastROTools = { _lastroQuestRoute: { request: async route => { events.push({ type: 'route', route }); report(); return true; },
  cancelPending: () => events.push({ type: 'cancel-pending-route' }), cancel: () => events.push({ type: 'cancel-route' }) } };
const WorldMap_default = { searchMonster: target => {
  events.push({ type: 'monster', target });
  report(); return nativeWorldMap.searchMonster(target);
} };
let quest = null, helper = null, mini = null, scale = 1, fontReady = false, assetsReady = false, detachedRows = 0, lastMetrics = null, topIndex = 50;
const plane = document.getElementById('native-plane');
const observer = new MutationObserver(() => report());
class GUIComponent {
  static MouseMode = { CROSS: 0, STOP: 1 };
  static NATIVE_DATA_ATTRS
  constructor(name, css) {
    this.name = name; this._cssText = css; this._host = null; this._shadow = null; this.__loaded = false; this.__active = false;
    this.ui = { show: () => { this.prepare(); this._host.style.display = ''; queueMicrotask(report); }, hide: () => { if (this._host) this._host.style.display = 'none'; queueMicrotask(report); },
      is: () => !!(this._host?.isConnected && getComputedStyle(this._host).display !== 'none') };
  }
  getRoot() { return this._shadow || this._host; }
  prepare() {
    if (this.__loaded) return; this.__loaded = true;
    this._host = document.createElement('div'); this._host.id = this.name;
    Object.assign(this._host.style, { position: 'absolute', color: '#000', fontSize: '12px', lineHeight: '1.2', zIndex: '50' });
    this._shadow = this._host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = values.Common_default$1 + this._cssText;
    const container = document.createElement('div'); container.className = 'ui-component-root'; setLastROInnerHTML(container, this.render());
    this._shadow.append(style, container); plane.append(this._host);
    this._shadow.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
    this.init?.(); this._host.remove();
    observer.observe(this._shadow, { attributes: true, childList: true, subtree: true, characterData: true });
    observer.observe(this._host, { attributes: true, attributeFilter: ['style'] });
  }
  append() { this.prepare(); plane.append(this._host); this.__active = true; if (this.onKeyDown) this.bindKeys(); this.onAppend?.(); applyLayout(this); this.focus(); }
  remove() { this.onRemove?.(); this.__active = false; if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, !!this.captureKeyEvents); this._keyHandler = null; this._host?.remove(); report(); }
  bindKeys() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, !!this.captureKeyEvents);
    this._keyHandler = event => { if (this.onKeyDown(event) === false) event.preventDefault(); };
    window.addEventListener('keydown', this._keyHandler, !!this.captureKeyEvents);
  }
  focus() { if (this._host) this._host.style.zIndex = String(++topIndex); }
  draggable(selector) {
    this.getRoot().querySelector(selector)?.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.composedPath().some(node => ['BUTTON', 'UI-BUTTON', 'INPUT', 'SELECT'].includes(node.tagName))) return;
      this.focus(); const x = event.clientX, y = event.clientY, left = this._host.offsetLeft, top = this._host.offsetTop;
      const move = next => { this._host.style.left = left + next.clientX - x + 'px'; this._host.style.top = top + next.clientY - y + 'px'; report(); };
      const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop, { once: true }); event.preventDefault();
    });
  }
}
const nativeWorldMap = new GUIComponent('WorldMap', worldMapFixture.css);
nativeWorldMap.render = () => worldMapFixture.html;
(NATIVE_WORLD_MAP_INSTALLER)(nativeWorldMap, {
  document, DB: { ...DB, getItemInfo: () => ({}) }, Client,
  loadData: async () => {
    try {
    const values = await Promise.all(['world-data', 'mob-data'].map(async name => {
      const response = await fetch('/core/data/world/' + name + '.json');
      if (!response.ok) throw new Error('World map data HTTP ' + response.status);
      return response.json();
    }));
    return { worldData: values[0], mobData: values[1] };
    } catch (error) { events.push({ type: 'offline-map-data-error', message: error.message }); report(); throw error; }
  },
  itemTable: () => ({}), currentMap: () => MapRenderer.currentMap, accountId: () => 0,
  navigate: map => events.push({ type: 'offline-map-navigation', map }),
  teleport: async map => { events.push({ type: 'offline-map-teleport', map }); return true; },
}, worldMapFixture.regions, (...args) => {
  try { return (NATIVE_WORLD_MAP_INDEX)(...args); }
  catch (error) { events.push({ type: 'offline-map-index-error', message: error.message }); report(); throw error; }
});
UIManager.addComponent(nativeWorldMap);
NATIVE_ELEMENTS
NATIVE_SANITIZE
NATIVE_QUEST_SOURCE
NATIVE_MINIMAP_FACTORY
const renewLayout = new URLSearchParams(location.search).get('layout') === 'renewal';
const applicableFailures = assetFailures.filter(failure => renewLayout || !failure.startsWith('renew_questui/'));
const assetStatus = document.getElementById('assets');
assetStatus.textContent = applicableFailures.join('\n'); assetStatus.hidden = applicableFailures.length === 0;
if (renewLayout) init_QuestWindow();
helper = createQuestHelper(configs[renewLayout ? 'QuestHelper' : 'QuestHelperV1']);
const questConfig = { ...configs[renewLayout ? 'Quest' : 'QuestV1'], questHelper: helper };
if (renewLayout) questConfig.questWindow = QuestWindow_default;
quest = createQuest(questConfig);
const Controller$3 = { getUI: () => quest };
mini = createMiniMap({ name: 'MiniMapV2', htmlText: values.MiniMapV2_default$2, cssText: values.MiniMapV2_default$1,
  worldMap: { toggle: () => { if (!nativeWorldMap.__loaded) nativeWorldMap.prepare(); if (!nativeWorldMap._host.isConnected) nativeWorldMap.append(); nativeWorldMap.toggle(); events.push({ type: 'world-map' }); report(); } }, townInfoToggle: true, coordinates: true, arrowShadow: true });
function init_Navigation() {}
function applyLayout(component) {
  // Match native navigation QA: scale the ancestor, so a layout-pixel move
  // becomes a scaled visual move and the production docking math stays intact.
  plane.style.zoom = String(scale); plane.style.width = innerWidth / scale + 'px'; plane.style.height = innerHeight / scale + 'px';
  const top = document.getElementById('controls').getBoundingClientRect().bottom + 18;
  if (component === quest) { component._host.style.left = 16 / scale + 'px'; component._host.style.top = top / scale + 'px'; }
  if (component === helper) { component._host.style.left = 16 / scale + (renewLayout ? 381 : 350) + 12 + 'px'; component._host.style.top = top / scale + 'px'; }
  if (component === mini) { component._host.style.left = 'auto'; component._host.style.right = 16 / scale + 'px'; component._host.style.top = top / scale + 'px'; }
}
function loadSamples() {
  quest.prepare();
  // A real incoming ALL_QUEST_LIST reaches the prepared but detached classic UI.
  const quests = [
    { questID: 30001, active: 1, count: 1, hunt: [{ huntID: 87001, mobGID: 1002, huntCount: 0, maxCount: 80, mobName: monsterCatalog[1002].name }] },
    { questID: 900001, active: 1, count: 0, hunt: [] },
  ];
  onAllQuestList({ questCount: quests.length, QuestList: quests });
  quest.receiveHuntingList({ HuntingList: [{ questID: 30090, mobGID: 1191, count: 0, maxCount: 80 }] });
  detachedRows = quest.getRoot().querySelectorAll('#active-quest-list .quest-item').length;
  quest.append(); quest.ui.show(); mini.append(); mini.setMap('dali.gat');
  quest.lastroQuestUI.position(); helper.append(); helper.setQuestInfo({ questID: 900001, active: 1, hunt_list: {}, reward_item_list: [] }); helper.ui.show();
  document.body.dataset.character = 'A'; report();
}
function progress(count) { onUpdateMissionHunt({ questCount: 1, hunt: [{ questID: 30090, huntID: 1191, huntCount: count, maxCount: 80 }] }); report(); }
function box(node) { if (!node) return null; const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; }
function componentMetric(component) {
  const root = component?.getRoot(), host = component?._host;
  if (!host || !root) return null;
  return { visible: !!(host.isConnected && getComputedStyle(host).display !== 'none'), rect: box(host), offsetWidth: host.offsetWidth, offsetHeight: host.offsetHeight, scrollWidth: host.scrollWidth, scrollHeight: host.scrollHeight,
    text: root.querySelector('.ui-component-root')?.textContent || '', rows: root.querySelectorAll('.quest-item').length,
    titles: [...root.querySelectorAll('.quest-item-title-text,.lastro-quest-detail h3,.quest-window-li-title')].map(node => node.textContent),
    targets: [...root.querySelectorAll('.lastro-quest-targets li,.quest-window-li-monster li')].map(node => node.textContent),
    footer: box(root.querySelector('.footer,.quest-bottom-panel,.quest-info-bottom-panel')) };
}
function report() {
  if (!quest) return null;
  const tracker = componentMetric(QuestWindow_default), minimap = componentMetric(mini);
  const mapHost = nativeWorldMap._host, mapRoot = nativeWorldMap.getRoot();
  const mapVisible = !!(mapHost?.isConnected && getComputedStyle(mapHost).display !== 'none');
  document.getElementById('controls').hidden = mapVisible;
  lastMetrics = { sourceHash, layout: renewLayout ? 'renewal' : 'classic', scale, fontReady, assetsReady, wirePackets: 0, detachedRows,
    quest: componentMetric(quest), helper: componentMetric(helper), tracker, minimap,
    trackerGap: tracker?.visible && minimap?.visible ? tracker.rect.top - minimap.rect.bottom : null,
    selectedQuestId: quest.lastroQuestUI.selectedQuestId, events: events.slice(-30), chatMessages: chatMessages.slice(-5),
    worldMap: { visible: mapVisible, rect: box(mapHost), panelRect: box(mapRoot?.querySelector('.wm-panel')), title: mapRoot?.querySelector('.wm-title')?.textContent,
      monster: mapRoot?.querySelector('.wm-detail-title')?.textContent, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } },
    monsterIdentity: [1191, 1775].map(id => ({ id, nativeName: monsterNames[id], localChineseName: monsterCatalog[id].name })) };
  document.body.dataset.questMetrics = JSON.stringify(lastMetrics); document.body.dataset.fontReady = String(fontReady); document.body.dataset.assetsReady = String(assetsReady);
  document.body.dataset.wirePackets = '0'; document.body.dataset.detachedRows = String(detachedRows); document.body.dataset.trackerVisible = String(tracker?.visible || false);
  document.body.dataset.killProgress = lastMetrics.tracker?.targets.join(' | ') || '';
  document.getElementById('state').textContent = '布局 ' + lastMetrics.layout + ' · ' + scale * 100 + '% · 简报 ' + (tracker?.visible ? '显示' : '隐藏'); return lastMetrics;
}
document.getElementById('layout').value = renewLayout ? 'renewal' : 'classic';
document.getElementById('layout').addEventListener('change', event => { location.search = '?layout=' + event.target.value; });
document.getElementById('scale').addEventListener('change', event => { scale = Number(event.target.value); [quest, helper, mini, QuestWindow_default].forEach(component => { if (component._host) applyLayout(component); }); quest.lastroQuestUI.position(); report(); });
document.getElementById('start').addEventListener('click', loadSamples);
document.getElementById('progress').addEventListener('click', () => progress(1));
document.getElementById('reset').addEventListener('click', () => progress(0));
document.getElementById('complete').addEventListener('click', () => progress(80));
document.getElementById('delete').addEventListener('click', () => { onDeleteQuest({ questID: 30090 }); report(); });
document.getElementById('clear').addEventListener('click', () => { quest.clean(); document.body.dataset.character = 'B'; events.push({ type: 'character-clear' }); report(); });
document.getElementById('toggle').addEventListener('click', () => { quest.toggle(); report(); });
document.getElementById('tracker').addEventListener('click', () => {
  const input = quest.getRoot().querySelector('.lastro-quest-display input');
  if (input) { input.checked = !input.checked; input.dispatchEvent(new Event('change')); }
  else quest.getRoot().querySelector('.toggle-quest-list')?.click(); report();
});
document.getElementById('detail').addEventListener('click', () => { helper.append(); helper.setQuestInfo({ questID: 900001, active: 1, hunt_list: {}, reward_item_list: [] }); helper.ui.show(); report(); });
document.getElementById('hide-detail').addEventListener('click', () => { helper.getRoot().querySelector('.quest-info-close-btn,.quest-info-bottom-btn')?.click(); report(); });
window.addEventListener('resize', () => { [quest, helper, mini, QuestWindow_default].forEach(component => { if (component?._host) applyLayout(component); }); quest.lastroQuestUI.position(); report(); });
Object.defineProperty(window, 'lastroQuestsQA', { value: Object.freeze({ get metrics() { return lastMetrics; }, sourceHash }), writable: false, configurable: false });
loadSamples();
await Promise.all([400, 500, 700].map(weight => document.fonts.load(weight + ' 12px MiSans', '任务信息赏金狩猎邪恶箱前往')));
await document.fonts.ready; fontReady = true;
await Promise.all(Object.keys(manifest).map(decodeBmp)); assetsReady = true;
function draw(tick) { Renderer.tick = tick; for (const callback of renderers) callback(); requestAnimationFrame(draw); }
requestAnimationFrame(draw); report();
`;
const js = ['import { setLastROInnerHTML, setLastROAdjacentHTML } from "./quests-trusted-dom.mjs";',
  'const values = ' + JSON.stringify(values) + ';', 'const configs = ' + JSON.stringify(configs) + ';', 'const manifest = ' + JSON.stringify(manifest) + ';',
  'const sourceHash = ' + JSON.stringify(sourceHash) + ';', 'const assetDirectory = "quests-assets";', 'const assetFailures = ' + JSON.stringify(failures) + ';',
  'const worldMapFixture = ' + JSON.stringify({ html: worldMapFixture.html, css: worldMapFixture.css, regions: worldMapFixture.regions }) + ';',
  'const messages = ' + JSON.stringify(tableContext.messages) + ';', 'const lastroUiMessages = ' + JSON.stringify(uiMessages) + ';',
  'const questTable = ' + JSON.stringify(questTable) + ';', 'const monsterNames = ' + JSON.stringify(monsterNames) + ';', 'const monsterCatalog = ' + JSON.stringify(monsterCatalog) + ';',
  'const _allowedTags$1 = new Set(["span", "br", "b", "i", "u"]);', NATIVE_BMP_PREVIEW_SOURCE.replace("document.getElementById('assets').textContent = error.message;", "document.getElementById('assets').hidden = false; document.getElementById('assets').textContent = error.message;"),
  fixture.replace('NATIVE_MESSAGE_FACTORY', messageFactory).replace('NATIVE_MESSAGE_METHOD', messageMethod).replace('NATIVE_DATA_ATTRS', dataAttrs)
    .replace('NATIVE_SANITIZE', functions.sanitizeHtml).replace('NATIVE_QUEST_SOURCE', nativeSource).replace('NATIVE_MINIMAP_FACTORY', functions.createMiniMap)
    .replace('NATIVE_WORLD_MAP_INSTALLER', worldMapFixture.installLastroWorldMap).replace('NATIVE_WORLD_MAP_INDEX', worldMapFixture.createWorldMapIndex)
    .replace('NATIVE_ELEMENTS', Object.entries(elements).map(([name, code]) => 'customElements.define(' + JSON.stringify({ UIButton: 'ui-button', UIText: 'ui-text', UIImage: 'ui-image' }[name]) + ', ' + code + ');').join('\n')),
].join('\n');
const syntax = ts.createSourceFile('quests-preview.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
if (syntax.parseDiagnostics.length) throw new Error('Invalid quest fixture: ' + syntax.parseDiagnostics.map(diagnostic => diagnostic.messageText).join('; '));
await writeFile('generated/quests-preview.js', js);
await writeFile('generated/quests-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
await writeFile('generated/quests-shell.css', await readFile('src/styles.css', 'utf8'));
await writeFile('generated/quests-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LASTRO 原生任务离线预览</title>
<link rel="stylesheet" href="./quests-shell.css"><link rel="stylesheet" href="/fonts/misans.css"><style>body{font:400 12px/1.2 Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size-adjust:none;background:linear-gradient(135deg,#435d36,#534a39);min-height:100vh}#native-plane{position:absolute;left:0;top:0;margin:0;padding:0}#controls{background:#15231de8;color:#f6f8f6;padding:12px 16px;position:relative;z-index:1000}h1{font-size:17px;font-weight:400;margin:0 0 8px}nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center}nav button,nav select{font:inherit;padding:3px 7px}nav select{width:auto;min-height:26px}#controls p{margin:8px 0 0}#assets{white-space:pre-wrap;color:#ffcbb8}#monster-results{position:fixed;left:16px;right:16px;bottom:12px;max-height:180px;overflow:auto;z-index:900;background:#e9eeeb;color:#111;padding:10px;box-shadow:0 1px 8px #0008}#monster-results h2{font-size:13px;font-weight:500;margin:0}#monster-results p{margin:5px 0}</style>
<header id="controls"><h1>原生任务窗口 · 离线收包预览</h1><nav><select id="layout"><option value="classic">当前经典 QuestV1</option><option value="renewal">原生新版 Quest</option></select><select id="scale"><option value="1">100%</option><option value="1.5">150%</option></select><button id="start">模拟开始任务</button><button id="progress">击杀进度 1</button><button id="reset">重置进度 0</button><button id="complete">完成 80</button><button id="delete">删除赏金任务</button><button id="clear">清空 / 切角色</button><button id="toggle">开关任务窗口</button><button id="tracker">开关任务简报</button><button id="detail">坐标示例详情</button><button id="hide-detail">折叠详情</button><span id="state"></span></nav>
<p>使用构建后真实工厂、模板与原生收包函数。30090 → mobGID 1191 是明确标记的离线服务器赏金样本；赏金文案按服务器目标校验，普通任务使用当前任务 DB。900001 是含 NAVI 坐标的离线示例。所有前往、怪物与任务操作只记录本地动作。</p><p id="assets" hidden></p></header><main id="native-plane"></main><section id="monster-results" hidden></section><script type="module" src="./quests-preview.js"></script></html>`);
console.log('Native quest artwork: ' + Object.keys(manifest).length + '/' + assets.size);
if (failures.length) console.warn(failures.join('\n'));
console.log('Source SHA256: ' + sourceHash);
console.log('Preview: /generated/quests-preview.html');
