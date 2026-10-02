// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installLastroShortcutSettings } from '../scripts/lastro-shortcut-settings.mjs';
import { installLastroTeleportSettings } from '../scripts/lastro-teleport-settings.mjs';
import { lastroUiWindowAppend } from '../scripts/lastro-ui-state.mjs';

const vendor = readFileSync('vendor/v2/Online.js', 'utf8');
const generated = readFileSync('generated/runtime/Online.js', 'utf8');
// Execute the actual patch function without loading unrelated skill-data assets
// through Vite's jsdom URL transformation.
const patchSource = readFileSync('scripts/patch-v2-runtime.mjs', 'utf8');
const patchFile = ts.createSourceFile('patcher.mjs', patchSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const patchDeclarations = patchFile.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'patchRuntimeShortcutSettings');
if (patchDeclarations.length !== 1) throw new Error('Missing shortcut-settings patch');
const patchRuntimeShortcutSettings = vm.runInNewContext(
  patchDeclarations[0]!.getText(patchFile).replace(/^export\s+/, '') + '\npatchRuntimeShortcutSettings;',
  { ts, installLastroShortcutSettings, installLastroTeleportSettings, fail: (message: string) => { throw new Error(message); } },
) as (source: string) => string;
function region(source: string, name: string) {
  const start = source.indexOf(`//#region ${name}`), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error(`Missing native region: ${name}`);
  return source.slice(start, end + '//#endregion'.length);
}
const componentModules = [
  'src/UI/Components/GraphicsOption/GraphicsOption.html?raw',
  'src/UI/Components/GraphicsOption/GraphicsOption.css?raw',
  'src/UI/Components/GraphicsOption/GraphicsOption.js',
  'src/UI/Components/Escape/Escape.html?raw',
  'src/UI/Components/Escape/Escape.css?raw',
  'src/UI/Components/Escape/Escape.js',
];
const native = ['src/UI/GUIComponent.js', 'src/UI/UIManager.js', ...componentModules]
  .map(name => region(vendor, name)).join('\n');
const patched = patchRuntimeShortcutSettings(native);
function classMembers(source: string, module: string, className: string, names: string[]) {
  const file = ts.createSourceFile('native.js', region(source, module), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let component: ts.ClassExpression | ts.ClassDeclaration | undefined;
  function visit(node: ts.Node) {
    if ((ts.isClassExpression(node) || ts.isClassDeclaration(node))
      && (node.name?.text === className || (ts.isBinaryExpression(node.parent) && node.parent.left.getText(file) === className))) component = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!component) throw new Error(`Missing native class: ${className}`);
  return names.map(name => {
    const matches = component!.members.filter(member => name === 'constructor'
      ? ts.isConstructorDeclaration(member)
      : ts.isMethodDeclaration(member) && member.name.getText(file) === name);
    if (matches.length !== 1) throw new Error(`Missing native method: ${className}.${name}`);
    return matches[0]!.getText(file);
  }).join('\n');
}
function preferenceHelpers(source: string) {
  const prefix = source.slice(0, source.indexOf('//#region'));
  const file = ts.createSourceFile('preferences.js', prefix, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const groups = [
    ['getLastroShortcutEntryPreferences', 'getLastroShortcutEntryEnabled', 'setLastroShortcutEntryEnabled'],
    ['getLastroTeleportConfirmationPreferences', 'getLastroTeleportConfirmationEnabled', 'setLastroTeleportConfirmationEnabled'],
  ];
  const names = groups.flat();
  const functions = file.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
  if (!functions.length) return '';
  for (const group of groups) {
    const count = functions.filter(node => group.includes(node.name?.text ?? '')).length;
    if (count && count !== group.length) throw new Error('Incomplete generated graphics preference helpers');
  }
  return 'let lastroShortcutEntryPreferences, lastroTeleportConfirmationPreferences;\n' + functions.map(node => node.getText(file)).join('\n');
}
interface Component {
  name: string; __loaded: boolean; __active: boolean; _host: HTMLElement | null;
  _lastroWindowState?: { dispose(): void };
  render: () => string; init: () => void; onAppend: () => void;
  getRoot(): ShadowRoot; append(): void; remove(): void;
}
const fixtures: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
  document.body.replaceChildren();
});
async function microtasks() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
function runtime(source: string, initialEnabled = true, initialTeleportEnabled?: boolean) {
  const errors: unknown[] = [], timeline: string[] = [];
  const saved = new Map<string, Record<string, unknown>>([['LastROShortcutEntry', { enabled: initialEnabled }]]);
  if (initialTeleportEnabled !== undefined) saved.set('LastROTeleportConfirmation', { enabled: initialTeleportEnabled });
  const save = vi.fn(function (this: Record<string, unknown>): unknown {
    saved.set(String(this._key), { ...this, save: undefined });
    return true;
  });
  const preferences = { get: vi.fn((key: string, defaults: Record<string, unknown>) => ({
    ...defaults, ...saved.get(key), _key: key, save,
  })) };
  const settings = {
    quality: 50, screensize: 'full', cursor: true, fpslimit: 60, pixelPerfectSprites: false,
    bloom: true, bloomIntensity: 0.3, blur: false, blurArea: 1, blurIntensity: 1,
    fxaaEnabled: true, fxaaSubpix: 0.3, fxaaEdgeThreshold: 0.2,
    vibranceEnabled: false, vibrance: 0.15, casEnabled: false, casContrast: 0.5, casSharpening: 0.5,
    cartoonEnabled: false, cartoonEdgeSlope: 1.5, cartoonPower: 1.5, performanceMode: false, viewArea: 14,
    defaults: { quality: 25, cursor: true, bloom: false }, save: vi.fn(),
  };
  const renderer = { width: 1024, height: 768, resize: vi.fn(), frameLimit: 0, render: vi.fn() };
  const onWindowError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
  window.addEventListener('error', onWindowError);
  const context = vm.createContext({
    document, window, globalThis: { document }, Event, console, parseInt, parseFloat,
    __esmMin: (initialize: () => void) => {
      let loaded = false;
      return () => { if (!loaded) { loaded = true; initialize(); } };
    },
    _ensureDeps() {}, Common_default$1: '', MouseMode: { STOP: 1, FREEZE: 2 },
    Mouse: { intersect: true }, SessionStorage_default: { FreezeUI: false }, _Cursor: null,
    setLastROInnerHTML: (target: HTMLElement, html: string) => { target.innerHTML = html; },
    lastroUiWindowAppend,
    Preferences: preferences, GraphicsSettings: settings, Renderer: renderer,
    Configs: { get: (_name: string, fallback: unknown) => fallback, set: vi.fn() },
    Context: { isFullScreen: () => true }, FPS_default: { _host: null, toggle: vi.fn() },
    MemoryManager: { search: () => [] }, ChatBox_default: { addText: vi.fn(), TYPE: {}, FILTER: {} },
    KEYS: { ESCAPE: 27 }, fixtureLifecycle: (name: string) => timeline.push(name),
    fixtureError: (message: string) => errors.push(new Error(message)),
  });
  const stubs = [
    'FPS', 'Configs', 'Context', 'Preferences$1', 'Graphics', 'Renderer', 'UIManager', 'GUIComponent',
    'MemoryManager', 'ChatBox', 'KeyEventHandler', 'SoundOption', 'ShortCutOption',
  ];
  for (const name of stubs) context[`init_${name}`] = () => {};
  const core = `
    class GUIComponent {
      static MouseMode = MouseMode;
      ${classMembers(source, 'src/UI/GUIComponent.js', 'GUIComponent', ['constructor', 'getRoot', 'prepare', '_prepare', 'append', 'remove'])}
      _processAllDataAttrs() {} _createUIProxy() {} _setupMouseMode() {}
      _bindKeyDown() {} _unbindKeyDown() {} _setupScrollbars() {} _fixPositionOverflow() {}
      draggable() { this._isDraggable = true; } focus() { fixtureLifecycle(this.name + '.focus'); }
    }
    var UIManager = class UIManager {
      static components = {};
      ${classMembers(source, 'src/UI/UIManager.js', 'UIManager', ['addComponent'])}
      static showErrorBox(message) { fixtureError(message); }
    }
    ${preferenceHelpers(source)}
  `;
  vm.runInContext(core + '\n' + componentModules.map(name => region(source, name)).join('\n'), context);
  context.init_Escape();
  const graphics = context.GraphicsOption as Component, escape = context.Escape as Component;
  const render = vi.fn(graphics.render), init = vi.fn(graphics.init), append = vi.fn(graphics.onAppend);
  graphics.render = render; graphics.init = init; graphics.onAppend = append;
  escape.append();
  const menu = escape.getRoot().querySelector<HTMLButtonElement>('.graphics')!;
  const fixture = {
    context, graphics, escape, menu, render, init, append, settings, renderer, saved, save, preferences, errors, timeline,
    toggle() { menu.click(); },
    dispose() {
      for (const component of [graphics, escape]) {
        component.remove(); component._lastroWindowState?.dispose();
      }
      window.removeEventListener('error', onWindowError);
    },
  };
  fixtures.push(fixture);
  return fixture;
}

describe.each([
  { name: 'native', source: native, shortcut: false, teleport: false },
  { name: 'fresh shortcut patch', source: patched, shortcut: true, teleport: true },
  { name: 'generated runtime', source: generated, shortcut: true, teleport: generated.includes('_lastroTeleportSettings') },
])('Escape opens GraphicsOption through the $name lifecycle', ({ source, shortcut, teleport }) => {
  it('keeps the registered GUI component as the default export and opens its real Shadow DOM controls', () => {
    const h = runtime(source);
    expect(h.context.GraphicsOption_default).toBe(h.graphics);
    expect(h.context.UIManager.components.GraphicsOption).toBe(h.graphics);
    expect(h.graphics._host).toBeNull();
    h.toggle();
    expect(h.errors).toEqual([]);
    expect(h.graphics.__loaded).toBe(true);
    expect(h.graphics.__active).toBe(true);
    expect(h.graphics._host?.isConnected).toBe(true);
    expect(h.graphics.getRoot()).toBeInstanceOf(ShadowRoot);
    expect(h.render).toHaveBeenCalledOnce();
    expect(h.init).toHaveBeenCalledOnce();
    expect(h.append).toHaveBeenCalledOnce();
    const root = h.graphics.getRoot();
    expect(root.querySelector<HTMLInputElement>('.details')?.value).toBe(String(h.settings.quality));
    expect(root.querySelector<HTMLInputElement>('.cursor-option')?.checked).toBe(true);
    expect(root.querySelectorAll('.lastro-shortcut-entry')).toHaveLength(shortcut ? 1 : 0);
    expect(root.querySelectorAll('.lastro-teleport-confirmation')).toHaveLength(teleport ? 1 : 0);
  });

  it('reuses the prepared component through menu and close-button toggles without duplicating settings', () => {
    const h = runtime(source);
    h.toggle();
    const root = h.graphics.getRoot(), host = h.graphics._host;
    h.toggle();
    expect(host?.isConnected).toBe(false);
    h.toggle();
    expect(h.graphics._host).toBe(host);
    root.querySelector<HTMLButtonElement>('.close')!.click();
    expect(host?.isConnected).toBe(false);
    h.toggle();
    expect(host?.isConnected).toBe(true);
    expect(h.render).toHaveBeenCalledOnce();
    expect(h.init).toHaveBeenCalledOnce();
    expect(h.append).toHaveBeenCalledTimes(3);
    expect(root.querySelectorAll('.lastro-shortcut-entry')).toHaveLength(shortcut ? 1 : 0);
    expect(root.querySelectorAll('.lastro-teleport-confirmation')).toHaveLength(teleport ? 1 : 0);
    expect(h.errors).toEqual([]);
  });

  it('switches basic and advanced tabs and retains native graphics change handlers', () => {
    const h = runtime(source);
    h.toggle();
    const root = h.graphics.getRoot();
    root.querySelector<HTMLButtonElement>('[data-tab="advanced"]')!.click();
    expect(root.querySelector('#advanced')?.classList.contains('selected')).toBe(true);
    expect(root.querySelector('#basic')?.classList.contains('selected')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-tab="basic"]')!.click();
    expect(root.querySelector('#basic')?.classList.contains('selected')).toBe(true);
    const details = root.querySelector<HTMLInputElement>('.details')!;
    details.value = '75'; details.dispatchEvent(new Event('change'));
    expect(h.settings.quality).toBe(75);
    expect(h.settings.save).toHaveBeenCalledOnce();
    expect(h.renderer.resize).toHaveBeenCalledOnce();
    expect(h.errors).toEqual([]);
  });
});

it('reproduces the broken registration assignment through the native Escape click without a storage error', () => {
  const registration = 'GraphicsOption_default = UIManager.addComponent(GraphicsOption);';
  const broken = native.replace(registration, `GraphicsOption_default = (${installLastroShortcutSettings.toString()})(GraphicsOption, {
    document, getEnabled: () => true, setEnabled: () => true,
  }); UIManager.addComponent(GraphicsOption);`);
  expect(broken).not.toBe(native);
  const h = runtime(broken);
  expect(h.context.GraphicsOption_default).not.toBe(h.graphics);
  expect(h.context.UIManager.components.GraphicsOption).toBe(h.graphics);
  h.toggle();
  expect(h.errors).toHaveLength(1);
  expect(String(h.errors[0])).toContain('GraphicsOption_default.append is not a function');
  expect(h.graphics._host).toBeNull();
  expect(h.preferences.get.mock.calls.map(([key]) => key)).toEqual(['GraphicsOption']);
});

describe.each([
  { name: 'fresh shortcut patch', source: patched }, { name: 'generated runtime', source: generated },
])('GraphicsOption shortcut preferences in $name', ({ source }) => {
  it('restores a disabled preference and keeps an edited value across close, reopen and graphics reset', async () => {
    const h = runtime(source, false);
    h.toggle();
    const root = h.graphics.getRoot(), checkbox = root.querySelector<HTMLInputElement>('.lastro-shortcut-entry')!;
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    await microtasks();
    expect(h.saved.get('LastROShortcutEntry')?.enabled).toBe(true);
    h.toggle(); h.toggle();
    expect(checkbox.checked).toBe(true);
    root.querySelector<HTMLButtonElement>('.reset-button')!.click();
    expect(checkbox.checked).toBe(true);
    expect(root.querySelectorAll('.lastro-shortcut-entry')).toHaveLength(1);
    expect(h.saved.get('LastROShortcutEntry')?.enabled).toBe(true);
    expect(h.errors).toEqual([]);
  });
});

describe.each([
  { name: 'fresh shortcut patch', source: patched },
  ...(generated.includes('_lastroTeleportSettings') ? [{ name: 'generated runtime', source: generated }] : []),
])('GraphicsOption teleport preferences in $name', ({ source }) => {
  it('defaults to enabled below the shortcut row without writing either preference on open', () => {
    const h = runtime(source);
    h.toggle();
    const root = h.graphics.getRoot(), teleport = root.querySelector<HTMLInputElement>('.lastro-teleport-confirmation')!;
    expect(teleport.checked).toBe(true);
    expect(teleport.closest('label')?.textContent).toBe('启用传送确认');
    const rows = Array.from(root.querySelectorAll('#basic table tr'));
    expect(rows.at(-1)?.querySelector('td')?.textContent).toBe('传送确认');
    expect(rows.at(-2)?.querySelector('td')?.textContent).toBe('快捷入口');
    expect(root.querySelector<HTMLInputElement>('.lastro-shortcut-entry')?.checked).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.context.getLastroTeleportConfirmationEnabled()).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it('keeps independent saved false values across native close, Escape reopen and graphics reset', async () => {
    const h = runtime(source, false, false);
    h.toggle();
    const root = h.graphics.getRoot(), teleport = root.querySelector<HTMLInputElement>('.lastro-teleport-confirmation')!;
    const shortcut = root.querySelector<HTMLInputElement>('.lastro-shortcut-entry')!;
    expect(teleport.checked).toBe(false);
    expect(shortcut.checked).toBe(false);
    teleport.checked = true; teleport.dispatchEvent(new Event('change')); await microtasks();
    expect(h.saved.get('LastROTeleportConfirmation')?.enabled).toBe(true);
    expect(h.saved.get('LastROShortcutEntry')?.enabled).toBe(false);
    expect(h.context.getLastroTeleportConfirmationEnabled()).toBe(true);
    shortcut.checked = true; shortcut.dispatchEvent(new Event('change')); await microtasks();
    expect(h.saved.get('LastROShortcutEntry')?.enabled).toBe(true);
    teleport.checked = false; teleport.dispatchEvent(new Event('change')); await microtasks();
    expect(h.saved.get('LastROTeleportConfirmation')?.enabled).toBe(false);
    expect(h.saved.get('LastROShortcutEntry')?.enabled).toBe(true);
    root.querySelector<HTMLButtonElement>('.close')!.click();
    expect(h.graphics._host?.isConnected).toBe(false);
    h.toggle();
    expect(h.graphics.getRoot()).toBe(root);
    expect(teleport.checked).toBe(false);
    expect(shortcut.checked).toBe(true);
    root.querySelector<HTMLButtonElement>('.reset-button')!.click();
    expect(teleport.checked).toBe(false);
    expect(shortcut.checked).toBe(true);
    expect(root.querySelectorAll('.lastro-teleport-confirmation')).toHaveLength(1);
    expect(h.render).toHaveBeenCalledOnce();
    expect(h.init).toHaveBeenCalledOnce();
    expect(h.context.GraphicsOption_default).toBe(h.graphics);
    expect(h.errors).toEqual([]);
  });

  it('rolls back a rejected teleport save without committing its cached preference or blocking native controls', async () => {
    const h = runtime(source, false, true);
    h.toggle();
    const root = h.graphics.getRoot(), teleport = root.querySelector<HTMLInputElement>('.lastro-teleport-confirmation')!;
    h.save.mockRejectedValueOnce(new Error('Storage unavailable'));
    teleport.checked = false; teleport.dispatchEvent(new Event('change')); await microtasks();
    expect(teleport.checked).toBe(true);
    expect(teleport.disabled).toBe(false);
    expect(h.saved.get('LastROTeleportConfirmation')?.enabled).toBe(true);
    expect(h.context.getLastroTeleportConfirmationEnabled()).toBe(true);
    expect(h.saved.get('LastROShortcutEntry')?.enabled).toBe(false);
    expect(h.errors).toHaveLength(1);
    expect(String(h.errors[0])).toContain('传送确认设置保存失败');
    const details = root.querySelector<HTMLInputElement>('.details')!;
    details.value = '75'; details.dispatchEvent(new Event('change'));
    expect(h.settings.quality).toBe(75);
    expect(h.settings.save).toHaveBeenCalledOnce();
    teleport.checked = false; teleport.dispatchEvent(new Event('change')); await microtasks();
    expect(h.saved.get('LastROTeleportConfirmation')?.enabled).toBe(false);
    h.toggle(); h.toggle();
    expect(teleport.checked).toBe(false);
  });
});
