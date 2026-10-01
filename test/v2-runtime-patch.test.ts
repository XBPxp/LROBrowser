import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { patchGuildEmblemRequestCallbacks, patchLegacyScriptSinks, patchLuaJsonEscapes, patchNpcMenuBlankArea, patchTrustedTypesDomWrites, patchV2Runtime, patchWebAudioPlayback, patchRuntimeWorldMap, patchRuntimeChatMapLinks, patchRuntimeToolsPanels } from '../scripts/patch-v2-runtime.mjs';
import { buildClientConfig } from '../src/runtime/client-config';
import { LASTRO_SERVER_PROFILES } from '../src/servers/server-profiles';
import { createLastroUiMessages } from '../scripts/lastro-ui-messages.mjs';

const profile = LASTRO_SERVER_PROFILES[0];
if (!profile || profile.availability !== 'available') throw new Error('missing fixture profile');

async function nativeCacheRegions() {
  const native = await readFile(new URL('../vendor/v2/Online.js', import.meta.url), 'utf8');
  return ['src/Core/MemoryItem.js', 'src/Core/MemoryManager.js', 'src/Core/Preferences.js'].map(name => {
    const start = native.indexOf('//#region ' + name), end = native.indexOf('//#endregion', start);
    if (start < 0 || end < start) throw new Error('Missing native cache region: ' + name);
    return native.slice(start, end + '//#endregion'.length);
  });
}

describe('V2 runtime patch', () => {
  it.each([
    'function cleanGameUI() {}',
    'UIManager.addComponent(LastROTools); function cleanGameUI() {}',
    'UIManager.addComponent(LastROTools); var MapRenderer = class MapRenderer { static setMap() { UIManager.removeComponents(); } };',
    'UIManager.addComponent(LastROTools); UIManager.addComponent(LastROTools); var MapRenderer = class MapRenderer { static setMap() { UIManager.removeComponents(); } }; function cleanGameUI() {}',
  ])('rejects missing or ambiguous tools/map lifecycle anchors', source => {
    expect(() => patchRuntimeToolsPanels(source)).toThrow('anchor:lastro-tools-panels');
  });
  it('installs native tools and preserves navigation across map UI teardown in the pinned runtime', async () => {
    const source = await readFile(new URL('../vendor/v2/Online.js', import.meta.url), 'utf8');
    const patched = patchRuntimeToolsPanels(source);
    expect(patched).toContain('getMap: () => normalizeLastROTeleportMap(MapRenderer.currentMap)');
    expect(patched).toContain('routeMapChanged: () => lastroRouteNavigation.onMapChanged()');
    expect(patched).toMatch(/onMapChanging\(\);\s*UIManager\.removeComponents\(\)/);
    expect(patched).toMatch(/function cleanGameUI\(\) \{\s*if .*?\.cancelRoute\(\);/);
    expect(patched).toContain('胖大海');
    expect(patched).not.toContain('https://game.lastro.cn/ro/src/DB/logsTable.js');
    const installation = patched.slice(patched.indexOf('const lastroSendRouteTeleport ='), patched.indexOf('UIManager.addComponent(LastROTools)'));
    const ast = ts.createSourceFile('tools-install.js', installation, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let catalogSelector = '', locationSelector = '';
    function findCatalog(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'getPresetRoutes') catalogSelector = node.initializer.getText(ast);
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'getCurrentLocation') locationSelector = node.initializer.getText(ast);
      ts.forEachChild(node, findCatalog);
    }
    findCatalog(ast);
    const presets = JSON.parse(await readFile(new URL('../scripts/lastro-teleport-routes.json', import.meta.url), 'utf8'));
    const appCatalog = new Function('Configs', 'LastROTeleportPresets', `return (${catalogSelector})();`)({ get: (name: string) => name === 'clientVer' ? 5 : 6 }, presets);
    const kafra = Object.values(appCatalog.npc).find((row: unknown) => (row as { npc: string }).npc.startsWith('卡普拉'));
    expect(kafra).toMatchObject({ outset: ['prontera', 149, 89], path: [['prontera', 149, 89]] });
    expect(Object.keys(appCatalog.custom)).toHaveLength(150);
    expect(appCatalog.custom['upstream:guide:treasureHunt']).toMatchObject({ outset: ['pay_fild11', 125, 175] });
    const unknownCatalog = new Function('Configs', 'LastROTeleportPresets', `return (${catalogSelector})();`)({ get: () => 999 }, presets);
    expect(unknownCatalog).toEqual({});
    const renderer = { currentMap: 'Prontera.gat', loading: false };
    const session: { Entity?: { position: Float32Array } } = { Entity: { position: new Float32Array([156.9, 182.3, 0]) } };
    const getLocation = () => new Function('MapRenderer', 'SessionStorage_default', 'normalizeLastROTeleportMap', `return (${locationSelector})();`)(renderer, session, (map: string) => map.toLowerCase().replace(/\.gat$/, ''));
    expect(getLocation()).toEqual({ map: 'prontera', x: 156, y: 182 });
    renderer.loading = true; expect(getLocation()).toBeUndefined();
    renderer.loading = false; session.Entity!.position[0] = Number.NaN; expect(getLocation()).toBeUndefined();
    delete session.Entity; expect(getLocation()).toBeUndefined();
  }, 20000);
  it('requires unambiguous chat-map integration anchors on upstream updates', () => {
    expect(() => patchRuntimeChatMapLinks('function requestChatMapTeleport(link) { return false; }')).toThrow('anchor:chat-map-links');
  });
  it('requires an unambiguous world-map anchor on upstream updates', () => {
    expect(() => patchRuntimeWorldMap('unrecognized upstream source')).toThrow('anchor:worldmap-component');
  });
  it('routes BGM and sound effects through decoded Web Audio buffers', async () => {
    const source = [
      ...await nativeCacheRegions(),
      'var BGM = class BGM {',
      '  static audio = document.createElement("audio");',
      '  static load(url) { BGM.audio.src = url; BGM.audio.play(); }',
      '  static stop() { BGM.audio.pause(); }',
      '};',
      'var SoundManager = class SoundManager {',
      '  static play(filename, vol) { const audio = document.createElement("audio"); audio.src = filename; audio.play(); }',
      '  static stop(filename) { return filename; }',
      '};',
      'function createRainAudio() { this.audioCtx = new AudioContext(); }',
    ].join('\n');
    const patched = patchWebAudioPlayback(source);
    expect(patched).toContain('LastROWebAudio.playBgm');
    expect(patched).toContain('LastROWebAudio.playSound');
    expect(patched).not.toContain('document.createElement("audio")');
    expect(patched).not.toContain('BGM.audio.play()');
    expect(patched).not.toContain('audio.play().catch');
    expect(patched).toContain('decodeAudioData');
    expect(patched).toContain('source.loop = true');
  });

  it('loads message IDs and quoted-comma values from the local CSV', async () => {
    const runtime = await readFile('generated/runtime/Online.js', 'utf8');
    const csv = await readFile('vendor/core/data/msgstringtable.csv', 'utf8');
    const start = runtime.indexOf('function loadCSV(filename, targetTable, keyIndex, valueIndex, onEnd) {');
    const end = runtime.indexOf('\n/**', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const client = { loadFile: (_filename: string, callback: (bytes: Uint8Array) => void) => callback(new TextEncoder().encode(csv)) };
    const codepageManager = { decode: (bytes: Uint8Array) => new TextDecoder().decode(bytes) };
    const loadCSV = new Function('Client', 'CodepageManager', 'LastROUiMessages', `${runtime.slice(start, end)}; return loadCSV;`)(client, codepageManager, createLastroUiMessages());
    const table: Record<number, string> = {};
    loadCSV('data/msgstringtable.csv', table, 0, 1, () => undefined);
    expect(table[3723]).toBe('※制作[%s] %d~%d个');
    expect(table[62]).toBe('没有接收 ,拒绝悄悄话讯息的人物名单');
    expect(runtime).toContain('data/msgstringtable.txt');
    expect(runtime).toContain('() => loadCSV("data/msgstringtable.csv", MsgStringTable, 0, 1, loadmsg)');
  }, 30000);

  it('keeps guild emblem callback arguments image-first', () => {
    const source = 'this.onSuccess(entry.guildId, entry.version, entry.image, entry.gif);';
    expect(patchGuildEmblemRequestCallbacks(source)).toBe('this.onSuccess(entry.guildId, entry.image, entry.gif);');
  });

  it('ignores blank-area NPC menu clicks in regenerated runtimes', () => {
    const source = [
      'content.addEventListener("mousedown", (e) => {',
      '  const div = e.target.closest("div");',
      '  if (div && content.contains(div)) selectIndex(div);',
      '});',
      'content.addEventListener("dblclick", (e) => {',
      '  const div = e.target.closest("div");',
      '  if (div && content.contains(div)) validate();',
      '});',
    ].join('\n');
    const patched = patchNpcMenuBlankArea(source);
    expect(patched).toContain('if (!div?.dataset?.index || !content.contains(div)) return;');
    expect(patched).toContain('if (div?.dataset?.index && content.contains(div)) validate();');
  });

  it('escapes Lua control characters before converting tables to JSON', () => {
    const source = String.raw`local function escape_str(str)
	return str:gsub("\\", "\\\\"):gsub("\"", "\\\"")
end`;
    const patched = patchLuaJsonEscapes(source);
    expect(patched).toContain(String.raw`:gsub("\b", "\\b")`);
    expect(patched).toContain(String.raw`:gsub("\f", "\\f")`);
    expect(patched).toContain(String.raw`:gsub("\n", "\\n")`);
    expect(patched).toContain(String.raw`:gsub("\r", "\\r")`);
    expect(patched).toContain(String.raw`:gsub("\t", "\\t")`);
    expect(patched).toContain(String.raw`:gsub("%c", function(char)`);
    expect(patched).toContain(String.raw`string.format("\\u%04x", string.byte(char))`);
  });

  it('removes legacy html2canvas proxy and FlashCanvas script sinks', () => {
    const source = [
      'function proxyGetImage(url, img, imageObj) {',
      '  let script = document.createElement("script");',
      '  script.setAttribute("src", options.proxy);',
      '  document.body.appendChild(script);',
      '}',
      '_html2canvas.Renderer.Canvas = function(options) {',
      '  let canvas = document.createElement("canvas");',
      '  if (canvas.getContext) { canvasReadyToDraw = true; }',
      '  else if (options.flashcanvas !== undefined) {',
      '    let script = document.createElement("script");',
      '    script.src = options.flashcanvas;',
      '    document.body.appendChild(script);',
      '  }',
      '  methods = { _create() {} };',
      '};',
    ].join('\n');
    const patched = patchLegacyScriptSinks(source);
    expect(patched).not.toContain('createElement("script")');
    expect(patched).not.toContain('options.proxy');
    expect(patched).not.toContain('options.flashcanvas');
  });

  it('rewrites executable DOM HTML sinks, including Background.setImage', () => {
    const source = [
      'class Background {',
      '  static setImage() { _container.innerHTML = ""; }',
      '  static replace() { node.outerHTML = html; }',
      '  static append() { node.insertAdjacentHTML("beforeend", html); }',
      '  static appendText() { node.innerHTML += html; }',
      '}',
    ].join('\n');
    const patched = patchTrustedTypesDomWrites(source);
    expect(patched).toContain('setLastROInnerHTML(_container, "")');
    expect(patched).toContain('setLastROOuterHTML(node, html)');
    expect(patched).toContain('setLastROAdjacentHTML(node, "beforeend", html)');
    expect(patched).not.toContain('_container.innerHTML =');
    expect(patched).not.toContain('node.outerHTML =');
    expect(patched).not.toContain('node.insertAdjacentHTML(');
    expect(patched).not.toContain('node.innerHTML +=');
  });

  it('replaces the factory and removes legacy initialization regions', async () => {
    const fixture = [
      'import { existing } from "./existing.mjs?build=fixture-1";',
      ...await nativeCacheRegions(),
      'var root = freeGlobal || freeSelf || Function("return this")();',
      'var Common_default$1 = "body {\\r\\n\\tfont-size: 12px;\\r\\n\\tfont-family: \'SCDream\', Arial, sans-serif;\\r\\n\\tfont-size-adjust: 0.5186;\\r\\n}\\r\\n:host {\\r\\n\\ttouch-action: manipulation;\\r\\n}";',
      'function drawLabel(ctx) { ctx.font = "10px Arial"; }',
      'var BGM = class BGM { static audio = document.createElement("audio"); static load(url) { BGM.audio.src = url; BGM.audio.play(); } };',
      'var SoundManager = class SoundManager { static play() { const audio = document.createElement("audio"); audio.play(); } };',
      'function createRainAudio() {',
      '\tconst AudioContext = window.AudioContext || window.webkitAudioContext;',
      '\tthis.audioCtx = new AudioContext();',
      '}',
      'function compileTemplate(importsKeys, sourceURL, source, importsValues) { return Function(importsKeys, sourceURL + "return " + source).apply(undefined, importsValues); }',
      'function addPreloader(el) { el.innerHTML = PRELOADER_INNER_HTML; }',
      '/** Earlier runtime documentation */\nconst retainedRuntime = 1;',
      '//#region src/Network/SocketHelpers/WebSocket.js\nfunction Socket$1() {}\n//#endregion',
      '//#region src/Network/SocketHelpers/NodeSocket.js\nvar Socket;\n//#endregion',
      '//#region src/UI/Components/WorldMap/WorldMap.js\nvar WorldMap;\n//#endregion',
      'function defaultSocketFactory(host, port) { return new Socket(host, port); }',
      'function requestChatMapTeleport(link) { return false; }',
      'function flushMessageBuffer() { messages.forEach(msg => { const div = document.createElement("div"); if (!msg.override) div.textContent = msg.text; else div.innerHTML = msg.text; }); }',
      'ChatBox.addText = function addText(text, override) { text = text.replace(/<ITEMLINK>.*?<\\/ITEMLINK>/gi, function(match) { return match; }); if (!override && /mapname/.test(text)) override = true; };',
      'function onMapClick(event, mapLink) { if (requestChatMapTeleport(mapLink)) { event.preventDefault(); event.stopImmediatePropagation(); } }',
      'UIManager.addComponent(LastROTools);',
      'UIManager.addComponent(GraphicsOption);',
      'Navigation.waitForMapData = function waitForMapData(callback) { setTimeout(() => Navigation.waitForMapData(callback), 100); };',
      'Navigation.navigateTo = function navigateTo(options) { _finalTargetData = {map: options.endMap}; this.waitForMapData(function () { this.findPath(); }); };',
      'var MapRenderer = class MapRenderer { static setMap(mapname) { UIManager.removeComponents(); } };',
      'function onMapComplete(success,error) { if (!success) { UIManager.showErrorBox(error).ui.css("zIndex", 1e3); return; } }',
      'function cleanGameUI() {}',
      'function onGlobalAnnounce(pkt) { Announce_default.set(pkt.msg, "#FFFF00"); }',
      'function onPlayerMessage(pkt) { ChatBox_default.addText(pkt.msg); }',
      'function onEntityTalkColor(pkt) { ChatBox_default.addText(pkt.msg); }',
      'function onConnectionRequest(username, password) {',
      '  SoundManager.play("fixture-login.wav");',
      '  Network.connect(_server.address, _server.port, (success) => {',
      '    if (!success) {',
      '      return;',
      '    }',
      '    let pkt;',
      '    function sendLogin() {',
      '      if (Configs.get("loginMode") == "han") {',
      '        pkt = new PACKET.CA.LOGIN_HAN();',
      '        Network.sendPacket(pkt);',
      '      } else {',
      '        pkt = new PACKET.CA.LOGIN();',
      '        Network.sendPacket(pkt);',
      '      }',
      '    }',
      '  });',
      '}',
      'function initializeLoginConfig() {',
      '      const autoLogin = Configs.get("autoLogin");',
      '      if (autoLogin instanceof Array && autoLogin[0] && autoLogin[1]) {',
      '        onConnectionRequest.apply(null, autoLogin);',
      '        Configs.set("autoLogin", null);',
      '      }',
      '}',
      'function initializeNetworkDebug() {',
      '  packetDump = Configs.get("packetDump", false);',
      '}',
      'Plugins.init = function initPlugins() { this.list = Configs.get("plugins", []); };',
      '//#region src/UI/Components/Storage/Fixture.js',
      'function renderStorageListFixture() { nameSpan.innerHTML = DB.getItemName(item); }',
      'function renderStorageGridFixture() { nameSpan.innerHTML = DB.getItemName(item); }',
      'function renderStorageListOverlayFixture() { overlay.innerHTML = `${DB.getItemName(item)} ${item.count || 1}${getItemCountUnit()}`; }',
      'function renderStorageGridOverlayFixture() { overlay.innerHTML = `${DB.getItemName(item)} ${item.count || 1}${getItemCountUnit()}`; }',
      '//#endregion',
      'function renderCharacterFixture() { charCanvases[i].querySelector(".name").innerHTML = _slots[i] ? _slots[i].name : ""; }',
      'function init_NetworkManager() { init_WebSocket(); init_NodeSocket(); }',
      'function init() {\n\troInitSpinner.add();\n\tPlugins.init();\n\tGameEngine.init();\n}',
      'function initThread() {\n\tif (!_source) _source = new Worker(new URL(\n\t\t/* @vite-ignore */\n\t\t"" + new URL("LastROThreadEventHandler.js", import.meta.url).href,\n\t\t"" + import.meta.url\n\t), { type: "classic" });\n\tif (_source instanceof Worker) _source.addEventListener("message", Thread.receive, false);\n}',
      'function initializePathFindingWorker() { const workerUrl = new URL("PathFindingWorker.js", import.meta.url).href; return new Worker(workerUrl); }',
      'function loadXMLFile(filename, callback, onEnd) {}',
      'function loadLuaValue(file_path, variable_name, callback, onEnd) { Client.loadFile(file_path, function(file) {}); }',
      ...['map', 'npc', 'link', 'linkdistance', 'npcdistance'].map(table => `loadLuaValue(DB.LUA_PATH + "navigation/navi_${table}_krpri.lub", "Navi_Table", callback, onEnd);`),
      'function onReady() { _thread_ready = true; savingFiles(files); }',
      'function updateGamepads() { const gamepads = navigator.getGamepads ? navigator.getGamepads() : []; }',
      'function clientInit() { if (remoteClient) Thread.send("SET_HOST", remoteClient); }',
      'function loginInit() {\n\t\t\t\tThread.send("SET_HOST", remoteClient);\n}',
      'function loadFiles() { if (!Configs.get("remoteClient") && !count && !window.electronAPI?.isElectron) { alert("x"); } }',
      'function createWinLogin({ name, htmlText, cssText }) {',
      '\t\tconst Component = new GUIComponent(name, enhanceWinLoginStyles(name, cssText));',
      '\t\tconst renderedHtmlText = enhanceWinLoginTemplate(name, htmlText);',
      '\t\tvoid 0;',
      '\t\tpopulateLoginServerButtons(root, Configs.get("loginServerProfiles", []), Configs.getServer?.().id || "lastro", (profile) => Component.onServerSelect(profile));',
      '\t\tconst user = _inputUsername.value;',
      '\t\tconst pass = _inputPassword.value;',
      '\t\tapplyDebugLoginFields();',
      '\t}',
    ].join('\n');
    const patched = patchV2Runtime(fixture);
    const transpiled = ts.transpileModule(patched, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
      reportDiagnostics: true,
    });
    expect(transpiled.diagnostics ?? []).toEqual([]);
    expect(patched).toContain('globalThis.LastRODirectSocketFactory(host, port)');
    expect(patched).toContain("font-family: Arial, 'Microsoft YaHei', 'MiSans', 'LastRO Glyph Fallback', sans-serif");
    expect(patched).toContain("font-family: 'MiSans', Arial, sans-serif");
    expect(patched).toContain('font-size: 12px');
    expect(patched).toContain('font-size-adjust: none');
    expect(patched).toContain('ctx.font = "10px Arial"');
    expect(patched).toContain('Arial');
    expect(patched).toContain('function installLastROAudioUnlock()');
    expect(patched).toContain('installLastROAudioUnlock();\nimport { existing }');
    expect(patched).toContain('LastROWebAudio.playBgm');
    expect(patched).toContain('LastROWebAudio.playSound');
    expect(patched).not.toContain('document.createElement("audio")');
    expect(patched).not.toContain('BGM.audio.play()');
    expect(patched).not.toContain('audio.play().catch');
    expect(patched).toContain('this.audioCtx = LastROAudioRegisterContext(new AudioContext());');
    expect(patched).toContain('const resumeAudioContexts = () => {');
    expect(patched).toContain('lastro-account-login.mjs');
    expect(patched).toContain('installLastROLogin({ root, component: Component, configs: Configs })');
    expect(patched).toContain('beforeLastROLoginConnect(user, pass)');
    expect(patched).toContain('Network.sendPacket(pkt);\n        afterLastROLoginPassword(username, password);');
    expect(patched).not.toContain('globalThis.LastROLoginBeforeConnect');
    expect(patched).not.toContain('globalThis.LastROLoginAfterPassword');
    expect(patched).toContain('finally { autoLogin = null; }');
    expect(patched).toContain('packetDump = false;');
    expect(patched).not.toContain('Configs.get("plugins", [])');
    expect(patched).toContain('nameSpan.textContent = DB.getItemName(item)');
    expect(patched).toContain('globalThis;');
    expect(patched).toContain('Dynamic templates are disabled in the IWA runtime');
    expect(patched).toContain('trustedTypes.createPolicy("lastro-iwa-worker"');
    expect(patched).toContain('return policy.createScriptURL(workerUrl.href);');
    expect(patched).toContain('Unexpected worker URL');
    expect(patched).not.toContain('"" + new URL("LastROThreadEventHandler.js"');
    expect(patched).toContain('createLastROWorkerScriptUrl("LastROThreadEventHandler.js")');
    expect(patched).toContain('createLastROWorkerScriptUrl("PathFindingWorker.js")');
    expect(patched).not.toContain('new URL("PathFindingWorker.js", import.meta.url).href');
    expect(patched).toContain('span.textContent = character');
    expect(patched).toContain('el.append(spinner, text)');
    expect(patched).not.toContain('el.innerHTML = PRELOADER_INNER_HTML');
    expect(patched).toContain('const retainedRuntime = 1;');
    expect(patched).not.toContain('?build=');
    expect(patched).not.toMatch(/WebSocket|wss?:\/\/|socketProxy|electronAPI|NodeSocket/i);
  });

  it('fails closed when an anchored region drifts', () => {
    expect(() => patchV2Runtime('function defaultSocketFactory(host, port) {}')).toThrow(/anchor|function/);
  });

  it('maps available profiles to one server and only selected credentials', () => {
    for (const candidate of LASTRO_SERVER_PROFILES.slice(0, 2)) {
      if (candidate.availability !== 'available') throw new Error('unexpected unavailable profile');
      const config = buildClientConfig(candidate, { username: 'user', password: 'pass' });
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0]).toMatchObject({ address: candidate.loginAddress, port: candidate.loginPort,
        version: candidate.version, langtype: candidate.langtype, packetver: candidate.packetver });
      expect(config.autoLogin).toEqual(['user', 'pass']);
      expect(JSON.stringify(config)).not.toMatch(/wss?:\/\/|XKore|quickLogin|socketProxy/i);
      expect(Object.isFrozen(config)).toBe(true);
    }
  });

  it('keeps the real imported runtime source available for the next patch step', async () => {
    await expect(readFile('vendor/v2/Online.js', 'utf8')).resolves.toContain('defaultSocketFactory');
  });

  it('keeps the built-in vertical flip disabled for the ILLUSION status', async () => {
    const runtime = await readFile('vendor/v2/Online.js', 'utf8');
    expect(runtime).toMatch(/static setActive\(bool\)\s*\{\s*_active\$3 = false;\s*\}/);
    expect(runtime).toMatch(/if \(efstConst == StatusConst_default\.ILLUSION\)\s*VerticalFlip\.setActive\(true\);/);
  });

  it('applies bundled Chinese typography to the generated runtime', async () => {
    const runtime = await readFile('generated/runtime/Online.js', 'utf8');
    expect(runtime).toContain("font-family: 'MiSans'");
    expect(runtime).toContain('font-size: 12px');
    expect(runtime).toContain('font-size-adjust: none');
    expect(runtime).not.toContain('SCDream');
    expect(runtime).toContain('Arial');
  });

  it('moves item obtain notices right and stabilizes shortcut number metrics', async () => {
    const runtime = await readFile('generated/runtime/Online.js', 'utf8');
    expect(runtime).toContain('LastRO item-obtain placement and typography');
    expect(runtime).toContain('top: var(--loot-top, 0px)');
    expect(runtime).toContain('function installLastroLootList');
    expect(runtime).toContain('left: var(--loot-left, 0px) !important');
    expect(runtime).toContain('right: auto !important');
    expect(runtime).toContain('this._host.style.right = "24px"');
    expect(runtime).toContain('LastRO shortcut typography and alignment');
    expect(runtime).toContain('font-family: Arial, sans-serif');
    expect(runtime).toContain('font-size: 10px');
    expect(runtime).toContain('top: 17px');
  });

  it('applies the maintainable LASTRO localization overlay', async () => {
    const runtime = await readFile('generated/runtime/Online.js', 'utf8');
    expect(runtime).toContain('LASTRO Chinese job-name overlay');
    expect(runtime).toContain('"NOVICE":"初心者"');
    expect(runtime).toContain('"DRAGON_KNIGHT":"龙骑士"');
    expect(runtime).not.toContain('JobNameTable[JobConst_default.NOVICE] = "初心者"');
    expect(runtime).toContain('lastroJobDisplayName(info.job)');
    expect(runtime).toContain('>创建聊天室<');
    expect(runtime).toContain('>领取奖励<');
    expect(runtime).toContain('正在监测非法软件。');
    expect(runtime).toContain('DB.getMessage(126, "更改房间设置")');
    expect(runtime).toContain('DB.getMessage(1808, "秒")');
    expect(runtime).toContain('LASTRO Chinese skill-name overlay');
    expect(runtime).toContain('"SM_SWORD":"剑术修炼"');
    expect(runtime).toContain('"MG_FIREBOLT":"火箭术"');
    expect(runtime).toContain('"AL_HEAL":"治愈术"');
    expect(runtime).toContain('>成就<');
    expect(runtime).toContain('>公会助手<');
    expect(runtime).toContain('>任务列表（Alt + U）<');
    expect(runtime).toContain('>价格上限：%s Zeny<');
  });

  it('registers Web Audio contexts in the generated runtime for activation resume', async () => {
    const runtime = await readFile('generated/runtime/Online.js', 'utf8');
    expect(runtime).toContain('this.audioCtx = LastROAudioRegisterContext(new AudioContext());');
    expect(runtime).toContain('const resumeAudioContexts = () => {');
  });

  it('sets skipIntro to bypass local GRF file picker', () => {
    const config = buildClientConfig(profile, { username: 'test', password: 'pass' });
    expect(config.skipIntro).toBe(true);
  });
});
