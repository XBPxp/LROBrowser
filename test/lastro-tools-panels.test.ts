// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

const panelsSource = readFileSync('scripts/lastro-tools-panels.mjs', 'utf8').replace('export function ', 'function ');
const install = runInNewContext(`${panelsSource}\ninstallLastroToolsPanels;`);
const toolsCssSource = readFileSync('scripts/lastro-tools-style.mjs', 'utf8').replace('export const ', 'const ');
const toolsCss = runInNewContext(`${toolsCssSource}\nLASTRO_TOOLS_CSS;`) as string;
const onlineSource = readFileSync('vendor/v2/Online.js', 'utf8');
const sectionStart = onlineSource.indexOf('function patchLastROToolsTemplate()');
const originalSource = onlineSource.slice(sectionStart, onlineSource.indexOf('//#endregion', sectionStart));
const ast = ts.createSourceFile('LastROTools.js', originalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function originalAssignment(name: string) {
  let found: ts.BinaryExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === name && !found) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!found) throw new Error(`Missing original ${name}`);
  return found.right.getText(ast);
}
const originalTemplate = runInNewContext(originalAssignment('LastROTools_default$1')) as string;
const originalInitSource = originalAssignment('LastROTools.init');

type Route = { npc: string; desc: string; outset: [string, number, number]; path: [string, number, number][] };
type Catalog = Record<string, Record<string, Route>>;
const route = (name: string, map = 'prontera'): Route => ({ npc: name, desc: `${name}说明`, outset: [map, 100, 184], path: [[map, 100, 184]] });
const defaults = (): Catalog => ({ npc: { a: route('地点甲'), b: route('地点乙'), c: route('地点丙') }, train: { t: route('练级地点', 'pay_fild01') }, boss: { boss: route('BOSS 地点', 'moc_fild17') } });
const originalViewport = { width: window.innerWidth, height: window.innerHeight };
// Capture the actual DOM implementation before any fixture installs a spy.
// Vitest 4 reuses an existing spy, so binding it inside a second fixture would
// make the replacement call itself when a saved panel is reloaded in one test.
const originalGetComputedStyle = window.getComputedStyle.bind(window);
const mountedTools: Array<{ remove: () => void }> = [];

function fixture(options: { preferences?: unknown; storage?: Map<string, unknown>; catalogs?: Record<string, Catalog>; profile?: string; confirm?: boolean;
  persist?: false | ((value: Record<string, unknown>, commit: () => void) => unknown); getCurrentLocation?: () => unknown } = {}) {
  const storage = options.storage ?? new Map<string, unknown>([['1', Object.hasOwn(options, 'preferences') ? options.preferences : { orders: {} }]]);
  let profile = options.profile ?? '1';
  const catalogs = options.catalogs ?? { '1': defaults() };
  const saved = vi.fn();
  const requestRoute = vi.fn<(route: Route) => string | Promise<string | null>>(() => 'teleport');
  const confirmations: Array<{ yes: () => void; no: () => void; popup: { onRemove?: () => void; remove: () => void } }> = [];
  const showPrompt = vi.fn((_message: string, yes: () => void, no: () => void) => {
    const popup = { onRemove: undefined as (() => void) | undefined, remove: vi.fn(() => popup.onRemove?.()) };
    confirmations.push({ popup, yes: () => { popup.remove(); yes(); }, no: () => { popup.remove(); no(); } });
    return popup;
  });
  const cancelRoute = vi.fn(), routeMapChanged = vi.fn(), routeMapChanging = vi.fn(), cancelPendingRoute = vi.fn();
  const loadPreferences = vi.fn(() => {
    const savedProfile = profile;
    const stored = storage.get(profile);
    if (!stored || typeof stored !== 'object') return stored;
    const value = JSON.parse(JSON.stringify(stored));
    if (options.persist !== false) value.save = function (this: Record<string, unknown>) {
      const commit = () => { storage.set(savedProfile, JSON.parse(JSON.stringify(this))); saved(); };
      if (options.persist) return options.persist(this, commit);
      commit();
    };
    return value;
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  class GUIComponent {
    _host = document.createElement('div');
    _root = this._host.attachShadow({ mode: 'open' });
    _cssText: string;
    __active = false;
    render = () => '';
    init = () => {};
    onAppend = () => {};
    onRemove = () => {};
    onDragEnd?: () => void;
    onResize = () => {};
    _fixPositionOverflow = () => {};
    draggable = vi.fn();
    focus = vi.fn();
    _setupScrollbars = vi.fn();
    constructor(public name: string, css: string) { this._cssText = css; this._host.dataset.component = name; this._host.style.zIndex = '50'; }
    getRoot() { return this._root; }
    append() {
      if (!this._root.childNodes.length) {
        const template = document.createElement('template');
        setLastROInnerHTML(template, this.render()); this._root.replaceChildren(template.content); this.init();
      }
      document.body.append(this._host); this.__active = true; this.onAppend();
    }
    remove() { this.__active = false; this.onRemove(); this._host.remove(); }
  }
  const tools = Object.assign(new GUIComponent('LastROTools', ''), {
    render: () => originalTemplate,
    _quickRoutes: {} as Catalog,
    loadQuickRoutes: vi.fn(() => {}),
    populateSkillSelects: vi.fn(), populateItemSelects: vi.fn(),
    setAutomationOption: vi.fn(), updateField: vi.fn(), submitAssistSkill: vi.fn(),
    minimizePanel: vi.fn(), hidePanel: vi.fn(), restorePanel: vi.fn(),
    runQuickRoute: vi.fn(),
    setStatus: vi.fn(),
    onMapChanged: vi.fn(),
    ensurePanelOpener: (): HTMLElement | null => null,
  });
  tools.hidePanel.mockImplementation(() => { tools._host.style.display = 'none'; });
  tools.restorePanel.mockImplementation(() => { tools._host.style.display = ''; });
  tools.init = runInNewContext(`(${originalInitSource})`, {
    installLastRORandomTeleportShortcut() {},
    showLastROSettingsView() {}, showLastROMainView() {}, activateLastROSettingsTab() {},
  });
  const previousRemove = vi.fn(); tools.onRemove = previousRemove;
  const UIManager = { addComponent: vi.fn((component: GUIComponent) => component) };
  const normalizeRoute = vi.fn((value: Route) => {
    if (!value || typeof value.npc !== 'string' || !Array.isArray(value.path) || !value.path.length) throw new Error('Invalid route');
    return value;
  });
  const deps = {
    document, window, GUIComponent, UIManager, setHtml: setLastROInnerHTML, normalizeRoute, requestRoute, loadPreferences,
    getProfile: () => profile, getPresetRoutes: () => catalogs[profile] ?? {},
    getCurrentLocation: options.getCurrentLocation,
    showPrompt: options.confirm ? showPrompt : undefined, cancelRoute, routeMapChanged, routeMapChanging, cancelPendingRoute,
  };
  const api = install(tools, deps, '') as {
    teleport: GUIComponent; showAutomation: () => void; showTeleport: () => void; select: (category: string) => void;
    ordered: (category: string) => string[];
    onMapChanging: () => void; cancelRoute: () => void;
    deactivate: () => void; refreshEntry: () => void; requestCustomRoute: (route: Route) => void;
  };
  tools.append();
  mountedTools.push(tools);
  const root = () => api.teleport.getRoot();
  const list = () => root().querySelector<HTMLElement>('.lastro-route-list')!;
  const ids = () => [...list().querySelectorAll<HTMLElement>('[data-route-id]')].map(node => node.dataset.routeId);
  const row = (id: string) => list().querySelector<HTMLElement>(`[data-route-id="${id}"]`)!;
  const handle = (id: string) => row(id).querySelector<HTMLElement>('[data-sort-handle]')!;
  const key = (id: string, direction: string) => handle(id).dispatchEvent(new KeyboardEvent('keydown', { key: direction, bubbles: true, cancelable: true }));
  const pointer = (target: Element, type: string, y: number, pointerId = 1) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: pointerId }); target.dispatchEvent(event);
  };
  const measureRows = () => {
    for (const node of list().querySelectorAll<HTMLElement>('[data-route-id]')) vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => {
      const top = [...list().children].indexOf(node) * 60;
      return { top, height: 40, bottom: top + 40, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) };
    });
    vi.spyOn(root().querySelector<HTMLElement>('.lastro-route-scroll')!, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 280, bottom: 280, left: 0, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) });
  };
  const measurePanels = (scale = 1, origin = { x: 0, y: 0 }) => {
    const hosts = new Set([tools._host, api.teleport._host]);
    const layoutSize = (host: HTMLElement, axis: 'width' | 'height') => Math.min(
      parseFloat(host.style[axis]) || (axis === 'width' ? 520 : 390),
      parseFloat(host.style[axis === 'width' ? 'maxWidth' : 'maxHeight']) || Infinity,
    );
    for (const host of hosts) {
      Object.defineProperties(host, {
        offsetWidth: { get: () => Math.round(layoutSize(host, 'width')) },
        offsetHeight: { get: () => Math.round(layoutSize(host, 'height')) },
        offsetLeft: { get: () => parseFloat(host.style.left) || 0 },
        offsetTop: { get: () => parseFloat(host.style.top) || 0 },
      });
      vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => {
        const left = origin.x + host.offsetLeft * scale, top = origin.y + host.offsetTop * scale;
        const width = layoutSize(host, 'width') * scale, height = layoutSize(host, 'height') * scale;
        return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) };
      });
    }
    // jsdom does not resolve used max-constrained sizes or ancestor CSS zoom.
    // Model those browser measurements while exercising the actual installer.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node, pseudo) => {
      const style = originalGetComputedStyle(node, pseudo);
      if (!hosts.has(node as HTMLDivElement)) return style;
      return new Proxy(style, {
        get(target, property) {
          if (property === 'width' || property === 'height') return `${layoutSize(node as HTMLElement, property)}px`;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
  };
  const setViewport = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    window.dispatchEvent(new Event('resize'));
  };
  return { api, tools, root, list, ids, row, handle, key, pointer, measureRows, saved, storage, catalogs, requestRoute, previousRemove, loadPreferences,
    showPrompt, confirmations, cancelRoute, routeMapChanged, routeMapChanging, cancelPendingRoute, measurePanels, setViewport,
    setProfile: (value: string) => { profile = value; } };
}

afterEach(() => {
  try { mountedTools.splice(0).forEach(tools => tools.remove()); }
  finally {
    document.body.replaceChildren(); vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalViewport.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalViewport.height });
  }
});

function fillCustom(f: ReturnType<typeof fixture>, fields: Partial<Record<'name' | 'desc' | 'map' | 'x' | 'y', string>> = {}) {
  const form = f.root().querySelector<HTMLFormElement>('[data-custom-form]')!;
  if (form.hidden) f.root().querySelector<HTMLButtonElement>('[data-add-place]')!.click();
  for (const [name, value] of Object.entries({ name: '我的地点', desc: '日后使用', map: 'prontera', x: '100', y: '184', ...fields })) {
    (form.elements.namedItem(name) as HTMLInputElement).value = value;
  }
  return form;
}

type CustomPlace = { id: string; name: string; desc: string; map: string; x: number; y: number };
const savedPlace = (fields: Partial<CustomPlace> = {}): CustomPlace => ({ id: 'place-1', name: '我的地点', desc: '日后使用', map: 'prontera', x: 100, y: 184, ...fields });
const storedPlaces = (f: ReturnType<typeof fixture>, profile = '1') => (f.storage.get(profile) as { customPlaces?: { version: number; entries: CustomPlace[] } })?.customPlaces?.entries ?? [];

describe('compact tools content', () => {
  const declaration = (selector: string, property: string) => {
    const start = toolsCss.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`Missing style ${selector}`);
    const block = toolsCss.slice(start, toolsCss.indexOf('}', start));
    const value = block.match(new RegExp(`(?:[;{]\\s*)${property.replaceAll('-', '\\-')}:([^;]+)`))?.[1]?.trim();
    if (!value) throw new Error(`Missing ${selector} ${property}`);
    return value;
  };
  it('shrinks controls and destination rows once and applies the requested 75 percent size to both sets of tabs', () => {
    for (const [selector, property, original] of [
      ['.lastro-settings-view,.lastro-teleport-body', 'font-size', 14], ['.lastro-button', 'font-size', 13],
      ['.lastro-button', 'min-height', 27], ['.lastro-line', 'min-height', 31],
      ['.lastro-tools input:not([type=checkbox]),.lastro-tools select', 'height', 24],
      ['.lastro-tools input[type=checkbox]', 'width', 15], ['.lastro-route-row', 'min-height', 73],
      ['.lastro-route-name', 'font-size', 15], ['.lastro-route-desc', 'font-size', 12], ['.lastro-route-go', 'min-width', 52],
    ] as const) expect(parseFloat(declaration(selector, property))).toBe(original * .75);
    expect(declaration('.lastro-tab', 'font-size')).toBe('10.5px');
    expect(declaration('.lastro-tab', 'padding')).toBe('3.75px 2.25px');
    expect(declaration('.lastro-tab', 'line-height')).toBe('15.75px');
    expect(declaration('.lastro-tab', 'min-width')).toBe('31.5px');
    expect(declaration('.lastro-tabs', 'gap')).toBe('2.25px');
    expect(declaration('.lastro-tabs', 'padding')).toBe('0 0 5.25px');
    expect(declaration('.lastro-tabs', 'margin')).toBe('0 0 6px');
    expect(declaration('.lastro-route-tabs .lastro-tab', 'font-size')).toBe('9.75px');
    expect(declaration('.lastro-route-tabs .lastro-tab', 'line-height')).toBe('15.75px');
    expect(declaration('.lastro-route-tabs .lastro-tab', 'padding')).toBe('3.75px 1.5px');
    expect(declaration('.lastro-route-tabs .lastro-tab', 'min-width')).toBe('31.5px');
    expect(declaration('.lastro-route-tabs', 'padding')).toBe('0 0 5.25px');
    expect(declaration('.lastro-route-tabs', 'margin')).toBe('0 0 6px');
    expect(declaration('.lastro-route-tabs', 'gap')).toBe('.75px');
    expect(declaration('.lastro-custom-group-tabs .lastro-tab', 'padding-inline')).toBe('3.75px');
    expect(declaration('.lastro-custom-source-tabs', 'margin-bottom')).toBe('3.75px');
  });
  it('preserves window and scroll viewport geometry without scaling the entire component', () => {
    expect(declaration(':host', 'width')).toBe('520px');
    expect(declaration('.lastro-settings-body', 'height')).toBe('325px');
    expect(declaration('.lastro-route-scroll', 'height')).toBe('280px');
    expect(declaration('.lastro-ro-titlebar', 'height')).toBe('20px');
    expect(declaration('.lastro-window-resize', 'width')).toBe('13px');
    for (const selector of [':host', '.lastro-tools', '.ui-component-root']) {
      const start = toolsCss.indexOf(`${selector} {`), block = toolsCss.slice(start, toolsCss.indexOf('}', start));
      expect(block).not.toMatch(/\b(?:zoom|transform)\s*:/);
    }
    expect(toolsCss).not.toContain('lastro-route-pagination');
  });
});

describe('saved custom destinations', () => {
  const source = (f: ReturnType<typeof fixture>, id: string) => f.root().querySelector<HTMLButtonElement>(`[data-custom-source="${id}"]`)!.click();
  const importedCustom = JSON.parse(readFileSync('scripts/lastro-teleport-routes.json', 'utf8')).upstreamCustomRoutes as Record<string, Route & { group?: string }>;
  it('preserves the exact upstream source categories and optgroup labels and shows each complete group with all 150 entries accessible', () => {
    const f = fixture({ catalogs: { '1': { ...defaults(), custom: importedCustom } }, preferences: { category: 'custom' } }); f.api.showTeleport();
    expect([...f.root().querySelectorAll('[data-custom-source]')].map(tab => tab.textContent)).toEqual(['常用地点', '洞穴传送', '野外地图', '我的地点']);
    expect(f.ids()).toEqual([]);
    const found = new Set<string>();
    for (const [id, labels] of [
      ['guide', ['首都功能服务', '城市与交通枢纽', '各地室外商人', '任务NPC']],
      ['train', ['经典地下城', '地区与扩展地下城', '高等级与剧情区域', '古城传送点']],
      ['wild', []],
    ] as const) {
      source(f, id);
      expect([...f.root().querySelectorAll('[data-custom-group]')].map(tab => tab.textContent)).toEqual([...labels]);
      const groups = [...f.root().querySelectorAll<HTMLElement>('[data-custom-group]')].map(tab => tab.dataset.customGroup!);
      for (const group of groups.length ? groups : [null]) {
        if (group != null) f.root().querySelector<HTMLButtonElement>(`[data-custom-group="${group}"]`)!.click();
        const expected = Object.entries(importedCustom).filter(([key, route]) => key.startsWith(`upstream:${id}:`) && (group == null || route.group === group)).map(([key]) => `preset:${key}`);
        expect(f.ids()).toEqual(expected); f.ids().forEach(value => found.add(value!));
        if (group === '经典地下城') expect(f.ids()).toHaveLength(28);
        if (group === '城市与交通枢纽') expect(f.ids()).toHaveLength(22);
        expect(f.root().querySelector('[data-page-next]')).toBeNull();
      }
    }
    expect(found.size).toBe(150); expect([...found].sort()).toEqual(Object.keys(importedCustom).map(id => `preset:${id}`).sort());
    expect(f.requestRoute).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
  });

  it('keeps other-group ordering intact during keyboard and pointer reordering in a complete group', () => {
    const f = fixture({ catalogs: { '1': { ...defaults(), custom: importedCustom } }, preferences: { category: 'custom', orders: {} } }); f.api.showTeleport();
    source(f, 'guide'); f.root().querySelector<HTMLButtonElement>('[data-custom-group="城市与交通枢纽"]')!.click();
    const all = f.api.ordered('custom'), visible = f.ids() as string[];
    expect(visible).toHaveLength(22);
    f.key(visible[0]!, 'ArrowDown'); expect(f.ids().slice(0, 2)).toEqual([visible[1], visible[0]]);
    const stored = (f.storage.get('1') as { orders: { custom: string[] } }).orders.custom;
    expect(stored).toHaveLength(150); expect(stored.filter(id => !visible.includes(id))).toEqual(all.filter(id => !visible.includes(id)));
    const last = visible.at(-1)!;
    f.measureRows(); f.pointer(f.handle(last), 'pointerdown', 1280); f.pointer(f.list(), 'pointermove', 0); f.pointer(f.list(), 'pointerup', 0);
    expect(f.ids().slice(0, 3)).toEqual([last, visible[1], visible[0]]);
    expect((f.storage.get('1') as { orders: { custom: string[] } }).orders.custom.filter(id => !visible.includes(id))).toEqual(stored.filter(id => !visible.includes(id)));
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('resets ordering only in the selected upstream group and preserves another group’s custom order', () => {
    const all = Object.keys(importedCustom).map(id => `preset:${id}`);
    const city = all.filter(id => importedCustom[id.slice(7)]?.group === '城市与交通枢纽'), wild = all.filter(id => id.startsWith('preset:upstream:wild:'));
    const swap = (ids: string[], left: string, right: string) => ids.map(id => id === left ? right : id === right ? left : id);
    const expected = swap(all, wild[0]!, wild[1]!), customOrder = swap(expected, city[0]!, city[1]!);
    const f = fixture({ catalogs: { '1': { ...defaults(), custom: importedCustom } }, preferences: { category: 'custom', orders: { custom: customOrder } } }); f.api.showTeleport();
    source(f, 'guide'); f.root().querySelector<HTMLButtonElement>('[data-custom-group="城市与交通枢纽"]')!.click();
    expect(f.ids().slice(0, 2)).toEqual([city[1], city[0]]);
    f.root().querySelector<HTMLButtonElement>('[data-reset-order]')!.click();
    expect(f.ids().slice(0, 2)).toEqual([city[0], city[1]]);
    expect((f.storage.get('1') as { orders: { custom: string[] } }).orders.custom).toEqual(expected);
  });
  it('shows imported and saved custom destinations in distinct source tabs without editing the presets', () => {
    const custom = { 'place-1': route('上游额外 NPC', 'izlude') };
    const f = fixture({ catalogs: { '1': { ...defaults(), custom } }, preferences: { category: 'custom', orders: {}, customPlaces: { version: 1, entries: [savedPlace()] } } });
    f.api.showTeleport();
    expect(f.ids()).toEqual(['user:place-1']);
    expect(f.root().querySelector<HTMLElement>('.lastro-route-scroll')?.hidden).toBe(false);
    expect(f.root().querySelector<HTMLFormElement>('[data-custom-form]')?.hidden).toBe(true);
    expect(f.root().querySelector<HTMLElement>('[data-custom-toolbar]')?.hidden).toBe(false);
    expect(f.row('user:place-1').querySelector('[data-edit-place]')).not.toBeNull();
    expect(f.row('user:place-1').textContent).toContain('自定义 / 我的地点 · prontera 100,184');
    source(f, 'other'); expect(f.ids()).toEqual(['preset:place-1']);
    expect(f.row('preset:place-1').querySelector('[data-edit-place]')).toBeNull();
    expect(f.row('preset:place-1').textContent).toContain('自定义 / 其他地点 · izlude 100,184');
    expect(custom).toEqual({ 'place-1': route('上游额外 NPC', 'izlude') });
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  const search = (f: ReturnType<typeof fixture>, query: string) => {
    const input = f.root().querySelector<HTMLInputElement>('[data-search-routes]')!;
    input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  it('places search after custom and searches every category with source labels and safe go actions', () => {
    const custom = { extra: { ...route('上游商人', 'izlude'), desc: '购买材料' } };
    const f = fixture({ confirm: true, catalogs: { '1': { ...defaults(), custom } }, preferences: { category: 'search', customPlaces: { version: 1, entries: [savedPlace({ name: '我的秘密营地', map: 'secret_map' })] } } });
    f.api.showTeleport();
    expect([...f.root().querySelectorAll<HTMLElement>('[data-category]')].slice(-2).map(tab => tab.dataset.category)).toEqual(['custom', 'search']);
    expect(f.root().querySelector<HTMLElement>('[data-search-toolbar]')?.hidden).toBe(false);
    expect(f.root().querySelector<HTMLElement>('[data-custom-toolbar]')?.hidden).toBe(true);
    for (const query of ['秘密营地', 'SECRET_MAP', '日后使用']) { search(f, query); expect(f.ids()).toEqual(['custom:user:place-1']); }
    for (const query of ['上游商人', 'IZLUDE', '购买材料']) { search(f, query); expect(f.ids()).toEqual(['custom:preset:extra']); }
    for (const query of ['100,184', '100 184']) { search(f, query); expect(f.ids()).toHaveLength(7); }
    search(f, '练级地点'); expect(f.ids()).toEqual(['train:t']); expect(f.row('train:t').textContent).toContain('练级 · pay_fild01 100,184');
    search(f, 'BOSS 地点'); expect(f.ids()).toEqual(['boss:boss']);
    search(f, '地点甲'); expect(f.ids()).toEqual(['npc:a']); expect(f.row('npc:a').textContent).toContain('NPC · prontera 100,184');
    expect(f.requestRoute).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
    f.row('npc:a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click(); expect(f.requestRoute).not.toHaveBeenCalled();
    f.confirmations[0]!.yes(); expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(f.catalogs['1']!.npc!.a);
  });

  it('shows every matching search result in a single scroll list without dropping saved destinations', () => {
    const custom = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`upstream:guide:entry-${index}`, { ...route(`共享上游地点 ${index}`), group: '首都功能服务' }]));
    const f = fixture({ catalogs: { '1': { npc: { first: route('共享主分类') }, custom } },
      preferences: { category: 'search', orders: {}, customPlaces: { version: 1, entries: [savedPlace({ name: '共享用户地点' })] } } });
    f.api.showTeleport(); search(f, '共享');
    expect(f.ids()).toHaveLength(47); expect(f.ids()[0]).toBe('npc:first');
    expect(f.root().querySelector('[data-route-pagination]')).toBeNull();
    expect(f.row('custom:preset:upstream:guide:entry-0').textContent).toContain('自定义 / 常用地点 / 首都功能服务');
    const results = new Set(f.ids());
    expect(results.size).toBe(47); expect(f.row('custom:user:place-1').querySelector('[data-edit-place]')).not.toBeNull();
    expect(storedPlaces(f)).toEqual([savedPlace({ name: '共享用户地点' })]); expect(f.saved).not.toHaveBeenCalled();
    search(f, '共享用户地点'); expect(f.ids()).toEqual(['custom:user:place-1']);
    expect(f.root().querySelector('[data-route-pagination]')).toBeNull();
  });

  it('shows an empty search result and clears it without mutating stored records or their original order', () => {
    const orders = { custom: ['user:place-2', 'preset:extra', 'user:place-1'] }, entries = [savedPlace(), savedPlace({ id: 'place-2', name: '第二个地点' })];
    const f = fixture({ catalogs: { '1': { ...defaults(), custom: { extra: route('上游地点') } } }, preferences: { category: 'search', orders, customPlaces: { version: 1, entries } } });
    f.api.showTeleport(); search(f, '不存在'); expect(f.ids()).toEqual([]);
    expect(f.list().textContent).toContain('未找到匹配地点'); expect(f.root().querySelector('[data-search-results]')?.textContent).toBe('找到 0 个地点');
    expect(f.root().querySelector<HTMLButtonElement>('[data-reset-order]')?.hidden).toBe(true);
    f.root().querySelector<HTMLButtonElement>('[data-clear-route-search]')!.click();
    expect(f.ids()).toEqual([]); expect(f.list().textContent).toContain('请输入名称');
    expect(f.root().querySelector<HTMLInputElement>('[data-search-routes]')?.value).toBe('');
    expect(storedPlaces(f)).toEqual(entries); expect((f.storage.get('1') as { orders: unknown }).orders).toEqual(orders);
    expect(f.saved).not.toHaveBeenCalled();
  });

  it('never sorts search results and restores saved-place sorting in the custom page', () => {
    const entries = [savedPlace(), savedPlace({ id: 'place-2', name: '第二个地点' })];
    const f = fixture({ preferences: { category: 'search', orders: {}, customPlaces: { version: 1, entries } } }); f.api.showTeleport();
    search(f, '我的'); expect(f.ids()).toEqual(['custom:user:place-1']);
    expect((f.handle('custom:user:place-1') as HTMLButtonElement).disabled).toBe(true);
    f.key('custom:user:place-1', 'ArrowDown'); f.measureRows();
    f.pointer(f.handle('custom:user:place-1'), 'pointerdown', 10); f.pointer(f.list(), 'pointermove', 150); f.pointer(f.list(), 'pointerup', 150);
    f.root().querySelector<HTMLButtonElement>('[data-reset-order]')!.click();
    expect(f.saved).not.toHaveBeenCalled(); expect(storedPlaces(f)).toEqual(entries);
    search(f, ''); f.api.select('custom'); f.saved.mockClear(); f.key('user:place-1', 'ArrowDown');
    expect(f.ids()).toEqual(['user:place-2', 'user:place-1']);
    expect((f.storage.get('1') as { orders: { custom: string[] } }).orders.custom).toEqual(['user:place-2', 'user:place-1']);
    expect(storedPlaces(f)).toEqual(entries); expect(f.saved).toHaveBeenCalledOnce();
  });

  it('retains hidden destinations when editing a filtered result and recomputes results after saving its name', () => {
    const entries = [savedPlace(), savedPlace({ id: 'place-2', name: '第二个地点' })];
    const f = fixture({ preferences: { category: 'search', orders: {}, customPlaces: { version: 1, entries } } }); f.api.showTeleport(); search(f, '我的');
    f.row('custom:user:place-1').querySelector<HTMLButtonElement>('[data-edit-place]')!.click();
    fillCustom(f, { name: '新的名字' }); f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(f.ids()).toEqual([]); expect(storedPlaces(f).map(place => place.name)).toEqual(['新的名字', '第二个地点']);
    expect(f.root().querySelector<HTMLInputElement>('[data-search-routes]')?.value).toBe('我的');
    search(f, '新的名字'); expect(f.ids()).toEqual(['custom:user:place-1']);
    expect(f.storage.get('1')).not.toHaveProperty('searchQuery'); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('keeps search temporary, does not filter other categories, and clears search after a server switch', () => {
    const storage = new Map<string, unknown>([
      ['1', { category: 'search', orders: {}, customPlaces: { version: 1, entries: [savedPlace()] } }],
      ['2', { category: 'custom', orders: {}, customPlaces: { version: 1, entries: [savedPlace({ name: '二区地点' })] } }],
    ]);
    const f = fixture({ storage }); f.api.showTeleport(); search(f, '我的'); f.api.select('npc');
    expect(f.ids()).toEqual(['a', 'b', 'c']); expect(f.root().querySelector<HTMLElement>('[data-custom-toolbar]')?.hidden).toBe(true);
    expect(f.storage.get('1')).not.toHaveProperty('searchQuery');
    f.setProfile('2'); f.api.showTeleport(); expect(f.ids()).toEqual(['user:place-1']);
    expect(f.root().querySelector<HTMLInputElement>('[data-search-routes]')?.value).toBe('');
    f.tools.remove(); const next = fixture({ storage, profile: '1' }); next.api.showTeleport(); next.api.select('custom');
    expect(next.root().querySelector<HTMLInputElement>('[data-search-routes]')?.value).toBe(''); expect(next.ids()).toEqual(['user:place-1']);
  });

  it('saves a destination with normalized map and a default name across reopening and creating a new tools instance', () => {
    const f = fixture(); f.api.showTeleport(); f.api.select('custom'); f.saved.mockClear();
    fillCustom(f, { name: '', desc: '', map: 'PRONTERA.GAT', x: '0', y: '65535' });
    f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f)).toEqual([savedPlace({ name: 'prontera 0,65535', desc: '', x: 0, y: 65535 })]);
    expect(f.saved).toHaveBeenCalledOnce(); expect(f.requestRoute).not.toHaveBeenCalled();
    expect(f.root().querySelector('[role="status"]')?.textContent).toBe('自定义地点已保存');
    f.api.teleport.remove(); f.api.showTeleport(); expect(f.ids()).toEqual(['user:place-1']);
    f.tools.remove();
    const next = fixture({ storage: f.storage }); next.api.showTeleport();
    expect(next.ids()).toEqual(['user:place-1']);
    expect(next.row('user:place-1').textContent).toContain('prontera 0,65535');
    expect(next.requestRoute).not.toHaveBeenCalled();
  });

  it.each(['adding', 'editing', 'editing from search'])('reads current location while %s without changing the name or notes or automatically saving or teleporting', mode => {
    const getCurrentLocation = vi.fn(() => ({ map: 'IZLUDE.GAT', x: 0, y: 65535 }));
    const f = fixture({ getCurrentLocation, preferences: { category: mode === 'editing from search' ? 'search' : 'custom', orders: {}, customPlaces: { version: 1, entries: [savedPlace()] } } });
    f.api.showTeleport();
    if (mode === 'editing') f.row('user:place-1').querySelector<HTMLButtonElement>('[data-edit-place]')!.click();
    else if (mode === 'editing from search') { search(f, '我的地点'); f.row('custom:user:place-1').querySelector<HTMLButtonElement>('[data-edit-place]')!.click(); }
    const form = fillCustom(f, { name: '自定义名字', desc: '保留这段备注', map: 'payon', x: '12', y: '34' });
    f.root().querySelector<HTMLButtonElement>('[data-read-current-location]')!.click();
    expect(getCurrentLocation).toHaveBeenCalledOnce();
    expect((form.elements.namedItem('name') as HTMLInputElement).value).toBe('自定义名字');
    expect((form.elements.namedItem('desc') as HTMLInputElement).value).toBe('保留这段备注');
    expect((form.elements.namedItem('map') as HTMLInputElement).value).toBe('izlude');
    expect((form.elements.namedItem('x') as HTMLInputElement).value).toBe('0');
    expect((form.elements.namedItem('y') as HTMLInputElement).value).toBe('65535');
    expect(f.root().querySelector('[role="status"]')?.textContent).toBe('已读取当前位置：izlude 0,65535');
    expect(storedPlaces(f)).toEqual([savedPlace()]); expect(f.saved).not.toHaveBeenCalled(); expect(f.requestRoute).not.toHaveBeenCalled();
    form.querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f)).toContainEqual(savedPlace({ id: mode === 'adding' ? 'place-2' : 'place-1', name: '自定义名字', desc: '保留这段备注', map: 'izlude', x: 0, y: 65535 }));
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it.each([undefined, null, { map: '../prontera', x: 10, y: 20 }, { map: 'map_name_too_long_17', x: 10, y: 20 },
    { map: 'prontera', x: '10', y: 20 }, { map: 'prontera', x: 1.5, y: 20 }, { map: 'prontera', x: -1, y: 20 },
    { map: 'prontera', x: 65536, y: 20 }, { map: 'prontera', x: 10, y: NaN }, { map: 'prontera', x: 10, y: Infinity }, { map: 'prontera', x: 10 }])('preserves every draft field when current location is unavailable or invalid: %j', location => {
    const f = fixture({ getCurrentLocation: () => location, preferences: { category: 'custom', orders: {} } }); f.api.showTeleport();
    const form = fillCustom(f, { name: '保持名称', desc: '保持备注', map: 'payon', x: '12', y: '34' });
    const fields = () => Object.fromEntries(['name', 'desc', 'map', 'x', 'y'].map(name => [name, (form.elements.namedItem(name) as HTMLInputElement).value]));
    const previous = fields(); f.root().querySelector<HTMLButtonElement>('[data-read-current-location]')!.click();
    expect(fields()).toEqual(previous); expect(f.root().querySelector('[role="status"]')?.textContent).toBe('角色或地图尚未就绪，无法读取当前位置，请稍后重试。');
    expect(f.saved).not.toHaveBeenCalled(); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('handles a missing or throwing location service without clearing draft coordinates', () => {
    for (const getCurrentLocation of [undefined, () => { throw new Error('Map is loading'); }]) {
      const f = fixture({ getCurrentLocation, preferences: { category: 'custom', orders: {} } }); f.api.showTeleport();
      const form = fillCustom(f); f.root().querySelector<HTMLButtonElement>('[data-read-current-location]')!.click();
      expect((form.elements.namedItem('map') as HTMLInputElement).value).toBe('prontera');
      expect((form.elements.namedItem('x') as HTMLInputElement).value).toBe('100');
      expect((form.elements.namedItem('y') as HTMLInputElement).value).toBe('184');
      expect(f.root().querySelector('[role="status"]')?.textContent).toContain('角色或地图尚未就绪');
      expect(f.saved).not.toHaveBeenCalled(); expect(f.requestRoute).not.toHaveBeenCalled(); f.tools.remove();
    }
  });

  it('keeps saving separate from teleporting and reuses the checked route request only after a go confirmation', () => {
    const f = fixture({ confirm: true }); f.api.showTeleport(); f.api.select('custom');
    fillCustom(f); f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(f.requestRoute).not.toHaveBeenCalled(); expect(f.showPrompt).not.toHaveBeenCalled();
    f.row('user:place-1').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    expect(f.requestRoute).not.toHaveBeenCalled(); f.confirmations[0]!.yes();
    expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ npc: '我的地点', outset: ['prontera', 100, 184], path: [['prontera', 100, 184]] }));
  });

  it('edits and deletes saved destinations without changing presets, route ordering, or window geometry', () => {
    const geometry = { teleport: { width: 480, height: 420, x: 20, y: 30 } }, orders = { npc: ['c', 'a', 'b'], custom: ['user:place-1', 'preset:extra'] };
    const f = fixture({ confirm: true, catalogs: { '1': { ...defaults(), custom: { extra: route('上游入口') } } },
      preferences: { category: 'custom', orders, geometry, customPlaces: { version: 1, entries: [savedPlace()] } } });
    f.api.showTeleport(); f.row('user:place-1').querySelector<HTMLButtonElement>('[data-edit-place]')!.click();
    const form = f.root().querySelector<HTMLFormElement>('[data-custom-form]')!;
    expect((form.elements.namedItem('map') as HTMLInputElement).value).toBe('prontera');
    expect(form.querySelector('[data-save-place]')?.textContent).toBe('保存修改');
    fillCustom(f, { name: '修改后的地点', map: 'izlude', x: '5', y: '6' });
    form.querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f)).toEqual([savedPlace({ name: '修改后的地点', map: 'izlude', x: 5, y: 6 })]);
    expect(f.ids()).toEqual(['user:place-1']);
    const stored = f.storage.get('1') as { orders: unknown; geometry: unknown };
    expect(stored.orders).toEqual(orders); expect(stored.geometry).toEqual(geometry);
    f.row('user:place-1').querySelector<HTMLButtonElement>('[data-delete-place]')!.click();
    expect(f.showPrompt).toHaveBeenCalledWith('是否删除自定义地点“修改后的地点”？', expect.any(Function), expect.any(Function));
    f.confirmations[0]!.no(); expect(storedPlaces(f)).toHaveLength(1);
    f.row('user:place-1').querySelector<HTMLButtonElement>('[data-delete-place]')!.click(); f.confirmations[1]!.yes();
    expect(storedPlaces(f)).toEqual([]); expect(f.ids()).toEqual([]); source(f, 'other'); expect(f.ids()).toEqual(['preset:extra']);
    expect((f.storage.get('1') as { orders: unknown; geometry: unknown }).orders).toEqual(orders);
    expect((f.storage.get('1') as { geometry: unknown }).geometry).toEqual(geometry);
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('cancels editing without modifying storage and does not reuse an edit draft after closing', () => {
    const f = fixture({ preferences: { category: 'custom', orders: {}, customPlaces: { version: 1, entries: [savedPlace()] } } }); f.api.showTeleport();
    f.row('user:place-1').querySelector<HTMLButtonElement>('[data-edit-place]')!.click(); fillCustom(f, { name: '未保存' });
    f.root().querySelector<HTMLButtonElement>('[data-cancel-edit]')!.click();
    expect(storedPlaces(f)).toEqual([savedPlace()]); expect(f.saved).not.toHaveBeenCalled();
    f.row('user:place-1').querySelector<HTMLButtonElement>('[data-edit-place]')!.click();
    f.api.teleport.remove(); f.api.showTeleport();
    expect((f.root().querySelector<HTMLFormElement>('[data-custom-form]')!.elements.namedItem('name') as HTMLInputElement).value).toBe('');
    expect(f.root().querySelector('[data-save-place]')?.textContent).toBe('保存地点');
  });

  it('isolates saved custom destinations and pending deletes by server profile', () => {
    const storage = new Map<string, unknown>([
      ['1', { category: 'custom', orders: {}, customPlaces: { version: 1, entries: [savedPlace({ name: '一区地点' })] } }],
      ['2', { category: 'custom', orders: {}, customPlaces: { version: 1, entries: [savedPlace({ name: '二区地点', map: 'izlude' })] } }],
    ]);
    const f = fixture({ storage, confirm: true }); f.api.showTeleport();
    f.row('user:place-1').querySelector<HTMLButtonElement>('[data-delete-place]')!.click();
    f.setProfile('2'); f.api.showTeleport(); f.confirmations[0]!.yes();
    expect(f.row('user:place-1').textContent).toContain('二区地点');
    expect(storedPlaces(f, '1')[0]?.name).toBe('一区地点'); expect(storedPlaces(f, '2')[0]?.name).toBe('二区地点');
    fillCustom(f, { name: '二区新增' }); f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f, '2').map(place => place.name)).toEqual(['二区地点', '二区新增']);
    f.setProfile('1'); f.api.showTeleport(); expect(f.ids()).toEqual(['user:place-1']);
    expect(f.root().textContent).not.toContain('二区地点'); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it.each([{ map: '../prontera' }, { map: 'prontera.gat?x=1' }, { x: '-1' }, { x: '65536' }, { y: '1.5' }, { y: '' }, { name: 'x'.repeat(81) }, { desc: 'x'.repeat(201) }])('rejects an invalid custom destination before saving or requesting a route: %j', fields => {
    const f = fixture(); f.api.showTeleport(); f.api.select('custom'); f.saved.mockClear();
    const form = fillCustom(f, fields); f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(f.saved).not.toHaveBeenCalled(); expect(f.requestRoute).not.toHaveBeenCalled(); expect(storedPlaces(f)).toEqual([]);
    expect(f.root().querySelector('[role="status"]')?.textContent).not.toContain('已保存');
  });

  it('renders saved names and notes as text and ignores executable fields in stored data', () => {
    const name = '<img src=x onerror=alert(1)>', desc = '<script>alert(1)</script>';
    const entry = { ...savedPlace({ name, desc }), path: [['malicious', 1, 2]], html: '<iframe>' };
    const f = fixture({ preferences: { category: 'custom', customPlaces: { version: 1, entries: [entry] } } }); f.api.showTeleport();
    expect(f.row('user:place-1').textContent).toContain(name); expect(f.row('user:place-1').textContent).toContain(desc);
    expect(f.root().querySelector('img,script,iframe')).toBeNull();
    f.row('user:place-1').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    expect(f.requestRoute).toHaveBeenCalledWith(expect.objectContaining({ outset: ['prontera', 100, 184], path: [['prontera', 100, 184]] }));
  });

  it.each([undefined, null, 'broken', [], { version: 9, entries: [savedPlace()] }, { version: 1, entries: {} }])('recovers legacy or malformed custom preferences without losing presets: %j', customPlaces => {
    const f = fixture({ catalogs: { '1': { ...defaults(), custom: { extra: route('上游入口') } } }, preferences: { category: 'custom', customPlaces } });
    expect(() => f.api.showTeleport()).not.toThrow(); source(f, 'other'); expect(f.ids()).toEqual(['preset:extra']);
    fillCustom(f); f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f)).toEqual([savedPlace()]); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('ignores malformed and duplicate stored records while preserving valid destinations', () => {
    const entries = [null, savedPlace({ id: '../bad' }), savedPlace({ map: '../bad' }), savedPlace({ x: -1 }), savedPlace({ y: 1.5 }),
      { ...savedPlace(), name: {} }, savedPlace(), savedPlace({ name: '重复 id' }), savedPlace({ id: 'place-2', map: 'izlude' })];
    const f = fixture({ preferences: { category: 'custom', customPlaces: { version: 1, entries } } }); f.api.showTeleport();
    expect(f.ids()).toEqual(['user:place-1', 'user:place-2']); expect(f.root().textContent).not.toContain('重复 id');
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('does not claim or retain a successful save when native storage throws, and supports retry', () => {
    let failing = true;
    const f = fixture({ preferences: { category: 'custom', orders: { npc: ['b', 'a'] }, geometry: { teleport: { width: 520 } }, _key: 'profile-key' },
      persist(value, commit) { if (failing) { delete value.save; delete value._key; throw new Error('Quota exceeded'); } commit(); } });
    f.api.showTeleport(); fillCustom(f); f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f)).toEqual([]); expect(f.ids()).toEqual([]); expect(f.saved).not.toHaveBeenCalled();
    expect(f.root().querySelector('[role="status"]')?.textContent).toBe('本地保存失败，地点未保存，请重试。');
    failing = false; f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f)).toEqual([savedPlace()]); expect(f.saved).toHaveBeenCalledOnce();
    expect(f.storage.get('1')).toMatchObject({ _key: 'profile-key', orders: { npc: ['b', 'a'] }, geometry: { teleport: { width: 520 } } });
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('does not discard an existing destination when a delete cannot be saved', () => {
    const f = fixture({ confirm: true, preferences: { category: 'custom', customPlaces: { version: 1, entries: [savedPlace()] } }, persist() { throw new Error('Blocked storage'); } });
    f.api.showTeleport(); f.row('user:place-1').querySelector<HTMLButtonElement>('[data-delete-place]')!.click(); f.confirmations[0]!.yes();
    expect(f.ids()).toEqual(['user:place-1']); expect(storedPlaces(f)).toEqual([savedPlace()]); expect(f.saved).not.toHaveBeenCalled();
    expect(f.root().querySelector('[role="status"]')?.textContent).toContain('本地保存失败');
  });

  it('does not claim a save when the preference adapter has no save method or explicitly reports failure', () => {
    for (const persist of [false, () => false] as const) {
      const f = fixture({ preferences: { category: 'custom', orders: {} }, persist }); f.api.showTeleport(); fillCustom(f);
      f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
      expect(f.root().querySelector('[role="status"]')?.textContent).toContain('本地保存失败');
      expect(f.ids()).toEqual([]); expect(storedPlaces(f)).toEqual([]); expect(f.requestRoute).not.toHaveBeenCalled(); f.tools.remove();
    }
  });

  it('waits for asynchronous persistence and rejects stale completion UI after switching servers', async () => {
    let commitPending: (() => void) | undefined, resolve!: (value: unknown) => void;
    const f = fixture({ storage: new Map([['1', { category: 'custom', orders: {} }], ['2', { category: 'custom', orders: {} }]]),
      persist(_value, commit) { commitPending = commit; return new Promise(success => { resolve = success; }); } });
    f.api.showTeleport(); fillCustom(f); f.root().querySelector<HTMLButtonElement>('[data-save-place]')!.click();
    expect(storedPlaces(f)).toEqual([]); expect(f.ids()).toEqual([]); expect(f.root().querySelector('[role="status"]')?.textContent).not.toContain('已保存');
    f.setProfile('2'); f.api.showTeleport(); commitPending!(); resolve(undefined); await Promise.resolve();
    expect(storedPlaces(f, '1')).toEqual([savedPlace()]); expect(storedPlaces(f, '2')).toEqual([]); expect(f.ids()).toEqual([]);
    expect(f.root().querySelector('[role="status"]')?.textContent).not.toContain('已保存');
    expect(f.requestRoute).not.toHaveBeenCalled();
  });
});

function resizePointer(target: EventTarget, type: string, x: number, y: number, pointerId = 7, pointerType = 'mouse', button = 0) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType } });
  target.dispatchEvent(event);
}

function mockSortAnimations(f: ReturnType<typeof fixture>) {
  const animations: Array<{ node: HTMLElement; cancel: ReturnType<typeof vi.fn>; onfinish?: (() => void) | null; oncancel?: (() => void) | null }> = [];
  const animate = vi.fn(function (this: HTMLElement) {
    const animation: (typeof animations)[number] = { node: this, cancel: vi.fn() };
    animation.cancel.mockImplementation(() => animation.oncancel?.()); animations.push(animation); return animation;
  });
  for (const row of f.list().querySelectorAll<HTMLElement>('[data-route-id]')) Object.defineProperty(row, 'animate', { configurable: true, value: animate });
  return { animate, animations };
}

describe('destination drag motion', () => {
  it.each([1, 1.5])('lifts a held row, follows the pointer at %s ancestor scale, stays inside the viewport and settles only on release', scale => {
    const f = fixture(); f.measurePanels(scale); f.api.showTeleport(); f.measureRows();
    const row = f.row('a'), viewport = f.root().querySelector<HTMLElement>('.lastro-route-scroll')!;
    f.pointer(f.handle('a'), 'pointerdown', 20);
    expect(row.classList.contains('is-dragging')).toBe(true); expect(f.ids()).toEqual(['a', 'b', 'c']); expect(f.saved).not.toHaveBeenCalled();
    f.pointer(f.list(), 'pointermove', 170);
    expect(row.classList.contains('is-drag-moving')).toBe(true); expect(row.style.getPropertyValue('--lastro-sort-offset')).not.toBe('');
    const visualTop = () => row.getBoundingClientRect().top + parseFloat(row.style.getPropertyValue('--lastro-sort-offset')) * scale;
    expect(visualTop()).toBeCloseTo(150 - 3 * scale);
    f.pointer(f.list(), 'pointermove', 1000);
    expect(visualTop()).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().top);
    expect(visualTop() + row.getBoundingClientRect().height * 1.01).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom);
    expect(f.saved).not.toHaveBeenCalled(); f.pointer(f.list(), 'pointerup', 1000);
    expect(row.classList.contains('is-dragging')).toBe(false); expect(row.classList.contains('is-drag-moving')).toBe(false);
    expect(row.style.getPropertyValue('--lastro-sort-offset')).toBe(''); expect(f.saved).toHaveBeenCalledOnce();
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('animates neighboring rows into place and cancels superseded animations before another reorder and release', () => {
    const f = fixture(); f.api.showTeleport(); f.measureRows(); const motion = mockSortAnimations(f);
    f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170);
    expect(f.ids()).toEqual(['b', 'c', 'a']); expect(motion.animate).toHaveBeenCalledTimes(2);
    expect(motion.animate).toHaveBeenCalledWith([{ transform: 'translateY(60px)' }, { transform: 'translateY(0)' }], { duration: 160, easing: 'cubic-bezier(.2,.65,.3,1)' });
    const initial = [...motion.animations];
    f.pointer(f.list(), 'pointermove', 0); expect(f.ids()).toEqual(['a', 'b', 'c']); expect(motion.animate).toHaveBeenCalledTimes(4);
    initial.forEach(animation => expect(animation.cancel).toHaveBeenCalledOnce());
    f.pointer(f.list(), 'pointerup', 0); motion.animations.slice(2).forEach(animation => expect(animation.cancel).toHaveBeenCalledOnce());
    expect(f.saved).toHaveBeenCalledOnce(); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('forgets finished animations instead of canceling them again on release', () => {
    const f = fixture(); f.api.showTeleport(); f.measureRows(); const motion = mockSortAnimations(f);
    f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170);
    motion.animations.forEach(animation => animation.onfinish?.()); f.pointer(f.list(), 'pointerup', 170);
    motion.animations.forEach(animation => expect(animation.cancel).not.toHaveBeenCalled());
    expect(f.ids()).toEqual(['b', 'c', 'a']); expect(f.saved).toHaveBeenCalledOnce();
  });

  it.each(['pointercancel', 'lostpointercapture', 'window close', 'logout', 'profile switch', 'category switch'])('cleans up lifted state and active reorder animations on %s', reason => {
    const f = fixture(); f.api.showTeleport(); f.measureRows(); const row = f.row('a'), motion = mockSortAnimations(f);
    f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170); expect(motion.animations).toHaveLength(2);
    if (reason === 'window close') f.api.teleport.remove();
    else if (reason === 'logout') f.tools.remove();
    else if (reason === 'profile switch') { f.setProfile('2'); f.api.showTeleport(); }
    else if (reason === 'category switch') f.api.select('boss');
    else f.pointer(f.list(), reason, 170);
    motion.animations.forEach(animation => expect(animation.cancel).toHaveBeenCalledOnce());
    expect(row.classList.contains('is-dragging')).toBe(false); expect(row.classList.contains('is-drag-moving')).toBe(false);
    expect(row.style.getPropertyValue('--lastro-sort-offset')).toBe('');
    expect((f.storage.get('1') as { orders: Record<string, unknown> }).orders.npc).toBeUndefined(); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps held-card movement and neighbor animation when reduced motion is %s', reducedMotion => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    try {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: reducedMotion })) });
      const f = fixture(); f.api.showTeleport(); f.measureRows(); const motion = mockSortAnimations(f);
      const row = f.row('a');
      f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170);
      expect(row.classList.contains('is-drag-moving')).toBe(true);
      expect(row.style.getPropertyValue('--lastro-sort-offset')).not.toBe('');
      expect(f.ids()).toEqual(['b', 'c', 'a']); expect(f.saved).not.toHaveBeenCalled();
      expect(motion.animate).toHaveBeenCalledTimes(2);
      expect(toolsCss).not.toMatch(/@media\s*\(prefers-reduced-motion/);
      f.pointer(f.list(), 'pointerup', 170);
      motion.animations.forEach(animation => expect(animation.cancel).toHaveBeenCalledOnce());
      expect(row.classList.contains('is-dragging')).toBe(false);
      expect(row.style.getPropertyValue('--lastro-sort-offset')).toBe('');
      expect(f.saved).toHaveBeenCalledOnce(); expect(f.requestRoute).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    }
  });
});

describe('native tools window resize handles', () => {
  it.each([
    ['auto', 1], ['auto', 1.5], ['teleport', 1], ['teleport', 1.5],
  ] as const)('resizes %s at %s ancestor scale, saves logical dimensions and restores them after reopening and reloading', (key, scale) => {
    const geometry = { [key]: { x: 40, y: 60, width: 500, height: 420 } };
    const f = fixture({ preferences: { orders: { npc: ['b', 'a', 'c'] }, geometry } });
    f.measurePanels(scale); f.setViewport(2400, 1600);
    const show = () => key === 'auto' ? f.api.showAutomation() : f.api.showTeleport();
    show();
    const component = key === 'auto' ? f.tools : f.api.teleport;
    const handle = component.getRoot().querySelector<HTMLButtonElement>('.lastro-window-resize')!;
    const captured = vi.fn(), released = vi.fn(); handle.setPointerCapture = captured; handle.releasePointerCapture = released;
    expect(handle.dataset.background).toBe('btn_resize.bmp'); expect(handle.textContent).toBe('');
    expect(handle.closest('.lastro-panel-footer')?.getAttribute('data-background')).toBe('basic_interface/btnbar_mid.bmp');
    const originalFields = [...component.getRoot().querySelectorAll('[data-field],[data-option]')];
    const rect = component._host.getBoundingClientRect();
    resizePointer(handle, 'pointerdown', rect.right, rect.bottom);
    resizePointer(window, 'pointermove', rect.right + 90 * scale, rect.bottom + 50 * scale, 8);
    expect(component._host.style.width).toBe('500px');
    resizePointer(window, 'pointermove', rect.right + 90 * scale, rect.bottom + 50 * scale);
    expect(component._host.style.width).toBe('590px'); expect(component._host.style.height).toBe('470px');
    expect(f.saved).not.toHaveBeenCalled();
    resizePointer(window, 'pointerup', rect.right + 90 * scale, rect.bottom + 50 * scale);
    expect(captured).toHaveBeenCalledWith(7); expect(released).toHaveBeenCalledWith(7); expect(f.saved).toHaveBeenCalledOnce();
    expect(f.storage.get('1')).toEqual({ orders: { npc: ['b', 'a', 'c'] }, geometry: { [key]: { x: 40, y: 60, width: 590, height: 470 } } });
    expect(component._host.style.fontSize).toBe(''); expect([...component.getRoot().querySelectorAll('[data-field],[data-option]')]).toEqual(originalFields);
    expect(f.requestRoute).not.toHaveBeenCalled(); expect(f.tools.setAutomationOption).not.toHaveBeenCalled();
    if (key === 'auto') f.tools.hidePanel(); else f.api.teleport.remove();
    show(); expect(component._host.style.width).toBe('590px'); expect(component._host.style.height).toBe('470px');
    f.tools.remove();
    const reloaded = fixture({ storage: f.storage }); reloaded.measurePanels(scale); reloaded.setViewport(2400, 1600);
    if (key === 'auto') reloaded.api.showAutomation(); else reloaded.api.showTeleport();
    const host = (key === 'auto' ? reloaded.tools : reloaded.api.teleport)._host;
    expect(host.style.width).toBe('590px'); expect(host.style.height).toBe('470px');
  });

  it('does not save a click or a tiny movement on a temporarily constrained panel', () => {
    const geometry = { auto: { x: 30, y: 50, width: 610, height: 410 } };
    const f = fixture({ preferences: { orders: {}, geometry } }); f.measurePanels(1.5); f.setViewport(400, 280); f.api.showAutomation();
    const handle = f.tools.getRoot().querySelector('.lastro-window-resize')!;
    const rect = f.tools._host.getBoundingClientRect();
    resizePointer(handle, 'pointerdown', rect.right, rect.bottom);
    resizePointer(window, 'pointerup', rect.right + 1, rect.bottom + 1);
    expect(f.saved).not.toHaveBeenCalled(); expect(f.storage.get('1')).toEqual({ orders: {}, geometry });
    f.setViewport(1600, 1100);
    expect(f.tools._host.style.width).toBe('610px'); expect(f.tools._host.style.height).toBe('410px');
  });

  it.each(['pointercancel', 'lostpointercapture', 'Escape', 'blur'])('rolls back %s without saving, requesting a route or leaving listeners active', action => {
    const geometry = { teleport: { x: 40, y: 60, width: 500, height: 420 } };
    const f = fixture({ preferences: { orders: {}, geometry } }); f.measurePanels(); f.setViewport(1600, 1100); f.api.showTeleport();
    const handle = f.root().querySelector('.lastro-window-resize')!, rect = f.api.teleport._host.getBoundingClientRect();
    resizePointer(handle, 'pointerdown', rect.right, rect.bottom);
    resizePointer(window, 'pointermove', rect.right + 60, rect.bottom + 40);
    expect(f.api.teleport._host.style.width).toBe('560px');
    if (action === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    else if (action === 'blur') window.dispatchEvent(new Event('blur'));
    else resizePointer(action === 'lostpointercapture' ? handle : window, action, rect.right + 60, rect.bottom + 40);
    resizePointer(window, 'pointerup', rect.right + 100, rect.bottom + 100);
    expect(f.api.teleport._host.style.width).toBe('500px'); expect(f.api.teleport._host.style.height).toBe('420px');
    expect(f.api.teleport._host.classList.contains('lastro-is-resizing')).toBe(false);
    expect(f.saved).not.toHaveBeenCalled(); expect(f.requestRoute).not.toHaveBeenCalled();
    expect(f.storage.get('1')).toEqual({ orders: {}, geometry });
  });

  it('caps touch resizing to a viewport smaller than the normal minimum and keeps category scrolling available', () => {
    const f = fixture(); f.measurePanels(1.5, { x: 13, y: 17 }); f.setViewport(250, 180); f.api.showTeleport();
    const handle = f.root().querySelector('.lastro-window-resize')!, rect = f.api.teleport._host.getBoundingClientRect();
    resizePointer(handle, 'pointerdown', rect.right, rect.bottom, 3, 'touch', -1);
    resizePointer(window, 'pointermove', rect.right + 900, rect.bottom + 900, 3, 'touch', -1);
    resizePointer(window, 'pointerup', rect.right + 900, rect.bottom + 900, 3, 'touch', -1);
    const assertFits = () => {
      const bounds = f.api.teleport._host.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(7.99); expect(bounds.top).toBeGreaterThanOrEqual(7.99);
      expect(bounds.right).toBeLessThanOrEqual(242.01); expect(bounds.bottom).toBeLessThanOrEqual(172.01);
    };
    assertFits();
    const scroll = f.root().querySelector<HTMLElement>('.lastro-route-scroll')!; scroll.scrollTop = 200;
    const height = f.api.teleport._host.style.height;
    f.api.select('custom'); assertFits(); f.root().querySelector<HTMLButtonElement>('[data-add-place]')!.click();
    assertFits(); expect(f.root().querySelector<HTMLFormElement>('[data-custom-form]')!.hidden).toBe(false);
    f.api.select('npc'); assertFits(); expect(scroll.hidden).toBe(false); expect(scroll.scrollTop).toBe(0);
    expect(f.api.teleport._host.style.height).toBe(height); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('cancels a pending size edit on close, logout and profile switch without contaminating saved sizes', () => {
    const storage = new Map<string, unknown>([
      ['1', { orders: {}, geometry: { auto: { x: 20, y: 20, width: 500, height: 420 } } }],
      ['2', { orders: {}, geometry: { auto: { x: 50, y: 70, width: 450, height: 350 } } }],
    ]);
    const f = fixture({ storage }); f.measurePanels(); f.setViewport(1800, 1300); f.api.showAutomation();
    const start = () => {
      const rect = f.tools._host.getBoundingClientRect();
      resizePointer(f.tools.getRoot().querySelector('.lastro-window-resize')!, 'pointerdown', rect.right, rect.bottom);
      resizePointer(window, 'pointermove', rect.right + 60, rect.bottom + 50);
      return rect;
    };
    let rect = start(); f.tools.hidePanel(); resizePointer(window, 'pointerup', rect.right + 60, rect.bottom + 50);
    f.api.showAutomation(); expect(f.tools._host.style.width).toBe('500px');
    rect = start(); f.setProfile('2'); resizePointer(window, 'pointerup', rect.right + 60, rect.bottom + 50);
    f.api.showAutomation(); expect(f.tools._host.style.width).toBe('450px'); expect(f.tools._host.style.height).toBe('350px');
    rect = start(); f.tools.remove(); resizePointer(window, 'pointerup', rect.right + 60, rect.bottom + 50);
    expect(f.saved).not.toHaveBeenCalled();
    expect(storage.get('1')).toEqual({ orders: {}, geometry: { auto: { x: 20, y: 20, width: 500, height: 420 } } });
    expect(storage.get('2')).toEqual({ orders: {}, geometry: { auto: { x: 50, y: 70, width: 450, height: 350 } } });
  });
});

describe('separate automation and teleport windows', () => {
  it.each([1, 1.5])('fits both panels inside a small viewport at %s ancestor scale without resetting their behavior', scale => {
    const f = fixture(); f.measurePanels(scale, { x: 13, y: 17 }); f.setViewport(360, 260);
    const assertFits = (host: HTMLElement) => {
      const rect = host.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(7.99); expect(rect.top).toBeGreaterThanOrEqual(7.99);
      expect(rect.right).toBeLessThanOrEqual(352.01); expect(rect.bottom).toBeLessThanOrEqual(252.01);
    };
    f.api.showAutomation(); assertFits(f.tools._host);
    expect(f.tools._host.style.width).toBe('520px');
    expect(f.tools.getRoot().querySelector('.lastro-settings-body')).not.toBeNull();
    f.api.showTeleport(); assertFits(f.api.teleport._host);
    expect(f.tools._host.style.display).toBe('none'); expect(f.ids()).toEqual(['a', 'b', 'c']);
    f.key('a', 'ArrowDown'); expect(f.ids()).toEqual(['b', 'a', 'c']);
    f.api.select('custom'); assertFits(f.api.teleport._host);
    f.root().querySelector<HTMLButtonElement>('[data-add-place]')!.click(); assertFits(f.api.teleport._host);
    expect(f.root().querySelector<HTMLFormElement>('[data-custom-form]')!.hidden).toBe(false);
    f.api.showAutomation(); assertFits(f.tools._host);
    expect(f.api.teleport._host.isConnected).toBe(false);
    expect(f.requestRoute).not.toHaveBeenCalled(); expect(f.tools.setAutomationOption).not.toHaveBeenCalled();
  });

  it.each([1, 1.5])('temporarily constrains saved size and position then restores them after enlarging the viewport at %s scale', scale => {
    const geometry = { auto: { x: 300, y: 120, width: 610, height: 410 }, teleport: { x: 280, y: 150, width: 480, height: 420 } };
    const f = fixture({ preferences: { orders: {}, geometry } }); f.measurePanels(scale); f.setViewport(1600, 1100);
    for (const key of ['auto', 'teleport'] as const) {
      if (key === 'auto') f.api.showAutomation(); else f.api.showTeleport();
      const component = key === 'auto' ? f.tools : f.api.teleport, host = component._host;
      const preferred = geometry[key];
      expect(host.style.left).toBe(`${preferred.x}px`); expect(host.style.top).toBe(`${preferred.y}px`);
      f.setViewport(320, 240);
      const rect = host.getBoundingClientRect();
      expect(rect.right).toBeLessThanOrEqual(312.01); expect(rect.bottom).toBeLessThanOrEqual(232.01);
      expect(host.style.width).toBe(`${preferred.width}px`); expect(host.style.height).toBe(`${preferred.height}px`);
      f.setViewport(1600, 1100);
      expect(host.style.left).toBe(`${preferred.x}px`); expect(host.style.top).toBe(`${preferred.y}px`);
      expect(host.getBoundingClientRect().width).toBeCloseTo(preferred.width * scale);
      expect(host.getBoundingClientRect().height).toBeCloseTo(preferred.height * scale);
    }
    expect(f.saved).not.toHaveBeenCalled(); expect(f.storage.get('1')).toEqual({ orders: {}, geometry });
  });

  it('saves logical drag geometry in existing profile preferences without replacing route order or saving a temporary size', () => {
    const geometry = { auto: { x: 20, y: 20, width: 610, height: 410 } };
    const f = fixture({ preferences: { orders: { npc: ['b', 'a', 'c'] }, geometry } });
    f.measurePanels(1.5); f.setViewport(400, 280); f.api.showAutomation();
    Object.assign(f.tools._host.style, { left: '12px', top: '10px' }); f.tools.onDragEnd?.();
    expect(f.storage.get('1')).toEqual({ orders: { npc: ['b', 'a', 'c'] }, geometry: { auto: { x: 12, y: 10, width: 610, height: 410 } } });
    expect(f.saved).toHaveBeenCalledOnce();
    f.setViewport(1600, 1100); expect(f.tools._host.style.left).toBe('12px'); expect(f.tools._host.style.width).toBe('610px');
    f.storage.set('2', { orders: {}, geometry: { auto: { x: 80, y: 90, width: 450 } } });
    f.setProfile('2'); f.api.showAutomation();
    expect(f.tools._host.style.left).toBe('80px'); expect(f.tools._host.style.top).toBe('90px');
    expect(f.tools._host.style.width).toBe('450px'); expect(f.tools._host.style.height).toBe('auto');
    expect(f.saved).toHaveBeenCalledOnce();
  });

  it('uses one viewport listener across toggles and removes it on logout while preserving a pending confirmation on resize', () => {
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener');
    const f = fixture({ confirm: true }); f.measurePanels(); f.api.showTeleport();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.setViewport(420, 300);
    expect(f.confirmations[0]!.popup.remove).not.toHaveBeenCalled(); expect(f.requestRoute).not.toHaveBeenCalled();
    f.confirmations[0]!.no(); f.api.showAutomation(); f.api.showTeleport(); f.api.showAutomation();
    const resizeCalls = added.mock.calls.filter(([name]) => name === 'resize'); expect(resizeCalls).toHaveLength(1);
    f.tools.remove();
    expect(removed.mock.calls.some(([name, listener]) => name === 'resize' && listener === resizeCalls[0]![1])).toBe(true);
    const before = f.tools._host.style.cssText; f.setViewport(200, 180); expect(f.tools._host.style.cssText).toBe(before);
    f.tools.append(); f.api.showAutomation();
    expect(added.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(2);
    expect(f.tools._host.getBoundingClientRect().right).toBeLessThanOrEqual(192.01);
  });

  it('keeps the dock entries independent while opening only one tools window at a time', () => {
    const f = fixture();
    const dock = document.getElementById('lastro-tools-dock')!;
    const buttons = dock.querySelectorAll<HTMLButtonElement>('button');
    expect([...buttons].map(button => button.getAttribute('aria-label'))).toEqual(['打开传送列表', '打开挂机设置']);
    expect([...buttons].map(button => button.textContent)).toEqual(['', '']);
    const automation = dock.querySelector<HTMLButtonElement>('[aria-label="打开挂机设置"]')!;
    const teleport = dock.querySelector<HTMLButtonElement>('[aria-label="打开传送列表"]')!;
    expect(f.tools._host.style.display).toBe('none');
    expect(f.api.teleport._host.isConnected).toBe(false);
    automation.click();
    expect(f.tools._host.style.display).toBe('');
    expect(f.tools.getRoot().querySelector('.lastro-ro-titlebar strong')?.textContent).toBe('挂机设置');
    expect(f.tools.getRoot().querySelector('.lastro-main-view')).toBeNull();
    expect(f.api.teleport._host.isConnected).toBe(false);
    automation.click();
    expect(f.tools._host.style.display).toBe('none');
    expect(dock.isConnected).toBe(true);
    automation.click();
    expect(f.tools._host.style.display).toBe('');
    teleport.click();
    expect(f.api.teleport._host.isConnected).toBe(true);
    expect(f.tools._host.style.display).toBe('none');
    expect(f.root().querySelector('.lastro-ro-titlebar strong')?.textContent).toBe('传送地点');
    expect(f.root().querySelector('[data-option]')).toBeNull();
    teleport.click();
    expect(f.api.teleport._host.isConnected).toBe(false);
    expect(f.tools._host.style.display).toBe('none');
    expect(dock.isConnected).toBe(true);
    teleport.click();
    expect(f.api.teleport._host.isConnected).toBe(true);
    automation.click();
    expect(f.tools._host.style.display).toBe('');
    expect(f.api.teleport._host.isConnected).toBe(false);
    expect(f.requestRoute).not.toHaveBeenCalled();
    expect(f.tools.setAutomationOption).not.toHaveBeenCalled();
  });

  it('uses only red book and gear artwork without button chrome below ordinary window layers', () => {
    const f = fixture();
    const dock = document.getElementById('lastro-tools-dock')!;
    const buttons = [...dock.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map(button => button.querySelector('[data-background]')?.getAttribute('data-background')))
      .toEqual(['ro_menu_icon/skill_1.bmp', 'ro_menu_icon/option_1.bmp']);
    expect(buttons.every(button => button.textContent === '' && !!button.getAttribute('aria-label'))).toBe(true);
    for (const button of buttons) {
      const style = getComputedStyle(button);
      expect(style.borderTopWidth).toBe('0px'); expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(['', 'none']).toContain(style.backgroundImage); expect(['', 'none']).toContain(style.boxShadow);
    }
    const dockLayer = Number(getComputedStyle(dock).zIndex || 0);
    expect(dockLayer).toBeLessThan(Number(f.tools._host.style.zIndex));
    expect(dockLayer).toBeLessThan(Number(f.api.teleport._host.style.zIndex));
  });

  it.each([['autoAttack', 'battle'], ['autoFollow', 'battle'], ['autoLoot', 'pick'], ['autoPots', 'eat']])('keeps the original %s checkbox wired to its original server option', (option, panel) => {
    const f = fixture(); f.api.showAutomation();
    const input = f.tools.getRoot().querySelector<HTMLInputElement>(`[data-option="${option}"]`)!;
    if (option === 'autoLoot') expect(input.closest('label')!.textContent).toBe('自动拾取：开启');
    expect(input.type).toBe('checkbox');
    expect(input.closest('[data-tab-panel]')?.getAttribute('data-tab-panel')).toBe(panel);
    input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
    input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.tools.setAutomationOption.mock.calls).toEqual([[option, true], [option, false]]);
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('renders destination names and descriptions as safe text in the selected category', () => {
    const unsafe = route('<img src=x onerror="alert(1)">'); unsafe.desc = '<script>alert(2)</script>';
    const f = fixture({ catalogs: { '1': { npc: { unsafe }, boss: { boss: route('首领地点') } } } });
    f.api.showTeleport();
    expect(f.root().querySelector('.lastro-route-name')?.textContent).toBe(unsafe.npc);
    expect(f.root().querySelector('.lastro-route-desc')?.textContent).toBe(unsafe.desc);
    expect(f.root().querySelector('img, script, [onerror]')).toBeNull();
    f.root().querySelector<HTMLButtonElement>('[data-category="boss"]')!.click();
    expect(f.ids()).toEqual(['boss']);
    expect(f.root().querySelector('[data-category="boss"]')?.getAttribute('aria-selected')).toBe('true');
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('preserves every original settings field and automation option while moving their positions', () => {
    const f = fixture();
    const original = document.createElement('template'); setLastROInnerHTML(original, originalTemplate);
    const keys = (root: ParentNode, attribute: string) => [...root.querySelectorAll(`[${attribute}]`)].map(node => node.getAttribute(attribute)).sort();
    expect(keys(f.tools.getRoot(), 'data-field')).toEqual(keys(original.content, 'data-field'));
    expect(keys(f.tools.getRoot(), 'data-option')).toEqual(keys(original.content, 'data-option'));
    for (const source of original.content.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')) {
      const target = f.tools.getRoot().querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${source.dataset.field}"]`)!;
      expect(target.tagName).toBe(source.tagName); expect(target.type).toBe(source.type);
      expect(target.value).toBe(source.value);
      if (source.tagName === 'SELECT') expect(target.innerHTML).toBe(source.innerHTML);
    }
    expect(f.tools.getRoot().querySelector('.lastro-quick-toggles')).toBeNull();
  });

  it('places the attack target group before basic battle settings without losing target controls', () => {
    const f = fixture(); f.api.showAutomation();
    const battle = f.tools.getRoot().querySelector('[data-tab-panel="battle"]')!;
    const targets = battle.querySelector('[data-targets]')!.closest('.lastro-group')!;
    const basic = [...battle.querySelectorAll('.lastro-group')].find(group => group.querySelector('.lastro-group-title')?.textContent === '基础')!;
    expect(targets.parentElement).toBe(battle);
    expect(targets.compareDocumentPosition(basic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(battle.querySelectorAll('[data-targets]')).toHaveLength(1);
    expect(f.tools.getRoot().querySelectorAll('[data-option]')).toHaveLength(4);
  });

  it('returns the settings scroll container to the top when each automation tab changes', () => {
    const f = fixture(); f.api.showAutomation();
    const root = f.tools.getRoot(), viewport = root.querySelector<HTMLElement>('.lastro-settings-body')!;
    for (const tab of ['pick', 'eat', 'mode', 'battle']) {
      viewport.scrollTop = 180;
      root.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.click();
      expect(viewport.scrollTop).toBe(0);
    }
    expect(f.tools.setAutomationOption).not.toHaveBeenCalled(); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it.each(['dock opener', 'native restore entry'])('closes teleport and invalidates its pending confirmation through the %s', entry => {
    const f = fixture({ confirm: true }); f.api.showTeleport();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    if (entry === 'dock opener') document.querySelector<HTMLButtonElement>('#lastro-tools-dock [aria-label="打开挂机设置"]')!.click();
    else f.tools.restorePanel();
    expect(f.tools._host.style.display).toBe(''); expect(f.api.teleport._host.isConnected).toBe(false);
    expect(f.confirmations[0]!.popup.remove).toHaveBeenCalledOnce();
    f.confirmations[0]!.yes(); expect(f.requestRoute).not.toHaveBeenCalled();
  });
});

describe('destination sorting and profile persistence', () => {
  it('resets scroll position on destination category changes from mouse and keyboard', () => {
    const f = fixture(); f.api.showTeleport();
    const viewport = f.root().querySelector<HTMLElement>('.lastro-route-scroll')!;
    for (const category of ['train', 'money', 'challenge', 'instance', 'boss', 'custom', 'npc']) {
      viewport.scrollTop = 220;
      f.root().querySelector<HTMLButtonElement>(`[data-category="${category}"]`)!.click();
      expect(viewport.scrollTop).toBe(0);
    }
    viewport.scrollTop = 220;
    f.root().querySelector<HTMLButtonElement>('[data-category="npc"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(viewport.scrollTop).toBe(0); expect(f.root().querySelector('[data-category="train"]')?.getAttribute('aria-selected')).toBe('true');
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('keeps the current scroll position while keyboard sorting within a category', () => {
    const f = fixture(); f.api.showTeleport();
    const viewport = f.root().querySelector<HTMLElement>('.lastro-route-scroll')!;
    viewport.scrollTop = 120; f.key('a', 'ArrowDown');
    expect(f.ids()).toEqual(['b', 'a', 'c']); expect(viewport.scrollTop).toBe(120);
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('saves keyboard ordering across closing, reopening, and a new tools instance', () => {
    const f = fixture(); f.api.showTeleport(); f.key('a', 'ArrowDown');
    expect(f.ids()).toEqual(['b', 'a', 'c']);
    expect(f.saved).toHaveBeenCalledOnce();
    f.api.teleport.remove(); f.api.showTeleport();
    expect(f.ids()).toEqual(['b', 'a', 'c']);
    f.tools.remove();
    const next = fixture({ storage: f.storage }); next.api.showTeleport();
    expect(next.ids()).toEqual(['b', 'a', 'c']);
    expect(f.requestRoute).not.toHaveBeenCalled(); expect(next.requestRoute).not.toHaveBeenCalled();
  });

  it('supports dragging a row down and back up while committing only on pointer release', () => {
    const f = fixture(); f.api.showTeleport(); f.measureRows();
    f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170);
    expect(f.ids()).toEqual(['b', 'c', 'a']); expect(f.saved).not.toHaveBeenCalled();
    f.pointer(f.list(), 'pointerup', 170);
    expect(f.saved).toHaveBeenCalledOnce();
    f.pointer(f.handle('a'), 'pointerdown', 140); f.pointer(f.list(), 'pointermove', 0); f.pointer(f.list(), 'pointerup', 0);
    expect(f.ids()).toEqual(['a', 'b', 'c']); expect(f.saved).toHaveBeenCalledTimes(2);
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('keeps pointer capture on the stationary list while the dragged handle changes DOM position', () => {
    const f = fixture(); f.api.showTeleport(); f.measureRows();
    const listCapture = vi.fn(), listRelease = vi.fn(), handleCapture = vi.fn(), handleRelease = vi.fn();
    Object.defineProperty(f.list(), 'setPointerCapture', { configurable: true, value: listCapture });
    Object.defineProperty(f.list(), 'releasePointerCapture', { configurable: true, value: listRelease });
    Object.defineProperty(f.handle('a'), 'setPointerCapture', { configurable: true, value: handleCapture });
    Object.defineProperty(f.handle('a'), 'releasePointerCapture', { configurable: true, value: handleRelease });
    f.pointer(f.handle('a'), 'pointerdown', 20, 7);
    expect(listCapture).toHaveBeenCalledExactlyOnceWith(7); expect(handleCapture).not.toHaveBeenCalled();
    f.pointer(f.list(), 'pointermove', 170, 7); expect(f.ids()).toEqual(['b', 'c', 'a']);
    f.pointer(f.list(), 'pointerup', 170, 7);
    expect(listRelease).toHaveBeenCalledExactlyOnceWith(7); expect(handleRelease).not.toHaveBeenCalled();
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture'])('restores the prior order when a drag ends with %s', type => {
    const f = fixture(); f.api.showTeleport(); f.measureRows();
    f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170);
    expect(f.ids()).toEqual(['b', 'c', 'a']);
    f.pointer(f.list(), type, 170);
    expect(f.ids()).toEqual(['a', 'b', 'c']); expect(f.saved).not.toHaveBeenCalled();
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('cancels unfinished drag sorting when selecting another category', () => {
    const f = fixture(); f.api.showTeleport(); f.measureRows();
    f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170);
    f.api.select('boss'); f.api.select('npc');
    expect(f.ids()).toEqual(['a', 'b', 'c']);
    expect((f.storage.get('1') as { orders: Record<string, unknown> }).orders.npc).toBeUndefined();
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('merges saved ordering with newly added and removed destinations', () => {
    const f = fixture({ preferences: { category: 'npc', orders: { npc: ['b', 'gone', 'b', 42, 'a'] } } });
    f.api.showTeleport(); expect(f.ids()).toEqual(['b', 'a', 'c']);
    f.catalogs['1']!.npc = { b: route('地点乙'), c: route('地点丙'), d: route('新增地点') };
    f.api.teleport.remove(); f.api.showTeleport();
    expect(f.ids()).toEqual(['b', 'c', 'd']); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('restores default ordering only for the selected category', () => {
    const f = fixture({ preferences: { orders: { npc: ['c', 'b', 'a'], train: ['t'] } } });
    f.api.showTeleport(); expect(f.ids()).toEqual(['c', 'b', 'a']);
    f.root().querySelector<HTMLButtonElement>('[data-reset-order]')!.click();
    expect(f.ids()).toEqual(['a', 'b', 'c']);
    const stored = f.storage.get('1') as { orders: Record<string, unknown> };
    expect(stored.orders.npc).toBeUndefined(); expect(stored.orders.train).toEqual(['t']);
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('uses each profile catalog and its own saved order after switching profiles', () => {
    const storage = new Map<string, unknown>([
      ['1', { category: 'npc', orders: { npc: ['b', 'a'] } }],
      ['2', { category: 'boss', orders: { boss: ['two', 'one'] } }],
    ]);
    const f = fixture({ storage, catalogs: { '1': defaults(), '2': { boss: { one: route('二区首领一'), two: route('二区首领二') } } } });
    f.api.showTeleport(); expect(f.ids()).toEqual(['b', 'a', 'c']);
    f.setProfile('2'); f.api.showTeleport(); expect(f.ids()).toEqual(['two', 'one']);
    expect(f.root().textContent).toContain('二区首领二'); expect(f.root().textContent).not.toContain('地点甲');
    f.key('one', 'ArrowUp');
    expect((storage.get('2') as { orders: Record<string, unknown> }).orders.boss).toEqual(['one', 'two']);
    expect((storage.get('1') as { orders: Record<string, unknown> }).orders.npc).toEqual(['b', 'a']);
    f.setProfile('1'); f.api.showTeleport(); expect(f.ids()).toEqual(['b', 'a', 'c']);
    expect(f.requestRoute).not.toHaveBeenCalled();
  });
});

describe('destination actions and lifecycle', () => {
  it('deactivates classic entry resources without logging out and recreates them only while tools remains active', () => {
    const f = fixture({ confirm: true }); f.api.showTeleport();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.api.deactivate(); expect(document.getElementById('lastro-tools-dock')).toBeNull(); expect(f.api.teleport._host.isConnected).toBe(false);
    expect(f.tools.__active).toBe(true); expect(f.previousRemove).not.toHaveBeenCalled();
    f.confirmations[0]!.yes(); expect(f.requestRoute).not.toHaveBeenCalled();
    f.api.refreshEntry(); expect(document.getElementById('lastro-tools-dock')).not.toBeNull();
    f.api.showTeleport(); expect(f.ids()).toEqual(['a', 'b', 'c']);
    f.tools.remove(); f.api.refreshEntry(); expect(document.getElementById('lastro-tools-dock')).toBeNull();
  });

  it('lets the native entry reuse confirmation and checked requests without mounting the classic teleport window', async () => {
    const f = fixture({ confirm: true });
    expect(() => f.api.requestCustomRoute({ ...route('错误地点'), path: [] })).toThrow('Invalid route');
    expect(f.requestRoute).not.toHaveBeenCalled();
    let reject!: (error: Error) => void;
    f.requestRoute.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    f.api.requestCustomRoute(route('原生快捷地点')); expect(f.requestRoute).not.toHaveBeenCalled();
    f.confirmations[0]!.yes(); expect(f.requestRoute).toHaveBeenCalledOnce(); expect(f.tools.setStatus).toHaveBeenCalledWith('正在检查传送地点');
    reject(new Error('地图资源不存在')); await Promise.resolve();
    expect(f.tools.setStatus).toHaveBeenCalledWith('无法前往：地图资源不存在'); expect(f.api.teleport._host.isConnected).toBe(false);
  });

  it('waits for resource checks and displays their failure without claiming a request was sent', async () => {
    const f = fixture(); f.api.showTeleport();
    let reject!: (error: Error) => void;
    f.requestRoute.mockReturnValue(new Promise((_resolve, failure) => { reject = failure; }));
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    expect(f.root().querySelector('[role="status"]')?.textContent).toBe('正在检查传送地点');
    reject(new Error('地图资源不存在')); await Promise.resolve();
    expect(f.root().querySelector('[role="status"]')?.textContent).toBe('无法前往：地图资源不存在');
  });

  it('ignores a late resource result after switching to automation and cancels its pending check', async () => {
    const f = fixture(); f.api.showTeleport();
    let resolve!: (value: string) => void;
    f.requestRoute.mockReturnValue(new Promise(success => { resolve = success; }));
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.api.showAutomation(); const calls = f.cancelPendingRoute.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    resolve('teleport'); await Promise.resolve();
    expect(f.root().querySelector('[role="status"]')?.textContent).not.toContain('已发送传送请求');
  });

  it('requests a route only when its dedicated go button is clicked', () => {
    const f = fixture(); f.api.showTeleport();
    f.row('a').querySelector<HTMLElement>('.lastro-route-name')!.click(); f.handle('a').click();
    f.api.select('boss'); f.api.select('npc');
    expect(f.requestRoute).not.toHaveBeenCalled();
    f.row('b').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(f.catalogs['1']!.npc!.b);
    expect(f.root().querySelector('[role="status"]')?.textContent).toContain('已发送传送请求：地点乙');
  });

  it('validates custom destinations before passing them to the existing route request', () => {
    const f = fixture(); f.api.showTeleport(); f.api.select('custom');
    const form = f.root().querySelector<HTMLFormElement>('[data-custom-form]')!;
    const set = (name: string, value: string) => { (form.elements.namedItem(name) as HTMLInputElement).value = value; };
    set('map', '../prontera'); set('x', '100'); set('y', '184');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); expect(f.requestRoute).not.toHaveBeenCalled();
    set('map', 'PRONTERA.GAT'); set('x', '65536');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); expect(f.requestRoute).not.toHaveBeenCalled();
    set('x', '0'); set('y', '65535');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outset: ['prontera', 0, 65535], path: [['prontera', 0, 65535]] }));
  });

  it.each([null, 'corrupt JSON', 42, { category: 'missing', orders: [] }, { orders: { npc: 'corrupt order' } }])('recovers malformed preferences without losing the route catalog', preferences => {
    const f = fixture({ preferences });
    expect(() => f.api.showTeleport()).not.toThrow(); expect(f.ids()).toEqual(['a', 'b', 'c']);
    expect(() => f.key('a', 'ArrowDown')).not.toThrow();
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('removes both windows and the dock on logout without committing a pending drag', () => {
    const f = fixture(); f.api.showAutomation(); f.api.showTeleport(); f.measureRows();
    f.pointer(f.handle('a'), 'pointerdown', 20); f.pointer(f.list(), 'pointermove', 170);
    f.tools.remove();
    expect(document.getElementById('lastro-tools-dock')).toBeNull();
    expect(f.api.teleport._host.isConnected).toBe(false); expect(f.tools._host.isConnected).toBe(false);
    expect(f.previousRemove).toHaveBeenCalledOnce(); expect(f.saved).not.toHaveBeenCalled();
    expect(f.cancelRoute).toHaveBeenCalledOnce();
    expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('retains a catalog entry with missing coordinates as a disabled destination', () => {
    const unavailable = { npc: '未提供坐标', desc: '原版入口说明', path: [] } as unknown as Route;
    const f = fixture({ catalogs: { '1': { npc: { unavailable, a: route('可用地点') } } } }); f.api.showTeleport();
    expect(f.ids()).toEqual(['unavailable', 'a']);
    const button = f.row('unavailable').querySelector<HTMLButtonElement>('.lastro-route-go')!;
    expect(button.disabled).toBe(true); expect(button.textContent).toBe('不可用');
    button.click(); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('forwards map changes to the existing route controller', () => {
    const f = fixture(); f.tools.onMapChanged();
    expect(f.routeMapChanged).toHaveBeenCalledOnce(); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('preserves a confirmed route during map cleanup while canceling an unconfirmed popup', () => {
    const f = fixture({ confirm: true }); f.api.showTeleport();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click(); f.confirmations[0]!.yes();
    f.row('b').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.api.onMapChanging(); f.tools.remove();
    expect(f.routeMapChanging).toHaveBeenCalledOnce(); expect(f.cancelRoute).not.toHaveBeenCalled();
    expect(f.confirmations[1]!.popup.remove).toHaveBeenCalledOnce();
    f.confirmations[1]!.yes();
    expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(f.catalogs['1']!.npc!.a);
    expect(document.getElementById('lastro-tools-dock')).toBeNull();
    expect(f.api.teleport._host.isConnected).toBe(false);
  });

  it('cancels routing on ordinary logout and through explicit cancellation during a map transition', () => {
    const logout = fixture({ confirm: true }); logout.api.showTeleport();
    logout.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click(); logout.confirmations[0]!.yes();
    logout.tools.remove(); expect(logout.cancelRoute).toHaveBeenCalledOnce();

    const canceled = fixture({ confirm: true }); canceled.api.showTeleport();
    canceled.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click(); canceled.confirmations[0]!.yes();
    canceled.row('b').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    canceled.api.onMapChanging(); canceled.api.cancelRoute();
    expect(canceled.cancelRoute).toHaveBeenCalledOnce();
    expect(canceled.confirmations[1]!.popup.remove).toHaveBeenCalledOnce();
    canceled.confirmations[1]!.yes(); expect(canceled.requestRoute).toHaveBeenCalledOnce();
    canceled.tools.remove(); expect(canceled.cancelRoute).toHaveBeenCalledTimes(2);
  });
});

describe('native destination confirmation', () => {
  it('opens only on a go click, cancels without sending, and sends once after native removal followed by yes', () => {
    const f = fixture({ confirm: true }); f.api.showTeleport();
    f.row('a').querySelector<HTMLElement>('.lastro-route-name')!.click(); f.handle('a').click();
    expect(f.showPrompt).not.toHaveBeenCalled();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    expect(f.showPrompt).toHaveBeenCalledOnce(); expect(f.requestRoute).not.toHaveBeenCalled();
    f.confirmations[0]!.no(); expect(f.requestRoute).not.toHaveBeenCalled();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.confirmations[1]!.yes(); f.confirmations[1]!.yes();
    expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(f.catalogs['1']!.npc!.a);
  });

  it('does not open duplicate confirmations when different go buttons are clicked repeatedly', () => {
    const f = fixture({ confirm: true }); f.api.showTeleport();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.row('b').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    expect(f.showPrompt).toHaveBeenCalledOnce(); expect(f.requestRoute).not.toHaveBeenCalled();
    f.confirmations[0]!.yes();
    expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(f.catalogs['1']!.npc!.a);
  });

  it.each(['window close', 'icon close', 'logout'])('removes a pending confirmation on %s and rejects its stale yes callback', reason => {
    const f = fixture({ confirm: true }); f.api.showTeleport();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    if (reason === 'logout') f.tools.remove();
    else if (reason === 'icon close') document.querySelector<HTMLButtonElement>('#lastro-tools-dock [aria-label="打开传送列表"]')!.click();
    else f.root().querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(f.confirmations[0]!.popup.remove).toHaveBeenCalledOnce();
    f.confirmations[0]!.yes(); expect(f.requestRoute).not.toHaveBeenCalled();
  });

  it('rejects a yes callback after external popup removal and recovers for a later request', async () => {
    const f = fixture({ confirm: true }); f.api.showTeleport();
    f.row('a').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    f.confirmations[0]!.popup.remove(); await Promise.resolve();
    f.confirmations[0]!.yes(); expect(f.requestRoute).not.toHaveBeenCalled();
    f.row('b').querySelector<HTMLButtonElement>('.lastro-route-go')!.click();
    expect(f.showPrompt).toHaveBeenCalledTimes(2);
    f.confirmations[1]!.yes();
    expect(f.requestRoute).toHaveBeenCalledExactlyOnceWith(f.catalogs['1']!.npc!.b);
  });
});
