import ts from 'typescript';
import { createLastroTeleportPreflight } from './lastro-teleport-preflight.mjs';
import { createLastroWorldMapTeleport } from './lastro-worldmap-teleport.mjs';

export function installLastroAchievementLinks(component, { mapLabel, showPrompt, shouldConfirmTeleport = () => true, teleport, cancelPending, showMonster, onError }) {
  const links = new WeakMap();
  let generation = 0, pending = null;
  function report(error) { try { onError?.(error); } catch { /* Keep native achievement controls usable. */ } }
  function normalize(value) {
    if (Array.isArray(value)) value = value.filter(item => typeof item === 'string').slice(0, 256).join('\n');
    return typeof value === 'string' ? value.slice(0, 65536).toWellFormed().replace(/\r\n?/g, '\n') : '';
  }
  function text(value) {
    return normalize(value).replace(/\^[0-9a-f]{6}/gi, '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<span\b[^>]*>|<\/span>/gi, '')
      .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi, (match, entity) => {
        const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }, name = entity.toLowerCase();
        if (name[0] !== '#') return named[name];
        const number = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        return number > 0 && number <= 0x10ffff && (number < 0xd800 || number > 0xdfff) ? String.fromCodePoint(number) : match;
      });
  }
  function visible() {
    return component.__active && component._host?.isConnected && component._host.style.display !== 'none';
  }
  function current(link, entry) {
    return !!entry && visible() && component.getRoot().contains(link)
      && link.dataset.kind === entry.kind && link.dataset.target === entry.target;
  }
  function valid(task) {
    return pending === task && task.generation === generation && task.selection === component.selectedAchId && current(task.link, links.get(task.link));
  }
  function invalidate() {
    generation++;
    const task = pending; pending = null;
    task?.link.removeAttribute('aria-busy');
    task?.settle?.(false); task?.prompt?.remove();
    cancelPending();
  }
  function confirm(task, entry) {
    return new Promise(resolve => {
      let settled = false;
      const finish = approved => {
        if (settled) return;
        settled = true; task.settle = null;
        resolve(approved === true && valid(task));
      };
      task.settle = finish;
      try {
        const prompt = showPrompt(`是否传送到${entry.label || entry.target}？\n${entry.target}`, () => finish(true), () => finish(false));
        if (!prompt) { finish(false); return; }
        task.prompt = prompt;
        const onRemove = prompt.onRemove;
        prompt.onRemove = function (...args) {
          globalThis.queueMicrotask(() => finish(false));
          return onRemove?.apply(this, args);
        };
        prompt.captureKeyEvents = true;
        prompt.onKeyDown = function (event) {
          const key = event.key || ({ 13: 'Enter', 27: 'Escape', 32: ' ' })[event.which];
          if (!['Enter', 'Escape', ' '].includes(key)) return true;
          event.preventDefault(); event.stopImmediatePropagation();
          if (event.repeat || event.isComposing || event.keyCode === 229 || event.which === 229
            || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return false;
          const button = prompt.getRoot?.().activeElement?.closest?.('button.btn');
          if (key !== 'Escape' && button) { button.click(); return false; }
          if (key === ' ') return false;
          finish(key === 'Enter'); prompt.remove(); return false;
        };
        prompt._bindKeyDown?.();
      } catch (error) { finish(false); report(error); }
    });
  }
  async function request(link) {
    const entry = links.get(link);
    if (!current(link, entry) || pending) return false;
    const task = { link, generation, selection: component.selectedAchId };
    pending = task; link.setAttribute('aria-busy', 'true');
    try {
      if (entry.kind === 'monster') {
        await showMonster(entry.target);
        return true;
      }
      if (shouldConfirmTeleport() !== false && !await confirm(task, entry)) return false;
      if (!valid(task)) return false;
      task.approved = true;
      return await teleport(entry.target) === true;
    } catch (error) { if (valid(task)) report(error); return false; }
    finally {
      if (pending === task) pending = null;
      link.removeAttribute('aria-busy');
    }
  }
  function render(parent, value) {
    const raw = normalize(value), doc = parent.ownerDocument;
    const expression = /<span\s+class\s*=\s*(['"])(goto|smob|sitem)\1\s*>([^<>]*)<\/span>/gi;
    parent.replaceChildren();
    let index = 0;
    for (const match of raw.matchAll(expression)) {
      parent.append(doc.createTextNode(text(raw.slice(index, match.index))));
      const kind = match[2].toLowerCase(), content = text(match[3]).trim();
      const target = kind === 'goto' ? content.toLowerCase().replace(/\.(gat|rsw)$/i, '') : content;
      if (kind === 'sitem' || !content || (kind === 'goto' && !/^[a-z0-9_@#-]{1,16}$/.test(target))) {
        parent.append(doc.createTextNode(content));
      } else {
        const link = doc.createElement('a');
        link.className = 'lastro-achievement-link'; link.href = '#';
        link.dataset.kind = kind === 'goto' ? 'map' : 'monster'; link.dataset.target = target;
        let label = content;
        if (kind === 'goto') { try { label = String(mapLabel?.(target) || content); } catch (error) { report(error); } }
        link.textContent = content;
        link.title = kind === 'goto' ? `传送到${label}（${target}）` : `搜索怪物：${label}`;
        links.set(link, { kind: link.dataset.kind, target, label });
        for (const type of ['mousedown', 'touchstart']) link.addEventListener(type, event => event.stopPropagation());
        link.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void request(link); });
        link.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault(); event.stopImmediatePropagation();
          if (!event.repeat && !event.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) void request(link);
        });
        parent.append(link);
      }
      index = match.index + match[0].length;
    }
    parent.append(doc.createTextNode(text(raw.slice(index))));
  }
  function canSend(mapname) {
    const entry = pending && links.get(pending.link);
    return !!entry && pending.approved === true && entry.kind === 'map' && entry.target === mapname && valid(pending);
  }
  for (const method of ['renderDetail', 'renderList', 'renderOverview', 'toggle', 'onRemove']) {
    const original = component[method];
    component[method] = function (...args) { invalidate(); return original?.apply(this, args); };
  }
  component._lastroAchievementLinks = { render, request, invalidate, canSend };
  return component._lastroAchievementLinks;
}

export function patchRuntimeAchievementLinks(source, resourceLoaderCode) {
  const marker = '//#region src/UI/Components/Achievement/Achievement.js', start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  const fail = () => { throw new Error('anchor:achievement-links'); };
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0 || source.includes('lastroAchievementMapPreflight')) fail();
  let region = source.slice(start, end);
  const file = ts.createSourceFile('Achievement.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left.getText(file), right = node.right.getText(file);
      if (left === 'root.querySelector(".js-d-desc").textContent' && right.includes('info.content.details'))
        edits.push({ start: node.getStart(file), end: node.end, text: `this._lastroAchievementLinks.render(root.querySelector(".js-d-desc"), ${right})` });
      if (left === 'g.textContent' && right === 'res.text')
        edits.push({ start: node.getStart(file), end: node.end, text: 'this._lastroAchievementLinks.render(g, res.text)' });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (edits.length !== 2) fail();
  for (const edit of edits.sort((a, b) => b.start - a.start)) region = region.slice(0, edit.start) + edit.text + region.slice(edit.end);
  function replace(needle, value) { if (region.split(needle).length !== 2) fail(); region = region.replace(needle, value); }
  replace('  init_ItemInfo();', '  init_ItemInfo(); init_Thread(); init_Configs(); init_MapRenderer(); init_WorldMap(); init_MouseEventHandler(); init_NpcBox(); init_NpcMenu(); init_InputBox();');
  replace('Achievement_default = UIManager.addComponent(Achievement);', `
  const lastroAchievementMapPreflight = (${createLastroTeleportPreflight.toString()})({
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    getProfile: () => String(Configs.get("lastroNid", 0)) + ":" + String(Configs.get("clientVer", 0)),
    loadFile: ${resourceLoaderCode},
  });
  const lastroAchievementMapTeleport = (${createLastroWorldMapTeleport.toString()})({
    preflight: lastroAchievementMapPreflight,
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    getProfile: () => String(Configs.get("lastroNid", 0)) + ":" + String(Configs.get("clientVer", 0)),
    onSameMap: () => showLastroTeleportNotice("已在目标地图。"),
    send: mapname => {
      if (!Achievement._lastroAchievementLinks.canSend(mapname)) { const error = new Error("传送检查已取消"); error.name = "AbortError"; throw error; }
      if (!PACKET.CZ.PRIVATE_AIRSHIP_REQUEST) throw new Error("当前客户端不支持传送");
      const packet = new PACKET.CZ.PRIVATE_AIRSHIP_REQUEST();
      Object.assign(packet, buildPrivateAirshipRequest({ mapname }));
      Network.sendPacket(packet);
    },
    onError: error => {
      if (error?.resource) { const diagnostic = describeLastroMapLoadFailure("", error); UIManager.showErrorBox("传送失败：" + diagnostic.reason + "。\\n文件：" + error.resource); }
      else UIManager.showErrorBox(error.message || "传送地点检查失败，请重试。");
    },
  });
  (${installLastroAchievementLinks.toString()})(Achievement, {
    mapLabel: mapname => DB.getMapName(mapname + ".gat", mapname),
    shouldConfirmTeleport: () => typeof getLastroTeleportConfirmationEnabled !== "function" || getLastroTeleportConfirmationEnabled(),
    showMonster: name => WorldMap_default.searchMonster({ name }),
    teleport: mapname => lastroAchievementMapTeleport.request(mapname),
    cancelPending: () => lastroAchievementMapTeleport.cancelPending(),
    showPrompt: (message, yes, no) => {
      const intersect = Mouse.intersect, freeze = SessionStorage_default.FreezeUI, input = InputBox_default;
      const active = dialog => dialog.__active && dialog._host?.isConnected && dialog._host.style.display !== "none";
      const paused = active(input);
      const restore = () => { if (paused && active(input)) input._bindKeyDown?.(); };
      if (paused) input._unbindKeyDown?.();
      let prompt;
      try { prompt = UIManager.showPromptBox(message, "ok", "cancel", yes, no); } catch (error) { restore(); throw error; }
      const remove = prompt.remove;
      prompt.remove = function (...args) {
        const result = remove.apply(this, args); restore();
        if ([Achievement, NpcBox_default, NpcMenu_default, InputBox_default].some(active)) { Mouse.intersect = intersect; SessionStorage_default.FreezeUI = freeze; }
        return result;
      };
      return prompt;
    },
    onError: error => UIManager.showErrorBox(error.message || "成就链接暂时无法使用，请重试。"),
  });
  Achievement_default = UIManager.addComponent(Achievement);`);
  const css = 'a.lastro-achievement-link{color:inherit;text-decoration:underline;cursor:pointer}a.lastro-achievement-link:focus-visible{outline:1px solid currentColor;outline-offset:1px}a.lastro-achievement-link[aria-busy]{opacity:.7;cursor:wait}.js-d-desc,.d-goal-item{white-space:pre-wrap}';
  replace('super("Achievement", Achievement_default$1);', `super("Achievement", Achievement_default$1 + ${JSON.stringify('\n' + css)});`);
  return source.slice(0, start) + region + source.slice(end);
}
