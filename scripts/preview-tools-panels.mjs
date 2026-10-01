// Offline fixture using the real tools template, panel factory, and scrollbar.
// Only passive BMP artwork is fetched; preview actions record local state.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import console from 'node:console';
import { build } from 'esbuild';
import ts from 'typescript';
import { installLastroToolsPanels } from './lastro-tools-panels.mjs';
import { LASTRO_TOOLS_CSS } from './lastro-tools-style.mjs';
import { captureLastroShortcutEntry, installLastroShortcutEntry } from './lastro-shortcut-entry.mjs';
import { installLastroShortcutSettings } from './lastro-shortcut-settings.mjs';
import { normalizeRouteEntry } from '../vendor/v2/lastro-v1-migration.mjs';
import presets from './lastro-teleport-routes.json' with { type: 'json' };

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const shellCss = await readFile('src/styles.css', 'utf8');
const file = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const values = {}, functions = {}, nativeToolsMethods = {};
const nativeMethodNames = new Set(['ensurePanelOpener', 'hidePanel', 'restorePanel', 'minimizePanel', 'collapseDetailedSettings', 'renderCompactStatus', 'renderAssistSkillList', 'applyState', 'renderQuickRoutes', 'loadQuickRoutes']);
const wanted = new Set(['Common_default$1', 'WinPopup_default$1', 'WinPopup_default$2', 'LastROTools_default', 'GraphicsOption_default$1', 'GraphicsOption_default$2']);
const wantedFunctions = new Set(['patchLastROToolsTemplate', 'activateLastROSettingsTab', 'showLastROSettingsView', 'showLastROMainView', '_popupPosition', '_createButton']);
let scrollbarClass, toolsInit, promptMethod;
function visit(node) {
  if (ts.isBinaryExpression(node)) {
    if (wanted.has(node.left.getText(file)) && ts.isStringLiteral(node.right)) values[node.left.getText(file)] = node.right.text;
    if (node.left.getText(file) === 'LastROTools.init' && ts.isFunctionExpression(node.right)) toolsInit = node.right.getText(file);
    const method = node.left.getText(file).replace(/^LastROTools\./, '');
    if (node.left.getText(file).startsWith('LastROTools.') && nativeMethodNames.has(method) && ts.isFunctionExpression(node.right)) nativeToolsMethods[method] = node.right.getText(file);
  }
  if (ts.isFunctionDeclaration(node) && wantedFunctions.has(node.name?.text)) functions[node.name.text] = node.getText(file);
  if (ts.isClassExpression(node) && node.name?.text === 'ScrollBar') scrollbarClass = node.getText(file);
  if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'showPromptBox') promptMethod = node.getText(file).replace(/^static\s+/, '');
  ts.forEachChild(node, visit);
}
visit(file);
for (const name of wanted) if (!values[name]) throw new Error('Missing native string: ' + name);
for (const name of wantedFunctions) if (!functions[name]) throw new Error('Missing native function: ' + name);
if (!scrollbarClass || !toolsInit || !promptMethod) throw new Error('Missing actual scrollbar, tools init, or prompt');
values.toolsTemplate = runInNewContext('let LastROTools_default$1 = "";\n' + functions.patchLastROToolsTemplate + '\npatchLastROToolsTemplate(); LastROTools_default$1;', {});

const directory = 'generated/tools-panels-assets';
const assets = [
  'basic_interface/titlebar_left.bmp', 'basic_interface/titlebar_mid.bmp', 'basic_interface/titlebar_right.bmp',
  'basic_interface/sys_close_off.bmp', 'basic_interface/sys_close_on.bmp',
  'basic_interface/sys_base_off.bmp', 'basic_interface/sys_base_on.bmp',
  'basic_interface/sys_mini_off.bmp', 'basic_interface/sys_mini_on.bmp',
  'basic_interface/btnbar_mid.bmp', 'btn_resize.bmp',
  'ro_menu_icon/option_1.bmp', 'ro_menu_icon/skill_1.bmp', 'ro_menu_icon/option_2.bmp', 'ro_menu_icon/skill_2.bmp',
  'scroll0up.bmp', 'scroll0down.bmp', 'scroll0mid.bmp',
  'scroll0bar_up.bmp', 'scroll0bar_mid.bmp', 'scroll0bar_down.bmp',
  'basic_interface/dialscr_up.bmp', 'basic_interface/dialscr_down.bmp',
  'win_msgbox.bmp', 'btn_ok.bmp', 'btn_ok_a.bmp', 'btn_ok_b.bmp', 'btn_cancel.bmp', 'btn_cancel_a.bmp', 'btn_cancel_b.bmp',
];
const resolverBundle = await build({ entryPoints: ['src/resources/resource-resolver.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const resolver = await import('data:text/javascript;base64,' + Buffer.from(resolverBundle.outputFiles[0].text).toString('base64'));
const origins = new Set(['https://game.lastro.cn', 'https://rodata.ltsd.ro']);
await mkdir(directory, { recursive: true });
const manifest = {}, failures = [];
await Promise.all(assets.map(async asset => {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  try {
    let cached;
    for (const cache of [directory, 'generated/chat-map-links-assets']) {
      try {
        const bytes = await readFile(cache + '/' + filename);
        if (bytes[0] === 66 && bytes[1] === 77) { cached = bytes; break; }
      } catch { /* Import uncached passive artwork below. */ }
    }
    if (cached) await writeFile(directory + '/' + filename, cached);
    else {
      const candidates = resolver.buildResourcePathCandidates('data/texture/유저인터페이스/' + asset);
      const attempts = [];
      let downloaded = false;
      for (const candidate of candidates) {
        for (const resourceRoot of resolver.DEFAULT_RESOURCE_ROOTS) {
          const url = new URL(candidate, resourceRoot);
          if (!origins.has(url.origin)) throw new Error('Unexpected passive resource origin');
          try {
            const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(10000), redirect: 'error' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes[0] !== 66 || bytes[1] !== 77) throw new Error('Invalid BMP');
            await writeFile(directory + '/' + filename, bytes);
            downloaded = true; break;
          } catch (error) { attempts.push(url.origin + ': ' + error.message); }
        }
        if (downloaded) break;
      }
      if (!downloaded) throw new Error(attempts.join('; '));
    }
    manifest[asset] = filename;
  } catch (error) { failures.push(asset + ': ' + error.message); }
}));
await writeFile(directory + '/index.json', JSON.stringify(manifest, null, 2) + '\n');

const stubSource = String.raw`
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

const decoded = new Map();
function decodeBmp(asset) {
  if (!decoded.has(asset)) decoded.set(asset, new Promise((resolve, reject) => {
    const filename = manifest[asset];
    if (!filename) { reject(new Error('Missing native BMP: ' + asset)); return; }
    const image = new Image();
    image.onerror = () => reject(new Error('Cannot load native BMP: ' + asset));
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        if (pixels.data[offset] === 255 && pixels.data[offset + 1] === 0 && pixels.data[offset + 2] === 255) pixels.data[offset + 3] = 0;
      }
      context.putImageData(pixels, 0, 0); resolve(canvas.toDataURL());
    };
    image.src = './tools-panels-assets/' + filename;
  }));
  return decoded.get(asset);
}
function assetError(error) { document.body.dataset.assetFailure = 'true'; document.getElementById('assets').textContent = error.message; }
function setBackground(element, asset) {
  if (!asset) return;
  element.dataset.previewAsset = asset;
  decodeBmp(asset).then(url => { if (element.dataset.previewAsset === asset) element.style.backgroundImage = 'url("' + url + '")'; }).catch(assetError);
}
const DB = { INTERFACE_PATH: '' };
const Client = { loadFiles: (files, callback) => { Promise.all(files.map(decodeBmp)).then(values => callback(...values)).catch(assetError); } };
const Texture = { load: (url, callback) => { const image = new Image(); image.onload = () => callback.call(image); image.src = url; } };
let topIndex = 50;
class GUIComponent {
  constructor(name, css) { this.name = name; this._cssText = css; this.__active = false; }
  clone(name) { const clone = new GUIComponent(name, this._cssText); clone.render = this.render; return clone; }
  getRoot() { return this._shadow || this._host; }
  _processAllDataAttrs() { this._shadow?.querySelectorAll('[data-background]').forEach(GUIComponent.processDataAttrs); }
  static processDataAttrs(element) {
    const normal = element.dataset.background;
    if (!normal) return;
    setBackground(element, normal);
    if (element.tagName === 'BUTTON') {
      element.type = 'button';
      if (!element.hasAttribute('aria-label') && normal.startsWith('btn_')) element.setAttribute('aria-label', normal.startsWith('btn_ok') ? '确定' : '取消');
    }
    element.addEventListener('mouseenter', () => setBackground(element, element.dataset.hover || normal));
    element.addEventListener('mouseleave', () => setBackground(element, normal));
    element.addEventListener('mousedown', () => setBackground(element, element.dataset.down || normal));
    element.addEventListener('mouseup', () => setBackground(element, element.dataset.hover || normal));
  }
  append() {
    this.__active = true;
    if (!this._host) {
      this._host = document.createElement('div'); this._host.id = this.name;
      this._host.style.position = 'absolute'; this._host.style.zIndex = '50';
      this._host.style.fontFamily = "Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif"; this._host.style.fontSizeAdjust = 'none';
      this._shadow = this._host.attachShadow({ mode: 'open' });
      const common = document.createElement('style'); common.textContent = values['Common_default$1'];
      const style = document.createElement('style'); style.dataset.component = this.name; style.textContent = this._cssText;
      this._container = document.createElement('div'); this._container.className = 'ui-component-root'; setLastROInnerHTML(this._container, this.render());
      this._shadow.append(common, style, this._container);
      this._shadow.querySelectorAll('[data-background]').forEach(GUIComponent.processDataAttrs);
      this._shadow.addEventListener('scroll', () => recordState(), true);
      document.body.append(this._host); this.init?.();
    } else document.body.append(this._host);
    stateObserver?.observe(this._host, { attributes: true, attributeFilter: ['style', 'hidden'] });
    stateObserver?.observe(this._shadow, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    this.onAppend?.(); this._setupScrollbars(); this.focus();
  }
  remove() { this.__active = false; if (this._host?.isConnected) { this.onRemove?.(); this._host.remove(); } recordState(); }
  focus() { if (this._host) this._host.style.zIndex = String(++topIndex); recordState(); }
  placeOnTop() { this.focus(); }
  _setupScrollbars() {
    this._shadow?.querySelectorAll('[data-scrollbar-skin], .lastro-settings-body').forEach(element => ScrollBar.applyDOMScrollbar(element));
  }
  draggable(selector) {
    const handle = selector ? this._shadow.querySelector(selector) : this._container;
    if (!handle) return;
    handle.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.composedPath().some(node => node.tagName === 'BUTTON' || node.tagName === 'INPUT' || node.tagName === 'SELECT')) return;
      this.focus();
      const startX = event.clientX, startY = event.clientY, bounds = this._host.getBoundingClientRect();
      this._host.style.right = 'auto'; this._host.style.bottom = 'auto';
      const move = next => { this._host.style.left = Math.max(0, bounds.left + next.clientX - startX) + 'px'; this._host.style.top = Math.max(0, bounds.top + next.clientY - startY) + 'px'; };
      const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop, { once: true }); event.preventDefault();
    });
  }
}
`;

const setupSource = String.raw`
const components = new Map();
const WinPopup = new GUIComponent('WinPopup', values['WinPopup_default$1']); WinPopup.render = () => values['WinPopup_default$2']; components.set('WinPopup', WinPopup);
const tools = new GUIComponent('LastROTools', values['LastROTools_default']); tools.render = () => values.toolsTemplate; components.set('LastROTools', tools);
tools.init = toolsInit;
function installLastRORandomTeleportShortcut() { return false; }
const requests = [];
let panels, stateObserver;
function visible(component) { return !!(component?._host?.isConnected && getComputedStyle(component._host).display !== 'none'); }
function recordState(message) {
  if (!document?.body || !previewFontsLoaded) return;
  document.body.dataset.autoFields = JSON.stringify(tools._settingState || {});
  document.body.dataset.routeRequests = String(requests.length);
  document.body.dataset.requests = JSON.stringify(requests);
  if (panels) {
    const automationRoot = tools.getRoot(), teleportRoot = panels.teleport.getRoot();
    const automationScroll = automationRoot?.querySelector('.lastro-settings-body')?.scrollTop || 0;
    const teleportScroll = teleportRoot?.querySelector('.lastro-route-scroll')?.scrollTop || 0;
    document.body.dataset.npcOrder = JSON.stringify(panels.ordered('npc'));
    document.body.dataset.automationVisible = String(visible(tools));
    document.body.dataset.teleportVisible = String(visible(panels.teleport));
    document.body.dataset.automationScrollTop = String(automationScroll);
    document.body.dataset.teleportScrollTop = String(teleportScroll);
    document.body.dataset.scrollTop = JSON.stringify({ automation: automationScroll, teleport: teleportScroll });
    document.body.dataset.visibleRouteOrder = JSON.stringify([...teleportRoot?.querySelectorAll('[data-route-id]') || []].map(node => node.dataset.routeId));
    document.body.dataset.selectedCategory = teleportRoot?.querySelector('[data-category].is-active')?.dataset.category || '';
  }
  document.body.dataset.coverageVisible = String(visible(components.get('PreviewOrdinaryWindow')));
  if (message) document.getElementById('state').textContent = message;
}
tools.setStatus = function (message) { const status = this.getRoot()?.querySelector('.lastro-status'); if (status) status.textContent = message; recordState(message); };
Object.assign(tools, nativeToolsMethods);
tools._defaultQuickRoutes = nativeQuickRoutes;
tools.populateSkillSelects = function () {
  for (const select of this.getRoot().querySelectorAll('[data-skill-select]')) {
    if (select.children.length) continue;
    for (const [id, name] of [[0, '请选择技能'], [28, '治愈术'], [29, '天使之赐福'], [34, '加速术'], [19, '火箭术'], [20, '雷击术']]) select.add(new Option(name, String(id)));
  }
};
tools.populateItemSelects = function () {
  for (const select of this.getRoot().querySelectorAll('[data-item-select]')) {
    if (select.children.length) continue;
    for (const [id, name] of [[0, '请选择道具'], [501, '红色药水'], [505, '蓝色药水'], [607, '天地树果实'], [608, '天地树种子']]) select.add(new Option(name, String(id)));
  }
};
tools.setAutomationOption = function (option, enabled) { this._settingState[option] = enabled; this.setStatus('已模拟设置 ' + option + '：' + (enabled ? '开启' : '关闭')); };
tools.updateField = function (field, input) { this._settingState[field] = input.type === 'checkbox' ? input.checked : input.value; this.setStatus('已模拟修改 ' + field); };
tools.submitAssistSkill = function () {
  const root = this.getRoot(), skill = root.querySelector('[data-field="addiskillid"]');
  const level = root.querySelector('[data-field="addiskilllv"]'), enabled = root.querySelector('[data-field="addiskillop"]');
  this._assistSkills.push({ id: skill.value, level: level.value, enabled: enabled.checked });
  const chip = document.createElement('span'); chip.className = 'lastro-assist-chip'; chip.textContent = skill.selectedOptions[0].textContent + ' Lv.' + level.value; root.querySelector('[data-assist-list]').append(chip);
  this.setStatus('辅助技能已写入本地预览。');
};
const preferenceKey = 'lastro-tools-preview-order:5';
function loadPreferences() {
  let preferences = { orders: {} };
  try { const stored = JSON.parse(localStorage.getItem(preferenceKey) || 'null'); if (stored && typeof stored === 'object') preferences = stored; } catch { /* Start with the default order. */ }
  preferences.save = function () { localStorage.setItem(preferenceKey, JSON.stringify(this)); recordState('已保存本地预览设置。'); };
  return preferences;
}
const nativeShortcutEntry = captureLastroShortcutEntry(tools);
panels = installLastroToolsPanels(tools, {
  document, window, GUIComponent, UIManager,
  setHtml: setLastROInnerHTML,
  normalizeRoute: normalizeRouteEntry,
  requestRoute: route => { requests.push({ npc: route.npc, outset: route.outset, path: route.path }); recordState('已模拟前往：' + route.npc); return route.breakpoint ? 'navigation' : 'teleport'; },
  showPrompt: (message, yes, no) => UIManager.showPromptBox(message, 'ok', 'cancel', yes, no),
  getProfile: () => 5, getPresetRoutes: () => routes, loadPreferences,
  getCurrentLocation: () => ({ map: 'prontera', x: 156, y: 182 }),
}, toolsCss, routes);
const shortcutPreferenceKey = 'lastro-tools-preview-shortcut';
let shortcutEnabled = true;
try { shortcutEnabled = JSON.parse(localStorage.getItem(shortcutPreferenceKey) || 'null')?.enabled !== false; } catch { /* Default to the native entry. */ }
const shortcutEntry = installLastroShortcutEntry(tools, nativeShortcutEntry, {
  document, setHtml: setLastROInnerHTML, getEnabled: () => shortcutEnabled,
  normalizeRoute: normalizeRouteEntry, requestRoute: route => panels.requestCustomRoute(route),
});
const graphics = new GUIComponent('GraphicsOption', values['GraphicsOption_default$1']);
graphics.render = () => values['GraphicsOption_default$2'];
graphics.init = function () {
  this.draggable('.titlebar');
  this.getRoot().querySelector('.close').addEventListener('click', () => this.remove());
  this.getRoot().querySelectorAll('.tab-button').forEach(button => button.addEventListener('click', () => {
    this.getRoot().querySelectorAll('.tab-button').forEach(tab => tab.classList.toggle('selected', tab === button));
    this.getRoot().querySelectorAll('.tab-content').forEach(content => content.classList.toggle('selected', content.id === button.dataset.tab));
  }));
};
graphics.onAppend = function () {
  Object.assign(this._host.style, { position: 'fixed', left: '20px', top: '145px', width: 'auto', color: '#202536' });
  this.getRoot().querySelector('.screensize').value = '1400x900';
  this.getRoot().querySelector('.fpslimit').value = '120';
  this.getRoot().querySelector('.cursor-option').checked = true;
};
installLastroShortcutSettings(graphics, {
  document, getEnabled: () => shortcutEnabled,
  setEnabled: enabled => {
    localStorage.setItem(shortcutPreferenceKey, JSON.stringify({ enabled }));
    shortcutEnabled = enabled; shortcutEntry.setEnabled(enabled);
    recordState(enabled ? '新版快捷入口已启用。' : '已恢复传送和挂机两个入口。');
    return true;
  },
  onError: error => recordState(error.message),
});
components.set(graphics.name, graphics);
const ordinaryWindow = new GUIComponent('PreviewOrdinaryWindow', toolsCss + '\n:host{width:280px}.preview-window-body{box-sizing:border-box;height:135px;padding:12px;color:#263854;font-size:13px}');
components.set(ordinaryWindow.name, ordinaryWindow);
ordinaryWindow.render = () => '<div class="lastro-tools"><div class="lastro-ro-titlebar" data-background="basic_interface/titlebar_mid.bmp"><span class="lastro-title-left" data-background="basic_interface/titlebar_left.bmp"></span><span class="lastro-title-right" data-background="basic_interface/titlebar_right.bmp"></span><strong>普通窗口遮挡示例</strong><button type="button" class="lastro-window-close" data-background="basic_interface/sys_close_off.bmp" data-hover="basic_interface/sys_close_on.bmp" aria-label="关闭遮挡示例" title="关闭"></button></div><div class="preview-window-body">本窗口位于普通窗口层级，可以遮挡底部入口图标。<p>关闭后可继续使用入口。</p></div></div>';
ordinaryWindow.init = function () {
  this.draggable('.lastro-ro-titlebar');
  this.getRoot().querySelector('button').addEventListener('mousedown', event => event.stopPropagation());
  this.getRoot().querySelector('button').addEventListener('click', () => this.remove());
  this.getRoot().addEventListener('click', () => { document.body.dataset.coverageClicks = String(Number(document.body.dataset.coverageClicks || 0) + 1); recordState(); });
};
function openOrdinaryWindow() {
  ordinaryWindow.append();
  Object.assign(ordinaryWindow._host.style, { position: 'fixed', left: 'auto', top: 'auto', right: '4px', bottom: '4px' });
  ordinaryWindow.focus(); recordState('普通窗口已覆盖底部入口；关闭遮挡示例后可继续打开面板。');
}
document.getElementById('open-automation').addEventListener('click', () => { panels.showAutomation(); recordState('已打开挂机设置。'); });
document.getElementById('open-teleport').addEventListener('click', () => { panels.showTeleport(); recordState('已打开传送地点。'); });
document.getElementById('open-coverage').addEventListener('click', openOrdinaryWindow);
document.getElementById('open-graphics').addEventListener('click', () => graphics.append());
let dragDemo;
document.getElementById('preview-drag').addEventListener('click', event => {
  if (dragDemo) {
    dragDemo.list.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 71 }));
    dragDemo = null; event.currentTarget.textContent = '拖拽演示'; recordState('卡片已放回列表。'); return;
  }
  panels.showTeleport(); panels.select('npc');
  const list = panels.teleport.getRoot().querySelector('.lastro-route-list');
  const handle = list.querySelector('[data-sort-handle]'), box = handle.getBoundingClientRect();
  const point = { bubbles: true, pointerId: 71, pointerType: 'mouse', button: 0, buttons: 1, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  handle.dispatchEvent(new PointerEvent('pointerdown', point));
  list.dispatchEvent(new PointerEvent('pointermove', { ...point, clientY: point.clientY + 6 }));
  dragDemo = { list }; event.currentTarget.textContent = '放下卡片'; recordState('拖拽演示：卡片抬起，点击“放下卡片”恢复。');
});
document.getElementById('preview-scale').addEventListener('change', event => {
  document.body.style.zoom = event.target.value;
  for (const component of components.values()) component.onResize?.();
});
stateObserver = new MutationObserver(() => recordState());
stateObserver.observe(document.body, { childList: true, subtree: true });
window.addEventListener('pagehide', () => stateObserver.disconnect());
tools.append();
recordState('可以打开图形设置切换入口，或预览挂机设置与传送地点。');
Promise.all(Object.keys(manifest).map(decodeBmp)).then(() => {
  document.body.dataset.assetsReady = 'true';
});
ScrollBar.init();
recordState();
previewFontsReady.then(() => requestAnimationFrame(() => recordState()));
`;

const trustedBundle = await build({ entryPoints: ['src/runtime/lastro-trusted-dom.mjs'], bundle: true, write: false, platform: 'browser', format: 'esm' });
await writeFile('generated/tools-panels-trusted-dom.mjs', trustedBundle.outputFiles[0].text);
const previewJs = [
  'import { setLastROInnerHTML } from "./tools-panels-trusted-dom.mjs";',
  '// Generated offline fixture; native implementation with explicit preview services.',
  'const values = ' + JSON.stringify(values) + ';',
  'const manifest = ' + JSON.stringify(manifest) + ';',
  'const routes = ' + JSON.stringify({ ...presets.profiles['5'], custom: presets.upstreamCustomRoutes }) + ';',
  'const nativeQuickRoutes = ' + JSON.stringify(JSON.parse(await readFile('test/fixtures/teleport-011-quick-routes.json', 'utf8')).routes) + ';',
  'const nativeToolsMethods = {' + Object.entries(nativeToolsMethods).map(([name, value]) => JSON.stringify(name) + ':' + value).join(',') + '};',
  'const toolsCss = ' + JSON.stringify(LASTRO_TOOLS_CSS) + ';',
  'const ROUTE_FIELDS = ["npc", "desc", "outset", "path", "breakpoint", "position"];',
  normalizeRouteEntry.toString(), stubSource,
  'const ScrollBar = ' + scrollbarClass + ';',
  functions.activateLastROSettingsTab, functions.showLastROSettingsView, functions.showLastROMainView,
  functions._popupPosition, functions._createButton,
  'const UIManager = { addComponent: component => { components.set(component.name, component); return component; }, getComponent: name => components.get(name), ' + promptMethod + ' };',
  'const toolsInit = ' + toolsInit + ';', installLastroToolsPanels.toString(), captureLastroShortcutEntry.toString(), installLastroShortcutEntry.toString(), installLastroShortcutSettings.toString(), setupSource,
].join('\n');
await writeFile('generated/tools-panels-preview.js', previewJs);
await writeFile('generated/tools-panels-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LASTRO 挂机与传送窗口预览</title>
<link rel="stylesheet" href="/fonts/misans.css">
<style>${shellCss}</style>
<style>html,body{height:100%;overflow:hidden}body{margin:0;padding:20px;box-sizing:border-box;background:#263238;color:#eef3f5;font:14px Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size-adjust:none}h1{font-size:20px;margin:0 0 7px}header p{margin:0 0 8px}.preview-actions{display:flex;flex-wrap:wrap;gap:8px}.preview-actions select{width:auto;min-width:100px}#state{font-size:12px;color:#b9d5e8;margin-top:8px}#assets{color:#ffbaa5;font-size:12px;white-space:pre-wrap}</style>
<header><h1>LASTRO · 挂机设置与传送地点</h1><p>离线预览：两个面板切换显示。设置与传送仅更新本页状态，排序和自定义地点保存在本地。</p><div class="preview-actions"><button id="open-automation">打开挂机设置</button><button id="open-teleport">打开传送地点</button><button id="open-graphics">打开图形设置</button><button id="open-coverage">打开普通窗口遮挡示例</button><button id="preview-drag">拖拽演示</button><select id="preview-scale" aria-label="界面缩放"><option value="1">100%</option><option value="1.5">150%</option></select></div><div id="state"></div><div id="assets">${failures.join('\n')}</div></header>
<script type="module" src="./tools-panels-preview.js"></script></html>`);
console.log('Native panel artwork: ' + Object.keys(manifest).length + '/' + assets.length);
if (failures.length) console.warn(failures.join('\n'));
console.log('Preview: /generated/tools-panels-preview.html');
