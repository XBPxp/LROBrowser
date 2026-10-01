// Snapshot the real upstream component before the classic-panel installer edits it.
export function captureLastroShortcutEntry(tools) {
  if (!tools || typeof tools.render !== 'function' || typeof tools.init !== 'function') throw new TypeError('Shortcut entry requires a native tools component');
  const names = ['render', 'init', 'hidePanel', 'restorePanel', 'ensurePanelOpener', 'collapseDetailedSettings', 'minimizePanel',
    '_fixPositionOverflow', 'onDragEnd', 'onResize', 'onAppend', 'onRemove'];
  return { css: tools._cssText || '', isDraggable: tools._isDraggable === true, methods: Object.fromEntries(names.map(name => [name, tools[name]])) };
}

// Both appearances retain one component, one server state, and one packet bridge.
// The template, stylesheet, and native handlers come from the captured component.
export function installLastroShortcutEntry(tools, nativeEntry, deps) {
  if (tools._lastroShortcutEntry) return tools._lastroShortcutEntry;
  if (!nativeEntry?.methods || typeof deps?.setHtml !== 'function' || typeof deps?.normalizeRoute !== 'function'
    || typeof deps?.requestRoute !== 'function') throw new TypeError('Shortcut entry requires native handlers and a verified route bridge');
  const doc = deps.document || globalThis.document;
  const classicEntry = { css: tools._cssText || '', isDraggable: tools._isDraggable === true,
    methods: Object.fromEntries(Object.keys(nativeEntry.methods).map(name => [name, tools[name]])) };
  let enabled = deps.getEnabled?.() !== false, switching = false, nativeView = null, lastTargets;
  const mode = () => enabled ? nativeEntry : classicEntry;
  const root = () => tools._shadow || tools._host;
  const stateNames = ['_settingState', '_assistSkills', '_onlyTargets', '_quickRoutes', '_quickLoaded'];
  const passThrough = ['render', 'hidePanel', 'restorePanel', 'ensurePanelOpener', 'collapseDetailedSettings', 'minimizePanel'];
  const assignLocalHooks = () => {
    tools._isDraggable = mode().isDraggable === true;
    for (const name of ['_fixPositionOverflow', 'onDragEnd', 'onResize']) {
      const value = mode().methods[name];
      if (value === undefined) delete tools[name]; else tools[name] = value;
    }
  };
  function removeOpener() {
    doc?.getElementById('lastro-tools-opener')?.remove();
    tools._panelOpener = null;
  }
  function readNativeView() {
    const current = root();
    if (!current?.querySelector('.lastro-main-view')) return;
    nativeView = {
      collapsed: current.querySelector('.lastro-tools')?.classList.contains('is-collapsed'),
      expanded: current.querySelector('.lastro-quick')?.classList.contains('expanded'),
      settings: current.querySelector('.lastro-settings-view')?.hidden === false,
      tab: current.querySelector('[data-tab].is-active')?.dataset.tab,
      category: current.querySelector('.quick-category')?.value,
      target: current.querySelector('.quick-route')?.value,
      custom: ['map', 'x', 'y'].map(name => current.querySelector(`[data-custom-route-${name}]`)?.value || ''),
    };
  }
  function restoreNativeView() {
    if (!enabled || !nativeView) return;
    const current = root(), category = current?.querySelector('.quick-category');
    if (!current) return;
    if (category && nativeView.category) { category.value = nativeView.category; category.onchange?.(); }
    const target = current.querySelector('.quick-route');
    if (target && nativeView.target) target.value = nativeView.target;
    ['map', 'x', 'y'].forEach((name, index) => {
      const field = current.querySelector(`[data-custom-route-${name}]`);
      if (field) field.value = nativeView.custom[index];
    });
    current.querySelector('.lastro-tools')?.classList.toggle('is-collapsed', !!nativeView.collapsed);
    current.querySelector('.lastro-quick')?.classList.toggle('expanded', !!nativeView.expanded);
    const compact = current.querySelector('.lastro-compact-status');
    if (compact) compact.hidden = !nativeView.collapsed;
    const main = current.querySelector('.lastro-main-view'), settings = current.querySelector('.lastro-settings-view');
    if (main) main.hidden = !!nativeView.settings;
    if (settings) settings.hidden = !nativeView.settings;
    if (nativeView.tab) {
      current.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.tab === nativeView.tab));
      current.querySelectorAll('[data-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.tabPanel !== nativeView.tab; });
    }
  }
  function initialize(...args) {
    const preserved = Object.fromEntries(stateNames.filter(name => Object.hasOwn(tools, name)).map(name => [name, tools[name]]));
    const result = mode().methods.init.apply(tools, args);
    Object.assign(tools, preserved);
    tools.populateItemSelects?.();
    tools.applyState?.({});
    tools.renderAssistSkillList?.();
    if (enabled) tools.renderQuickRoutes?.();
    if (lastTargets) tools.setOnlyTargetOptions?.(lastTargets);
    restoreNativeView();
    return result;
  }
  for (const name of passThrough) tools[name] = function (...args) { return mode().methods[name]?.apply(this, args); };
  tools.init = initialize;
  tools.onAppend = function (...args) {
    mode().methods.onAppend?.apply(this, args);
    if (enabled) this.ensurePanelOpener?.();
  };
  tools.onRemove = function (...args) {
    // The classic lifecycle also cleans shared route/navigation state.
    classicEntry.methods.onRemove?.apply(this, args);
    removeOpener();
  };
  const setTargets = tools.setOnlyTargetOptions;
  if (typeof setTargets === 'function') tools.setOnlyTargetOptions = function (targets = []) {
    lastTargets = targets;
    return setTargets.call(this, targets);
  };
  tools.runQuickRoute = function () {
    this.stopQuickRoute?.();
    try {
      const current = this.getRoot(), category = current.querySelector('.quick-category')?.value;
      let route;
      if (category === 'custom') {
        const map = String(current.querySelector('[data-custom-route-map]')?.value || '').trim().toLowerCase().replace(/\.gat$/i, '');
        if (!/^[a-z0-9_@#-]{1,16}$/.test(map)) throw new Error('请输入有效地图名');
        const coordinate = name => {
          const text = String(current.querySelector(`[data-custom-route-${name}]`)?.value || '').trim(), value = Number(text);
          if (!/^\d{1,5}$/.test(text) || !Number.isSafeInteger(value) || value > 65535) throw new Error(`${name.toUpperCase()} 必须是 0-65535 的整数`);
          return value;
        };
        const x = coordinate('x'), y = coordinate('y'), destination = [map, x, y];
        route = deps.normalizeRoute({ npc: `${map} (${x},${y})`, desc: `${map} ${x},${y}`, outset: destination, path: [destination] });
      } else {
        const key = current.querySelector('.quick-route')?.value;
        route = deps.normalizeRoute(this._quickRoutes?.[category]?.[key]);
      }
      this.setStatus?.(`等待传送确认：${route.npc}`);
      const result = deps.requestRoute(route);
      if (result && typeof result.catch === 'function') result.catch(error => this.setStatus?.(`快速传送失败：${error.message || '请重试'}`));
      return result;
    } catch (error) {
      this.setStatus?.(`快速传送失败：${error.message || '请重试'}`);
      return false;
    }
  };
  function setEnabled(value) {
    if (typeof value !== 'boolean') throw new TypeError('Shortcut entry enabled value must be boolean');
    if (value === enabled || switching) return enabled;
    switching = true;
    try {
      if (enabled) readNativeView();
      const loaded = !!tools._container, active = !!tools.__active;
      // Native server target updates live on the checkbox, not in _onlyTargets.
      // Preserve both checked states only while replacing this window's DOM.
      const targetStates = loaded ? new Map([...root().querySelectorAll('[data-target-id]')]
        .map(input => [input.dataset.targetId, input.checked])) : null;
      tools.stopQuickRoute?.();
      tools._lastroPanels?.deactivate?.();
      if (loaded) tools.remove?.();
      removeOpener();
      enabled = value; tools._cssText = mode().css; assignLocalHooks();
      if (loaded) {
        const host = tools._host;
        const retained = { zIndex: host.style.zIndex || '50', fontFamily: host.style.fontFamily, fontSizeAdjust: host.style.fontSizeAdjust };
        host.style.cssText = ''; Object.assign(host.style, retained); host.style.position = 'absolute';
        const style = [...root().querySelectorAll('style[data-component]')].find(node => node.getAttribute('data-component') === tools.name);
        if (style) style.textContent = tools._cssText;
        deps.setHtml(tools._container, tools.render());
        tools._processAllDataAttrs?.();
        initialize();
        for (const input of root().querySelectorAll('[data-target-id]')) {
          if (targetStates?.has(input.dataset.targetId)) input.checked = targetStates.get(input.dataset.targetId);
        }
        if (active) tools.append(); else removeOpener();
      }
      return enabled;
    } finally { switching = false; }
  }
  tools._cssText = mode().css; assignLocalHooks();
  const api = { setEnabled, isEnabled: () => enabled, refresh: () => setEnabled(deps.getEnabled?.() !== false) };
  tools._lastroShortcutEntry = api;
  return api;
}
