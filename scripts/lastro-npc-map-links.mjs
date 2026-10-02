import { createLastroTeleportPreflight } from './lastro-teleport-preflight.mjs';
import { createLastroWorldMapTeleport } from './lastro-worldmap-teleport.mjs';

export function installLastroNpcMapLinks(component, { setHtml, labelFor, showPrompt, shouldConfirmTeleport = () => true, teleport, cancelPending, canActivate = () => true, onError }) {
  let generation = 0, pending = null;
  const links = new WeakMap();

  function report(error) {
    try { onError?.(error); } catch { /* Keep native dialog controls usable. */ }
  }

  function invalidate() {
    generation++;
    const task = pending;
    pending = null;
    task?.link.removeAttribute('aria-busy');
    task?.settle?.(false);
    task?.prompt?.remove();
    cancelPending();
  }

  function current(link, entry) {
    return entry && entry.generation === generation && entry.owner === component.ownerID
      && component.__active && component._host?.isConnected && component._host.style.display !== 'none'
      && component.getRoot().contains(link) && link.dataset.map === entry.mapname;
  }

  function confirm(task, entry) {
    return new Promise(resolve => {
      let settled = false;
      const finish = approved => {
        if (settled) return;
        settled = true;
        task.settle = null;
        resolve(approved === true && pending === task && !!current(task.link, entry));
      };
      task.settle = finish;
      try {
        const prompt = showPrompt(`是否传送到${task.link.textContent || entry.mapname}？\n${entry.mapname}`, () => finish(true), () => finish(false));
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
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.repeat || !activationKey(event)) return false;
          const button = prompt.getRoot?.().activeElement?.closest?.('button.btn');
          if (key !== 'Escape' && button) { button.click(); return false; }
          if (key === ' ') return false;
          finish(key !== 'Escape');
          prompt.remove();
          return false;
        };
        prompt._bindKeyDown?.();
      } catch (error) { finish(false); report(error); }
    });
  }

  async function request(link) {
    const entry = links.get(link);
    if (!current(link, entry) || pending) return false;
    const task = { link, generation, owner: component.ownerID };
    pending = task;
    link.setAttribute('aria-busy', 'true');
    try {
      if (shouldConfirmTeleport() !== false && !await confirm(task, entry)) return false;
      if (pending !== task || !current(link, entry)) return false;
      task.approved = true;
      const approved = await teleport(entry.mapname);
      if (task.committed) return approved === true;
      if (pending !== task || !current(link, entry)) return false;
      if (approved !== true) return false;
      component.close();
      return true;
    } catch (error) {
      if (pending === task && task.generation === generation) report(error);
      return false;
    } finally {
      if (pending === task) pending = null;
      link.removeAttribute('aria-busy');
    }
  }

  function render(parent, value, formatText) {
    const text = value == null ? '' : String(value);
    const token = globalThis.crypto.randomUUID();
    const targets = [];
    const marked = text.replace(/\^nMapName\^([^\r\n]*)/g, (match, mapValue) => {
      const mapname = mapValue.trim().toLowerCase().replace(/\.(gat|rsw)$/i, '');
      if (!/^[a-z0-9_@#-]{1,16}$/.test(mapname)) return mapValue;
      targets.push(mapname);
      return `<span data-lastro-npc-map="${token}-${targets.length - 1}"></span>`;
    });
    setHtml(parent, formatText(marked));
    targets.forEach((mapname, index) => {
      const placeholder = parent.querySelector(`span[data-lastro-npc-map="${token}-${index}"]`);
      if (!placeholder) return;
      if (placeholder.closest('.item-link,.navi-link')) {
        placeholder.replaceWith(parent.ownerDocument.createTextNode(mapname));
        return;
      }
      const link = parent.ownerDocument.createElement('a');
      let label = mapname;
      try { label = String(labelFor?.(mapname) || mapname); } catch (error) { report(error); }
      link.className = 'lastro-npc-map-link';
      link.href = '#';
      link.dataset.map = mapname;
      link.textContent = label;
      link.title = `传送到${label}（${mapname}）`;
      links.set(link, { mapname, owner: component.ownerID, generation });
      placeholder.replaceWith(link);
    });
    for (const link of parent.querySelectorAll('.lastro-npc-map-link')) {
      if (!links.has(link)) link.replaceWith(parent.ownerDocument.createTextNode(link.textContent || ''));
    }
  }

  function canSend(mapname) {
    const entry = pending && links.get(pending.link);
    return !!entry && pending.approved === true && entry.mapname === mapname && !!current(pending.link, entry);
  }

  function commit(mapname, send) {
    if (!canSend(mapname)) {
      const error = new Error('传送检查已取消');
      error.name = 'AbortError';
      throw error;
    }
    const task = pending;
    component.close();
    send();
    task.committed = true;
  }

  function eventLink(event, allowFocused = true) {
    const root = component.getRoot();
    const link = event.target?.closest?.('a.lastro-npc-map-link')
      || (allowFocused && root.activeElement?.closest?.('a.lastro-npc-map-link'));
    return link && links.has(link) ? link : null;
  }

  function activationKey(event) {
    return !event.isComposing && event.keyCode !== 229 && event.which !== 229
      && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  }

  const init = component.init;
  component.init = function (...args) {
    const result = init?.apply(this, args);
    const root = this.getRoot();
    root.addEventListener('click', event => {
      const link = eventLink(event, false);
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void request(link);
    }, true);
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!canActivate() || !activationKey(event)) return;
      const link = eventLink(event);
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) void request(link);
    }, true);
    return result;
  };
  const onKeyDown = component.onKeyDown;
  component.onKeyDown = function (event) {
    const link = eventLink(event);
    if (link && (event.key === 'Enter' || event.key === ' ' || event.which === 13 || event.which === 32)) {
      if (!canActivate() || !activationKey(event)) return true;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) void request(link);
      return false;
    }
    return onKeyDown?.call(this, event);
  };
  for (const name of ['next', 'close', 'onRemove']) {
    const original = component[name];
    component[name] = function (...args) {
      invalidate();
      return original?.apply(this, args);
    };
  }
  for (const [name, ownerIndex] of [['setText', 1], ['addNext', 0], ['addClose', 0]]) {
    const original = component[name];
    component[name] = function (...args) {
      if (component.ownerID !== args[ownerIndex]) invalidate();
      return original?.apply(this, args);
    };
  }
  component._lastroMapLinks = { render, invalidate, request, canSend, commit };
  return component._lastroMapLinks;
}

export function patchRuntimeNpcMapLinks(source, resourceLoaderCode) {
  const marker = '//#region src/UI/Components/NpcBox/NpcBox.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:npc-map-links');
  let region = source.slice(start, end);
  const replace = (needle, replacement) => {
    if (region.split(needle).length !== 2) throw new Error('anchor:npc-map-links:' + needle);
    region = region.replace(needle, replacement);
  };
  replace('NpcBox = new GUIComponent("NpcBox", NpcBox_default$1);', `
  init_DBManager(); init_NetworkManager(); init_PacketStructure(); init_MapRenderer(); init_Thread(); init_Configs(); init_MouseEventHandler(); init_SessionStorage();
  NpcBox_default$1 += "\\na.lastro-npc-map-link{color:#0070c0;text-decoration:underline;cursor:pointer}a.lastro-npc-map-link:hover{color:#00a0ff}a.lastro-npc-map-link:focus-visible{outline:1px solid #0070c0;outline-offset:1px}a.lastro-npc-map-link[aria-busy]{opacity:.7;cursor:wait}";
  NpcBox = new GUIComponent("NpcBox", NpcBox_default$1);`);
  replace('div.innerHTML = processText(text);', 'NpcBox._lastroMapLinks.render(div, text, processText);');
  replace('NpcBox_default = UIManager.addComponent(NpcBox);', `
  const lastroNpcMapPreflight = (${createLastroTeleportPreflight.toString()})({
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    getProfile: () => String(Configs.get("lastroNid", 0)) + ":" + String(Configs.get("clientVer", 0)),
    loadFile: ${resourceLoaderCode},
  });
  const lastroNpcMapTeleport = (${createLastroWorldMapTeleport.toString()})({
    preflight: lastroNpcMapPreflight,
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    getProfile: () => String(Configs.get("lastroNid", 0)) + ":" + String(Configs.get("clientVer", 0)),
    onSameMap: () => showLastroTeleportNotice("已在目标地图。"),
    send: mapname => {
      if (!NpcBox._lastroMapLinks.canSend(mapname)) {
        const error = new Error("传送检查已取消");
        error.name = "AbortError";
        throw error;
      }
      if (!PACKET.CZ.PRIVATE_AIRSHIP_REQUEST) throw new Error("当前客户端不支持传送");
      const packet = new PACKET.CZ.PRIVATE_AIRSHIP_REQUEST();
      Object.assign(packet, buildPrivateAirshipRequest({ mapname }));
      NpcBox._lastroMapLinks.commit(mapname, () => Network.sendPacket(packet));
    },
    onError: error => {
      console.warn("[LastRO] NPC map teleport check failed", error);
      if (error?.resource) {
        const diagnostic = describeLastroMapLoadFailure("", error);
        UIManager.showErrorBox("传送失败：" + diagnostic.reason + "。\\n文件：" + error.resource);
      } else UIManager.showErrorBox(error.message || "传送地点检查失败，请重试。");
    },
  });
  (${installLastroNpcMapLinks.toString()})(NpcBox, {
    setHtml: (parent, html) => setLastROInnerHTML(parent, html),
    labelFor: mapname => DB.getMapName(mapname + ".gat", mapname),
    shouldConfirmTeleport: () => typeof getLastroTeleportConfirmationEnabled !== "function" || getLastroTeleportConfirmationEnabled(),
    showPrompt: (message, yes, no) => {
      const intersect = Mouse.intersect, freeze = SessionStorage_default.FreezeUI;
      const input = InputBox_default;
      const inputPaused = input.__active && input._host?.isConnected && input._host.style.display !== "none";
      const restoreInput = () => { if (inputPaused && input.__active && input._host?.isConnected && input._host.style.display !== "none") input._bindKeyDown?.(); };
      if (inputPaused) input._unbindKeyDown?.();
      let prompt;
      try { prompt = UIManager.showPromptBox(message, "ok", "cancel", yes, no); }
      catch (error) { restoreInput(); throw error; }
      const remove = prompt.remove;
      prompt.remove = function (...args) {
        const result = remove.apply(this, args);
        restoreInput();
        if ([NpcBox, NpcMenu_default, InputBox_default].some(dialog => dialog.__active && dialog._host && dialog._host.style.display !== "none")) {
          Mouse.intersect = intersect;
          SessionStorage_default.FreezeUI = freeze;
        }
        return result;
      };
      return prompt;
    },
    teleport: mapname => lastroNpcMapTeleport.request(mapname),
    cancelPending: () => lastroNpcMapTeleport.cancelPending(),
    canActivate: () => ![NpcMenu_default, InputBox_default].some(dialog => dialog.__active && dialog._host && dialog._host.style.display !== "none"),
    onError: error => UIManager.showErrorBox(error.message || "传送失败，请重试。"),
  });
  NpcBox_default = UIManager.addComponent(NpcBox);`);
  return source.slice(0, start) + region + source.slice(end);
}
