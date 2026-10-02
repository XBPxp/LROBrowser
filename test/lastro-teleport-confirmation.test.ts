// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLastroChatMapLinks } from '../scripts/lastro-chat-map-links.mjs';
import { installLastroNpcMapLinks, type NpcMapComponent, type NpcMapLinksApi } from '../scripts/lastro-npc-map-links.mjs';
import { installLastroAchievementLinks, type AchievementLinkComponent, type AchievementLinksApi } from '../scripts/lastro-achievement-links.mjs';
import { createLastroWorldMapTeleport } from '../scripts/lastro-worldmap-teleport.mjs';
import { createLastroVerifiedTeleportRequest } from '../scripts/lastro-teleport-request.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

type Policy = () => boolean;
const cleanups: Array<() => void> = [];
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(async () => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  await flush(); document.body.replaceChildren(); vi.restoreAllMocks();
});

// Keep the native button ordering: remove the prompt, then invoke Yes/No.
// Approvals require an actual button click; returning no popup is never approval.
function prompts() {
  const dialogs: Array<{ host: HTMLElement; yes: HTMLButtonElement; no: HTMLButtonElement }> = [];
  const showPrompt = vi.fn((message: string, onYes: () => void, onNo: () => void) => {
    const host = document.createElement('div'), root = host.attachShadow({ mode: 'open' });
    const text = document.createElement('p'); text.textContent = message;
    const yes = document.createElement('button'), no = document.createElement('button');
    yes.className = no.className = 'btn'; yes.textContent = '确认'; no.textContent = '取消';
    root.append(text, yes, no); document.body.append(host);
    const prompt = { onRemove: undefined as (() => void) | undefined, getRoot: () => root,
      remove() { this.onRemove?.(); host.remove(); }, _bindKeyDown() {} };
    yes.addEventListener('click', () => { prompt.remove(); onYes(); });
    no.addEventListener('click', () => { prompt.remove(); onNo(); });
    dialogs.push({ host, yes, no }); return prompt;
  });
  return { dialogs, showPrompt };
}

function chat(policy?: Policy) {
  const parent = document.createElement('div'); document.body.append(parent);
  const popup = prompts(), send = vi.fn(), navigate = vi.fn(); let available = true;
  const api = createLastroChatMapLinks({ setHtml: setLastROInnerHTML, showPrompt: popup.showPrompt,
    teleport: send, navigate, canTeleport: () => available, getMap: () => 'prontera',
    ...(policy ? { shouldConfirmTeleport: policy } : {}) });
  api.render(parent, "<span class='mapname' data-map='force_map3#100#184'>活动</span>");
  const link = parent.querySelector<HTMLAnchorElement>('a.mapname')!;
  return { api, link, send, navigate, ...popup, unavailable: () => { available = false; } };
}

function mapLinks(kind: 'npc' | 'achievement', policy?: Policy, approved = true, check?: () => Promise<{ approved: boolean }>) {
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' }), content = document.createElement('div'); root.append(content);
  const popup = prompts(), send = vi.fn(), close = vi.fn();
  const preflight = { check: vi.fn(check || (async () => ({ approved }))), cancel: vi.fn() };
  let api: NpcMapLinksApi | AchievementLinksApi;
  const controller = createLastroWorldMapTeleport({ preflight, getMap: () => 'izlude', getProfile: () => 5,
    send: map => {
      if (!api.canSend(map)) throw new Error('stale link');
      if (kind === 'npc') (api as NpcMapLinksApi).commit(map, () => send(map)); else send(map);
    } });
  const base = { _host: host, __active: true, getRoot: () => root };
  const npc: NpcMapComponent = { ...base, ownerID: 123, init() {}, setText() {}, addNext() {}, addClose() {}, next() {},
    close() { close(); this.__active = false; host.remove(); } };
  const achievement: AchievementLinkComponent = { ...base, selectedAchId: 120083 };
  const options = { showPrompt: popup.showPrompt, teleport: controller.request, cancelPending: controller.cancelPending,
    ...(policy ? { shouldConfirmTeleport: policy } : {}) };
  if (kind === 'npc') {
    api = installLastroNpcMapLinks(npc, { ...options, setHtml: (parent, html) => setLastROInnerHTML(parent as HTMLElement, html) });
    (api as NpcMapLinksApi).render(content, '^nMapName^ra_fild05', text => text);
  } else {
    api = installLastroAchievementLinks(achievement, { ...options, showMonster: vi.fn() });
    (api as AchievementLinksApi).render(content, '<span class="goto">ra_fild05</span>');
  }
  cleanups.push(() => api.invalidate());
  return { api, npc, achievement, content, link: content.querySelector<HTMLAnchorElement>('a')!, send, close, preflight, ...popup };
}

type Route = { npc: string; desc: string; outset: [string, number, number]; path: [string, number, number][]; unavailable?: boolean };
const route: Route = { npc: '任务NPC', desc: '任务地点', outset: ['prontera', 100, 184], path: [['prontera', 100, 184]] };
class Panel {
  _host = document.createElement('div'); _root = this._host.attachShadow({ mode: 'open' });
  __active = false; _cssText = ''; render = () => ''; init = () => {}; onAppend = () => {}; onRemove = () => {};
  constructor(public name: string, css: string) { this._cssText = css; this._host.style.zIndex = '50'; }
  getRoot() { return this._root; }
  append() {
    if (!this._root.childNodes.length) { const template = document.createElement('template');
      setLastROInnerHTML(template, this.render()); this._root.append(template.content); this.init(); }
    document.body.append(this._host); this.__active = true; this.onAppend();
  }
  remove() { this.__active = false; this.onRemove(); this._host.remove(); }
  focus() {} draggable() {} _setupScrollbars() {} _fixPositionOverflow() {}
}
interface ToolsApi { teleport: Panel; showTeleport(): void; select(category: string): void; requestCustomRoute(route: Route): void; deactivate(): void; }
// Only this small helper is evaluated; no bundle transformation or native AST parse.
const installTools = runInNewContext(readFileSync('scripts/lastro-tools-panels.mjs', 'utf8')
  .replace('export function ', 'function ') + '\ninstallLastroToolsPanels;') as
  (tools: Panel, deps: Record<string, unknown>, css: string) => ToolsApi;
function tools(policy?: Policy, approved = true) {
  const popup = prompts(), saved = vi.fn();
  const preferences = { orders: {}, category: 'custom', save: saved,
    customPlaces: { version: 1, entries: [{ id: 'place-1', name: '我的地点', desc: '', map: 'prontera', x: 100, y: 184 }] } };
  const preflight = { check: vi.fn(async () => ({ approved })), cancel: vi.fn() };
  const navigation = { request: vi.fn(() => 'teleport'), cancel: vi.fn() };
  const verified = createLastroVerifiedTeleportRequest({ preflight, navigation, getMap: () => 'izlude', getProfile: () => 5 });
  const component = Object.assign(new Panel('LastROTools', ''), { _defaultQuickRoutes: {},
    hidePanel() {}, restorePanel() {}, populateItemSelects() {}, setStatus: vi.fn(), loadQuickRoutes() {} });
  const normalizeRoute = (value: Route) => {
    if (!value || typeof value.npc !== 'string' || !Array.isArray(value.path) || !value.path.length) throw new Error('Invalid route');
    return value;
  };
  const api = installTools(component, { document, window, GUIComponent: Panel,
    UIManager: { addComponent: (value: Panel) => value }, setHtml: setLastROInnerHTML, normalizeRoute,
    loadPreferences: () => preferences, getProfile: () => 5, getPresetRoutes: () => ({}),
    showPrompt: popup.showPrompt, requestRoute: verified.request, cancelPendingRoute: verified.cancelPending,
    ...(policy ? { shouldConfirmTeleport: policy } : {}) }, '');
  cleanups.push(() => { api.deactivate(); verified.cancel(); });
  return { api, preferences, saved, preflight, navigation, ...popup };
}

describe('teleport confirmation setting at every prompt owner', () => {
  it('keeps the default chat confirmation and sends only after the native-order Yes click', async () => {
    const f = chat(); expect(f.api.request(f.link)).toBe(true);
    expect(f.showPrompt).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled();
    f.dialogs[0]!.yes.click(); await flush();
    expect(f.send).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
  });
  it('skips the chat prompt only when disabled while retaining link registration and packet availability checks', () => {
    const f = chat(() => false); expect(f.api.request(f.link)).toBe(true);
    expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
    f.link.dataset.map = 'another_map'; expect(f.api.request(f.link)).toBe(false);
    expect(f.api.request(f.link.cloneNode(true) as Element)).toBe(false); expect(f.send).toHaveBeenCalledTimes(1);
    const blocked = chat(() => false); blocked.unavailable(); expect(blocked.api.request(blocked.link)).toBe(false);
    expect(blocked.showPrompt).not.toHaveBeenCalled(); expect(blocked.send).not.toHaveBeenCalled();
  });
  it('reads the chat policy for each new request without caching it at installation', async () => {
    let enabled = false; const f = chat(() => enabled);
    f.api.request(f.link); expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledTimes(1);
    enabled = true; f.api.request(f.link); expect(f.showPrompt).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
    f.dialogs[0]!.no.click(); await flush(); expect(f.send).toHaveBeenCalledTimes(1);
  });
  for (const kind of ['npc', 'achievement'] as const) {
    it(`keeps the default ${kind} prompt before resource checks and sending`, async () => {
      const f = mapLinks(kind), pending = f.api.request(f.link);
      expect(f.showPrompt).toHaveBeenCalledTimes(1); expect(f.preflight.check).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
      f.dialogs[0]!.yes.click(); expect(await pending).toBe(true);
      expect(f.preflight.check).toHaveBeenCalledExactlyOnceWith({ outset: ['ra_fild05', 0, 0] });
      expect(f.send).toHaveBeenCalledExactlyOnceWith('ra_fild05');
    });
    it(`skips the disabled ${kind} prompt while retaining resource verification and canSend authorization`, async () => {
      const f = mapLinks(kind, () => false), pending = f.api.request(f.link);
      expect(f.showPrompt).not.toHaveBeenCalled(); expect(await pending).toBe(true);
      expect(f.preflight.check).toHaveBeenCalledExactlyOnceWith({ outset: ['ra_fild05', 0, 0] });
      expect(f.send).toHaveBeenCalledExactlyOnceWith('ra_fild05');
      expect(f.api.canSend('ra_fild05')).toBe(false); expect(f.close).toHaveBeenCalledTimes(kind === 'npc' ? 1 : 0);
    });
    it(`keeps ${kind} resource rejection active with confirmation disabled`, async () => {
      const f = mapLinks(kind, () => false, false), pending = f.api.request(f.link);
      expect(f.showPrompt).not.toHaveBeenCalled(); expect(await pending).toBe(false);
      expect(f.preflight.check).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
    });
    it(`rejects unregistered and changed ${kind} links with confirmation disabled`, async () => {
      const f = mapLinks(kind, () => false);
      expect(await f.api.request(f.link.cloneNode(true) as Element)).toBe(false);
      if (kind === 'npc') f.npc.ownerID++; else f.link.dataset.target = 'prontera';
      expect(await f.api.request(f.link)).toBe(false);
      expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.preflight.check).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    });
    it(`does not send a stale ${kind} request when its owner or selection changes during verification without a prompt`, async () => {
      let approve!: (value: { approved: boolean }) => void;
      const f = mapLinks(kind, () => false, true, () => new Promise(done => { approve = done; }));
      const pending = f.api.request(f.link);
      expect(f.showPrompt).not.toHaveBeenCalled(); expect(f.preflight.check).toHaveBeenCalledTimes(1);
      if (kind === 'npc') f.npc.ownerID++; else f.achievement.selectedAchId = 140001;
      approve({ approved: true }); expect(await pending).toBe(false);
      expect(f.send).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
      expect(f.api.canSend('ra_fild05')).toBe(false);
    });
  }
  it('keeps default tools route confirmation before the shared verified request', async () => {
    const f = tools(); f.api.requestCustomRoute(route);
    expect(f.showPrompt).toHaveBeenCalledTimes(1); expect(f.preflight.check).not.toHaveBeenCalled();
    f.dialogs[0]!.yes.click(); await flush();
    expect(f.preflight.check).toHaveBeenCalledTimes(1); expect(f.navigation.request).toHaveBeenCalledExactlyOnceWith(route);
  });
  it('skips disabled tools route confirmation and still uses the shared verified request', async () => {
    const f = tools(() => false); f.api.requestCustomRoute(route);
    expect(f.showPrompt).not.toHaveBeenCalled(); await flush();
    expect(f.preflight.check).toHaveBeenCalledTimes(1); expect(f.navigation.request).toHaveBeenCalledExactlyOnceWith(route);
    expect(() => f.api.requestCustomRoute({ ...route, unavailable: true })).toThrow('地点资料暂不可用');
    expect(f.preflight.check).toHaveBeenCalledTimes(1);
  });
  it('retains tools resource rejection when confirmation is disabled', async () => {
    const f = tools(() => false, false); f.api.requestCustomRoute(route);
    expect(f.showPrompt).not.toHaveBeenCalled(); await flush();
    expect(f.preflight.check).toHaveBeenCalledTimes(1); expect(f.navigation.request).not.toHaveBeenCalled();
  });
  it('still confirms deleting a saved location when teleport confirmation is disabled', async () => {
    const f = tools(() => false); f.api.showTeleport();
    f.api.teleport.getRoot().querySelector<HTMLButtonElement>('[data-delete-place]')!.click();
    expect(f.showPrompt).toHaveBeenCalledExactlyOnceWith('是否删除自定义地点“我的地点”？', expect.any(Function), expect.any(Function));
    expect(f.preferences.customPlaces.entries).toHaveLength(1); expect(f.saved).not.toHaveBeenCalled();
    f.dialogs[0]!.yes.click(); await flush();
    expect(f.preferences.customPlaces.entries).toHaveLength(0); expect(f.saved).toHaveBeenCalledTimes(1);
    expect(f.preflight.check).not.toHaveBeenCalled(); expect(f.navigation.request).not.toHaveBeenCalled();
  });
});
