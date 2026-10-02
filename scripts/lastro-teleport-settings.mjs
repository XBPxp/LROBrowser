// Adds teleport confirmation to the existing native GraphicsOption window.
export function installLastroTeleportSettings(component, { document: doc, getEnabled, setEnabled, onError }) {
  if (component._lastroTeleportSettings) return component._lastroTeleportSettings;
  let checkbox, saving = false;
  const sync = () => { if (checkbox && !saving) checkbox.checked = getEnabled() !== false; };
  const originalInit = component.init, originalAppend = component.onAppend;
  component.init = function (...args) {
    const result = originalInit?.apply(this, args);
    const table = this.getRoot()?.querySelector('#basic table');
    if (!table) throw new Error('Missing native graphics basic settings table');
    if (checkbox && table.contains(checkbox)) { sync(); return result; }
    const row = doc.createElement('tr'), title = doc.createElement('td'), value = doc.createElement('td');
    const label = doc.createElement('label'), input = doc.createElement('input');
    title.textContent = '传送确认';
    input.type = 'checkbox'; input.className = 'lastro-teleport-confirmation';
    input.checked = getEnabled() !== false; input.disabled = saving;
    checkbox = input;
    label.append(input, doc.createTextNode('启用传送确认'));
    value.append(label); row.append(title, value); table.append(row);
    input.addEventListener('change', async () => {
      if (saving || checkbox !== input) return;
      const enabled = input.checked;
      saving = true; input.disabled = true;
      try {
        if (await setEnabled(enabled) === false) throw new Error('传送确认设置未保存，请重试。');
      } catch (error) { onError?.(error); }
      finally {
        saving = false; input.disabled = false;
        if (checkbox) checkbox.disabled = false;
        sync();
      }
    });
    sync();
    return result;
  };
  component.onAppend = function (...args) { const result = originalAppend?.apply(this, args); sync(); return result; };
  component._lastroTeleportSettings = { sync };
  return component._lastroTeleportSettings;
}
