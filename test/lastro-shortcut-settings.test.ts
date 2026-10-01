// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { installLastroShortcutSettings } from '../scripts/lastro-shortcut-settings.mjs';

function fixture(initial = true) {
  const root = document.createElement('div');
  root.innerHTML = '<section id="basic"><table><tr><td>显示 FPS</td><td><input class="fps" type="checkbox"></td></tr></table></section>';
  const originalInit = vi.fn(), originalAppend = vi.fn(), onError = vi.fn();
  let enabled = initial;
  const setEnabled = vi.fn((value: boolean) => { enabled = value; return true; });
  const component = { getRoot: () => root, init: originalInit, onAppend: originalAppend };
  const options = { document, getEnabled: () => enabled, setEnabled, onError };
  const controller = installLastroShortcutSettings(component, options);
  component.init();
  const checkbox = root.querySelector<HTMLInputElement>('.lastro-shortcut-entry')!;
  const change = async (checked: boolean) => { checkbox.checked = checked; checkbox.dispatchEvent(new Event('change')); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { root, originalInit, originalAppend, onError, setEnabled, component, options, controller, checkbox, change };
}

describe('native graphics shortcut entry preference', () => {
  it('adds a checked basic setting while preserving the existing FPS control and lifecycle', () => {
    const f = fixture();
    expect(f.originalInit).toHaveBeenCalledOnce();
    expect(f.root.querySelector('.fps')).not.toBeNull();
    expect(f.checkbox.checked).toBe(true);
    expect(f.checkbox.closest('label')?.textContent).toBe('启用新版快捷入口');
    f.component.onAppend();
    expect(f.originalAppend).toHaveBeenCalledOnce();
  });

  it('restores a saved disabled preference when opening the window', () => {
    const f = fixture(false);
    expect(f.checkbox.checked).toBe(false);
    f.checkbox.checked = true;
    f.component.onAppend();
    expect(f.checkbox.checked).toBe(false);
  });

  it('persists changes immediately and permits switching both ways', async () => {
    const f = fixture();
    await f.change(false);
    expect(f.setEnabled).toHaveBeenLastCalledWith(false);
    expect(f.checkbox.checked).toBe(false);
    await f.change(true);
    expect(f.setEnabled).toHaveBeenLastCalledWith(true);
    expect(f.checkbox.checked).toBe(true);
  });

  it('rolls the checkbox back and reports a failed save', async () => {
    const f = fixture();
    f.setEnabled.mockImplementation(() => { throw new Error('Storage unavailable'); });
    await f.change(false);
    expect(f.checkbox.checked).toBe(true);
    expect(f.checkbox.disabled).toBe(false);
    expect(f.onError).toHaveBeenCalledOnce();
  });

  it('also treats a false result as a failed save', async () => {
    const f = fixture();
    f.setEnabled.mockReturnValue(false);
    await f.change(false);
    expect(f.checkbox.checked).toBe(true);
    expect(f.onError).toHaveBeenCalledOnce();
  });

  it('does not install a duplicate preference row or wrapper', () => {
    const f = fixture();
    expect(installLastroShortcutSettings(f.component, f.options)).toBe(f.controller);
    expect(f.root.querySelectorAll('.lastro-shortcut-entry')).toHaveLength(1);
  });
});
