// Offline QA only. Native generated DOM, MiniMap factory and Navigation methods;
// local map/worker mocks never initialize a game session or send packets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';
import ts from 'typescript';
import { cacheNativeUiAssets, NATIVE_BMP_PREVIEW_SOURCE } from './preview-native-ui-assets.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const sourceHash = createHash('sha256').update(runtime).digest('hex');
const source = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = new Set(['Common_default$1', 'Navigation_default$1', 'Navigation_default$2',
  'MiniMap_default$1', 'MiniMap_default$2', 'MiniMapV2_default$1', 'MiniMapV2_default$2']);
const values = {}, elements = {}, docking = {};
let dataAttrs;
function visit(node) {
  if (ts.isBinaryExpression(node) && wanted.has(node.left.getText(source)) && ts.isStringLiteral(node.right)) {
    const name = node.left.getText(source);
    values[name] = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? (values[name] ?? '') + node.right.text : node.right.text;
  }
  if (ts.isBinaryExpression(node) && ['UIButton', 'UIText', 'UIImage'].includes(node.left.getText(source)) && ts.isClassExpression(node.right)) {
    elements[node.left.getText(source)] = node.right.getText(source);
  }
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'processDataAttrs') dataAttrs = node.getText(source).replace(/^static\s+/, '');
  if (ts.isVariableDeclaration(node) && ['getNavigationDockPosition', 'dockLastroNavigation'].includes(node.name.getText(source))) {
    docking[node.name.getText(source)] = node.initializer.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of wanted) if (!values[name]) throw new Error('Missing native navigation string: ' + name);
if (!dataAttrs || Object.keys(elements).length !== 3) throw new Error('Missing native GUI elements');
if (Object.keys(docking).length !== 2) throw new Error('Generated runtime lacks navigation docking patch; build the final runtime before generating this preview.');

function nativeMethods(path, names) {
  const begin = runtime.indexOf('//#region src/UI/Components/' + path + '.js');
  const end = runtime.indexOf('//#endregion', begin);
  if (begin < 0 || end < begin) throw new Error('Missing native navigation region: ' + path);
  const ast = ts.createSourceFile(path + '.js', runtime.slice(begin, end), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods = {};
  function collect(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) methods[node.name.text] = node.getText(ast);
    if (ts.isBinaryExpression(node) && names.includes(node.left.getText(ast)) && ts.isFunctionExpression(node.right)) methods[node.left.getText(ast)] = node.right.getText(ast);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  for (const name of names) if (!methods[name]) throw new Error('Missing native navigation method: ' + name);
  return methods;
}
const minimap = nativeMethods('MiniMap/MiniMapCommon', ['createMiniMap']);
if (!minimap.createMiniMap.includes('Navigation_default.show(this._host)')) throw new Error('Generated MiniMap lacks the native navigation click patch');
const navigation = nativeMethods('Navigation/Navigation', [
  'createAsyncImage', 'normalizeMapName', 'formatCoordinates', 'formatTargetCoordinates', 'formatLocationTitle', 'mapToScreen', 'getCurrentMap', 'getPlayerPosition',
  'Navigation.init', 'Navigation.onAppend', 'Navigation.onRemove', 'Navigation.show', 'Navigation.hide', 'Navigation.onKeyDown',
  'Navigation.clear', 'Navigation.clearPath', 'Navigation.loadMap', 'Navigation.renderCanvas', 'Navigation.screenToMapCoordinates',
  'Navigation.setMapNameText', 'Navigation.setLocationTitle', 'Navigation.setMouseCoordinatesText', 'Navigation.setTargetCoordinatesText', 'Navigation.setTargetCoordinatesBlinking',
  'Navigation.onMapMouseMove', 'Navigation.onMapMouseLeave', 'Navigation.onMapClick', 'Navigation.navigateTo', 'Navigation.waitForMapData', 'Navigation.findClosestWalkableCell', 'Navigation.findPath',
  'Navigation.onSearch', 'Navigation.displaySearchResults',
]);
const assets = new Set(['map/dali.bmp', 'map/map_arrow.bmp', 'information/store.bmp', 'information/weaponshop.bmp',
  'information/armorshops.bmp', 'information/smithy.bmp', 'information/guide.bmp', 'information/inn.bmp', 'information/kafra.bmp']);
for (const name of ['Navigation_default$2', 'MiniMap_default$2', 'MiniMapV2_default$2']) {
  for (const match of values[name].matchAll(/(?:data-(?:background|hover|down|active)|bg|hover|down|src)="([^";]+\.bmp)"/g)) assets.add(match[1]);
  for (const match of values[name].matchAll(/data-preload="([^"]+)"/g)) for (const asset of match[1].split(';')) assets.add(asset);
}
const { manifest, failures } = await cacheNativeUiAssets([...assets], 'generated/navigation-ui-assets');

const fixture = String.raw`
const DB = { INTERFACE_PATH: '', mapalias: {}, getMessage: id => String(id), getTownInfo: () => [], getNaviLinkTable: () => [], searchNavigation: () => [] };
const gatWidth = 400, gatHeight = 400;
const gatCells = new Float32Array(gatWidth * gatHeight * 5);
for (let index = 4; index < gatCells.length; index += 5) gatCells[index] = 1;
function uiAsset(filename) { return String(filename).replace(/\\/g, '/').replace(/^data\/texture\//, '').replace(/^유저인터페이스\//, ''); }
const Client = {
  loadFile: (filename, done) => {
    if (filename === 'data/dali.gat') { done({ width: gatWidth, height: gatHeight, cells: gatCells }); return; }
    decodeBmp(uiAsset(filename)).then(done).catch(assetError);
  },
  loadFiles: (files, done) => Promise.all(files.map(filename => decodeBmp(uiAsset(filename)))).then(values => done?.(...values)).catch(assetError),
};
const _Client = Client, _DB = DB;
const Altitude = { width: gatWidth, height: gatHeight, TYPE: { WALKABLE: 1 } };
const SessionStorage_default = { Entity: { position: [200, 200], direction: 0, walk: { total: 0 } } };
const MapRenderer = { currentMap: 'dali.gat' };
const KEYS = { ENTER: 13, ESCAPE: 27, TAB: 9, CTRL: false };
const Preferences = { get: (_name, defaults) => ({ ...defaults, save() {} }) };
const renderers = new Set();
const Renderer = { tick: 0, get width() { return innerWidth; }, get height() { return innerHeight; }, render(callback) { renderers.add(callback); } };
const UIManager = { addComponent: component => component };
const localRequests = [], workerEvents = [];
const MapPathFinder = { findPathBetweenMaps: (_startMap, _startX, _startY, endMap, endX, endY) => [{ map: endMap, x: endX, y: endY }] };
// Native findPath runs, but its worker is a local recorder with no Worker or socket.
function initializePathFindingWorker() {
  if (_pathFindingWorker) return;
  workerEvents.push('initialize');
  _pathFindingWorker = { id: workerEvents.length, postMessage: value => { localRequests.push(value); queueMicrotask(report); } };
}
function terminatePathFindingWorker() { if (_pathFindingWorker) workerEvents.push('terminate'); _pathFindingWorker = null; }
function resetPathFindingWorker() { terminatePathFindingWorker(); initializePathFindingWorker(); }
function requestNavigationMove() { throw new Error('Offline preview must not issue movement'); }
function isNavigationTargetReached() { return false; }
let topIndex = 50;
class GUIComponent {
  static MouseMode = { STOP: 1 };
  static NATIVE_DATA_ATTRS
  constructor(name, css) {
    this.name = name; this._cssText = css; this.__loaded = false; this.__active = false;
    this.ui = { show: () => { this.prepare(); this._host.style.display = ''; this.focus(); queueMicrotask(report); },
      hide: () => { this.prepare(); this._host.style.display = 'none'; queueMicrotask(report); } };
  }
  getRoot() { this.prepare(); return this._root; }
  prepare() {
    if (this.__loaded) return;
    this.__loaded = true;
    this._host = document.createElement('div'); this._host.id = this.name;
    Object.assign(this._host.style, { position: 'absolute', color: '#000', fontSize: '12px', lineHeight: '1.2', zIndex: '50' });
    this._root = this._host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = values.Common_default$1 + this._cssText;
    const container = document.createElement('div'); setLastROInnerHTML(container, this.render());
    this._root.append(style, container);
    this._root.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
    plane.append(this._host); this.init?.();
    observer.observe(this._host, { attributes: true, attributeFilter: ['style'] });
  }
  append() { this.prepare(); plane.append(this._host); this.__active = true; this.onAppend?.(); }
  remove() { this.onRemove?.(); this.__active = false; this._host?.remove(); report(); }
  focus() { this._host.style.zIndex = String(++topIndex); }
  draggable(selector) {
    this.getRoot().querySelector(selector)?.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.composedPath().some(node => ['BUTTON', 'UI-BUTTON', 'INPUT', 'SELECT'].includes(node.tagName))) return;
      this.focus();
      const startX = event.clientX, startY = event.clientY, left = this._host.offsetLeft, top = this._host.offsetTop;
      const move = next => { this._host.style.left = left + (next.clientX - startX) / scale + 'px'; this._host.style.top = top + (next.clientY - startY) / scale + 'px'; report(); };
      const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop, { once: true }); event.preventDefault();
    });
  }
}
`;
const app = String.raw`
const plane = document.getElementById('plane');
let scale = 1, anchor = 'right', activeVersion = 'MiniMapV2', fontReady = false, assetsReady = false, lastMetrics = null, canvasClicks = 0;
const observer = new MutationObserver(() => report());
var Navigation = new GUIComponent('Navigation', values.Navigation_default$1);
Navigation.render = () => values.Navigation_default$2;
var _arrow = createAsyncImage(), _toolDealer = createAsyncImage(), _weaponDealer = createAsyncImage(), _armorDealer = createAsyncImage(),
  _blacksmith = createAsyncImage(), _guide = createAsyncImage(), _inn = createAsyncImage(), _kafra = createAsyncImage(), _map = createAsyncImage();
var _ctx$2 = null, _towninfo = [], _markers = [], _path = [], _lastPathUpdate = 0, _pathUpdateThrottle = 500, _pathUpdateLock = false,
  _pathFindingWorker = null, _mapData = null, _targetData = null, _finalTargetData = null, _isMapClickTarget = false,
  _blinking = false, _fadeInterval = null, _originalColor = '', _documentClickHandler = null;
NATIVE_NAVIGATION_METHODS
const Navigation_default = Navigation;
function init_Navigation() { Navigation.prepare(); }
NATIVE_MINIMAP_FACTORY
const miniMaps = {
  MiniMap: createMiniMap({ name: 'MiniMap', htmlText: values.MiniMap_default$2, cssText: values.MiniMap_default$1 }),
  MiniMapV2: createMiniMap({ name: 'MiniMapV2', htmlText: values.MiniMapV2_default$2, cssText: values.MiniMapV2_default$1,
    worldMap: { toggle: () => { document.body.dataset.worldMapClicks = String(Number(document.body.dataset.worldMapClicks || 0) + 1); } },
    townInfoToggle: true, coordinates: true, arrowShadow: true }),
};
for (const component of Object.values(miniMaps)) {
  component.append(); component.setMap('dali.gat');
  component.getRoot().querySelector('canvas').addEventListener('click', () => { canvasClicks++; queueMicrotask(report); });
}
Navigation.append();
function box(node) {
  const rect = node.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}
function visible(component) { return !!(component._host?.isConnected && getComputedStyle(component._host).display !== 'none'); }
function report() {
  if (!Navigation.__loaded) return null;
  const mini = miniMaps[activeVersion], shown = visible(Navigation), navigationBox = box(Navigation._host), minimapBox = box(mini._host);
  const footer = box(Navigation.getRoot().querySelector('.footer'));
  const panel = box(Navigation.getRoot().querySelector('.Navigation'));
  lastMetrics = {
    sourceHash, scale, anchor, activeVersion, fontReady, assetsReady, viewport: { width: innerWidth, height: innerHeight },
    visible: shown, navigation: navigationBox, panel, footer, minimap: minimapBox,
    hostLayout: { scrollWidth: Navigation._host.scrollWidth, scrollHeight: Navigation._host.scrollHeight,
      offsetWidth: Navigation._host.offsetWidth, offsetHeight: Navigation._host.offsetHeight },
    leftGap: shown ? minimapBox.left - navigationBox.right : null,
    rightGap: shown ? navigationBox.left - minimapBox.right : null,
    topDelta: shown ? navigationBox.top - minimapBox.top : null,
    hostInViewport: shown ? navigationBox.left >= -0.5 && navigationBox.top >= -0.5 && navigationBox.right <= innerWidth + 0.5 && navigationBox.bottom <= innerHeight + 0.5 : null,
    footerInViewport: shown ? footer.left >= -0.5 && footer.top >= -0.5 && footer.right <= innerWidth + 0.5 && footer.bottom <= innerHeight + 0.5 : null,
    footerOutsideHost: shown ? footer.bottom - navigationBox.bottom : null,
    canvasClicks, routeRequests: localRequests.length, workerEvents: [...workerEvents], finalTarget: _finalTargetData,
    packets: 0, mapFixture: 'dali native BMP; local 400 x 400 walkable cells',
    font: { family: getComputedStyle(Navigation._host).fontFamily, weight: getComputedStyle(Navigation._host).fontWeight },
  };
  document.body.dataset.navigationMetrics = JSON.stringify(lastMetrics);
  document.body.dataset.navigationVisible = String(shown);
  document.body.dataset.scale = String(scale); document.body.dataset.anchor = anchor;
  document.body.dataset.activeMinimap = activeVersion; document.body.dataset.minimapClicks = String(canvasClicks);
  document.body.dataset.routeRequests = String(localRequests.length); document.body.dataset.packets = '0';
  document.body.dataset.fontReady = String(fontReady); document.body.dataset.assetsReady = String(assetsReady);
  document.body.dataset.hostInViewport = String(lastMetrics.hostInViewport); document.body.dataset.footerInViewport = String(lastMetrics.footerInViewport);
  document.getElementById('state').textContent = shown ? '导航位置 ' + navigationBox.left.toFixed(1) + ', ' + navigationBox.top.toFixed(1) + '；小地图左侧间隔 ' + lastMetrics.leftGap.toFixed(1) + ' px' : '点击小地图打开原生导航';
  return lastMetrics;
}
function layout() {
  plane.style.zoom = String(scale); plane.style.width = innerWidth / scale + 'px'; plane.style.height = innerHeight / scale + 'px';
  for (const [version, mini] of Object.entries(miniMaps)) {
    const host = mini._host;
    host.style.display = version === activeVersion ? '' : 'none';
    host.style.right = 'auto'; host.style.bottom = 'auto';
    host.style.left = (anchor === 'left' ? 8 / scale : innerWidth / scale - host.offsetWidth - 16 / scale) + 'px';
    host.style.top = (anchor === 'bottom' ? innerHeight / scale - host.offsetHeight - 8 / scale : 106 / scale) + 'px';
  }
  // Reopen through native show when changing the QA anchor/scale; no duplicate docking math.
  if (visible(Navigation)) Navigation.show(miniMaps[activeVersion]._host);
  report();
}
document.getElementById('scale').addEventListener('change', event => { scale = Number(event.target.value); layout(); });
document.getElementById('version').addEventListener('change', event => { activeVersion = event.target.value; layout(); });
document.querySelectorAll('[data-anchor]').forEach(button => button.addEventListener('click', () => { anchor = button.dataset.anchor; layout(); }));
document.getElementById('close').addEventListener('click', () => Navigation.hide());
document.getElementById('background').addEventListener('click', () => {
  Navigation.hide();
  Navigation.navigateTo({ startMap: 'dali', startX: 200, startY: 200, endMap: 'dali', endX: 210, endY: 210, showWindow: false });
  report();
});
document.getElementById('clear').addEventListener('click', () => { Navigation.clear(); report(); });
window.addEventListener('keydown', event => { Navigation.onKeyDown(event); queueMicrotask(report); });
window.addEventListener('resize', layout);
Object.defineProperty(window, 'lastroNavigationUIQA', { value: Object.freeze({ get metrics() { return lastMetrics; }, sourceHash }), writable: false, configurable: false });
layout();
await Promise.all([400, 500, 700].map(weight => document.fonts.load(weight + ' 12px MiSans', '导航服务地图')));
await document.fonts.ready; fontReady = true;
await Promise.all(Object.keys(manifest).map(decodeBmp));
await Promise.all([...Object.values(miniMaps).flatMap(component => [...component.getRoot().querySelectorAll('ui-button')])].map(element => element.updateComplete));
// Allow the Image objects assigned by native init/setMap/loadMap to finish decoding.
await new Promise(resolve => setTimeout(resolve, 80)); assetsReady = true;
function frame(tick) { Renderer.tick = tick; for (const render of renderers) render(tick); requestAnimationFrame(frame); }
requestAnimationFrame(frame); report();
`;
const navCode = Object.entries(navigation).map(([name, code]) => name.startsWith('Navigation.') ? name + ' = ' + code + ';' : '').filter(Boolean).join('\n');
const functions = Object.entries(navigation).filter(([name]) => !name.startsWith('Navigation.')).map(([, code]) => code).join('\n');
const js = [
  'import { setLastROInnerHTML } from "./navigation-ui-trusted-dom.mjs";',
  'const values = ' + JSON.stringify(values) + ';', 'const manifest = ' + JSON.stringify(manifest) + ';',
  'const sourceHash = ' + JSON.stringify(sourceHash) + ';', 'const assetDirectory = "navigation-ui-assets";',
  NATIVE_BMP_PREVIEW_SOURCE,
  ...Object.entries(docking).map(([name, code]) => 'const ' + name + ' = ' + code + ';'),
  functions,
  fixture.replace('NATIVE_DATA_ATTRS', dataAttrs),
  ...Object.entries(elements).map(([name, code]) => 'customElements.define(' + JSON.stringify({ UIButton: 'ui-button', UIText: 'ui-text', UIImage: 'ui-image' }[name]) + ', ' + code + ');'),
  app.replace('NATIVE_NAVIGATION_METHODS', navCode).replace('NATIVE_MINIMAP_FACTORY', minimap.createMiniMap),
].join('\n');
const syntax = ts.createSourceFile('navigation-ui-preview.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
if (syntax.parseDiagnostics.length) throw new Error('Invalid native navigation fixture: ' + syntax.parseDiagnostics.map(diagnostic => diagnostic.messageText).join('; '));
await mkdir('generated', { recursive: true });
await writeFile('generated/navigation-ui-preview.js', js);
await writeFile('generated/navigation-ui-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
await writeFile('generated/navigation-ui-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LASTRO 原生导航预览</title>
<link rel="stylesheet" href="/fonts/misans.css">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:linear-gradient(125deg,#786747,#344b36);font:400 12px/1.2 Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size-adjust:none;font-synthesis:none}#plane{position:absolute;left:0;top:0}header{position:fixed;z-index:1000;top:0;left:0;right:0;padding:12px;background:#27352bf0;color:#eaf2ed}h1{font-size:16px;font-weight:400;margin:0 0 8px}nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center}header button,header select{font:inherit}#state{margin-left:8px}#assets{color:#ffd0b8;white-space:pre-wrap;margin:5px 0 0}</style>
<header><h1>原生导航 / 小地图 · 离线 UI QA</h1><nav><label>比例 <select id="scale"><option value="1">100%</option><option value="1.5">150%</option></select></label><label>小地图 <select id="version"><option value="MiniMapV2">MiniMapV2</option><option value="MiniMap">MiniMap</option></select></label><button data-anchor="right">右上</button><button data-anchor="left">左侧边缘</button><button data-anchor="bottom">下方边缘</button><button id="close">收起导航</button><button id="background">后台导航（本地）</button><button id="clear">清除路线</button><span id="state">载入原生资源……</span></nav><p id="assets">${failures.join('\n')}</p></header><main id="plane"></main>
<script type="module" src="./navigation-ui-preview.js"></script></html>`);
console.log('Native navigation artwork: ' + Object.keys(manifest).length + '/' + assets.size);
if (failures.length) console.warn(failures.join('\n'));
console.log('Source SHA256: ' + sourceHash);
console.log('Preview: /generated/navigation-ui-preview.html');
