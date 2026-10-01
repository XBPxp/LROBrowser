// Serialized into the packaged runtime; all client services are supplied explicitly.
export function installLastroToolsPanels(tools, deps, css, presetRoutes = {}) {
  if (tools._lastroPanels) return tools._lastroPanels;
  const { document: doc, window: win, GUIComponent, UIManager, setHtml, normalizeRoute, requestRoute, loadPreferences } = deps;
  function readPreferences() {
    let value;
    try { value = loadPreferences(); } catch { value = { orders: {} }; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = { orders: {} };
    if (!value.orders || typeof value.orders !== 'object' || Array.isArray(value.orders)) value.orders = {};
    if (!value.geometry || typeof value.geometry !== 'object' || Array.isArray(value.geometry)) value.geometry = {};
    const entries = [], seen = new Set();
    if (value.customPlaces?.version === 1 && Array.isArray(value.customPlaces.entries)) {
      for (const raw of value.customPlaces.entries.slice(0, 500)) {
        try {
          const place = normalizeCustomPlace(raw);
          if (!seen.has(place.id)) { entries.push(place); seen.add(place.id); }
        } catch { /* Invalid saved data must never become a route request. */ }
      }
    }
    if (Object.hasOwn(value, 'customPlaces')) value.customPlaces = { version: 1, entries };
    return value;
  }
  let preferences = readPreferences(), profile = deps.getProfile?.();
  const categories = [['npc', 'NPC'], ['train', '练级'], ['money', '打钱'], ['challenge', '挑战'], ['instance', '副本'], ['boss', 'BOSS'], ['custom', '自定义'], ['search', '搜索']];
  const customSources = [['guide', '常用地点'], ['train', '洞穴传送'], ['wild', '野外地图'], ['mine', '我的地点'], ['other', '其他地点']];
  let selected = categories.some(([id]) => id === preferences.category) ? preferences.category : 'npc';
  let root, list, status, dock, drag, resizing, scrollFrame, confirmation, requestGeneration = 0;
  let editingPlaceId = null, customEditorOpen = false, savingCustom = false, searchQuery = '';
  let customSource = 'mine', customGroup = null;
  const layouts = new Map();
  const sortAnimations = new Map();
  let listeningForResize = false;
  const catalog = Object.create(null);
  const teleport = new GUIComponent('LastROTeleport', css);
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const titlebar = title => `<div class="lastro-ro-titlebar" data-background="basic_interface/titlebar_mid.bmp"><span class="lastro-title-left" data-background="basic_interface/titlebar_left.bmp"></span><span class="lastro-title-right" data-background="basic_interface/titlebar_right.bmp"></span><strong>${title}</strong><button type="button" class="lastro-window-close" data-action="close" data-background="basic_interface/sys_close_off.bmp" data-hover="basic_interface/sys_close_on.bmp" aria-label="关闭${title}" title="关闭"></button></div>`;
  const resizeFooter = title => `<div class="lastro-panel-footer" data-background="basic_interface/btnbar_mid.bmp"><button type="button" class="lastro-window-resize" data-background="btn_resize.bmp" aria-label="调整${title}窗口大小"></button></div>`;
  function save(message) {
    try { preferences.save?.(); if (message && status) status.textContent = message; }
    catch { if (status) status.textContent = '顺序已调整，但本地保存失败。'; }
  }
  function normalizeCustomPlace(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(raw.id)) throw new Error('地点资料无效');
    if (typeof raw.map !== 'string') throw new Error('请输入有效地图名');
    const map = raw.map.trim().toLowerCase().replace(/\.gat$/i, '');
    if (!/^[a-z0-9_@#-]{1,16}$/.test(map)) throw new Error('请输入有效地图名');
    for (const value of [raw.x, raw.y]) if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('坐标必须为 0–65535 的整数');
    if (raw.name != null && typeof raw.name !== 'string') throw new Error('请输入有效地点名称');
    if (raw.desc != null && typeof raw.desc !== 'string') throw new Error('请输入有效备注');
    const name = raw.name?.trim() || `${map} ${raw.x},${raw.y}`, desc = raw.desc?.trim() || '';
    if (name.length > 80 || desc.length > 200) throw new Error('地点名称最多 80 字，备注最多 200 字');
    return { id: raw.id, name, desc, map, x: raw.x, y: raw.y };
  }
  function customRoute(place) {
    const destination = [place.map, place.x, place.y];
    return normalizeRoute({ npc: place.name, desc: place.desc, outset: destination, path: [destination] });
  }
  function refreshCustomRoutes() {
    for (const id of Object.keys(catalog.custom || {})) if (id.startsWith('user:')) delete catalog.custom[id];
    for (const place of customEntries()) {
      try { catalog.custom[`user:${place.id}`] = { ...customRoute(place), customPlaceId: place.id, customSource: 'mine', customGroup: '' }; }
      catch { /* Keep invalid or unsupported saved destinations out of the list. */ }
    }
  }
  function customEntries() { return preferences.customPlaces?.entries || []; }
  function sortingAllowed() { return selected !== 'search'; }
  function matchesSearch(route) {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const destinations = [route.outset, ...(route.path || [])].filter(Array.isArray);
    const text = [route.npc, route.desc, ...destinations.flatMap(destination => [destination.join(' '), `${destination[1]},${destination[2]}`])].join(' ').toLowerCase();
    return text.includes(query);
  }
  function updateSearch(value) {
    stopDrag(true); searchQuery = value;
    root.querySelector('[data-search-routes]').value = value;
    renderList(); resetScroll(teleport, '.lastro-route-scroll');
  }
  function customSourceFromId(id) { return /^upstream:(guide|train|wild):/.exec(id)?.[1] || 'other'; }
  function sourceName(category, route) {
    if (category !== 'custom') return categories.find(([id]) => id === category)?.[1] || category;
    const source = customSources.find(([id]) => id === route.customSource)?.[1] || '其他地点';
    return route.customGroup ? `自定义 / ${source} / ${route.customGroup}` : `自定义 / ${source}`;
  }
  function searchEntries() {
    return categories.filter(([id]) => id !== 'search').flatMap(([category]) => ordered(category).map(id => ({ category, id, key: `${category}:${id}`, route: catalog[category][id] })));
  }
  function customIds() {
    return ordered('custom').filter(id => {
      const route = catalog.custom[id];
      return route.customSource === customSource && (customGroup == null || route.customGroup === customGroup);
    });
  }
  function saveVisibleOrder(ids) {
    const visible = new Set(ids), next = [...ids];
    // Replace only this group's displayed positions; records in other groups
    // retain their existing places in the complete order.
    preferences.orders[selected] = ordered(selected).map(id => visible.has(id) ? next.shift() : id);
    save();
  }
  function groupTabs(container, entries, current, choose, attribute) {
    container.replaceChildren();
    entries.forEach(([id, name], index) => {
      const button = element('button', 'lastro-tab', name), active = id === current;
      button.type = 'button'; button.dataset[attribute] = id; button.setAttribute('role', 'tab');
      button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      button.addEventListener('click', () => choose(id));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + entries.length) % entries.length;
        choose(entries[next][0]);
        [...container.querySelectorAll('button')].find(node => node.dataset[attribute] === entries[next][0])?.focus();
      });
      container.append(button);
    });
  }
  function selectCustomSource(value) {
    if (!customSources.some(([id]) => id === value)) return;
    stopDrag(true); clearCustomEditor(); customSource = value; customGroup = null;
    renderList(); resetScroll(teleport, '.lastro-route-scroll');
  }
  function selectCustomGroup(value) {
    stopDrag(true); clearCustomEditor(); customGroup = value;
    renderList(); resetScroll(teleport, '.lastro-route-scroll');
  }
  function renderCustomNavigation() {
    const sourceTabs = root.querySelector('[data-custom-sources]'), groupTabsRoot = root.querySelector('[data-custom-groups]');
    sourceTabs.hidden = selected !== 'custom'; groupTabsRoot.hidden = true; groupTabsRoot.replaceChildren();
    if (selected !== 'custom') return;
    const availableSources = customSources.filter(([id]) => id !== 'other' || Object.values(catalog.custom).some(route => route.customSource === id));
    groupTabs(sourceTabs, availableSources, customSource, selectCustomSource, 'customSource');
    const routes = Object.values(catalog.custom).filter(route => route.customSource === customSource);
    const groups = [...new Set(routes.map(route => route.customGroup || ''))];
    if (customSource === 'guide' || customSource === 'train' || (customSource === 'other' && groups.some(Boolean))) {
      if (!groups.includes(customGroup)) customGroup = groups[0] ?? null;
      groupTabsRoot.hidden = groups.length === 0;
      groupTabs(groupTabsRoot, groups.map(group => [group, group || '其他地点']), customGroup, selectCustomGroup, 'customGroup');
    } else customGroup = null;
  }
  function clearCustomEditor() {
    editingPlaceId = null; customEditorOpen = false;
    const form = root?.querySelector('[data-custom-form]');
    if (!form) return;
    form.hidden = true;
    form.reset();
    form.querySelector('[data-custom-title]').textContent = '添加自定义地点';
    form.querySelector('[data-save-place]').textContent = '保存地点';
    form.querySelector('[data-cancel-edit]').hidden = true;
  }
  function openCustomEditor() {
    if (savingCustom) return;
    cancelConfirmation(); clearCustomEditor(); customEditorOpen = true;
    if (selected === 'custom') { customSource = 'mine'; customGroup = null; renderList(); }
    const form = root.querySelector('[data-custom-form]');
    form.hidden = false; form.querySelector('[data-cancel-edit]').hidden = false;
    resetScroll(teleport, '.lastro-route-scroll');
    form.elements.namedItem('name').focus(); fitPanel(teleport, 'teleport', 34);
  }
  function editCustomPlace(id) {
    if (savingCustom) return;
    const place = customEntries().find(entry => entry.id === id);
    if (!place) return;
    openCustomEditor();
    editingPlaceId = id;
    const form = root.querySelector('[data-custom-form]');
    for (const [name, value] of Object.entries(place)) if (name !== 'id') form.elements.namedItem(name).value = String(value);
    form.querySelector('[data-custom-title]').textContent = '编辑自定义地点';
    form.querySelector('[data-save-place]').textContent = '保存修改';
    form.querySelector('[data-cancel-edit]').hidden = false;
    form.elements.namedItem('name').focus();
  }
  function placeFromForm() {
    const form = root.querySelector('[data-custom-form]');
    const coordinate = name => {
      const text = form.elements.namedItem(name).value.trim(), value = Number(text);
      if (!/^\d{1,5}$/.test(text) || value > 65535) throw new Error('坐标必须为 0–65535 的整数');
      return value;
    };
    return normalizeCustomPlace({ id: editingPlaceId || 'draft', name: form.elements.namedItem('name').value,
      desc: form.elements.namedItem('desc').value, map: form.elements.namedItem('map').value, x: coordinate('x'), y: coordinate('y') });
  }
  function readCurrentLocation() {
    if (savingCustom) return;
    try {
      const current = deps.getCurrentLocation?.();
      if (!current) throw new Error('Location is not ready');
      // Validate the complete snapshot before writing any field. A missing map
      // or invalid coordinate must leave the user's draft and its notes intact.
      const place = normalizeCustomPlace({ id: 'current', map: current.map, x: current.x, y: current.y });
      const form = root.querySelector('[data-custom-form]');
      for (const name of ['map', 'x', 'y']) form.elements.namedItem(name).value = String(place[name]);
      status.textContent = `已读取当前位置：${place.map} ${place.x},${place.y}`;
    } catch { status.textContent = '角色或地图尚未就绪，无法读取当前位置，请稍后重试。'; }
  }
  async function saveCustomPlaces(entries, message) {
    if (savingCustom) return false;
    const current = preferences, currentProfile = profile;
    const next = { ...current, customPlaces: { version: 1, entries } };
    const persist = current.save;
    savingCustom = true;
    root?.querySelectorAll('[data-custom-action]').forEach(button => { button.disabled = true; });
    try {
      if (typeof persist !== 'function') throw new Error('本地存储不可用');
      // Save a complete copy through the native method's `this` contract. The
      // active preference object and visible routes change only after success.
      const result = persist.call(next);
      // Native Preferences.save is synchronous; also handle asynchronous adapters
      // without claiming success before durable storage has completed.
      if (result && typeof result.then === 'function') { if (await result === false) throw new Error('本地保存失败'); }
      else if (result === false) throw new Error('本地保存失败');
      current.customPlaces = next.customPlaces;
      if (preferences === current && currentProfile === deps.getProfile?.()) {
        clearCustomEditor(); refreshCustomRoutes(); renderList(); status.textContent = message;
      }
      return true;
    } catch {
      if (preferences === current && currentProfile === deps.getProfile?.()) status.textContent = '本地保存失败，地点未保存，请重试。';
      return false;
    } finally {
      savingCustom = false;
      root?.querySelectorAll('[data-custom-action]').forEach(button => { button.disabled = false; });
    }
  }
  function saveCustomPlace() {
    if (savingCustom) return;
    try {
      const place = placeFromForm(), entries = customEntries().map(entry => ({ ...entry }));
      if (editingPlaceId) {
        const index = entries.findIndex(entry => entry.id === editingPlaceId);
        if (index < 0) throw new Error('地点已不存在，请重新添加');
        entries[index] = { ...place, id: editingPlaceId };
      } else {
        if (entries.length >= 500) throw new Error('最多保存 500 个自定义地点');
        let index = 1;
        while (entries.some(entry => entry.id === `place-${index}`)) index++;
        entries.push({ ...place, id: `place-${index}` });
      }
      void saveCustomPlaces(entries, editingPlaceId ? '地点修改已保存' : '自定义地点已保存');
    } catch (error) { status.textContent = error.message; }
  }
  function deleteCustomPlace(id) {
    if (savingCustom) return;
    const place = customEntries().find(entry => entry.id === id);
    if (!place) return;
    confirmAction(`是否删除自定义地点“${place.name}”？`, () => {
      void saveCustomPlaces(customEntries().filter(entry => entry.id !== id), '自定义地点已删除');
    });
  }
  function ordered(category) {
    const entries = catalog[category] || {};
    const saved = Array.isArray(preferences.orders[category]) ? preferences.orders[category] : [];
    return [...new Set([...saved.filter(id => typeof id === 'string' && Object.hasOwn(entries, id)), ...Object.keys(entries)])];
  }
  function refreshProfile() {
    if (profile !== deps.getProfile?.()) {
      stopPanelResize(true, false);
      cancelConfirmation(); deps.cancelRoute?.();
      profile = deps.getProfile?.(); preferences = readPreferences();
      clearCustomEditor();
      searchQuery = ''; customSource = 'mine'; customGroup = null;
      if (root) root.querySelector('[data-search-routes]').value = '';
      layouts.clear();
      selected = categories.some(([id]) => id === preferences.category) ? preferences.category : 'npc';
    }
  }
  function refreshCatalog() {
    refreshProfile();
    tools.loadQuickRoutes();
    for (const [category] of categories) catalog[category] = Object.create(null);
    for (const [category, entries] of Object.entries(deps.getPresetRoutes?.() || presetRoutes)) {
      if (!Object.hasOwn(catalog, category)) continue;
      for (const [id, raw] of Object.entries(entries || {})) {
        const routeId = category === 'custom' ? `preset:${id}` : id;
        const metadata = category === 'custom' ? { customSource: customSourceFromId(id), customGroup: typeof raw?.group === 'string' ? raw.group.trim() : '' } : {};
        try { catalog[category][routeId] = { ...normalizeRoute(raw), ...metadata }; }
        catch { catalog[category][routeId] = { npc: raw?.npc || '未命名地点', desc: raw?.desc || '地点资料暂不可用', unavailable: true, ...metadata }; }
      }
    }
    // Keep every existing destination available when an original catalog is absent.
    const fallback = { guide: 'npc', wild: 'train', train: 'instance' };
    for (const [from, to] of Object.entries(fallback)) {
      if (Object.keys(catalog[to]).length) continue;
      for (const [id, raw] of Object.entries(tools._quickRoutes?.[from] || {})) {
        try { catalog[to][`${from}:${id}`] = normalizeRoute(raw); } catch { /* Same validation as the existing selector. */ }
      }
    }
    refreshCustomRoutes();
  }
  function stopDrag(cancel = false) {
    if (scrollFrame != null) win.cancelAnimationFrame?.(scrollFrame);
    scrollFrame = null;
    cancelSortAnimations();
    if (!drag) return;
    const previous = drag;
    drag = null;
    previous.node.classList.remove('is-dragging', 'is-drag-moving'); previous.node.style.removeProperty('--lastro-sort-offset');
    previous.handle.setAttribute('aria-grabbed', 'false');
    if (cancel) for (const id of previous.order) {
      const node = [...list.children].find(row => row.dataset.routeId === id);
      if (node) list.append(node);
    }
    else if (previous.moved) {
      saveVisibleOrder([...list.children].map(row => row.dataset.routeId));
    }
    try { list.releasePointerCapture?.(previous.pointerId); } catch { /* Capture may already be released. */ }
  }
  function cancelSortAnimations() {
    for (const animation of sortAnimations.values()) animation.cancel?.();
    sortAnimations.clear();
  }
  function routeLayoutTop(node) {
    const viewport = root.querySelector('.lastro-route-scroll');
    if (node.offsetParent === viewport) return viewport.getBoundingClientRect().top + (node.offsetTop - viewport.scrollTop) * drag.scaleY;
    return node.getBoundingClientRect().top;
  }
  function followDragPointer() {
    if (!drag?.moved) return;
    const viewport = root.querySelector('.lastro-route-scroll').getBoundingClientRect();
    const height = (drag.node.offsetHeight ? drag.node.offsetHeight * drag.scaleY : drag.node.getBoundingClientRect().height) * 1.01;
    const minTop = viewport.top + 4 * drag.scaleY, maxTop = Math.max(minTop, viewport.bottom - height - 4 * drag.scaleY);
    const desiredTop = drag.startTop + drag.y - drag.startY - 3 * drag.scaleY;
    const top = Math.max(minTop, Math.min(maxTop, desiredTop));
    drag.node.style.setProperty('--lastro-sort-offset', `${(top - routeLayoutTop(drag.node)) / drag.scaleY}px`);
  }
  function moveAtPointer() {
    if (!drag || !drag.moved) return;
    const rows = [...list.children].filter(row => row !== drag.node);
    const before = rows.find(row => drag.y < routeLayoutTop(row) + (row.offsetHeight ? row.offsetHeight * drag.scaleY : row.getBoundingClientRect().height) / 2);
    if (drag.node.nextElementSibling === (before || null)) return;
    const positions = new Map(rows.map(row => [row, row.getBoundingClientRect().top]));
    cancelSortAnimations();
    list.insertBefore(drag.node, before || null);
    for (const row of rows) {
      const offset = (positions.get(row) - row.getBoundingClientRect().top) / drag.scaleY;
      if (Math.abs(offset) < .5 || typeof row.animate !== 'function') continue;
      const animation = row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'cubic-bezier(.2,.65,.3,1)' });
      sortAnimations.set(row, animation);
      const cleanup = () => { if (sortAnimations.get(row) === animation) sortAnimations.delete(row); };
      animation.onfinish = animation.oncancel = cleanup;
    }
  }
  function autoScroll() {
    if (!drag) return;
    const viewport = root.querySelector('.lastro-route-scroll');
    const bounds = viewport.getBoundingClientRect();
    const delta = drag.y < bounds.top + 28 ? -8 : drag.y > bounds.bottom - 28 ? 8 : 0;
    if (delta && drag.moved) { viewport.scrollTop += delta; moveAtPointer(); followDragPointer(); }
    scrollFrame = win.requestAnimationFrame?.(autoScroll);
  }
  function commitMove(id, offset) {
    if (!sortingAllowed()) return;
    const order = [...list.querySelectorAll('[data-route-id]')].map(row => row.dataset.routeId);
    const index = order.indexOf(id), next = index + offset;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    saveVisibleOrder(order);
    renderList();
    [...list.querySelectorAll('[data-sort-handle]')].find(node => node.closest('[data-route-id]').dataset.routeId === id)?.focus();
  }
  function run(route) {
    const generation = ++requestGeneration;
    const complete = mode => {
      if (generation !== requestGeneration || mode == null) return;
      const message = `${mode === 'navigation' ? '已开始导航' : '已发送传送请求'}：${route.npc}`;
      if (status) status.textContent = message; tools.setStatus?.(message);
      fitPanel(teleport, 'teleport', 34);
    };
    const failed = error => {
      if (generation === requestGeneration) { const message = `无法前往：${error.message}`; if (status) status.textContent = message; tools.setStatus?.(message); fitPanel(teleport, 'teleport', 34); }
    };
    try {
      const mode = requestRoute(route);
      if (mode && typeof mode.then === 'function') {
        if (status) status.textContent = '正在检查传送地点'; tools.setStatus?.('正在检查传送地点');
        mode.then(complete, failed);
      } else complete(mode);
    } catch (error) { failed(error); }
  }
  function cancelPendingRequest() {
    requestGeneration++;
    deps.cancelPendingRoute?.();
    if (status?.textContent === '正在检查传送地点') status.textContent = '';
  }
  function cancelConfirmation() {
    if (!confirmation) return;
    const previous = confirmation;
    confirmation = null; previous.settled = true; previous.popup?.remove?.();
  }
  function go(route) {
    confirmAction(`是否前往${route.npc}？`, () => run(route));
  }
  function confirmAction(message, action) {
    if (!deps.showPrompt) { action(); return; }
    if (confirmation) return;
    const pending = { settled: false, popup: null }; confirmation = pending;
    const finish = yes => {
      if (pending.settled) return;
      pending.settled = true;
      if (confirmation === pending) confirmation = null;
      if (yes) action();
    };
    try {
      pending.popup = deps.showPrompt(message, () => finish(true), () => finish(false));
      if (pending.popup) {
        const previousRemove = pending.popup.onRemove;
        pending.popup.onRemove = function (...args) {
          win.queueMicrotask(() => finish(false));
          return previousRemove?.apply(this, args);
        };
      } else if (!pending.settled) finish(false);
    } catch (error) { finish(false); if (status) status.textContent = `无法打开确认窗口：${error.message}`; }
  }
  function renderList() {
    stopDrag(true);
    list.replaceChildren();
    root.querySelector('[data-custom-form]').hidden = !['custom', 'search'].includes(selected) || !customEditorOpen;
    root.querySelector('[data-custom-toolbar]').hidden = selected !== 'custom';
    root.querySelector('[data-search-toolbar]').hidden = selected !== 'search';
    root.querySelector('[data-clear-route-search]').hidden = !searchQuery;
    root.querySelector('[data-reset-order]').hidden = !sortingAllowed();
    renderCustomNavigation();
    root.querySelector('.lastro-route-scroll').hidden = false;
    root.querySelectorAll('[data-category]').forEach(tab => {
      const active = tab.dataset.category === selected;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    const entries = selected === 'search' ? searchQuery.trim() ? searchEntries().filter(entry => matchesSearch(entry.route)) : []
      : (selected === 'custom' ? customIds() : ordered(selected)).map(id => ({ category: selected, id, key: id, route: catalog[selected][id] }));
    root.querySelector('[data-custom-results]').textContent = `${entries.length} 个地点`;
    root.querySelector('[data-search-results]').textContent = searchQuery.trim() ? `找到 ${entries.length} 个地点` : '可搜索全部内置及已保存地点';
    for (const entry of entries) {
      const { route, category } = entry, id = entry.key;
      const row = element('li', 'lastro-route-row');
      row.dataset.routeId = id; row.dataset.routeCategory = category;
      const handle = element('button', 'lastro-sort-handle', '⋮⋮');
      handle.type = 'button';
      handle.dataset.sortHandle = '';
      handle.setAttribute('aria-label', `调整${route.npc}的位置`);
      handle.setAttribute('aria-grabbed', 'false');
      handle.title = '上下拖拽排序，也可使用方向键';
      if (!sortingAllowed()) { handle.disabled = true; handle.hidden = true; }
      handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault(); event.stopPropagation();
        commitMove(id, event.key === 'ArrowUp' ? -1 : 1);
      });
      const text = element('div', 'lastro-route-copy');
      text.append(element('strong', 'lastro-route-name', route.npc), element('span', 'lastro-route-desc', route.desc));
      if (selected === 'custom' || selected === 'search') {
        const destination = route.outset || route.path?.[0];
        const source = sourceName(category, route);
        text.append(element('span', 'lastro-route-location', destination ? `${source} · ${destination[0]} ${destination[1]},${destination[2]}` : source));
      }
      const button = element('button', 'lastro-button lastro-route-go', '前往');
      button.type = 'button'; button.setAttribute('aria-label', `前往${route.npc}`);
      if (route.unavailable) { button.disabled = true; button.title = route.unavailableReason || '地点资料暂不可用'; button.textContent = '不可用'; }
      button.addEventListener('click', () => go(route));
      const actions = element('div', 'lastro-route-actions'); actions.append(button);
      if (route.customPlaceId) {
        for (const [name, label, action] of [['edit', '编辑', editCustomPlace], ['delete', '删除', deleteCustomPlace]]) {
          const control = element('button', 'lastro-button lastro-route-manage', label);
          control.type = 'button'; control.dataset.customAction = ''; control.dataset[`${name}Place`] = route.customPlaceId;
          control.disabled = savingCustom; control.setAttribute('aria-label', `${label}${route.npc}`);
          control.addEventListener('click', () => action(route.customPlaceId)); actions.append(control);
        }
      }
      row.append(handle, text, actions); list.append(row);
    }
    if (!list.children.length) list.append(element('li', 'lastro-route-empty', selected === 'search' ? searchQuery.trim() ? '未找到匹配地点，请修改或清空搜索。' : '请输入名称、地图、备注或坐标搜索地点。' : selected === 'custom' && customSource === 'mine' ? '尚无已保存地点，可点击“添加自定义地点”保存。' : '此分类暂无可用地点。'));
    teleport._setupScrollbars?.();
    fitPanel(teleport, 'teleport', 34);
  }
  function select(category) {
    if (!categories.some(([id]) => id === category)) return;
    stopDrag(true); clearCustomEditor(); selected = category; preferences.category = category; renderList(); resetScroll(teleport, '.lastro-route-scroll'); save();
  }
  function resetOrder() {
    if (!sortingAllowed()) return;
    stopDrag(true);
    if (selected === 'custom') {
      const ids = new Set(customIds());
      saveVisibleOrder(Object.keys(catalog.custom).filter(id => ids.has(id)));
    } else { delete preferences.orders[selected]; save(); }
    renderList();
  }
  function resetScroll(component, selector) {
    const viewport = component.getRoot().querySelector(selector);
    if (viewport) viewport.scrollTop = 0;
    component._setupScrollbars?.();
  }
  function panelVisible(component) {
    const host = component._host;
    return component.__active !== false && !!host?.isConnected && host.style.display !== 'none'
      && win.getComputedStyle(host).display !== 'none';
  }
  function layoutFor(key) {
    if (!layouts.has(key)) {
      const saved = preferences.geometry[key], value = { width: 520 };
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const name of ['x', 'y', 'width', 'height']) {
          if (typeof saved[name] === 'number' && Number.isFinite(saved[name])
            && (name === 'x' || name === 'y' || saved[name] > 0)) value[name] = saved[name];
        }
      }
      layouts.set(key, value);
    }
    return layouts.get(key);
  }
  function panelMeasurements(host) {
    const rect = host.getBoundingClientRect(), computed = win.getComputedStyle(host);
    const size = (name, sides, fallback) => {
      const value = parseFloat(computed[name]);
      if (!(value > 0)) return fallback;
      return computed.boxSizing === 'border-box' ? value
        : value + sides.reduce((sum, side) => sum + (parseFloat(computed[side]) || 0), 0);
    };
    const width = size('width', ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'], host.offsetWidth);
    const height = size('height', ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'], host.offsetHeight);
    const ratio = (visual, logical, fallback) => visual > 0 && logical > 0 ? visual / logical : fallback;
    const scaleX = ratio(rect.width, width, 1), scaleY = ratio(rect.height, height, scaleX);
    return { width, height, scaleX, scaleY };
  }
  function stopPanelResize(cancel = false, fit = true) {
    if (!resizing) return;
    const previous = resizing; resizing = null;
    win.removeEventListener('pointermove', previous.move);
    win.removeEventListener('pointerup', previous.up);
    win.removeEventListener('pointercancel', previous.cancel);
    win.removeEventListener('keydown', previous.key, true);
    win.removeEventListener('blur', previous.cancel);
    win.removeEventListener('pagehide', previous.cancel);
    previous.handle.removeEventListener('lostpointercapture', previous.cancel);
    previous.component._host.classList.remove('lastro-is-resizing');
    try { previous.handle.releasePointerCapture?.(previous.pointerId); } catch { /* A canceled pointer may already have released capture. */ }
    if (cancel) layouts.set(previous.layoutKey, previous.original);
    else if (previous.moved) {
      preferences.geometry[previous.layoutKey] = { ...layoutFor(previous.layoutKey) }; save();
    }
    if (fit) fitPanel(previous.component, previous.layoutKey, previous.right);
  }
  function beginPanelResize(component, layoutKey, right, handle, event) {
    if (resizing || drag || !panelVisible(component) || (event.button !== 0 && event.button !== -1)) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    refreshProfile();
    const { width, height, scaleX, scaleY } = panelMeasurements(component._host);
    if (!(width > 0 && height > 0 && scaleX > 0 && scaleY > 0)) return;
    event.preventDefault(); event.stopPropagation();
    const previous = { component, layoutKey, right, handle, pointerId: event.pointerId, profile,
      startX: event.clientX, startY: event.clientY, width, height, scaleX, scaleY,
      x: parseFloat(component._host.style.left), y: parseFloat(component._host.style.top),
      original: { ...layoutFor(layoutKey) }, moved: false };
    previous.move = move => {
      if (resizing !== previous || move.pointerId !== previous.pointerId) return;
      if (profile !== deps.getProfile?.()) { stopPanelResize(true, false); refreshProfile(); return; }
      const dx = move.clientX - previous.startX, dy = move.clientY - previous.startY;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!previous.moved && Math.max(Math.abs(dx), Math.abs(dy)) < 3)) return;
      move.preventDefault(); move.stopPropagation(); previous.moved = true;
      const preferred = layoutFor(layoutKey);
      const maxWidth = Math.max(1, ((win.innerWidth || doc.documentElement.clientWidth) - 16) / scaleX);
      const maxHeight = Math.max(1, ((win.innerHeight || doc.documentElement.clientHeight) - 16) / scaleY);
      preferred.width = Math.min(maxWidth, Math.max(Math.min(320, maxWidth), width + dx / scaleX));
      preferred.height = Math.min(maxHeight, Math.max(Math.min(180, maxHeight), height + dy / scaleY));
      if (Number.isFinite(previous.x)) preferred.x = previous.x;
      if (Number.isFinite(previous.y)) preferred.y = previous.y;
      fitPanel(component, layoutKey, right);
      preferred.x = parseFloat(component._host.style.left); preferred.y = parseFloat(component._host.style.top);
    };
    previous.up = up => { if (up.pointerId === previous.pointerId) { previous.move(up); stopPanelResize(); } };
    previous.cancel = cancel => { if (cancel.pointerId == null || cancel.pointerId === previous.pointerId) stopPanelResize(true); };
    previous.key = key => { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); stopPanelResize(true); } };
    resizing = previous;
    component._host.classList.add('lastro-is-resizing');
    win.addEventListener('pointermove', previous.move);
    win.addEventListener('pointerup', previous.up);
    win.addEventListener('pointercancel', previous.cancel);
    win.addEventListener('keydown', previous.key, true);
    win.addEventListener('blur', previous.cancel);
    win.addEventListener('pagehide', previous.cancel);
    handle.addEventListener('lostpointercapture', previous.cancel);
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* Synthetic events do not own a pointer. */ }
  }
  function fitPanel(component, key, right) {
    const host = component._host;
    if (!panelVisible(component)) return;
    refreshProfile();
    const { scaleX, scaleY } = panelMeasurements(host);
    const width = win.innerWidth || doc.documentElement.clientWidth, height = win.innerHeight || doc.documentElement.clientHeight;
    if (!(width > 0 && height > 0 && scaleX > 0 && scaleY > 0)) return;
    const preferred = layoutFor(key);
    host.style.position = 'fixed';
    host.style.right = 'auto'; host.style.bottom = 'auto';
    // Keep the preferred size intact. CSS max constraints shrink only the current
    // viewport, so restoring a larger viewport restores the user's dimensions.
    host.style.setProperty('width', `${preferred.width}px`, 'important');
    host.style.height = preferred.height ? `${preferred.height}px` : 'auto';
    host.style.setProperty('max-width', `${Math.max(0, (width - 16) / scaleX)}px`, 'important');
    const maxHeight = Math.max(0, (height - 16) / scaleY);
    host.style.setProperty('max-height', `${maxHeight}px`, 'important');
    host.style.setProperty('--lastro-panel-max-height', `${maxHeight}px`);
    const rect = host.getBoundingClientRect();
    const originX = rect.left - (parseFloat(host.style.left) || host.offsetLeft || 0) * scaleX;
    const originY = rect.top - (parseFloat(host.style.top) || host.offsetTop || 0) * scaleY;
    const minX = (8 - originX) / scaleX, minY = (8 - originY) / scaleY;
    const maxX = Math.max(minX, (width - 8 - rect.width - originX) / scaleX);
    const maxY = Math.max(minY, (height - 8 - rect.height - originY) / scaleY);
    if (!Number.isFinite(preferred.x)) preferred.x = (width - right * scaleX - rect.width - originX) / scaleX;
    if (!Number.isFinite(preferred.y)) preferred.y = (height - 88 * scaleY - rect.height - originY) / scaleY;
    host.style.left = `${Math.max(minX, Math.min(maxX, preferred.x))}px`;
    host.style.top = `${Math.max(minY, Math.min(maxY, preferred.y))}px`;
    component._setupScrollbars?.();
  }
  function fitPanels() {
    stopPanelResize(true, false);
    fitPanel(tools, 'auto', 12); fitPanel(teleport, 'teleport', 34);
  }
  function listenForResize() {
    if (listeningForResize) return;
    win.addEventListener('resize', fitPanels); listeningForResize = true;
  }
  function stopListeningIfInactive() {
    if (!listeningForResize || tools.__active || teleport.__active) return;
    win.removeEventListener('resize', fitPanels); listeningForResize = false;
  }
  function setupPanel(component, key, right) {
    component._host.style.position = 'fixed';
    component.draggable('.lastro-ro-titlebar');
    const resizeHandle = component.getRoot().querySelector('.lastro-window-resize');
    resizeHandle.addEventListener('pointerdown', event => beginPanelResize(component, key, right, resizeHandle, event));
    resizeHandle.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
    resizeHandle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    // Native append/show calls this hook after lifecycle callbacks. Use the
    // same scaled clamp instead of applying the unscaled native clamp afterward.
    component._fixPositionOverflow = () => fitPanel(component, key, right);
    const previousDragEnd = component.onDragEnd, previousResize = component.onResize;
    component.onDragEnd = function (...args) {
      previousDragEnd?.apply(this, args);
      refreshProfile();
      const preferred = layoutFor(key), host = this._host;
      const x = parseFloat(host.style.left), y = parseFloat(host.style.top);
      if (Number.isFinite(x)) preferred.x = x;
      if (Number.isFinite(y)) preferred.y = y;
      const width = parseFloat(host.style.width), height = parseFloat(host.style.height);
      if (width > 0) preferred.width = width;
      if (height > 0) preferred.height = height;
      preferences.geometry[key] = { ...preferred }; save();
      fitPanel(this, key, right);
    };
    component.onResize = function (...args) { previousResize?.apply(this, args); fitPanel(this, key, right); };
  }
  function ensureDock() {
    if (!tools.__active) return null;
    if (dock?.isConnected) return dock;
    dock = element('div', 'lastro-tools-dock'); dock.id = 'lastro-tools-dock';
    const style = element('style', '', '.lastro-tools-dock{position:fixed;right:12px;bottom:12px;display:flex;gap:12px;z-index:49}#lastro-tools-dock button{display:block;width:36px;height:36px;min-height:0;margin:0;padding:0;border:0;background:none;box-shadow:none;cursor:pointer}#lastro-tools-dock button:focus-visible{outline:2px solid #7396d0;outline-offset:2px}.lastro-dock-icon{display:block;width:36px;height:36px;background-size:36px 36px;background-repeat:no-repeat;background-position:center}');
    dock.append(style);
    const automationButton = element('button', ''), teleportButton = element('button', '');
    automationButton.type = teleportButton.type = 'button';
    automationButton.setAttribute('aria-label', '打开挂机设置'); teleportButton.setAttribute('aria-label', '打开传送列表');
    for (const [button, asset] of [[teleportButton, 'skill'], [automationButton, 'option']]) {
      const icon = element('span', 'lastro-dock-icon'); icon.dataset.background = 'ro_menu_icon/' + asset + '_1.bmp'; icon.dataset.down = 'ro_menu_icon/' + asset + '_2.bmp';
      icon.setAttribute('aria-hidden', 'true'); button.replaceChildren(icon);
      GUIComponent.processDataAttrs?.(icon);
    }
    automationButton.addEventListener('click', () => {
      if (tools._host?.isConnected && tools._host.style.display !== 'none') tools.hidePanel();
      else showAutomation();
    });
    teleportButton.addEventListener('click', () => {
      if (teleport._host?.isConnected && teleport._host.style.display !== 'none') teleport.remove();
      else showTeleport();
    });
    dock.addEventListener('mousedown', event => event.stopPropagation());
    dock.addEventListener('pointerdown', event => event.stopPropagation());
    dock.append(teleportButton, automationButton); doc.body.append(dock);
    tools._panelOpener = automationButton;
    return dock;
  }
  function showAutomation() {
    tools.restorePanel(); tools.populateItemSelects();
    tools.getRoot().querySelector('.lastro-settings-view').hidden = false;
    resetScroll(tools, '.lastro-settings-body');
    tools.focus?.(); ensureDock();
  }
  function showTeleport() {
    tools.hidePanel(); refreshCatalog(); teleport.append(); renderList(); resetScroll(teleport, '.lastro-route-scroll'); teleport.focus?.(); ensureDock();
  }
  const originalRender = tools.render;
  tools._cssText = css;
  tools.render = function () {
    const template = doc.createElement('template');
    setHtml(template, originalRender.call(this));
    const content = template.content;
    const header = content.querySelector('.lastro-header');
    const bar = doc.createElement('div'); setHtml(bar, titlebar('挂机设置')); header.replaceWith(bar.firstElementChild);
    content.querySelector('.lastro-settings-bar').remove();
    const settings = content.querySelector('.lastro-settings-view'); settings.hidden = false;
    const options = content.querySelectorAll('[data-option]');
    for (const option of [...options].reverse()) {
      const tab = option.dataset.option === 'autoLoot' ? 'pick' : option.dataset.option === 'autoPots' ? 'eat' : 'battle';
      const label = option.closest('label'); label.className = 'lastro-line'; option.classList.remove('lastro-switch');
      content.querySelector(`[data-tab-panel="${tab}"]`).prepend(label);
    }
    const battle = content.querySelector('[data-tab-panel="battle"]');
    battle.insertBefore(battle.querySelector('[data-targets]').closest('.lastro-group'), battle.querySelector('.lastro-group'));
    const minimize = element('button', 'lastro-window-minimize'); minimize.type = 'button';
    minimize.dataset.action = 'minimize'; minimize.dataset.background = 'basic_interface/sys_mini_off.bmp'; minimize.dataset.hover = 'basic_interface/sys_mini_on.bmp';
    minimize.setAttribute('aria-label', '最小化挂机设置'); minimize.title = '最小化';
    content.querySelector('.lastro-ro-titlebar').append(minimize);
    const statusNode = content.querySelector('.lastro-status'); settings.append(statusNode);
    content.querySelector('.lastro-main-view').remove();
    const footer = doc.createElement('template'); setHtml(footer, resizeFooter('挂机设置'));
    content.querySelector('.lastro-tools').append(footer.content);
    return template.innerHTML;
  };
  const originalInit = tools.init;
  tools.init = function () {
    originalInit.call(this);
    setupPanel(this, 'auto', 12);
    this.getRoot().querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => resetScroll(this, '.lastro-settings-body')));
    this.getRoot().querySelectorAll('.lastro-ro-titlebar button').forEach(button => button.addEventListener('mousedown', event => event.stopPropagation()));
  };
  tools.ensurePanelOpener = () => { ensureDock(); return tools._panelOpener; };
  const originalHide = tools.hidePanel, originalRestore = tools.restorePanel;
  tools.hidePanel = function () { if (resizing?.component === this) stopPanelResize(true); originalHide.call(this); ensureDock(); };
  tools.restorePanel = function () {
    teleport.remove();
    originalRestore.call(this);
    this.getRoot().querySelector('.lastro-settings-view').hidden = false;
    if (this._panelOpener) this._panelOpener.hidden = false;
    fitPanel(this, 'auto', 12);
  };
  tools.collapseDetailedSettings = function () { this.getRoot()?.querySelector('.lastro-settings-view')?.removeAttribute('hidden'); };
  const previousAppend = tools.onAppend, previousRemove = tools.onRemove;
  tools.onAppend = function () { previousAppend?.call(this); this._host.style.display = 'none'; ensureDock(); listenForResize(); };
  tools.onRemove = function () {
    stopPanelResize(true, false);
    stopDrag(true); cancelConfirmation();
    if (!this._lastroMapTransition) deps.cancelRoute?.();
    teleport.remove(); dock?.remove(); dock = null; previousRemove?.call(this);
    stopListeningIfInactive();
  };
  const previousMapChanged = tools.onMapChanged;
  tools.onMapChanged = function (...args) { this._lastroMapTransition = false; deps.routeMapChanged?.(); return previousMapChanged?.apply(this, args); };
  teleport.render = () => `<div class="lastro-tools">${titlebar('传送地点')}<div class="lastro-teleport-body">
    <div class="lastro-tabs lastro-route-tabs" role="tablist" aria-label="传送分类">${categories.map(([id, name]) => `<button type="button" class="lastro-tab" role="tab" data-category="${id}">${name}</button>`).join('')}</div>
    <div class="lastro-tabs lastro-route-tabs lastro-custom-source-tabs" data-custom-sources role="tablist" aria-label="自定义地点类别" hidden></div>
    <div class="lastro-tabs lastro-route-tabs lastro-custom-group-tabs" data-custom-groups role="tablist" aria-label="上游地点分组" hidden></div>
    <div class="lastro-custom-toolbar" data-custom-toolbar hidden><span class="lastro-help" data-custom-results aria-live="polite"></span><button type="button" class="lastro-button" data-custom-action data-add-place>添加自定义地点</button></div>
    <div class="lastro-search-toolbar" data-search-toolbar hidden><label class="lastro-route-search">搜索<input data-search-routes maxlength="100" placeholder="名称、地图、备注或坐标" autocomplete="off"></label><button type="button" class="lastro-button" data-clear-route-search hidden>清空</button><span class="lastro-help lastro-search-results" data-search-results aria-live="polite"></span></div>
    <div class="lastro-route-scroll" data-scrollbar-skin="blue">
      <form data-custom-form hidden><strong class="lastro-group-title" data-custom-title>添加自定义地点</strong><p class="lastro-help">保存后可在本区服的角色之间使用；“前往”会检查地图后再请求传送。</p>
        <label class="lastro-line">地点名称<input name="name" maxlength="80" placeholder="可选，默认使用地图和坐标" autocomplete="off"></label>
        <label class="lastro-line">备注<input name="desc" maxlength="200" placeholder="可选" autocomplete="off"></label>
        <div class="lastro-custom-map-row"><label class="lastro-line">地图名<input name="map" required maxlength="20" placeholder="prontera" autocomplete="off"></label><button type="button" class="lastro-button" data-custom-action data-read-current-location>读取当前位置</button></div>
        <div class="lastro-custom-coordinates"><label class="lastro-line">X 坐标<input name="x" type="number" required min="0" max="65535" step="1"></label><label class="lastro-line">Y 坐标<input name="y" type="number" required min="0" max="65535" step="1"></label></div>
        <div class="lastro-custom-buttons"><button type="button" class="lastro-button" data-custom-action data-save-place>保存地点</button><button type="submit" class="lastro-button" data-custom-action>前往</button><button type="button" class="lastro-button" data-custom-action data-cancel-edit hidden>取消编辑</button></div>
      </form>
      <ul class="lastro-route-list" aria-label="传送地点列表"></ul><div class="lastro-route-footer"><button type="button" class="lastro-button" data-reset-order>恢复默认顺序</button></div>
    </div><div class="lastro-status" role="status" aria-live="polite"></div></div></div>`;
  const renderTeleport = teleport.render;
  teleport.render = () => renderTeleport().replace(/<\/div>$/, `${resizeFooter('传送地点')}</div>`);
  teleport.init = function () {
    root = this.getRoot(); list = root.querySelector('.lastro-route-list'); status = root.querySelector('.lastro-status');
    setupPanel(this, 'teleport', 34);
    root.querySelector('[data-action="close"]').addEventListener('click', () => this.remove());
    root.querySelector('[data-action="close"]').addEventListener('mousedown', event => event.stopPropagation());
    root.querySelectorAll('[data-category]').forEach(button => {
      button.addEventListener('click', () => select(button.dataset.category));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = categories.findIndex(([id]) => id === selected);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + categories.length) % categories.length;
        select(categories[next][0]); root.querySelector(`[data-category="${selected}"]`).focus();
      });
    });
    root.querySelector('[data-reset-order]').addEventListener('click', resetOrder);
    root.querySelector('[data-save-place]').addEventListener('click', saveCustomPlace);
    root.querySelector('[data-add-place]').addEventListener('click', openCustomEditor);
    root.querySelector('[data-read-current-location]').addEventListener('click', readCurrentLocation);
    root.querySelector('[data-search-routes]').addEventListener('input', event => updateSearch(event.currentTarget.value));
    root.querySelector('[data-clear-route-search]').addEventListener('click', () => { updateSearch(''); root.querySelector('[data-search-routes]').focus(); });
    root.querySelector('[data-cancel-edit]').addEventListener('click', clearCustomEditor);
    root.querySelector('[data-custom-form]').addEventListener('submit', event => {
      event.preventDefault();
      if (savingCustom) return;
      try {
        go(customRoute(placeFromForm()));
      } catch (error) { status.textContent = error.message; }
    });
    list.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-sort-handle]');
      if (!handle || !sortingAllowed() || (event.button !== 0 && event.button !== -1) || drag) return;
      event.preventDefault(); event.stopPropagation();
      const node = handle.closest('[data-route-id]');
      cancelSortAnimations();
      drag = { node, handle, pointerId: event.pointerId, startY: event.clientY, y: event.clientY, startTop: node.getBoundingClientRect().top,
        scaleY: panelMeasurements(teleport._host).scaleY, moved: false, order: [...list.children].map(row => row.dataset.routeId) };
      node.classList.add('is-dragging');
      // Capture on the stationary list: moving a captured row loses capture in Chromium.
      try { list.setPointerCapture?.(event.pointerId); } catch { /* Synthetic/test events have no active pointer. */ }
      handle.setAttribute('aria-grabbed', 'true'); autoScroll();
    });
    list.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.y = event.clientY;
      if (Math.abs(drag.y - drag.startY) >= 4) drag.moved = true;
      if (drag.moved) { event.preventDefault(); drag.node.classList.add('is-drag-moving'); moveAtPointer(); followDragPointer(); }
    });
    list.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) stopDrag(); });
    list.addEventListener('pointercancel', () => stopDrag(true));
    list.addEventListener('lostpointercapture', () => stopDrag(true));
    renderList();
  };
  teleport.onRemove = () => { if (resizing?.component === teleport) stopPanelResize(true, false); stopDrag(true); cancelConfirmation(); cancelPendingRequest(); clearCustomEditor(); stopListeningIfInactive(); };
  teleport.onAppend = () => { tools.hidePanel(); listenForResize(); fitPanel(teleport, 'teleport', 34); };
  UIManager.addComponent(teleport);
  tools._lastroPanels = {
    teleport, showAutomation, showTeleport, select, ordered, catalog,
    deactivate: () => {
      stopPanelResize(true, false); stopDrag(true); cancelConfirmation(); cancelPendingRequest(); teleport.remove();
      dock?.remove(); dock = null; tools._panelOpener = null;
      if (listeningForResize) { win.removeEventListener('resize', fitPanels); listeningForResize = false; }
    },
    refreshEntry: () => { if (tools.__active) { ensureDock(); listenForResize(); if (tools._panelOpener) tools._panelOpener.hidden = false; } },
    requestCustomRoute: raw => { const route = normalizeRoute(raw); if (route.unavailable) throw new Error(route.unavailableReason || '地点资料暂不可用'); go(route); },
    setStatus: message => { if (status) status.textContent = message; },
    onMapChanging: () => { tools._lastroMapTransition = true; deps.routeMapChanging?.(); },
    cancelRoute: () => { tools._lastroMapTransition = false; cancelConfirmation(); cancelPendingRequest(); deps.cancelRoute?.(); },
  };
  return tools._lastroPanels;
}
