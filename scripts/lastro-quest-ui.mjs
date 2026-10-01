/** Self-contained: serialized into the packaged native runtime. */
export function installLastroQuestUI(deps) {
const FONT = "Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif";
const LIST_STYLE = `
:host{font-family:${FONT};font-size:12px;font-weight:400;font-size-adjust:none}
.lastro-quest-track{position:absolute;right:3px;top:14px;margin:0;width:14px;height:14px;cursor:pointer}
.quest-item{position:relative}.quest-item-title{min-width:0!important;max-width:calc(100% - 64px);overflow-wrap:anywhere}
.quest-item-title-text{font-weight:400!important;white-space:normal}
.lastro-quest-display{position:absolute;left:12px;bottom:8px;display:flex;align-items:center;gap:4px;font-size:12px;font-weight:400}
.lastro-quest-display input{margin:0;width:13px;height:13px}
`;
const DETAIL_STYLE = `
:host{font-family:${FONT};font-size:12px;font-weight:400;font-size-adjust:none}
#QuestInfoV1 .content>.title,#QuestInfoV1 .content>.summary,#QuestInfoV1 .content>.objective,
#QuestInfoV1 .content>.monster,#QuestInfoV1 .content>.killed,#QuestInfoV1 .content>.limited{display:none}
#QuestInfoV1 .lastro-quest-detail{position:absolute;inset:26px 14px 18px;overflow-y:auto;background:white;padding:8px;box-sizing:border-box}
#QuestInfoV1 .lastro-quest-caption{position:absolute;top:3px;left:30px;right:30px;height:20px;line-height:20px;text-align:center;background:white;color:#000091;font-size:12px;font-weight:500;pointer-events:none}
#QuestInfo .quest-info-mid-panel{box-sizing:border-box;padding:10px;overflow-y:auto;overflow-x:hidden}
.lastro-quest-detail{font-size:12px;font-weight:400;line-height:1.5;color:#111;overflow-wrap:anywhere}
.lastro-quest-detail h3{margin:0 0 8px;font-size:12px;font-weight:500;color:#000091}
.lastro-quest-detail p{margin:6px 0;white-space:pre-wrap}
  .lastro-quest-targets,.lastro-quest-rewards{padding-left:18px;margin:8px 0}.lastro-quest-targets li,.lastro-quest-rewards li{margin:3px 0}
.lastro-quest-link{background:none;border:0;padding:0;color:#064a8b;text-decoration:underline;font:inherit;cursor:pointer;text-align:left;white-space:normal}
.lastro-quest-link:disabled{color:#666;cursor:default}.lastro-quest-status{color:#a00000;white-space:pre-wrap}
`;
const TRACKER_STYLE = `
:host{font-family:${FONT};font-size:12px;font-weight:400;font-size-adjust:none}
#QuestWindow{width:240px;max-width:calc(100vw - 24px);display:block;background:none;font-size:12px}
#QuestWindow .quest-window-ul{list-style:none;margin:0;padding:0;overflow-y:auto;overflow-x:hidden;max-height:var(--lastro-quest-height,50vh);text-shadow:1px 1px 2px #000,-1px -1px 1px #000}
#QuestWindow .quest-window-li{margin:0 0 12px;overflow-wrap:anywhere}
#QuestWindow .quest-window-li-title{color:#ffef00;font-size:12px;font-weight:400;white-space:normal}
#QuestWindow .quest-window-li-summary,#QuestWindow .quest-window-li-monster{color:white;font-size:12px;font-weight:400;white-space:pre-wrap}
#QuestWindow .quest-window-li-monster ul{margin:3px 0;padding-left:16px}
#QuestWindow .lastro-quest-link{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;text-decoration:underline;text-shadow:inherit;cursor:pointer;white-space:normal}
#QuestWindow .lastro-quest-status{color:#ffb9a5;font-size:12px;text-shadow:inherit}
`;

function string(value) {
  if (Array.isArray(value)) value = value.filter(item => typeof item === 'string').slice(0, 256).join('\n');
  // eslint-disable-next-line no-control-regex -- Native descriptions can contain binary padding and display controls.
  return typeof value === 'string' ? value.slice(0, 65536).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '') : '';
}
function text(value) {
  return string(value).replace(/\^[0-9a-f]{6}/gi, '').replace(/<INFO>[\s\S]*?<\/INFO>/gi, '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?(?:NAVI|ITEM|smob)>|<span\b[^>]*>|<\/span>/gi, '');
}
function number(value) { return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0; }
function id(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null; }
function escape(value) { return string(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

  const { quest, helper, tracker, document: doc, window: win } = deps;
  if (!quest || !helper || !tracker || !doc) throw new TypeError('Missing native quest UI dependency');
  if (quest.lastroQuestUI) return quest.lastroQuestUI;
  const fallbackHidden = [];
  let selected = null, showTracker = true, generation = 0, pending = false, disposed = false;
  let positionObserver = null, listening = false;
  const restorers = [], actionButtons = new Set();
  const getRoot = component => component.getRoot?.() || component._host?.shadowRoot || component._host;
  const quests = () => deps.getQuests?.() || {};
  const hidden = () => {
    const result = deps.getHidden?.();
    return Array.isArray(result) ? result : fallbackHidden;
  };
  const node = (tag, className, value) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  };
  function on(element, type, handler, options) {
    // These listeners belong to their rendered node and are collected with it.
    element.addEventListener(type, event => { if (!disposed && element.isConnected) handler(event); }, options);
  }
  function style(component, css) {
    const root = getRoot(component);
    if (!root || root.querySelector('style[data-lastro-quest]')) return;
    const element = node('style'); element.dataset.lastroQuest = ''; element.textContent = css; root.append(element);
  }
  function wrap(component, method, callback) {
    const original = component[method];
    if (typeof original !== 'function') return;
    const replacement = function (...args) { return callback.call(this, original, args); };
    component[method] = replacement;
    restorers.push(() => { if (component[method] === replacement) component[method] = original; });
  }
  function hydrate(value) {
    try { return deps.hydrateQuest?.(value) || value || {}; } catch { return value || {}; }
  }
  function records() { return Object.values(quests()).filter(value => value && typeof value === 'object'); }
  function targetList(value) {
    return Object.values(value.hunt_list || {}).filter(value => value && typeof value === 'object');
  }
  function setVisible(visible) {
    showTracker = !!visible;
    deps.setShowTracker?.(showTracker);
    if (showTracker && records().length) tracker.ui?.show?.(); else tracker.ui?.hide?.();
    const toggle = getRoot(quest)?.querySelector('.lastro-quest-display input');
    if (toggle) toggle.checked = showTracker;
  }
  function syncVisibility() {
    if (typeof deps.getShowTracker === 'function') showTracker = !!deps.getShowTracker();
    if (!showTracker || !getRoot(tracker)?.querySelector('.quest-window-li')) tracker.ui?.hide?.();
    else tracker.ui?.show?.();
  }
  function status(message) {
    for (const component of [helper, tracker]) {
      const root = getRoot(component);
      let element = root?.querySelector('.lastro-quest-status');
      if (!element && root) {
        element = node('div', 'lastro-quest-status'); element.setAttribute('role', 'status');
        (root.querySelector('.lastro-quest-detail') || root.querySelector('#QuestWindow'))?.append(element);
      }
      if (element) element.textContent = message;
    }
  }
  function link(label, action) {
    const button = node('button', 'lastro-quest-link', text(label)); button.type = 'button';
    on(button, 'mousedown', event => event.stopPropagation());
    on(button, 'touchstart', event => event.stopPropagation());
    on(button, 'click', event => { event.preventDefault(); event.stopPropagation(); if (!disposed && button.isConnected) action(button); });
    return button;
  }
  function monsterButton(target) {
    const mobId = id(target.mobGID ?? target.monsterId ?? target.mobId);
    const name = text(target.mobName ?? target.name);
    if ((!mobId && !name) || typeof deps.showMonster !== 'function') return node('span', '', name);
    return link(name || String(mobId), () => {
      try { const result = deps.showMonster(mobId, name); Promise.resolve(result).catch(() => status('暂时无法显示怪物信息')); }
      catch { status('暂时无法显示怪物信息'); }
    });
  }
  function itemId(value) {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
    const result = Number(value);
    return Number.isSafeInteger(result) && result > 0 && result <= 0xffffffff ? result : null;
  }
  function itemButton(value, label) {
    const target = itemId(value);
    if (!target) return node('span', '', text(label));
    const button = node('button', 'lastro-quest-link item-link', text(label) || `道具 #${target}`);
    button.type = 'button'; button.dataset.itemId = String(target);
    on(button, 'mousedown', event => event.stopPropagation());
    on(button, 'touchstart', event => event.stopPropagation());
    // Keep click bubbling to the native helper's ItemInfo delegate.
    on(button, 'click', event => event.preventDefault());
    return button;
  }
  function validPoint(point) {
    if (!Array.isArray(point) || point.length !== 3 || typeof point[0] !== 'string' || !/^[a-z0-9_@#-]{1,32}$/i.test(point[0])) return null;
    const coordinates = point.slice(1).map(value => typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
    return coordinates.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 65535) ? [point[0], ...coordinates] : null;
  }
  function validRoute(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.path !== undefined && !Array.isArray(value.path)) return null;
    let path = Array.isArray(value.path) ? value.path.map(validPoint) : [];
    const outset = validPoint(value.outset) || ((!value.outset || Array.isArray(value.outset) && value.outset.length === 0) ? validPoint(path[0]) : null);
    if (!path.length && outset) path = [outset];
    if (!outset || !path?.length || path.length > 100 || path.some(point => !point)) return null;
    return { ...value, outset, path };
  }
  function routeButton(label, route) {
    const safe = validRoute(route);
    if (!safe || typeof deps.requestRoute !== 'function') return null;
    const button = link(label || '前往', async () => {
      if (pending || disposed || deps.getMapReady?.() === false) return;
      const current = generation; pending = true; status('');
      for (const action of actionButtons) action.disabled = true;
      try {
        const accepted = await deps.requestRoute({ ...safe, outset: [...safe.outset], path: safe.path.map(point => [...point]) });
        if (current === generation && !disposed && accepted === false) status('暂时无法前往任务地点');
      } catch {
        if (current === generation && !disposed) status('暂时无法前往任务地点');
      } finally {
        if (current === generation) { pending = false; for (const action of actionButtons) action.disabled = false; }
      }
    });
    actionButtons.add(button); button.disabled = pending; return button;
  }
  function appendDescription(container, value) {
    const raw = string(value), expression = /<NAVI>([^<]*)<INFO>([^<]*)<\/INFO><\/NAVI>|<smob>([^<]*)<\/smob>|<span\s+class\s*=\s*(['"])smob\4\s*>([^<]*)<\/span>|<ITEM>([^<]*)<INFO>([^<]*)<\/INFO><\/ITEM>/gi;
    let index = 0;
    for (const match of raw.matchAll(expression)) {
      container.append(doc.createTextNode(text(raw.slice(index, match.index))));
      if (match[6] !== undefined) container.append(itemButton(match[7], match[6]));
      else if (match[3] !== undefined || match[5] !== undefined) container.append(monsterButton({ mobName: match[3] ?? match[5] }));
      else {
        const fields = match[2].split(',').map(value => value.trim());
        const point = fields.length >= 3 ? validPoint(fields.slice(0, 3)) : null;
        const button = point && routeButton(text(match[1]) + '（前往）', { name: text(match[1]), outset: point, path: [point] });
        container.append(button || doc.createTextNode(text(match[1])));
      }
      index = match.index + match[0].length;
    }
    container.append(doc.createTextNode(text(raw.slice(index))));
  }
  function detail(value) {
    const root = getRoot(helper); if (!root || !value) return;
    const info = hydrate(value); style(helper, DETAIL_STYLE);
    const classic = root.querySelector('#QuestInfoV1 .content');
    if (classic && !classic.querySelector('.lastro-quest-caption')) classic.append(node('div', 'lastro-quest-caption', '任务详情'));
    let container = root.querySelector('.lastro-quest-detail');
    if (!container) {
      container = node('div', 'lastro-quest-detail');
      const renewable = root.querySelector('.quest-info-mid-panel');
      if (renewable) { renewable.replaceChildren(container); }
      else root.querySelector('.content')?.append(container);
    }
    if (!container.parentNode) return;
    container.replaceChildren();
    for (const button of actionButtons) if (!getRoot(tracker)?.contains(button)) actionButtons.delete(button);
    container.append(node('h3', '', text(info.title)));
    if (info.summary) { const summary = node('p', 'lastro-quest-summary'); appendDescription(summary, info.summary); container.append(summary); }
    const description = node('p', 'lastro-quest-description'); appendDescription(description, info.description); container.append(description);
    const targets = node('ul', 'lastro-quest-targets');
    for (const target of targetList(info)) {
      const row = node('li'); row.append(monsterButton(target), doc.createTextNode(` (${number(target.huntCount)}/${number(target.maxCount)})`)); targets.append(row);
    }
    if (targets.childNodes.length) container.append(targets);
    const officialMap = typeof info.npc_navi === 'string' ? info.npc_navi.replace(/\.gat$/i, '') : null;
    const officialPoint = validPoint([officialMap, info.npc_pos_x, info.npc_pos_y]);
    const routes = info.routes || (validRoute(info.route) ? [info.route] : officialPoint ? [{ outset: officialPoint, path: [officialPoint] }] : []);
    for (const value of routes) {
      const button = routeButton('前往' + (text(value.name) ? '：' + text(value.name) : ''), value);
      if (button) { const paragraph = node('p'); paragraph.append(button); container.append(paragraph); }
    }
    const rewards = [];
    if (number(info.reward_exp_base)) rewards.push(`EXP ${number(info.reward_exp_base)}`);
    if (number(info.reward_exp_job)) rewards.push(`JEXP ${number(info.reward_exp_job)}`);
    if (rewards.length) container.append(node('p', '', rewards.join('　')));
    const items = node('ul', 'lastro-quest-rewards');
    for (const reward of Array.isArray(info.reward_item_list) ? info.reward_item_list : []) {
      const target = itemId(reward?.ItemID); if (!target) continue;
      let label;
      try { label = deps.getItemInfo?.(target)?.identifiedDisplayName; } catch { /* An unavailable item still has its native ID. */ }
      const row = node('li'); row.append(itemButton(target, label));
      const quantity = Number(reward.ItemNum);
      if ((typeof reward.ItemNum === 'number' || typeof reward.ItemNum === 'string' && /^\d+$/.test(reward.ItemNum))
        && Number.isSafeInteger(quantity) && quantity >= 0) row.append(doc.createTextNode(` × ${quantity}`));
      items.append(row);
    }
    if (items.childNodes.length) container.append(node('h3', '', '物品奖励'), items);
    if (number(info.end_time)) {
      const deadline = new Date(Number(info.end_time) * 1000);
      if (Number.isFinite(deadline.getTime())) container.append(node('p', 'lastro-quest-deadline', '期限：' + deadline.toLocaleString('zh-CN')));
    }
    container.append(node('div', 'lastro-quest-status'));
  }
  function renderTracker(values = quests(), suppressed = hidden()) {
    const root = getRoot(tracker), ul = root?.querySelector('.quest-window-ul'); if (!ul) return;
    style(tracker, TRACKER_STYLE); ul.replaceChildren();
    const exclusions = new Set(suppressed.map(Number));
    let shown = 0;
    for (const value of Object.values(values || {})) {
      if (!value || Number(value.active) !== 1 || exclusions.has(Number(value.questID)) || shown >= 4) continue;
      shown++; const info = hydrate(value), item = node('li', 'quest-window-li'); item.dataset.questId = String(value.questID);
      const title = node('div', 'quest-window-li-title');
      title.append(link(info.title, () => { helper.append?.(); helper.ui?.show?.(); helper.setQuestInfo(value); })); item.append(title);
      if (info.summary) item.append(node('div', 'quest-window-li-summary', text(info.summary)));
      if (number(info.end_time)) {
        const deadline = new Date(Number(info.end_time) * 1000);
        if (Number.isFinite(deadline.getTime())) item.append(node('div', 'quest-window-li-summary', '期限：' + deadline.toLocaleString('zh-CN')));
      }
      const content = node('div', 'quest-window-li-monster'), targets = node('ul');
      for (const target of targetList(info)) {
        const row = node('li'); row.append(monsterButton(target), doc.createTextNode(` (${number(target.huntCount)}/${number(target.maxCount)})`)); targets.append(row);
      }
      content.append(targets); item.append(content); ul.append(item);
    }
    syncVisibility(); position();
  }
  function decorateList() {
    const root = getRoot(quest); if (!root) return;
    style(quest, LIST_STYLE);
    const entries = quests();
    for (const item of root.querySelectorAll('.quest-item')) {
      const match = [...item.classList].map(value => /^qid(\d+)$/.exec(value)).find(Boolean) || /^qid(\d+)$/.exec(item.id);
      const questId = match && Number(match[1]), value = entries[questId]; if (!value) continue;
      const title = item.querySelector('.quest-item-title-text'); if (title) title.textContent = text(hydrate(value).title);
      if (item.querySelector('.quest-item-display-image')) continue;
      let toggle = item.querySelector('.lastro-quest-track');
      if (!toggle) {
        toggle = node('input', 'lastro-quest-track'); toggle.type = 'checkbox'; toggle.dataset.questId = String(questId);
        toggle.setAttribute('aria-label', '追踪任务：' + text(value.title)); item.append(toggle);
        on(toggle, 'click', event => event.stopPropagation()); on(toggle, 'contextmenu', event => { event.preventDefault(); event.stopPropagation(); });
        on(toggle, 'change', () => {
          const list = hidden(), index = list.findIndex(value => Number(value) === questId);
          if (toggle.checked && index >= 0) list.splice(index, 1);
          else if (!toggle.checked && index < 0) list.push(questId);
          refresh();
        });
      }
      toggle.checked = !hidden().some(value => Number(value) === questId); toggle.disabled = Number(value.active) !== 1;
    }
    if (!root.querySelector('.toggle-quest-list') && !root.querySelector('.lastro-quest-display')) {
      const footer = root.querySelector('.footer');
      if (footer) {
        const label = node('label', 'lastro-quest-display'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = showTracker;
        label.append(checkbox, doc.createTextNode('显示任务简报')); footer.append(label);
        on(checkbox, 'change', () => setVisible(checkbox.checked));
      }
    }
  }
  function refresh() {
    if (disposed) return;
    actionButtons.clear(); decorateList(); renderTracker();
    if (selected !== null) {
      const value = records().find(value => Number(value.questID) === selected);
      if (value) detail(value); else { if (pending) cancel(); selected = null; getRoot(helper)?.querySelector('.lastro-quest-detail')?.replaceChildren(); helper.ui?.hide?.(); }
    }
  }
  function position() {
    const host = tracker._host; if (!host) return;
    const viewport = deps.getViewport?.() || { width: win?.innerWidth || 800, height: win?.innerHeight || 600 };
    const mini = deps.getMiniMap?.(), miniHost = mini?._host || mini;
    const rect = miniHost?.isConnected && miniHost.style.display !== 'none' ? miniHost.getBoundingClientRect() : null;
    const hostRect = host.getBoundingClientRect();
    const scaleX = host.offsetWidth > 0 && hostRect.width > 0 ? hostRect.width / host.offsetWidth : 1;
    const scaleY = host.offsetHeight > 0 && hostRect.height > 0 ? hostRect.height / host.offsetHeight : scaleX;
    const originX = hostRect.left - host.offsetLeft * scaleX, originY = hostRect.top - host.offsetTop * scaleY;
    const width = Math.min(240 * scaleX, Math.max(80, viewport.width - 24));
    const top = Math.min(Math.max(8, rect && rect.height ? rect.bottom + 8 : 160), Math.max(8, viewport.height - 80));
    const right = rect && rect.width ? Math.max(8, viewport.width - rect.right) : 16;
    const left = Math.max(8, viewport.width - width - Math.min(right, Math.max(8, viewport.width - width - 8)));
    host.style.right = 'auto'; host.style.left = `${(left - originX) / scaleX}px`; host.style.top = `${(top - originY) / scaleY}px`;
    const inner = getRoot(tracker)?.querySelector('#QuestWindow'); if (inner) inner.style.width = `${width / scaleX}px`;
    host.style.setProperty('--lastro-quest-height', `${Math.max(48, viewport.height - top - 16) / scaleY}px`);
  }
  function attachPosition() {
    if (listening || disposed) return; listening = true; win?.addEventListener('resize', position);
    if (win?.ResizeObserver) { positionObserver = new win.ResizeObserver(position); const mini = deps.getMiniMap?.(); if (mini?._host || mini) positionObserver.observe(mini?._host || mini); }
  }
  function detachPosition() { listening = false; win?.removeEventListener('resize', position); positionObserver?.disconnect(); positionObserver = null; }
  function cancel(all = false) {
    generation++; pending = false;
    for (const button of actionButtons) button.disabled = false;
    try { (all ? deps.cancelRoute || deps.cancelPendingRoute : deps.cancelPendingRoute || deps.cancelRoute)?.(); } catch { /* Cleanup must not block the native logout. */ }
  }

  // STOP is native GUIComponent.MouseMode.STOP; install before prepare registers its mouse handlers.
  tracker.mouseMode = 1;
  wrap(quest, 'addQuestToUI', function (original, args) {
    const value = args[0]; return original.call(this, { ...value, title: escape(value.title), summary: escape(value.summary) }, ...args.slice(1));
  });
  for (const method of ['setQuestList', 'addQuest', 'updateMissionHunt', 'toggleQuestActive', 'removeQuest', 'init', 'onAppend']) {
    wrap(quest, method, function (original, args) {
      const result = original.apply(this, args); if (method === 'onAppend') attachPosition(); refresh(); return result;
    });
  }
  wrap(quest, 'onRemove', function (original, args) { detachPosition(); return original.apply(this, args); });
  wrap(quest, 'clean', function (original, args) {
    cancel(true); detachPosition(); const result = original.apply(this, args); hidden().splice(0); selected = null;
    getRoot(helper)?.querySelector('.lastro-quest-detail')?.replaceChildren(); helper.ui?.hide?.(); tracker.ClearQuestList?.(); tracker.remove?.(); actionButtons.clear(); return result;
  });
  wrap(helper, 'setQuestInfo', function (original, args) {
    const value = args[0] || {}, next = id(value.questID); if (pending && next !== selected) cancel(); selected = next;
    const safe = { ...value, title: '', summary: '', description: '', hunt_list: {}, reward_item_list: [] };
    const result = original.call(this, safe, ...args.slice(1)); detail(value); return result;
  });
  wrap(helper, 'clearQuestDesc', function (original, args) { if (pending) cancel(); selected = null; const result = original.apply(this, args); getRoot(helper)?.querySelector('.lastro-quest-detail')?.replaceChildren(); return result; });
  wrap(helper, 'init', function (original, args) {
    const result = original.apply(this, args);
    wrap(helper.ui, 'hide', function (originalHide, hideArgs) { if (pending) cancel(); return originalHide.apply(this, hideArgs); });
    return result;
  });
  // The original tracker uses HTML fragments; replace that display method with safe DOM rendering.
  wrap(tracker, 'setQuestList', function (_original, args) { renderTracker(args[0], args[1] || hidden()); });
  wrap(tracker, 'onAppend', function (original, args) { const result = original.apply(this, args); attachPosition(); refresh(); return result; });
  wrap(tracker, 'onRemove', function (original, args) { detachPosition(); return original.apply(this, args); });
  const api = { refresh, position, setVisible, cancelRoute: () => cancel(true), get selectedQuestId() { return selected; }, get pending() { return pending; }, dispose() {
    if (disposed) return; cancel(true); disposed = true; detachPosition(); restorers.splice(0).reverse().forEach(restore => restore()); actionButtons.clear(); tracker.remove?.(); delete quest.lastroQuestUI;
  } };
  quest.lastroQuestUI = api; refresh(); return api;
}
