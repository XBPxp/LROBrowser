// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractWorldMapFixture } from '../scripts/extract-worldmap-fixture.mjs';
import { createLastroWorldMapTeleport } from '../scripts/lastro-worldmap-teleport.mjs';
import { WORLD_MAP_CSS, WORLD_MAP_HTML } from '../scripts/lastro-worldmap.mjs';

const runtime = readFileSync('generated/runtime/Online.js', 'utf8');
const fixture = extractWorldMapFixture(runtime);
fixture.css = WORLD_MAP_CSS; fixture.html = WORLD_MAP_HTML;
// Exercise current source behavior without regenerating the packaged runtime.
const installerFile = ts.createSourceFile('lastro-worldmap.mjs', readFileSync('scripts/lastro-worldmap.mjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const installer = installerFile.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'installLastroWorldMap');
if (installer.length !== 1) throw new Error('Missing source world map installer');
fixture.installLastroWorldMap = installer[0]!.getText(installerFile).replace(/^export\s+/, '');
function nativeRegion(name: string) {
  const start = runtime.indexOf('//#region ' + name), end = runtime.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + name);
  return ts.createSourceFile(name, runtime.slice(start, end), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
let guiClass = '', commonCss = '';
for (const file of [nativeRegion('src/UI/GUIComponent.js'), nativeRegion('src/UI/Common.css?raw')]) {
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node)) {
      if (node.left.getText(file) === 'GUIComponent' && ts.isClassExpression(node.right)) guiClass = node.right.getText(file);
      if (node.left.getText(file) === 'Common_default$1' && ts.isStringLiteral(node.right)) commonCss = node.right.text;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}
if (!guiClass || !commonCss) throw new Error('Missing real native GUI class/CSS');
const data = {
  worldData: { prontera: { name: '普隆德拉', branch: ['test_dun'], mobs: [1002, 1002] }, test_dun: { name: '测试地下城', belong: 'prontera', mobs: [1039] }, unknown: { name: '未标记地图', mobs: [] } },
  mobData: {
    1002: { kName: '波利', LV: '1', DropsNum: 2, Drop0id: 501, Drop0per: 1000, Drop1id: 501, Drop1per: 500 },
    1039: { kName: '巴风特', LV: '81', MvpDropsNum: 1, MVP0id: 501, MVP0per: 2000 },
  },
};
const items = { 501: { identifiedDisplayName: '红色药水', identifiedResourceName: 'red-potion', identifiedDescriptionName: ['恢复 HP。', '^ff0000<img src=x onerror=alert(1)>^000000'], slotCount: 0 }, 502: { identifiedDisplayName: '橙色药水' } };
const model = runInNewContext(`(${fixture.createWorldMapIndex})(worldData,mobData,items,()=>({}))`, { ...data, items });
function mount(loadData = vi.fn(async () => data), itemTable: Record<number, { identifiedDisplayName: string }> = items, monsterPortrait = vi.fn(async (_id: number) => { void _id; return 'data:image/png;base64,AAAA'; }), prepared = true) {
  const host = document.createElement('div'); if (prepared) document.body.append(host);
  const root = host.attachShadow({ mode: 'open' }); root.innerHTML = `<style>${commonCss}</style><style>${fixture.css}</style><div class="ui-component-root">${fixture.html}</div>`;
  const component = { _host: host, getRoot: () => root, prepare: vi.fn(() => { component.init(); host.remove(); }), append: vi.fn(() => { document.body.append(host); component.onAppend(); }), focus: vi.fn(), searchMonster: async (_target: unknown) => { void _target; }, init: () => {}, onAppend: () => {}, toggle: () => {}, onRemove: () => {}, onResize: () => {}, updatePartyMembers: (_pkt: unknown) => { void _pkt; } };
  const navigate = vi.fn(), teleport = vi.fn<(mapid: string, label?: string) => void | Promise<boolean>>(), cancelTeleport = vi.fn();
  const Client = { loadFile: vi.fn((_path: string, _done: (url: string) => void, fail?: () => void) => fail?.()) };
  const api = runInNewContext(`(${fixture.installLastroWorldMap})(component,deps,regions,(${fixture.createWorldMapIndex}))`, {
    component, regions: fixture.regions,
    deps: { document, DB: { INTERFACE_PATH: '', getItemInfo: (id: number) => itemTable[id] || {} }, Client, loadData, itemTable: () => itemTable, currentMap: () => 'prontera.gat', navigate, teleport, cancelTeleport, monsterPortrait },
  });
  if (prepared) { component.init(); component.onAppend(); }
  const click = (text: string) => {
    const el = [...root.querySelectorAll('button')].find(b => b.textContent === text);
    if (!el) throw new Error('Missing button ' + text); el.click();
  };
  return { root, component, api, click, navigate, teleport, cancelTeleport, monsterPortrait, Client };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const frames: HTMLIFrameElement[] = [];
afterEach(() => { frames.splice(0).forEach(frame => frame.remove()); });
function mountNative(scale = 1) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const win = frame.contentWindow as Window & typeof globalThis, doc = win.document;
  doc.body.style.zoom = String(scale);
  const GUI = runInNewContext(`(${guiClass})`, { window: win, document: doc, Event: win.Event,
    MouseMode: { STOP: 1, FREEZE: 2 }, _ensureDeps: () => {}, Common_default$1: commonCss,
    setLastROInnerHTML: (element: HTMLElement, html: string) => { element.innerHTML = html; } });
  // Native prepare/append/focus/key binding remain intact. Asset/renderer services
  // are irrelevant to the fixture and never start a game connection.
  const component = new GUI('WorldMap', fixture.css);
  component.render = () => fixture.html;
  component._processAllDataAttrs = () => {};
  component._createUIProxy = () => {};
  component._setupScrollbars = () => {};
  component._setupMouseMode = () => {
    const host: HTMLElement = component._host;
    Object.defineProperties(host, {
      offsetWidth: { get: () => Math.round(parseFloat(host.style.width) || win.innerWidth) },
      offsetHeight: { get: () => Math.round(parseFloat(host.style.height) || win.innerHeight) },
    });
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => {
      const left = (parseFloat(host.style.left) || 0) * scale, top = (parseFloat(host.style.top) || 0) * scale;
      const width = (parseFloat(host.style.width) || win.innerWidth) * scale, height = (parseFloat(host.style.height) || win.innerHeight) * scale;
      return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) };
    });
  };
  const api = runInNewContext(`(${fixture.installLastroWorldMap})(component,deps,regions,(${fixture.createWorldMapIndex}))`, {
    component, regions: fixture.regions,
    deps: { document: doc, DB: { INTERFACE_PATH: '', getItemInfo: () => ({}) },
      Client: { loadFile: (_path: string, _done: unknown, failed: () => void) => failed() },
      loadData: async () => data, itemTable: () => items },
  });
  const root = () => component.getRoot() as ShadowRoot;
  const key = (value: string, target: EventTarget = win, options: KeyboardEventInit = {}) => {
    const event = new win.KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true, ...options });
    target.dispatchEvent(event); return event;
  };
  return { component, api, root, win, doc, key };
}

function installVerifiedWarp(f: ReturnType<typeof mount>) {
  let resolve!: (value: { approved: boolean }) => void;
  const preflight = { check: vi.fn(() => new Promise<{ approved: boolean }>(done => { resolve = done; })), cancel: vi.fn() };
  const send = vi.fn(), onError = vi.fn();
  const controller = createLastroWorldMapTeleport({ preflight, getMap: () => 'prontera.gat', getProfile: () => 5, send, onError });
  f.teleport.mockImplementation(mapid => controller.request(mapid));
  f.cancelTeleport.mockImplementation(() => controller.cancelPending());
  return { approve: () => resolve({ approved: true }), reject: () => resolve({ approved: false }), send, onError };
}

describe('packaged official-style world map', () => {
  it('lets fitted native host dimensions win over the Shadow DOM viewport fallback', () => {
    const host = fixture.css.match(/:host\{([^}]*)\}/)?.[1];
    expect(host).toContain('position:fixed!important');
    for (const property of ['width', 'height', 'inset']) {
      expect(host).not.toMatch(new RegExp(`${property}:[^;]*!important`));
    }
    expect(host).toContain('width:100vw;'); expect(host).toContain('height:100vh;');
  });
  it.each([1, 1.5])('uses the real lazy native GUI lifecycle with the same viewport layout at %s scale', async scale => {
    const f = mountNative(scale);
    expect(f.component._host).toBeNull();
    await f.api.searchMonster({ id: 1002 });
    const host = f.component._host as HTMLElement, root = f.root();
    expect(f.component.__loaded).toBe(true); expect(f.component.__active).toBe(true);
    expect(root.querySelector('#WorldMap')?.parentElement?.className).toBe('ui-component-root');
    expect(root.querySelector('style')?.textContent).toBe(commonCss);
    expect(host.getBoundingClientRect().width).toBeCloseTo(f.win.innerWidth);
    expect(host.getBoundingClientRect().height).toBeCloseTo(f.win.innerHeight);
    expect(host.style.getPropertyPriority('width')).toBe('important');
    expect(root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1002');
    const initial = host.style.cssText;
    f.component.toggle(); expect(host.style.display).toBe('none');
    f.component.toggle(); await flush();
    expect(host.style.cssText).toBe(initial);
    await f.api.searchMonster({ id: 1039 });
    expect(f.component._host).toBe(host); expect(f.root()).toBe(root);
    expect(host.style.cssText).toBe(initial);
    f.component.remove(); expect(host.isConnected).toBe(false);
    await f.api.searchMonster({ id: 1002 });
    expect(f.component._host).toBe(host); expect(host.style.cssText).toBe(initial);
    Object.defineProperty(f.win, 'innerWidth', { configurable: true, value: 640 });
    Object.defineProperty(f.win, 'innerHeight', { configurable: true, value: 400 });
    f.win.dispatchEvent(new f.win.Event('resize'));
    expect(host.getBoundingClientRect().width).toBeCloseTo(640);
    expect(host.getBoundingClientRect().height).toBeCloseTo(400);
    f.component.remove();
  });
  it.each([1, 1.5].flatMap(scale => [[1280, 720], [720, 1280], [360, 360]].map(([width, height]) => [scale, width!, height!])))('fits all four continents inside the available canvas at %s scale and %s×%s viewport', async (scale, width, height) => {
      const f = mountNative(scale); await f.api.searchMonster({ id: 1002 });
      Object.defineProperty(f.win, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(f.win, 'innerHeight', { configurable: true, value: height });
      const canvas = f.root().querySelector<HTMLElement>('.wm-canvas')!, toolbar = f.root().querySelector('.wm-toolbar')!;
      const layoutWidth = width / scale, layoutHeight = height / scale;
      canvas.style.width = `${layoutWidth}px`; canvas.style.height = `${layoutHeight}px`;
      Object.defineProperties(canvas, { clientWidth: { get: () => Math.round(layoutWidth) }, clientHeight: { get: () => Math.round(layoutHeight) },
        offsetWidth: { get: () => Math.round(layoutWidth) }, offsetHeight: { get: () => Math.round(layoutHeight) } });
      const rectangle = (left: number, top: number, w: number, h: number) => ({ x: left, y: top, left, top, right: left + w, bottom: top + h, width: w, height: h, toJSON: () => ({}) });
      vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => rectangle(0, 0, width, height));
      vi.spyOn(toolbar, 'getBoundingClientRect').mockImplementation(() => rectangle(15 * scale, 15 * scale, width - 30 * scale, 36 * scale));
      f.component.onResize();
      const regionSelect = f.root().querySelector<HTMLSelectElement>('.wm-region')!, grid = f.root().querySelector<HTMLElement>('.wm-grid')!;
      for (const [i, region] of fixture.regions.entries()) {
        regionSelect.value = String(i); regionSelect.dispatchEvent(new f.win.Event('change'));
        const w = parseFloat(grid.style.width), h = parseFloat(grid.style.height), left = parseFloat(grid.style.left), top = parseFloat(grid.style.top);
        expect(w).toBeGreaterThan(0); expect(h).toBeGreaterThan(0);
        expect(w / h).toBeCloseTo(region.columns * 50 / (region.rows * 48));
        expect(left).toBeGreaterThanOrEqual(12); expect(top).toBeGreaterThanOrEqual(15 + 36 + 12);
        expect((left + w) * scale).toBeLessThanOrEqual(width + 0.01);
        expect((top + h) * scale).toBeLessThanOrEqual(height + 0.01);
        expect(w > Math.round(layoutWidth) - 25 || h > Math.round(layoutHeight) - (15 + 36 + 12) - 13).toBe(true);
        expect(grid.children).toHaveLength(region.cells.length);
        for (const [j, cell] of region.cells.entries()) {
          const tile = grid.children[j] as HTMLElement;
          expect(parseFloat(tile.style.left)).toBeCloseTo(cell.x / region.columns * 100);
          expect(parseFloat(tile.style.top)).toBeCloseTo(cell.y / region.rows * 100);
          expect(parseFloat(tile.style.width)).toBeCloseTo(cell.span / region.columns * 100);
          expect(parseFloat(tile.style.height)).toBeCloseTo(100 / region.rows);
        }
        expect(canvas.scrollTop).toBe(0); expect(canvas.scrollLeft).toBe(0);
      }
      expect(fixture.css).not.toContain('1104px'); expect(fixture.css).toMatch(/\.wm-canvas\{[^}]*overflow:hidden/);
      f.component.remove();
    });
  it('refits on resize with rect-based canvas dimensions and keeps tile positions unchanged', async () => {
    const f = mountNative(1.5); await f.api.searchMonster({ id: 1002 });
    const canvas = f.root().querySelector<HTMLElement>('.wm-canvas')!, toolbar = f.root().querySelector('.wm-toolbar')!;
    let width = 800, height = 450;
    const rectangle = (w: number, h: number) => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) });
    Object.defineProperties(canvas, { offsetWidth: { get: () => width }, offsetHeight: { get: () => height } });
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => rectangle(width * 1.5, height * 1.5));
    vi.spyOn(toolbar, 'getBoundingClientRect').mockImplementation(() => rectangle(width * 1.5, 51 * 1.5));
    const grid = f.root().querySelector<HTMLElement>('.wm-grid')!;
    f.component.onResize(); const initialWidth = grid.style.width;
    const tiles = [...grid.children].map(tile => (tile as HTMLElement).style.cssText);
    width = 450; height = 800;
    f.win.dispatchEvent(new f.win.Event('resize'));
    expect(grid.style.width).not.toBe(initialWidth);
    expect(parseFloat(grid.style.left) + parseFloat(grid.style.width)).toBeLessThanOrEqual(width);
    expect(parseFloat(grid.style.top) + parseFloat(grid.style.height)).toBeLessThanOrEqual(height);
    expect([...grid.children].map(tile => (tile as HTMLElement).style.cssText)).toEqual(tiles);
    f.component.remove();
  });
  it('does not let native capture binding of a hidden/removed world map swallow game keys', async () => {
    const f = mountNative(); f.component.append();
    const game = vi.fn(); f.win.addEventListener('keydown', game);
    expect(f.component._host.style.display).toBe('none');
    for (const value of ['Escape', 'Enter', 'F2']) expect(f.key(value).defaultPrevented).toBe(false);
    expect(game).toHaveBeenCalledTimes(3);
    await f.api.searchMonster({ id: 1002 });
    expect(f.key('Escape').defaultPrevented).toBe(true); // details -> map
    expect(game).toHaveBeenCalledTimes(3);
    expect(f.key('Escape').defaultPrevented).toBe(true); // map -> hidden
    f.key('Enter'); expect(game).toHaveBeenCalledTimes(4);
    f.component.remove(); f.key('Escape'); expect(game).toHaveBeenCalledTimes(5);
  });
  it('lets native input and title handlers run, ignores composing/repeat Escape, and yields to another focused GUI', async () => {
    const f = mountNative(); await f.api.searchMonster({ id: 1002 });
    const input = f.root().querySelector<HTMLInputElement>('.wm-form input')!, own = vi.fn(), game = vi.fn();
    input.addEventListener('keydown', own); f.win.addEventListener('keydown', game);
    f.key('Enter', input); expect(own).toHaveBeenCalledTimes(1); expect(game).not.toHaveBeenCalled();
    f.key('Escape', input, { isComposing: true });
    f.key('Escape', input, { repeat: true });
    expect(f.root().querySelector<HTMLElement>('.wm-panel')!.hidden).toBe(false);
    expect(own).toHaveBeenCalledTimes(2);
    const external = f.doc.createElement('input'); f.doc.body.append(external);
    expect(f.key('Enter', external).defaultPrevented).toBe(false); expect(game).toHaveBeenCalledTimes(1);
    const prompt = f.doc.createElement('div'); prompt.style.zIndex = '60'; f.doc.body.append(prompt);
    f.component.manager = { components: { Prompt: { _host: prompt, __active: true, needFocus: true } } };
    expect(f.key('Escape').defaultPrevented).toBe(false); expect(game).toHaveBeenCalledTimes(2);
    expect(f.root().querySelector<HTMLElement>('.wm-panel')!.hidden).toBe(false);
    f.component.remove();
  });
  it('scrolls only the details panel when a quest target is selected', async () => {
    const f = mountNative(); const scroll = vi.fn();
    const original = f.win.HTMLElement.prototype.scrollIntoView;
    f.win.HTMLElement.prototype.scrollIntoView = scroll;
    f.doc.documentElement.scrollTop = 120; f.doc.body.scrollTop = 70;
    await f.api.searchMonster({ id: 1002 });
    expect(scroll).not.toHaveBeenCalled();
    expect(f.doc.documentElement.scrollTop).toBe(120); expect(f.doc.body.scrollTop).toBe(70);
    f.win.HTMLElement.prototype.scrollIntoView = original;
    f.component.remove();
  });
  it('uses a single vertical workspace with one page scrollbar at every window size', () => {
    expect(fixture.css).toContain('.wm-workspace{display:grid;grid-template-columns:minmax(0,1fr);');
    expect(fixture.css).toContain('.wm-context,.wm-inspectors{min-width:0;max-height:none;overflow:visible;');
    expect(fixture.css).not.toContain('max-height:calc(100dvh - 130px)');
    expect(fixture.css).not.toContain('.wm-inspectors{border-left:');
  });
  it('uses a single Return control without redundant details instructions or empty drop sections', async () => {
    const f = mount(); await f.api.open({ kind: 'map', id: 'prontera' });
    expect(f.root.querySelector('.wm-dismiss')).toBeNull();
    expect(f.root.querySelector('.wm-back')?.textContent).toBe('返回');
    expect(f.root.activeElement).toBe(f.root.querySelector('.wm-back'));
    expect(fixture.css).not.toContain('点击怪物查看掉落');
    await f.api.open({ kind: 'monster', id: 1002 });
    const details = f.root.querySelector('.wm-monster-detail')!;
    expect(details.textContent).toContain('普通掉落 · 2');
    expect(details.textContent).toContain('10.00%'); expect(details.textContent).toContain('5.00%');
    expect(details.textContent).not.toContain('MVP 奖励');
    expect(details.textContent).not.toMatch(/概率为本地资料|不含服务器倍率|重复物品保留|本地资料未记录/);
    await f.api.open({ kind: 'monster', id: 1039 });
    expect(f.root.querySelector('.wm-monster-detail')?.textContent).toContain('MVP 奖励 · 1');
    expect(f.root.querySelector('.wm-monster-detail')?.textContent).not.toContain('普通掉落 · 0');
    expect(f.root.querySelector('.wm-back')?.textContent).toBe('返回');
    await f.api.open({ kind: 'item', id: 501 });
    expect(f.root.querySelector('.wm-item-window')?.textContent).not.toMatch(/点击怪物查看|概率为本地资料|概率为本地资料基础值/);
  });
  it('returns item popup focus to Return when there is no connected opener', async () => {
    const f = mount(); await f.api.open({ kind: 'item', id: 501 });
    f.root.querySelector<HTMLButtonElement>('.wm-item-window-close')!.click();
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
    expect(f.root.activeElement).toBe(f.root.querySelector('.wm-back'));
    expect(f.root.querySelector('.wm-back')?.textContent).toBe('返回');
    await f.api.open({ kind: 'monster', id: 1002 });
    const opener = f.root.querySelector<HTMLButtonElement>('.wm-monster-detail .wm-card[data-kind="item"]')!;
    opener.click(); await flush(); opener.remove();
    f.root.querySelector<HTMLButtonElement>('.wm-item-window-close')!.click();
    expect(f.root.activeElement).toBe(f.root.querySelector('.wm-back'));
    f.click('返回'); expect(f.root.querySelector<HTMLElement>('.wm-panel')!.hidden).toBe(true);
    expect(f.root.activeElement).toBe(f.root.querySelector('.wm-search'));
  });
  it('bundles every official backdrop and map thumbnail', () => {
    expect(fixture.regions.map(r => r.name)).toEqual(['中土大陆', '次元大陆', '局部地图01', '局部地图02']);
    for (const region of fixture.regions) {
      expect(existsSync('public/worldmap/' + region.background)).toBe(true);
      for (const cell of region.cells) { expect(existsSync('public/worldmap/' + cell.image)).toBe(true); expect(cell.x + cell.span).toBeLessThanOrEqual(region.columns); }
    }
  });
  it('searches all items including those with no drop records and ranks exact ID first', () => {
    expect(model.search('502')[0].record.name).toBe('橙色药水');
    expect(model.search('药水', 'item')).toHaveLength(2);
    expect(model.search('波利', 'monster')[0].record.id).toBe(1002);
    expect(model.search('PRONTERA.GAT', 'map')[0].record.name).toBe('普隆德拉');
    expect(model.search('')).toEqual([]);
  });
  it('exposes monster search on both the component and installer API without appending an existing window', async () => {
    const f = mount();
    expect(f.component.searchMonster).toBe(f.api.searchMonster);
    await f.component.searchMonster({ id: 1002, name: '巴风特' });
    expect(f.component._host.style.display).toBe('');
    expect(f.component.focus).toHaveBeenCalledTimes(1);
    expect(f.component.prepare).not.toHaveBeenCalled();
    expect(f.component.append).not.toHaveBeenCalled();
    expect(f.root.querySelector<HTMLSelectElement>('.wm-form select')?.value).toBe('monster');
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('1002');
    expect(f.root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1002');
    expect(f.root.querySelector('.wm-monster-detail')?.textContent).toContain('波利 · Lv.1');
    expect(f.root.querySelector('.wm-search-results .wm-card')?.getAttribute('aria-pressed')).toBe('true');
    expect(f.teleport).not.toHaveBeenCalled();
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('prepares and appends once on first use, then reuses the native component after removal', async () => {
    const load = vi.fn(async () => data), f = mount(load, items, undefined, false);
    expect(f.component._host.isConnected).toBe(false);
    await f.api.searchMonster({ id: 1002 });
    expect(f.component.prepare).toHaveBeenCalledTimes(1);
    expect(f.component.append).toHaveBeenCalledTimes(1);
    expect(f.component._host.isConnected).toBe(true);
    await f.api.searchMonster({ id: 1039 });
    expect(f.component.append).toHaveBeenCalledTimes(1);
    f.component.onRemove(); f.component._host.remove();
    await f.api.searchMonster({ id: 1002 });
    expect(f.component.prepare).toHaveBeenCalledTimes(1);
    expect(f.component.append).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
    expect(f.root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1002');
  });
  it('uses exact monster IDs for external targets and restores ordinary partial search after editing', async () => {
    const f = mount(vi.fn(async () => ({ ...data, mobData: { ...data.mobData, 11002: { kName: '测试波利', LV: '2' }, 10020: { kName: '测试怪物', LV: '3' } } })));
    await f.api.searchMonster({ id: 1002 });
    expect(f.root.querySelectorAll('.wm-search-results .wm-card')).toHaveLength(1);
    expect(f.root.querySelector('.wm-search-results .wm-card')?.getAttribute('data-id')).toBe('1002');
    const input = f.root.querySelector<HTMLInputElement>('.wm-form input')!;
    input.dispatchEvent(new Event('input'));
    expect(f.root.querySelectorAll('.wm-search-results .wm-card')).toHaveLength(3);
  });
  it('does not replace an unknown explicit monster ID with its name or a substring ID match', async () => {
    const f = mount(); await f.api.searchMonster({ id: 100, name: '波利' });
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('100');
    expect(f.root.querySelector('.wm-search-results')?.textContent).toContain('没有匹配结果');
    expect(f.root.querySelectorAll('.wm-search-results .wm-card')).toHaveLength(0);
    expect(f.root.querySelector('.wm-monster-detail')).toBeNull();
  });
  it('searches by cleaned name when no mobGID is available and opens a unique exact name match', async () => {
    const f = mount(); await f.api.searchMonster({ name: '  ^ff0000波利^000000  ' });
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('波利');
    expect(f.root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1002');
    await f.api.searchMonster({ name: '风' });
    expect(f.root.querySelectorAll('.wm-search-results .wm-card')).toHaveLength(1);
    expect(f.root.querySelector('.wm-monster-detail')).toBeNull();
  });
  it('keeps duplicate exact names as search results without selecting an arbitrary monster', async () => {
    const f = mount(vi.fn(async () => ({ ...data, mobData: { ...data.mobData, 2002: { kName: '波利', LV: '2' } } })));
    await f.api.searchMonster({ name: '波利' });
    expect(f.root.querySelectorAll('.wm-search-results .wm-card')).toHaveLength(2);
    expect(f.root.querySelector('.wm-monster-detail')).toBeNull();
  });
  it.each([0, -1, 1.5, NaN, Infinity, 0x100000000, '1039'])('rejects invalid monster ID %s and uses only its available name', async id => {
    const f = mount(); await f.api.searchMonster({ id, name: '波利' });
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('波利');
    expect(f.root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1002');
  });
  it('never treats huntID or other quest counters as a monster ID and keeps unknown names safe', async () => {
    const f = mount(); await f.api.searchMonster({ huntID: 1039, huntIDCount: 1002, name: '波利' });
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('波利');
    expect(f.root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1002');
    await f.api.searchMonster({ huntID: 1039, name: '<img src=x onerror=alert(1)>' });
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('<img src=x onerror=alert(1)>');
    expect(f.root.querySelector('img[src="x"]')).toBeNull();
    expect(f.root.querySelector('.wm-search-results')?.textContent).toContain('没有匹配结果');
    await f.api.searchMonster({ huntID: 1039 });
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('');
    expect(f.root.querySelector('.wm-monster-detail')).toBeNull();
  });
  it('coalesces loading on repeated clicks and shows only the latest selected target', async () => {
    let resolve!: (value: typeof data) => void;
    const load = vi.fn(() => new Promise<typeof data>(done => { resolve = done; })), f = mount(load);
    const first = f.api.searchMonster({ id: 1002 }), repeat = f.api.searchMonster({ id: 1002 }), latest = f.api.searchMonster({ id: 1039 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(f.component.append).not.toHaveBeenCalled();
    resolve(data); await Promise.all([first, repeat, latest]);
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('1039');
    expect(f.root.querySelectorAll('.wm-monster-detail')).toHaveLength(1);
    expect(f.root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1039');
  });
  it.each(['close', 'back', 'remove', 'escape'])('does not reopen a pending external search after %s', async action => {
    let resolve!: (value: typeof data) => void;
    const f = mount(vi.fn(() => new Promise<typeof data>(done => { resolve = done; })));
    const request = f.api.searchMonster({ id: 1002 });
    if (action === 'close') f.root.querySelector<HTMLButtonElement>('.wm-close')!.click();
    else if (action === 'back') f.click('返回');
    else if (action === 'remove') { f.component.onRemove(); f.component._host.remove(); }
    else f.root.querySelector('.wm-body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    resolve(data); await request;
    expect(f.root.querySelector('.wm-monster-detail')).toBeNull();
    expect(f.component.append).not.toHaveBeenCalled();
    if (action === 'close') expect(f.component._host.style.display).toBe('none');
    else if (action === 'remove') expect(f.component._host.isConnected).toBe(false);
    else expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(true);
  });
  it('retains the exact external monster target when retrying a failed data load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(data), f = mount(load);
    await f.api.searchMonster({ id: 1002, name: '巴风特' });
    expect(f.root.querySelector('.wm-title')?.textContent).toBe('资料加载失败');
    expect(f.component._host.style.display).toBe('');
    f.click('重试'); await flush();
    expect(f.root.querySelector<HTMLInputElement>('.wm-form input')?.value).toBe('1002');
    expect(f.root.querySelector<HTMLSelectElement>('.wm-form select')?.value).toBe('monster');
    expect(f.root.querySelector('.wm-monster-detail')?.getAttribute('data-id')).toBe('1002');
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('preserves independent ordinary and MVP drops without summing duplicate items', () => {
    expect(model.items.get(501).sources.map((s: { rate: number }) => s.rate)).toEqual([1000, 500, 2000]);
    expect(model.monsters.get(1039).drops[0].kind).toBe('MVP 奖励');
    expect(model.monsters.get(1002).maps).toHaveLength(1);
    expect(model.floors('test_dun.rsw').map((m: { id: string }) => m.id)).toEqual(['prontera', 'test_dun']);
  });
  it('uses actual repository monster/drop data including MVP rewards', () => {
    const actual = runInNewContext(`(${fixture.createWorldMapIndex})(w,m,{},()=>({}))`, {
      w: JSON.parse(readFileSync('vendor/core/data/world/world-data.json', 'utf8')),
      m: JSON.parse(readFileSync('vendor/core/data/world/mob-data.json', 'utf8')),
    });
    expect(actual.monsters.get(1039).drops.filter((d: { kind: string }) => d.kind === 'MVP 奖励')).toHaveLength(3);
    expect(actual.items.get(909).sources.length).toBeGreaterThan(0);
    expect(actual.maps.size).toBe(Object.keys(JSON.parse(readFileSync('vendor/core/data/world/world-data.json', 'utf8'))).length);
  });
  it('keeps the selected map mounted with inline monster details and a single item popup', async () => {
    const f = mount(); await f.api.open({ kind: 'map', id: 'prontera' });
    const map = f.root.querySelector('.wm-context');
    const large = f.root.querySelector('.wm-map-image img');
    expect(large?.getAttribute('src')).toBe('/worldmap/prontera.png');
    expect(f.root.querySelector('.wm-body')?.textContent).toContain('地图怪物 · 1 种');
    await f.api.open({ kind: 'monster', id: 1002 });
    expect(f.root.querySelector('.wm-body')?.textContent).toContain('10.00%');
    await f.api.open({ kind: 'item', id: 501 });
    expect(f.root.querySelector('.wm-item-window')?.textContent).toContain('恢复 HP');
    expect(f.root.querySelector('.wm-item-window')?.textContent).toContain('掉落来源 · 3');
    expect(f.root.querySelector('.wm-body .wm-item-detail')).toBeNull();
    expect(f.root.querySelector('.wm-description')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(f.root.querySelector('.wm-description img[src="x"]')).toBeNull();
    for (let i = 0; i < 12; i++) {
      await f.api.open({ kind: 'monster', id: i % 2 ? 1002 : 1039 });
      await f.api.open({ kind: 'item', id: 501 });
    }
    expect(f.root.querySelector('.wm-context')).toBe(map);
    expect(f.root.querySelector('.wm-map-image img')).toBe(large);
    expect(f.root.querySelectorAll('.wm-inspector')).toHaveLength(1);
    expect(f.root.querySelectorAll('.wm-item-window')).toHaveLength(1);
    expect(f.root.querySelector('.wm-title')?.textContent).toBe('普隆德拉 · prontera');
    f.click('返回'); await flush();
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(true);
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
  });
  it('opens drops without scrolling or appending page content and reuses the RO popup', async () => {
    const f = mount(); await f.api.open({ kind: 'map', id: 'prontera' });
    await f.api.open({ kind: 'monster', id: 1002 }); await flush();
    const panel = f.root.querySelector<HTMLElement>('.wm-panel')!;
    const map = f.root.querySelector('.wm-context');
    const monster = f.root.querySelector('.wm-monster-detail');
    const bodyText = f.root.querySelector('.wm-body')!.textContent;
    panel.scrollTop = 240;
    const drop = f.root.querySelector<HTMLButtonElement>('.wm-monster-detail .wm-card[data-kind="item"]')!;
    drop.click(); await flush();
    const popup = f.root.querySelector('.wm-item-window');
    expect(popup?.getAttribute('role')).toBe('dialog');
    expect(popup?.parentElement?.id).toBe('WorldMap');
    expect(f.root.activeElement).toBe(popup?.querySelector('.wm-item-window-close'));
    expect(panel.scrollTop).toBe(240);
    expect(f.root.querySelector('.wm-body')!.textContent).toBe(bodyText);
    expect(f.root.querySelector('.wm-context')).toBe(map);
    expect(f.root.querySelector('.wm-monster-detail')).toBe(monster);
    expect(popup?.querySelector<HTMLDetailsElement>('.wm-item-sources')?.open).toBe(false);
    expect([...popup!.querySelectorAll<HTMLSpanElement>('.wm-description span')].some(span => span.style.color === 'rgb(255, 0, 0)')).toBe(true);
    await f.api.open({ kind: 'item', id: 502 });
    expect(f.root.querySelector('.wm-item-window')).toBe(popup);
    expect(f.root.querySelectorAll('.wm-item-window')).toHaveLength(1);
    expect(popup?.querySelector('.wm-item-window-title')?.textContent).toBe('橙色药水');
    expect(panel.scrollTop).toBe(240);
    (popup!.querySelector('.wm-item-window-close') as HTMLButtonElement).click();
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
    expect(f.root.activeElement).toBe(drop);
    expect(panel.scrollTop).toBe(240);
    expect(panel.hidden).toBe(false);
  });
  it('Escape closes only the item popup first and returns focus to its drop card', async () => {
    const f = mount(); await f.api.open({ kind: 'monster', id: 1002 });
    const drop = f.root.querySelector<HTMLButtonElement>('.wm-monster-detail .wm-card[data-kind="item"]')!;
    drop.click(); await flush();
    f.root.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
    expect(f.root.activeElement).toBe(drop);
    expect(drop.getAttribute('aria-pressed')).toBe('false');
    expect(f.root.querySelector<HTMLElement>('.wm-panel')!.hidden).toBe(false);
    drop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(f.root.querySelector<HTMLElement>('.wm-panel')!.hidden).toBe(true);
  });
  it('cleans up item windows on navigation, monster inspection and component removal', async () => {
    const f = mount(); await f.api.open({ kind: 'item', id: 501 });
    await f.api.open({ kind: 'monster', id: 1039 });
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
    expect(f.root.querySelector('.wm-monster-detail')?.textContent).toContain('巴风特');
    await f.api.open({ kind: 'item', id: 501 }); await f.api.open({ kind: 'map', id: 'prontera' });
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
    await f.api.open({ kind: 'item', id: 501 }); await f.api.open({ kind: 'search' });
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
    await f.api.open({ kind: 'item', id: 501 }); f.component.onRemove();
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
  });
  it('restores drop source clicks to monster details and expands spawn maps by default', async () => {
    const f = mount(); await f.api.open({ kind: 'map', id: 'prontera' });
    await f.api.open({ kind: 'monster', id: 1002 }); await f.api.open({ kind: 'item', id: 501 });
    f.root.querySelector<HTMLDetailsElement>('.wm-item-sources')!.open = true;
    f.root.querySelector<HTMLButtonElement>('.wm-item-sources .wm-card[data-id="1039"]')!.click(); await flush();
    expect(f.root.querySelector('.wm-item-window')).toBeNull();
    expect(f.root.querySelector('.wm-title')?.textContent).toBe('普隆德拉 · prontera');
    expect(f.root.querySelector('.wm-monster-detail')?.textContent).toContain('巴风特');
    expect(f.root.querySelector<HTMLDetailsElement>('.wm-locations')?.open).toBe(true);
    expect(f.root.querySelector('.wm-locations summary')?.textContent).toBe('出没地图 · 1');
    expect(f.root.querySelector('.wm-locations .wm-card[data-id="test_dun"]')).not.toBeNull();
    expect(f.teleport).not.toHaveBeenCalled();
  });
  it('drags by the title bar, clamps to the viewport, retains position and ends capture on cancellation', async () => {
    const f = mount(); await f.api.open({ kind: 'item', id: 501 });
    const area = f.root.querySelector('#WorldMap')!;
    const popup = f.root.querySelector<HTMLElement>('.wm-item-window')!;
    const header = f.root.querySelector<HTMLElement>('.wm-item-window-header')!;
    const rectangle = (width: number, height: number) => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
    const bounds = vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(rectangle(800, 600));
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rectangle(280, 240));
    header.setPointerCapture = vi.fn(); header.hasPointerCapture = vi.fn(() => true); header.releasePointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number, target: HTMLElement = header, button = 0) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
    };
    f.component.onResize(); const startX = parseFloat(popup.style.left), startY = parseFloat(popup.style.top);
    pointer('pointerdown', 100, 100); pointer('pointermove', 220, 180);
    expect(parseFloat(popup.style.left)).toBe(startX + 120); expect(parseFloat(popup.style.top)).toBe(startY + 80);
    expect(header.setPointerCapture).toHaveBeenCalledWith(1);
    pointer('pointerup', 220, 180); expect(popup.hasAttribute('data-dragging')).toBe(false);
    await f.api.open({ kind: 'item', id: 502 }); expect(parseFloat(popup.style.left)).toBe(startX + 120);
    pointer('pointerdown', 100, 100); pointer('pointermove', 9999, 9999);
    expect(popup.style.left).toBe('514px'); expect(popup.style.top).toBe('354px');
    pointer('pointercancel', 9999, 9999); pointer('pointermove', 0, 0);
    expect(popup.style.left).toBe('514px');
    bounds.mockReturnValue(rectangle(400, 300)); f.component.onResize();
    expect(popup.style.left).toBe('114px'); expect(popup.style.top).toBe('54px');
    pointer('pointerdown', 100, 100, header, 2); expect(popup.hasAttribute('data-dragging')).toBe(false);
    pointer('pointerdown', 100, 100, f.root.querySelector<HTMLElement>('.wm-item-window-close')!);
    expect(popup.hasAttribute('data-dragging')).toBe(false);
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); expect(popup.style.left).toBe('104px');
    f.click('返回'); expect(f.root.querySelector('.wm-item-window')).toBeNull();
    document.defaultView!.dispatchEvent(new Event('resize'));
  });
  it('keeps item popup coordinates in layout units when the world map is scaled to 150%', async () => {
    const f = mount(); await f.api.open({ kind: 'item', id: 501 });
    const area = f.root.querySelector<HTMLElement>('#WorldMap')!, popup = f.root.querySelector<HTMLElement>('.wm-item-window')!;
    const header = popup.querySelector<HTMLElement>('.wm-item-window-header')!;
    const rectangle = (width: number, height: number) => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
    Object.defineProperties(area, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 } });
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(rectangle(1200, 900));
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rectangle(420, 360));
    header.setPointerCapture = vi.fn(); header.hasPointerCapture = vi.fn(() => true); header.releasePointerCapture = vi.fn();
    f.component.onResize();
    const startX = parseFloat(popup.style.left), startY = parseFloat(popup.style.top);
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 1 }); header.dispatchEvent(event);
    };
    pointer('pointerdown', 100, 100); pointer('pointermove', 250, 220);
    expect(parseFloat(popup.style.left)).toBe(startX + 100); expect(parseFloat(popup.style.top)).toBe(startY + 80);
    pointer('pointermove', 9999, 9999); pointer('pointerup', 9999, 9999);
    expect(popup.style.left).toBe('514px'); expect(popup.style.top).toBe('354px');
    f.click('返回');
  });
  it('loads native item window skin and collection art through the shared image cache', async () => {
    const f = mount(); f.Client.loadFile.mockImplementation((path, done) => done('data:image/png;base64,' + path));
    await f.api.open({ kind: 'item', id: 501 }); await flush();
    expect(f.root.querySelector('.wm-item-window')?.hasAttribute('data-skinned')).toBe(true);
    const artwork = f.root.querySelector<HTMLImageElement>('.wm-item-collection')!;
    expect(artwork.src).toBe('data:image/png;base64,collection/red-potion.bmp');
    artwork.dispatchEvent(new Event('load')); expect(artwork.hidden).toBe(false);
    f.click('返回'); await f.api.open({ kind: 'item', id: 501 }); await flush();
    for (const path of ['collection/red-potion.bmp', 'basic_interface/collection_bg.bmp', 'basic_interface/sys_close_off.bmp', 'basic_interface/sys_close_on.bmp']) {
      expect(f.Client.loadFile.mock.calls.filter(c => c[0] === path)).toHaveLength(1);
    }
  });
  it('keeps search term/type/page when returning from details', async () => {
    const f = mount(); await f.api.open({ kind: 'search' });
    const input = f.root.querySelector('input')!;
    input.value = '药水'; input.dispatchEvent(new Event('input'));
    expect(f.root.querySelector('.wm-body')?.textContent).toContain('找到 2 条结果');
    await f.api.open({ kind: 'item', id: 501 });
    expect(f.root.querySelector('input')).toBe(input);
    expect(f.root.querySelector('input')?.value).toBe('药水');
  });
  it('updates the large image to the selected floor and removes the locate action', async () => {
    const f = mount(); await f.api.open({ kind: 'map', id: 'prontera' });
    await f.api.open({ kind: 'map', id: 'test_dun' });
    expect(f.root.querySelector('.wm-map-image img')?.getAttribute('alt')).toBe('测试地下城地图大图');
    expect(f.root.querySelector('.wm-map-image')?.textContent).toContain('test_dun（地图图像暂缺）');
    expect(f.root.querySelector('.wm-body')?.textContent).not.toContain('在世界地图定位');
    expect(f.root.querySelector('.wm-body')?.textContent).toContain('巴风特');
  });
  it('prefers the native full-size minimap instead of enlarging the 60px overview tile', async () => {
    const f = mount();
    f.Client.loadFile.mockImplementation((path, done) => done('data:image/bmp;base64,' + path));
    await f.api.open({ kind: 'map', id: 'prontera' });
    expect(f.root.querySelector('.wm-map-image img')?.getAttribute('src')).toBe('data:image/bmp;base64,map/prontera.bmp');
    await f.api.open({ kind: 'map', id: 'test_dun' });
    expect(f.root.querySelector('.wm-map-image img')?.getAttribute('src')).toBe('data:image/bmp;base64,map/test_dun.bmp');
  });
  it('pages all matches instead of silently truncating and restores the page', async () => {
    const catalog = Object.fromEntries(Array.from({ length: 125 }, (_, i) => [5000 + i, { identifiedDisplayName: `测试道具${i}` }]));
    const f = mount(undefined, catalog); await f.api.open({ kind: 'search' });
    const input = f.root.querySelector('input')!; input.value = '测试道具'; input.dispatchEvent(new Event('input'));
    expect(f.root.querySelectorAll('.wm-card')).toHaveLength(60); f.click('下一页');
    expect(f.root.querySelector('.wm-page')?.textContent).toContain('2 / 3');
    await f.api.open({ kind: 'item', id: 5000 });
    expect(f.root.querySelector('.wm-page')?.textContent).toContain('2 / 3'); f.click('下一页');
    expect(f.root.querySelectorAll('.wm-search-results .wm-card')).toHaveLength(5);
  });
  it('keeps party map markers while switching regions', () => {
    const f = mount(); f.component.updatePartyMembers({ groupInfo: [{ AID: 22, state: 0, mapName: 'prontera.gat' }] });
    expect(f.root.querySelector('.wm-tile.party')?.getAttribute('data-map-id')).toBe('prontera');
    f.component.updatePartyMembers({ groupInfo: [] }); expect(f.root.querySelector('.wm-tile.party')).toBeNull();
  });
  it('returns to search in one step even after switching maps and opening details', async () => {
    const f = mount(); await f.api.open({ kind: 'search' });
    const input = f.root.querySelector('input')!; input.value = '波利'; input.dispatchEvent(new Event('input'));
    await f.api.open({ kind: 'map', id: 'prontera' });
    await f.api.open({ kind: 'map', id: 'test_dun' });
    await f.api.open({ kind: 'monster', id: 1039 }); await f.api.open({ kind: 'item', id: 501 });
    f.click('返回'); await flush();
    expect(f.root.querySelector('input')?.value).toBe('波利');
    expect(f.root.querySelectorAll('.wm-inspector')).toHaveLength(0);
  });
  it('passes the selected floor label to the teleport adapter and keeps synchronous adapters compatible', async () => {
    const f = mount(); await f.api.open({ kind: 'map', id: 'test_dun' }); f.click('传送到此地图');
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith('test_dun', '测试地下城');
    await flush();
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(true);
  });
  it('disables repeat clicks while checking and hides only after the verified warp is sent', async () => {
    const f = mount(), warp = installVerifiedWarp(f); await f.api.open({ kind: 'map', id: 'test_dun' });
    f.click('传送到此地图');
    const button = [...f.root.querySelectorAll('button')].find(button => button.textContent === '传送到此地图')!;
    expect(button.disabled).toBe(true);
    f.click('传送到此地图');
    expect(f.teleport).toHaveBeenCalledTimes(1);
    expect(warp.send).not.toHaveBeenCalled();
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(false);
    warp.approve(); await flush();
    expect(warp.send).toHaveBeenCalledExactlyOnceWith('test_dun');
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(true);
  });
  it('keeps the selected map available and reenables retry after a failed preflight', async () => {
    const f = mount(), warp = installVerifiedWarp(f); await f.api.open({ kind: 'map', id: 'test_dun' });
    f.component._host.style.display = '';
    f.click('传送到此地图'); warp.reject(); await flush();
    expect(warp.send).not.toHaveBeenCalled();
    expect(warp.onError).toHaveBeenCalledTimes(1);
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(false);
    expect(f.component._host.style.display).toBe('');
    expect(f.root.querySelector('.wm-title')?.textContent).toBe('测试地下城 · test_dun');
    const button = [...f.root.querySelectorAll('button')].find(button => button.textContent === '传送到此地图')!;
    expect(button.disabled).toBe(false);
    f.click('传送到此地图'); warp.approve(); await flush();
    expect(warp.send).toHaveBeenCalledExactlyOnceWith('test_dun');
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(true);
  });
  it('keeps the selected map mounted when an adapter rejects instead of hiding it', async () => {
    const f = mount(); f.teleport.mockRejectedValue(new Error('missing map resource'));
    await f.api.open({ kind: 'map', id: 'test_dun' }); f.click('传送到此地图'); await flush();
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(false);
    expect([...f.root.querySelectorAll('button')].find(button => button.textContent === '传送到此地图')?.disabled).toBe(false);
  });
  it.each(['close', 'back', 'remove'])('cancels a pending warp when the world map lifecycle action is %s', async action => {
    const f = mount(), warp = installVerifiedWarp(f); await f.api.open({ kind: 'map', id: 'test_dun' });
    f.click('传送到此地图'); const previousCancels = f.cancelTeleport.mock.calls.length;
    if (action === 'close') f.root.querySelector<HTMLButtonElement>('.wm-close')!.click();
    else if (action === 'back') f.click('返回');
    else f.component.onRemove();
    expect(f.cancelTeleport.mock.calls.length).toBeGreaterThan(previousCancels);
    warp.approve(); await flush();
    expect(warp.send).not.toHaveBeenCalled();
    expect(warp.onError).not.toHaveBeenCalled();
  });
  it('cancels the pending target when switching maps and ignores its late completion', async () => {
    const f = mount(), warp = installVerifiedWarp(f); await f.api.open({ kind: 'map', id: 'test_dun' });
    f.click('传送到此地图'); await f.api.open({ kind: 'map', id: 'prontera' });
    warp.approve(); await flush();
    expect(warp.send).not.toHaveBeenCalled();
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(false);
    expect(f.root.querySelector('.wm-title')?.textContent).toBe('普隆德拉 · prontera');
  });
  it('retries after load failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(data);
    const f = mount(load); await f.api.open({ kind: 'monster', id: 1002 });
    expect(f.root.querySelector('.wm-title')?.textContent).toBe('资料加载失败');
    f.click('重试'); await flush(); expect(f.root.querySelector('.wm-monster-detail')?.textContent).toContain('波利 · Lv.1');
  });
  it('shows real portrait loader output on search cards and inline monster details', async () => {
    const f = mount(); await f.api.open({ kind: 'search' });
    const input = f.root.querySelector('input')!; input.value = '波利'; input.dispatchEvent(new Event('input')); await flush();
    expect(f.monsterPortrait).toHaveBeenCalledWith(1002);
    expect(f.root.querySelector('.wm-search-results .wm-portrait img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    (f.root.querySelector('.wm-search-results .wm-card') as HTMLButtonElement).click(); await flush();
    expect(f.root.querySelector('.wm-monster-detail .wm-portrait img')).not.toBeNull();
    (f.root.querySelector('.wm-monster-detail .wm-card[data-kind="item"]') as HTMLButtonElement).click(); await flush();
    expect(f.root.querySelector('.wm-item-detail')?.textContent).toContain('恢复 HP');
    expect(f.root.querySelector('input')).toBe(input);
  });
  it('shows cached item thumbnails in search, monster drops and the item popup', async () => {
    const f = mount();
    f.Client.loadFile.mockImplementation((path, done, fail) => { if (path === 'item/red-potion.bmp') done('data:image/png;base64,potion'); else fail?.(); });
    await f.api.open({ kind: 'search' });
    const input = f.root.querySelector('input')!; input.value = '红色药水'; input.dispatchEvent(new Event('input')); await flush();
    expect(f.root.querySelector('.wm-search-results .wm-item-icon')?.getAttribute('src')).toBe('data:image/png;base64,potion');
    await f.api.open({ kind: 'monster', id: 1002 });
    expect(f.root.querySelector('.wm-monster-detail .wm-item-icon')?.getAttribute('src')).toBe('data:image/png;base64,potion');
    await f.api.open({ kind: 'item', id: 501 });
    const icon = f.root.querySelector<HTMLImageElement>('.wm-description .wm-item-icon')!;
    expect(icon.src).toBe('data:image/png;base64,potion'); expect(icon.alt).toBe('红色药水缩略图'); expect(icon.hidden).toBe(false);
    icon.dispatchEvent(new Event('error')); expect(icon.hidden).toBe(true);
    expect(f.root.querySelector('.wm-description .wm-icon-fallback')?.textContent).toBe('图标暂缺');
    expect(f.root.querySelector('.wm-description')?.textContent).toContain('恢复 HP');
    expect(f.Client.loadFile.mock.calls.filter(c => c[0] === 'item/red-potion.bmp')).toHaveLength(1);
  });
  it('coalesces repeated image loads and reuses the result after closing the panel', async () => {
    const f = mount(); let resolve!: (url: string) => void;
    f.Client.loadFile.mockImplementation((path, done, fail) => { if (path === 'item/red-potion.bmp') resolve = done; else fail?.(); });
    await f.api.open({ kind: 'monster', id: 1002 });
    await f.api.open({ kind: 'item', id: 501 });
    expect(f.Client.loadFile.mock.calls.filter(c => c[0] === 'item/red-potion.bmp')).toHaveLength(1);
    resolve('data:image/png;base64,cached'); await flush();
    expect(f.root.querySelectorAll('.wm-item-icon[src="data:image/png;base64,cached"]')).toHaveLength(3);
    f.click('返回'); await f.api.open({ kind: 'item', id: 501 });
    expect(f.Client.loadFile.mock.calls.filter(c => c[0] === 'item/red-potion.bmp')).toHaveLength(1);
    expect(f.root.querySelector('.wm-description .wm-item-icon')?.getAttribute('src')).toBe('data:image/png;base64,cached');
  });
  it('keeps data usable if a portrait fails and ignores detached portrait callbacks', async () => {
    const failed = mount(undefined, items, vi.fn().mockRejectedValue(new Error('missing')));
    await failed.api.open({ kind: 'map', id: 'prontera' }); await flush();
    expect(failed.root.querySelector('.wm-portrait')?.textContent).toBe('外貌暂缺');
    let resolve!: (value: string) => void;
    const f = mount(undefined, items, vi.fn(() => new Promise<string>(r => { resolve = r; })));
    await f.api.open({ kind: 'map', id: 'prontera' }); await flush();
    const portrait = f.root.querySelector('.wm-portrait')!;
    f.click('返回'); resolve('data:image/png;base64,AAAA'); await flush();
    expect(portrait.querySelector('img')).toBeNull();
  });
  it('ignores stale requests after dismissing or removing the component', async () => {
    let resolve!: (value: typeof data) => void;
    const f = mount(vi.fn(() => new Promise(r => { resolve = r; })));
    const request = f.api.open({ kind: 'monster', id: 1002 }); f.click('返回'); resolve(data); await request;
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(true);
    f.component.onRemove();
  });
  it('isolates input shortcuts and dismisses details with Escape', async () => {
    const f = mount(); await f.api.open({ kind: 'search' });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    f.root.querySelector('input')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.root.querySelector<HTMLElement>('.wm-panel')?.hidden).toBe(true);
  });
});
