import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { patchRuntimePreferencesSave, patchRuntimeShortcutSettings } from '../scripts/patch-v2-runtime.mjs';

const native = readFileSync('vendor/v2/Online.js', 'utf8').replace(/\r\n/g, '\n');
const start = native.indexOf('//#region src/Core/Preferences.js');
const end = native.indexOf('//#endregion', start);
const preferenceSource = patchRuntimePreferencesSave(native.slice(start, end));
const patched = patchRuntimeShortcutSettings('UIManager.addComponent(GraphicsOption);');
const functions = patched.slice(0, patched.indexOf('(function installLastroShortcutSettings'));

function fixture(stored?: boolean) {
  const key = 'LastROShortcutEntry';
  const storage = new Map<string, string>(stored === undefined ? [] : [[key, JSON.stringify({ _version: 1, enabled: stored })]]);
  const switchEntry = vi.fn();
  let failure = false;
  const api = runInNewContext(preferenceSource + '\n' + functions + '\n({ get: getLastroShortcutEntryEnabled, set: setLastroShortcutEntryEnabled });', {
    __esmMin: (initialize: () => void) => initialize,
    LastROTools: { _lastroShortcutEntry: { setEnabled: switchEntry } },
    localStorage: {
      getItem: (name: string) => storage.get(name) ?? null,
      setItem: (name: string, value: string) => { if (failure) throw new Error('storage blocked'); storage.set(name, value); },
    },
  }) as { get(): boolean; set(enabled: boolean): Promise<boolean> };
  return { key, storage, api, switchEntry, fail: (value: boolean) => { failure = value; } };
}

describe('persistent native shortcut preference adapter', () => {
  it('defaults to enabled through the original native preference initialization', () => {
    const f = fixture();
    expect(f.api.get()).toBe(true);
    expect(JSON.parse(f.storage.get(f.key)!)).toMatchObject({ enabled: true });
    expect(f.storage.has('undefined')).toBe(false);
    expect(f.switchEntry).not.toHaveBeenCalled();
  });

  it('restores disabled mode and persists either selection before applying it', async () => {
    const f = fixture(false);
    expect(f.api.get()).toBe(false);
    await f.api.set(true);
    expect(JSON.parse(f.storage.get(f.key)!)).toMatchObject({ enabled: true });
    expect(f.switchEntry).toHaveBeenLastCalledWith(true);
    await f.api.set(false);
    expect(f.api.get()).toBe(false);
    expect(JSON.parse(f.storage.get(f.key)!)).toMatchObject({ enabled: false });
  });

  it('keeps the active mode when storage fails and permits a successful retry', async () => {
    const f = fixture(true), before = f.storage.get(f.key);
    f.fail(true);
    await expect(f.api.set(false)).rejects.toThrow('storage blocked');
    expect(f.api.get()).toBe(true);
    expect(f.storage.get(f.key)).toBe(before);
    expect(f.switchEntry).not.toHaveBeenCalled();
    f.fail(false);
    await f.api.set(false);
    expect(f.switchEntry).toHaveBeenCalledWith(false);
    expect(f.storage.has('undefined')).toBe(false);
  });

  it('keeps the default entry usable when first-load storage is unavailable', async () => {
    const f = fixture();
    f.fail(true);
    expect(f.api.get()).toBe(true);
    await expect(f.api.set(false)).rejects.toThrow('storage blocked');
    expect(f.api.get()).toBe(true);
    f.fail(false); await f.api.set(false);
    expect(JSON.parse(f.storage.get(f.key)!)).toMatchObject({ enabled: false });
  });

  it('requires one graphics initialization anchor on upstream updates', () => {
    expect(() => patchRuntimeShortcutSettings('')).toThrow('anchor:lastro-shortcut-settings');
    expect(() => patchRuntimeShortcutSettings('UIManager.addComponent(GraphicsOption); UIManager.addComponent(GraphicsOption);')).toThrow('anchor:lastro-shortcut-settings');
    const output = patchRuntimeShortcutSettings(native);
    expect(output).toContain('checkbox.className = \'lastro-shortcut-entry\'');
    expect(output).toContain('启用新版快捷入口');
  });

  it('preserves the assigned GUI component used by the native Escape graphics button', () => {
    const component = { init: vi.fn(), onAppend: vi.fn(), append: vi.fn(), remove: vi.fn() };
    const addComponent = vi.fn((value: unknown) => value);
    const output = patchRuntimeShortcutSettings('GraphicsOption_default = UIManager.addComponent(GraphicsOption);');
    const value = runInNewContext(output + '\nGraphicsOption_default;', {
      GraphicsOption: component, UIManager: { addComponent },
    });
    expect(addComponent).toHaveBeenCalledExactlyOnceWith(component);
    expect(value).toBe(component);
    expect(value.append).toBe(component.append);
  });

  it('rejects registration embedded in an unreviewed expression', () => {
    expect(() => patchRuntimeShortcutSettings('const wrong = UIManager.addComponent(GraphicsOption);'))
      .toThrow('anchor:lastro-shortcut-settings:statement');
    expect(() => patchRuntimeShortcutSettings('consume(UIManager.addComponent(GraphicsOption));'))
      .toThrow('anchor:lastro-shortcut-settings:statement');
  });
});
