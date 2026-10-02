// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { installLastroTeleportSettings } from '../scripts/lastro-teleport-settings.mjs';

function fixture(initial = true) {
  let root = document.createElement('div'), enabled = initial;
  const render = () => {
    root = document.createElement('div');
    root.innerHTML = '<section id="basic"><table><tr><td>显示 FPS</td><td><input class="fps" type="checkbox"></td></tr><tr><td>快捷入口</td><td><label><input class="lastro-shortcut-entry" type="checkbox" checked>启用新版快捷入口</label></td></tr></table></section>';
  };
  render();
  const originalInit = vi.fn(), originalAppend = vi.fn(), onError = vi.fn();
  const setEnabled = vi.fn<(value: boolean) => unknown | Promise<unknown>>((value) => { enabled = value; return true; });
  const component = { getRoot: () => root, init: originalInit, onAppend: originalAppend };
  const options = { document, getEnabled: () => enabled, setEnabled, onError };
  const controller = installLastroTeleportSettings(component, options);
  component.init();
  const checkbox = () => root.querySelector<HTMLInputElement>('.lastro-teleport-confirmation')!;
  const dispatch = (checked: boolean) => { const input = checkbox(); input.checked = checked; input.dispatchEvent(new Event('change')); };
  const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  return {
    get root() { return root; }, originalInit, originalAppend, onError, setEnabled, component, options, controller,
    checkbox, dispatch, settle, setPreference(value: boolean) { enabled = value; },
    rebuild() { render(); component.init(); },
    async change(checked: boolean) { dispatch(checked); await settle(); },
  };
}

describe('native graphics teleport confirmation preference', () => {
  it('defaults to enabled and adds its row below the unchanged shortcut setting', () => {
    const f = fixture();
    expect(f.originalInit).toHaveBeenCalledOnce();
    expect(f.checkbox().checked).toBe(true);
    expect(f.checkbox().closest('label')?.textContent).toBe('启用传送确认');
    expect(Array.from(f.root.querySelectorAll('tr > td:first-child'), cell => cell.textContent)).toEqual(['显示 FPS', '快捷入口', '传送确认']);
    expect(f.root.querySelector<HTMLInputElement>('.lastro-shortcut-entry')?.checked).toBe(true);
    expect(f.root.querySelector('.fps')).not.toBeNull();
    expect(f.setEnabled).not.toHaveBeenCalled();
    f.component.onAppend();
    expect(f.originalAppend).toHaveBeenCalledOnce();
  });

  it('reads a saved false value and synchronizes external changes on append or explicit sync', () => {
    const f = fixture(false);
    expect(f.checkbox().checked).toBe(false);
    f.setPreference(true); f.component.onAppend();
    expect(f.checkbox().checked).toBe(true);
    f.setPreference(false); f.controller.sync();
    expect(f.checkbox().checked).toBe(false);
    expect(f.setEnabled).not.toHaveBeenCalled();
  });

  it('persists both directions immediately without changing the shortcut preference', async () => {
    const f = fixture();
    await f.change(false);
    expect(f.setEnabled).toHaveBeenLastCalledWith(false);
    expect(f.checkbox().checked).toBe(false);
    await f.change(true);
    expect(f.setEnabled).toHaveBeenLastCalledWith(true);
    expect(f.checkbox().checked).toBe(true);
    expect(f.root.querySelector<HTMLInputElement>('.lastro-shortcut-entry')?.checked).toBe(true);
  });

  it.each(['throw', 'reject', 'false'] as const)('restores the saved value and permits retry after a %s failure', async (failure) => {
    const f = fixture();
    if (failure === 'throw') f.setEnabled.mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
    else if (failure === 'reject') f.setEnabled.mockRejectedValueOnce(new Error('Storage unavailable'));
    else f.setEnabled.mockReturnValueOnce(false);
    await f.change(false);
    expect(f.checkbox().checked).toBe(true);
    expect(f.checkbox().disabled).toBe(false);
    expect(f.onError).toHaveBeenCalledOnce();
    await f.change(false);
    expect(f.checkbox().checked).toBe(false);
    expect(f.setEnabled).toHaveBeenCalledTimes(2);
  });

  it('disables the control and ignores duplicate changes while an asynchronous save is pending', async () => {
    const f = fixture();
    let finish!: () => void;
    f.setEnabled.mockImplementationOnce(value => new Promise(resolve => {
      finish = () => { f.setPreference(value); resolve(true); };
    }));
    f.dispatch(false);
    expect(f.checkbox().disabled).toBe(true);
    f.controller.sync(); f.component.onAppend();
    expect(f.checkbox().checked).toBe(false);
    f.dispatch(true);
    expect(f.setEnabled).toHaveBeenCalledOnce();
    finish(); await f.settle();
    expect(f.checkbox().disabled).toBe(false);
    expect(f.checkbox().checked).toBe(false);
  });

  it('installs once and does not duplicate a row when init is called on the same DOM', () => {
    const f = fixture(), init = f.component.init, append = f.component.onAppend;
    expect(installLastroTeleportSettings(f.component, f.options)).toBe(f.controller);
    expect(f.component.init).toBe(init);
    expect(f.component.onAppend).toBe(append);
    f.component.init(); f.component.onAppend();
    expect(f.root.querySelectorAll('.lastro-teleport-confirmation')).toHaveLength(1);
    expect(f.originalInit).toHaveBeenCalledTimes(2);
    expect(f.originalAppend).toHaveBeenCalledOnce();
  });

  it('attaches to rebuilt DOM and ignores events from the obsolete checkbox', async () => {
    const f = fixture(false), old = f.checkbox();
    f.rebuild(); f.component.onAppend();
    expect(f.checkbox()).not.toBe(old);
    expect(f.checkbox().checked).toBe(false);
    expect(f.root.querySelectorAll('.lastro-teleport-confirmation')).toHaveLength(1);
    old.checked = true; old.dispatchEvent(new Event('change')); await f.settle();
    expect(f.setEnabled).not.toHaveBeenCalled();
    await f.change(true);
    expect(f.checkbox().checked).toBe(true);
  });

  it('keeps rebuilt controls disabled until the original save finishes, then synchronizes the current DOM', async () => {
    const f = fixture();
    let finish!: () => void;
    f.setEnabled.mockImplementationOnce(value => new Promise(resolve => {
      finish = () => { f.setPreference(value); resolve(true); };
    }));
    f.dispatch(false);
    const old = f.checkbox();
    f.rebuild(); f.component.onAppend();
    expect(f.checkbox().disabled).toBe(true);
    finish(); await f.settle();
    expect(old.disabled).toBe(false);
    expect(f.checkbox().disabled).toBe(false);
    expect(f.checkbox().checked).toBe(false);
  });
});
