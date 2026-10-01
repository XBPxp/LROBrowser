// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLastroShortcutEntry, installLastroShortcutEntry } from '../scripts/lastro-shortcut-entry.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';
import upstreamFixture from './fixtures/teleport-011-quick-routes.json';

const migration = await import(pathToFileURL(resolve('vendor/v2/lastro-v1-migration.mjs')).href);
const source = readFileSync('vendor/v2/Online.js', 'utf8');
function region(name: string) {
  const start = source.indexOf('//#region ' + name), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing original tools region: ' + name);
  return source.slice(start, end);
}
const js = region('src/UI/Components/LastROTools/LastROTools.js');
const ast = ts.createSourceFile('LastROTools.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function assignment(name: string) {
  const matches: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); if (matches.length !== 1) throw new Error('Missing/ambiguous native assignment: ' + name);
  return matches[0]!.right.getText(ast);
}
function declaration(name: string) {
  const match = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!match) throw new Error('Missing native helper: ' + name); return match.getText(ast);
}
const helpers = ['activateLastROSettingsTab', 'showLastROSettingsView', 'showLastROMainView'].map(declaration).join('\n');
const originalTemplate = vm.runInNewContext(`${declaration('patchLastROToolsTemplate')}\nlet LastROTools_default$1 = ''; patchLastROToolsTemplate(); LastROTools_default$1;`) as string;
const css = vm.runInNewContext(`${region('src/UI/Components/LastROTools/LastROTools.css?raw')}\ninit_LastROTools$1(); LastROTools_default;`, { __esmMin: (initialize: () => void) => initialize }) as string;
const styleSource = readFileSync('scripts/lastro-tools-style.mjs', 'utf8').replace('export const ', 'const ');
const classicCss = vm.runInNewContext(`${styleSource}\nLASTRO_TOOLS_CSS;`) as string;
const panelSource = readFileSync('scripts/lastro-tools-panels.mjs', 'utf8').replace('export function ', 'function ');
const installPanels = vm.runInNewContext(`${panelSource}\ninstallLastroToolsPanels;`);
const cleanups: Array<() => void> = [];

class GUIComponent {
  __loaded = false; __active = false;
  _isDraggable = false;
  _host = document.createElement('div'); _shadow = this._host.attachShadow({ mode: 'open' });
  _container = document.createElement('div');
  _panelOpener: HTMLElement | null = null;
  render = () => ''; init = () => {}; onAppend = () => {}; onRemove = () => {};
  onResize = () => {}; _fixPositionOverflow = () => {};
  draggable = vi.fn(() => { this._isDraggable = true; }); focus = vi.fn(); _setupScrollbars = vi.fn();
  constructor(public name: string, public _cssText = '') { this._host.id = name; }
  static processDataAttrs() {}
  _processAllDataAttrs() {}
  getRoot() { if (!this.__loaded) this.prepare(); return this._shadow; }
  prepare() {
    this.__loaded = true;
    const style = document.createElement('style'); style.dataset.component = this.name; style.textContent = this._cssText;
    this._container.className = 'ui-component-root'; setLastROInnerHTML(this._container, this.render());
    this._shadow.append(style, this._container); document.body.append(this._host); this.init(); this._host.remove();
  }
  append() { if (!this.__loaded) this.prepare(); this.__active = true; document.body.append(this._host); this.onAppend(); }
  remove() { this.__active = false; if (this._host.isConnected) { this.onRemove(); this._host.remove(); } }
}
interface NativeTools extends GUIComponent {
  _lastroPanels: { deactivate(): void; refreshEntry(): void; requestCustomRoute(route: unknown): void; showAutomation(): void; showTeleport(): void; teleport: GUIComponent };
  _settingState: Record<string, unknown>;
  _assistSkills: Array<{ skillId: number; level: number; enabled: boolean }>;
  _onlyTargets: number[];
  _quickRoutes: Record<string, Record<string, unknown>>;
  applyState(state: Record<string, unknown>): void;
  setLoadInfo(state: Record<string, unknown>): void;
  setOnlyTargetOptions(targets: unknown[]): void;
  setOnlyTargetState(packet: { mobid: number; value: number }): void;
  onMapChanged(): Promise<void>;
  toggleOnlyTarget(id: number, enabled: boolean, checkbox?: HTMLElement): void;
  setStatus(message: string): void;
}

function fixture(initial?: boolean) {
  const packets: unknown[] = [], requests = vi.fn(() => 'teleport');
  let mapTargets: Array<{ id: number; name: string }> = [];
  const mapRenderer = { currentMap: 'prontera.gat' };
  const prompts: Array<{ yes(): void; no(): void; popup: { onRemove?: () => void; remove(): void } }> = [];
  const showPrompt = vi.fn((_message: string, yes: () => void, no: () => void) => {
    const popup = { onRemove: undefined as (() => void) | undefined, remove: () => popup.onRemove?.() };
    prompts.push({ popup, yes: () => { popup.remove(); yes(); }, no: () => { popup.remove(); no(); } }); return popup;
  });
  const tools = new GUIComponent('LastROTools', css) as NativeTools;
  const context = vm.createContext({ ...migration, document, window, LastROTools: tools,
    installLastRORandomTeleportShortcut() {},
    getLastROLearnedSkills: () => [{ SKID: 28, SkillName: '治愈术' }, { SKID: 19, SkillName: '火箭术' }],
    getLastROInventoryItems: () => [{ ITID: 501, count: 4, name: '红色药水' }],
    SkillInfo: {}, Configs: { get: () => 5 },
    PACKET: { CZ: { NOTIFY_UPDATEINFO: class {}, NOTIFY_ONLYTARGET: class {}, WHISPER: class {} } },
    Network: { sendPacket: (packet: unknown) => packets.push(packet) }, clearTimeout,
    loadWorldMapData: async () => ({ worldData: {}, mobData: {} }), getMapTargetOptions: () => mapTargets, MapRenderer: mapRenderer,
  });
  vm.runInContext(helpers, context);
  context.OPTION_TO_PACKET_ID = vm.runInContext(`(${assignment('OPTION_TO_PACKET_ID')})`, context);
  context.SCALAR_FIELD_BY_ID = Object.fromEntries(Object.entries(migration.AUTO_BATTLE_SCALAR_IDS).map(([name, id]) => [id, name]));
  const methods = ['ensurePanelOpener', 'hidePanel', 'init', 'setStatus', 'renderCompactStatus', 'populateSkillSelects', 'populateItemSelects',
    'setAutomationOption', 'submitAssistSkill', 'renderAssistSkillList', 'updateField', 'toggleOnlyTarget', 'setOnlyTargetOptions',
    'minimizePanel', 'restorePanel', 'collapseDetailedSettings', 'onMapChanged', 'getOptionLabel', 'loadQuickRoutes', 'renderQuickRoutes',
    'stopQuickRoute', 'setOnlyTargetState', 'setLoadInfo', 'setReloadInfo', 'applyState'];
  Object.assign(tools, Object.fromEntries(methods.map(name => [name, vm.runInContext(`(${assignment(`LastROTools.${name}`)})`, context)])),
    { render: () => originalTemplate, _defaultQuickRoutes: upstreamFixture.routes });
  const captured = captureLastroShortcutEntry(tools);
  const cancel = vi.fn();
  const panels = installPanels(tools, {
    document, window, GUIComponent, UIManager: { addComponent: (component: GUIComponent) => component },
    setHtml: setLastROInnerHTML, normalizeRoute: migration.normalizeRouteEntry, requestRoute: requests,
    loadPreferences: () => ({ orders: {}, save: vi.fn() }), getProfile: () => 5, getPresetRoutes: () => ({ npc: {} }),
    showPrompt, cancelRoute: cancel, cancelPendingRoute: cancel,
  }, classicCss) as NativeTools['_lastroPanels'];
  const controller = installLastroShortcutEntry(tools, captured, {
    document, setHtml: setLastROInnerHTML, ...(initial === undefined ? {} : { getEnabled: () => initial }),
    normalizeRoute: migration.normalizeRouteEntry, requestRoute: route => panels.requestCustomRoute(route),
  });
  // A GUI component has a container before it is prepared in this fixture;
  // the production instance creates it only during prepare().
  tools.append();
  cleanups.push(() => { tools.remove(); panels.deactivate(); document.getElementById('lastro-tools-opener')?.remove(); });
  const root = () => tools.getRoot();
  const button = (action: string) => root().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  const input = (field: string) => root().querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`)!;
  const change = (field: string, value: string | boolean) => {
    const node = input(field);
    if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = Boolean(value); else node.value = String(value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { tools, panels, controller, packets, requests, prompts, showPrompt, cancel, captured, root, button, input, change,
    setMapTargets(targets: Array<{ id: number; name: string }>, map = 'geffen.gat') { mapTargets = targets; mapRenderer.currentMap = map; },
  };
}
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

describe('upstream shortcut entry mode', () => {
  it('applies a saved disabled preference before the first native component preparation', () => {
    const f = fixture(false);
    expect(f.controller.isEnabled()).toBe(false);
    expect(f.root().querySelector('.lastro-main-view')).toBeNull();
    expect(document.getElementById('lastro-tools-dock')?.querySelectorAll('button')).toHaveLength(2);
    expect(document.getElementById('lastro-tools-opener')).toBeNull();
    expect(f.tools._isDraggable).toBe(true);
    expect(f.packets).toEqual([]);
  });

  it('allows graphics settings to change the mode before the GUI component has any DOM', () => {
    const originalInit = vi.fn(), classicInit = vi.fn();
    const tools = { render: () => '<div>native</div>', init: originalInit, _cssText: css,
      _host: null, _shadow: null, _container: null, __loaded: false, __active: false, _isDraggable: false };
    const captured = captureLastroShortcutEntry(tools);
    tools.render = () => '<div>classic</div>'; tools.init = classicInit; tools._cssText = classicCss;
    const controller = installLastroShortcutEntry(tools, captured, {
      document, setHtml: setLastROInnerHTML, normalizeRoute: migration.normalizeRouteEntry, requestRoute: vi.fn(),
    });
    controller.setEnabled(false);
    expect(tools.render()).toBe('<div>classic</div>'); expect(tools._cssText).toBe(classicCss);
    expect(originalInit).not.toHaveBeenCalled(); expect(classicInit).not.toHaveBeenCalled();
    controller.setEnabled(true);
    expect(tools.render()).toBe('<div>native</div>'); expect(tools._cssText).toBe(css);
    expect(tools._container).toBeNull();
  });

  it('defaults to the complete upstream native tools template and stylesheet', () => {
    const f = fixture();
    expect(f.controller.isEnabled()).toBe(true);
    expect(f.tools._cssText).toBe(css);
    expect(f.root().querySelector('.lastro-main-view')).not.toBeNull();
    expect(f.root().querySelectorAll('[data-option]')).toHaveLength(4);
    const expected = document.createElement('template'); setLastROInnerHTML(expected, originalTemplate);
    expect(f.root().querySelectorAll('[data-field]')).toHaveLength(expected.content.querySelectorAll('[data-field]').length);
    expect(document.getElementById('lastro-tools-dock')).toBeNull();
    expect(f.root().querySelector('.lastro-quick')).not.toBeNull();
    expect(f.tools._host.style.width).toBe('420px');
  });

  it('keeps native close, reopen, minimize, quick collapse and settings navigation operational', () => {
    const f = fixture();
    f.button('minimize').click(); expect(f.root().querySelector('.lastro-tools')?.classList.contains('is-collapsed')).toBe(true);
    f.button('compact-settings').click();
    expect(f.root().querySelector<HTMLElement>('.lastro-settings-view')?.hidden).toBe(false);
    expect(f.root().querySelector('.lastro-tools')?.classList.contains('is-collapsed')).toBe(false);
    f.button('back-main').click(); expect(f.root().querySelector<HTMLElement>('.lastro-main-view')?.hidden).toBe(false);
    f.button('quick').click(); expect(f.root().querySelector('.lastro-quick')?.classList.contains('expanded')).toBe(false);
    f.button('close').click(); expect(f.tools._host.style.display).toBe('none');
    const opener = document.getElementById('lastro-tools-opener') as HTMLButtonElement;
    expect(opener.hidden).toBe(false); opener.click();
    expect(f.tools._host.style.display).toBe(''); expect(opener.hidden).toBe(true);
  });

  it('switches to the existing two-button dock and classic windows without replacing the component', () => {
    const f = fixture(), host = f.tools._host;
    f.controller.setEnabled(false);
    expect(f.tools._host).toBe(host); expect(f.controller.isEnabled()).toBe(false);
    expect(f.tools._cssText).toBe(classicCss);
    expect(f.tools._isDraggable).toBe(true);
    expect(f.root().querySelector('.lastro-main-view')).toBeNull();
    expect(document.getElementById('lastro-tools-opener')).toBeNull();
    const dock = document.getElementById('lastro-tools-dock')!;
    expect(dock.querySelectorAll('button')).toHaveLength(2);
    expect(f.tools._host.style.display).toBe('none');
    dock.querySelector<HTMLButtonElement>('[aria-label="打开挂机设置"]')!.click();
    expect(f.tools._host.style.display).toBe('');
    f.controller.setEnabled(true);
    expect(f.tools._host).toBe(host); expect(f.root().querySelector('.lastro-main-view')).not.toBeNull();
    expect(document.getElementById('lastro-tools-dock')).toBeNull();
    expect(f.tools._cssText).toBe(css);
    expect(f.tools._isDraggable).toBe(false);
  });

  it('preserves four server switches, settings, assist skills and selected targets across both modes', () => {
    const f = fixture();
    f.tools.applyState({ autoAttack: true, autoLoot: true, autoPots: true, autoFollow: true, pmdis: 7, AutoUseItem_hp_1: 501 });
    f.tools._assistSkills = [{ skillId: 28, level: 5, enabled: true }];
    f.tools.setOnlyTargetOptions([{ id: 1002, name: '波利', level: 1 }]);
    f.root().querySelector<HTMLInputElement>('[data-target-id="1002"]')!.click();
    const shared = f.tools._settingState, assist = f.tools._assistSkills;
    f.packets.length = 0;
    for (const enabled of [false, true, false, true]) {
      f.controller.setEnabled(enabled);
      expect(f.tools._settingState).toBe(shared); expect(f.tools._assistSkills).toBe(assist);
      expect(f.input('pmdis').value).toBe('7'); expect(f.input('AutoUseItem_hp_1').value).toBe('501');
      expect(f.root().querySelectorAll<HTMLInputElement>('[data-option]:checked')).toHaveLength(4);
      expect(f.root().querySelector<HTMLInputElement>('[data-target-id="1002"]')?.checked).toBe(true);
      expect(f.root().querySelector('[data-assist-list]')?.textContent).toContain('28 Lv.5');
      expect(f.packets).toEqual([]);
    }
  });

  it('continues processing original server state and sends each native option/field change once after repeated switches', () => {
    const f = fixture(false);
    f.controller.setEnabled(true); f.controller.setEnabled(false); f.controller.setEnabled(true);
    f.tools.setLoadInfo({ startAutoAtk: 1, startAutoLoot: 0, startAutopots: 1, startAutofollow: 1 });
    expect(f.root().querySelectorAll<HTMLInputElement>('[data-option]:checked')).toHaveLength(4);
    const attack = f.root().querySelector<HTMLInputElement>('[data-option="autoAttack"]')!;
    attack.checked = false; attack.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.packets).toEqual([expect.objectContaining({ id: 34, value: 1 })]);
    f.change('pmdis', '8');
    expect(f.packets).toEqual([expect.objectContaining({ id: 34, value: 1 }), expect.objectContaining({ id: 1, value: 8 })]);
  });

  it.each([
    { enabled: true, cache: [] }, { enabled: false, cache: [1002] },
  ])('preserves server target checked=$enabled across both modes without changing the native cache or sending packets', ({ enabled, cache }) => {
    const f = fixture(), originalCache = [...cache];
    f.tools._onlyTargets = originalCache;
    f.tools.setOnlyTargetOptions([{ id: 1002, name: '波利' }]);
    f.tools.setOnlyTargetState({ mobid: 1002, value: enabled ? 1 : 0 });
    const target = () => f.root().querySelector<HTMLInputElement>('[data-target-id="1002"]')!;
    expect(target().checked).toBe(enabled);
    for (const nativeMode of [false, true]) {
      f.controller.setEnabled(nativeMode);
      expect(target().checked).toBe(enabled);
      expect(f.tools._onlyTargets).toBe(originalCache);
      expect(f.tools._onlyTargets).toEqual(cache);
      expect(f.packets).toEqual([]);
    }
    target().click();
    expect(target().checked).toBe(!enabled);
    expect(f.packets).toEqual([expect.objectContaining({ id: 1002, value: enabled ? 0 : 1 })]);
    expect(f.requests).not.toHaveBeenCalled();
  });

  it('uses fresh native map target state after a map change instead of restoring the previous DOM snapshot', async () => {
    const f = fixture();
    f.tools._onlyTargets = [];
    f.tools.setOnlyTargetOptions([{ id: 1002, name: '旧地图波利' }]);
    f.tools.setOnlyTargetState({ mobid: 1002, value: 1 });
    f.controller.setEnabled(false); f.controller.setEnabled(true);
    expect(f.root().querySelector<HTMLInputElement>('[data-target-id="1002"]')?.checked).toBe(true);
    f.setMapTargets([{ id: 1002, name: '新地图波利' }, { id: 1007, name: '新地图疯兔' }]);
    await f.tools.onMapChanged();
    for (const nativeMode of [false, true]) {
      f.controller.setEnabled(nativeMode);
      expect(f.root().querySelectorAll('[data-target-id]')).toHaveLength(2);
      expect(f.root().querySelector<HTMLInputElement>('[data-target-id="1002"]')?.checked).toBe(false);
      expect(f.root().querySelector<HTMLInputElement>('[data-target-id="1007"]')?.checked).toBe(false);
      expect(f.root().querySelector('[data-target-id="1002"]')?.parentElement?.textContent).toContain('新地图波利');
      expect(f.tools._onlyTargets).toEqual([]);
      expect(f.packets).toEqual([]);
    }
  });

  it('keeps native presets but sends them only through the shared confirmation and verified route bridge', async () => {
    const f = fixture();
    const category = f.root().querySelector<HTMLSelectElement>('.quick-category')!;
    expect([...category.options].map(option => option.textContent)).toEqual(['常用地点', '洞穴传送', '野外地图', '自定义传送']);
    f.root().querySelector<HTMLSelectElement>('.quick-route')!.value = 'bounty';
    f.button('run-quick').click(); expect(f.showPrompt).toHaveBeenCalledOnce(); expect(f.requests).not.toHaveBeenCalled();
    expect(f.packets).toEqual([]);
    f.prompts[0]!.yes(); await Promise.resolve();
    expect(f.requests).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ npc: '⭐赏金猎人', outset: ['prontera', 156, 117] }));
    expect(f.packets).toEqual([]);
  });

  it('validates custom coordinates and cancels a native pending confirmation when the mode changes', async () => {
    const f = fixture(), category = f.root().querySelector<HTMLSelectElement>('.quick-category')!;
    category.value = 'custom'; category.dispatchEvent(new Event('change'));
    const map = f.root().querySelector<HTMLInputElement>('[data-custom-route-map]')!;
    const x = f.root().querySelector<HTMLInputElement>('[data-custom-route-x]')!;
    const y = f.root().querySelector<HTMLInputElement>('[data-custom-route-y]')!;
    map.value = 'force_map3'; x.value = '65536'; y.value = '184'; f.button('run-quick').click();
    expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.root().querySelector('.lastro-status')?.textContent).toContain('0-65535');
    x.value = '100'; f.button('run-quick').click();
    expect(f.showPrompt).toHaveBeenCalledOnce(); expect(f.requests).not.toHaveBeenCalled();
    f.controller.setEnabled(false); f.prompts[0]!.yes(); await Promise.resolve();
    expect(f.requests).not.toHaveBeenCalled(); expect(f.packets).toEqual([]);
    f.controller.setEnabled(true);
    expect(f.root().querySelector<HTMLSelectElement>('.quick-category')?.value).toBe('custom');
    expect(f.root().querySelector<HTMLInputElement>('[data-custom-route-map]')?.value).toBe('force_map3');
    expect(f.root().querySelector<HTMLInputElement>('[data-custom-route-x]')?.value).toBe('100');
  });

  it('removes all native and classic entry elements on logout and restores only the selected mode', () => {
    const f = fixture(); f.tools.remove();
    expect(document.getElementById('lastro-tools-opener')).toBeNull(); expect(document.getElementById('lastro-tools-dock')).toBeNull();
    f.tools.append(); expect(f.root().querySelector('.lastro-main-view')).not.toBeNull();
    f.controller.setEnabled(false); f.tools.remove();
    expect(document.getElementById('lastro-tools-dock')).toBeNull();
    f.tools.append(); expect(document.getElementById('lastro-tools-dock')).not.toBeNull();
    expect(document.getElementById('lastro-tools-opener')).toBeNull();
  });
});
