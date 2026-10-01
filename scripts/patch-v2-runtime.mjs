import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';
import process from 'node:process';
import ts from 'typescript';
import { patchRuntimeNavigation, patchRuntimePluginLoader, patchRuntimePlainTextSinks } from './patch-csp-runtime.mjs';
import { patchRuntimeCredentialSecurity } from './lastro-credential-security.mjs';
import { patchRuntimeLastROItemLayouts } from './lastro-network-security.mjs';
import { patchRuntimeCharacterSwitch, patchRuntimeNetworkHandoffCleanup } from './lastro-character-switch.mjs';
import { patchRuntimeNetworkFramingRecovery, patchRuntimeNetworkCloseDrain } from './lastro-network-receive-recovery.mjs';
import { patchRuntimeNetworkDiagnostics } from './lastro-network-diagnostics.mjs';
import { patchRuntimeLuaStartup } from './lastro-lua-startup.mjs';
import { patchRuntimeDebugAccess } from './lastro-debug-access.mjs';
import { JOB_NAME_OVERRIDES, MESSAGE_FALLBACKS, RUNTIME_TEXT_REPLACEMENTS, patchRuntimeMapLocalization, patchRuntimeStatusTooltips, assertRuntimeLocalizationMount } from './lastro-localization.mjs';
import jobNameAliases from './lastro-job-name-aliases.json' with { type: 'json' };
import { SKILL_DESCRIPTION_OVERRIDES, SKILL_NAME_OVERRIDES } from './lastro-skill-localization.mjs';
import { ITEM_OBTAIN_CSS } from './lastro-loot-style.mjs';
import { installLastroLootList } from './lastro-loot-list.mjs';
import { createWorldMapIndex, installLastroWorldMap, WORLD_MAP_HTML, WORLD_MAP_CSS } from './lastro-worldmap.mjs';
import { createMonsterPortraitLoader } from './lastro-monster-portrait.mjs';
import { createLastroChatMapLinks } from './lastro-chat-map-links.mjs';
import { patchRuntimeNpcMapLinks } from './lastro-npc-map-links.mjs';
import { patchRuntimeNpcDialogButtons } from './lastro-npc-dialog-buttons.mjs';
import { patchRuntimeAutolootSettings } from './lastro-autoloot-settings.mjs';
import { patchRuntimeVendingMovement } from './lastro-vending-movement.mjs';
import { patchRuntimeAchievementLinks } from './lastro-achievement-links.mjs';
import { patchRuntimeTeleportFeedback } from './lastro-teleport-feedback.mjs';
import { patchRuntimeFrameTiming } from './lastro-frame-timing.mjs';
import { patchRuntimeAudioTiming } from './lastro-audio-timing.mjs';
import { patchRuntimeEntitySync } from './lastro-entity-sync.mjs';
import { patchRuntimeEntityAppearance } from './lastro-entity-appearance.mjs';
import { patchRuntimeEquipmentAnimation } from './lastro-equipment-animation.mjs';
import { patchRuntimeEquipmentCatalog, patchRuntimeEquipmentView } from './lastro-equipment-view.mjs';
import { patchRuntimeTeleportFade } from './lastro-teleport-fade.mjs';
import { patchRuntimeMovementInput } from './lastro-movement-input.mjs';
import { patchRuntimeMovementSync } from './lastro-movement-sync.mjs';
import { installLastroToolsPanels } from './lastro-tools-panels.mjs';
import { LASTRO_TOOLS_CSS } from './lastro-tools-style.mjs';
import { captureLastroShortcutEntry, installLastroShortcutEntry } from './lastro-shortcut-entry.mjs';
import { installLastroShortcutSettings } from './lastro-shortcut-settings.mjs';
import { patchRuntimeMail } from './lastro-mail.mjs';
import { patchPetDialogueDecoding } from './patch-pet-dialogue.mjs';
import { patchRuntimeUiText } from './lastro-ui-text.mjs';
import { patchRuntimeUiMessages } from './lastro-ui-messages.mjs';
import { patchRuntimeUiLayout as patchScopedUiLayout } from './lastro-ui-layout.mjs';
import { patchRuntimeUiState } from './lastro-ui-state.mjs';
import { patchRuntimeStoreScroll } from './lastro-store-scroll.mjs';
import { patchRuntimeStorageCount } from './lastro-storage-count.mjs';
import { patchRuntimeUiInput } from './lastro-ui-input.mjs';
import { patchRuntimeItemDrag } from './lastro-item-drag.mjs';
import { patchRuntimeItemName } from './lastro-item-name.mjs';
import { patchRuntimeHotkeys } from './lastro-hotkeys.mjs';
import { patchRuntimeTypography } from './lastro-typography.mjs';
import { patchRuntimeDialogTypography } from './lastro-dialog-typography.mjs';
import { patchRuntimeNavigationUi } from './lastro-navigation-ui.mjs';
import { patchRuntimeBasicInfoLayout } from './lastro-basic-info.mjs';
import { patchRuntimeQuests } from './lastro-quest-runtime.mjs';
import { describeLastroMapLoadFailure } from './lastro-map-load-diagnostic.mjs';
import teleportRoutes from './lastro-teleport-routes.json' with { type: 'json' };
import { createLastroTeleportNavigation } from './lastro-teleport-navigation.mjs';
import { createLastroTeleportPreflight } from './lastro-teleport-preflight.mjs';
import { createLastroVerifiedTeleportRequest } from './lastro-teleport-request.mjs';
import { createLastroWorldMapTeleport } from './lastro-worldmap-teleport.mjs';
import { resolveLastroMapResourceName } from './lastro-map-resource-name.mjs';
import worldMapLayout from './lastro-worldmap-layout.json' with { type: 'json' };

const repo = fileURLToPath(new URL('../', import.meta.url));

function fail(code) {
  throw new Error(JSON.stringify({ code }));
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function replaceOnce(source, needle, replacement) {
  if (count(source, needle) !== 1) fail(`anchor:${needle}`);
  return source.replace(needle, replacement);
}

/**
 * Try candidate anchor/replacement pairs, longest anchor first, and apply the
 * first pair whose anchor matches exactly once.  This lets the patcher support
 * both the tab-indented upstream bundle and the space-indented formatted copy.
 */
function replaceOnceAny(source, pairs) {
  const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
  for (const [anchor, replacement] of sorted) {
    if (count(source, anchor) === 1) return source.replace(anchor, replacement);
  }
  fail(`anchor:${pairs[0][0]}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeDoubleQuotedString(literal) {
  const escapeMap = { '\\r': '\r', '\\n': '\n', '\\t': '\t', '\\b': '\b', '\\f': '\f', '\\v': '\v', '\\\\': '\\', '\\"': '"' };
  return literal.slice(1, -1).replace(/\\(?:r|n|t|b|f|v|\\|")/g, (escape) => escapeMap[escape]);
}

function appendCssToStringVariable(source, variableName, cssBlock) {
  const pattern = new RegExp(`(${escapeRegExp(variableName)}\\s*=\\s*)("(?:\\\\.|[^"\\\\])*")`, 'g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) fail(`anchor:${variableName}`);
  const match = matches[0];
  const css = decodeDoubleQuotedString(match[2]);
  if (css.includes(cssBlock)) return source;
  return source.replace(match[0], `${match[1]}${JSON.stringify(css + cssBlock)}`);
}

function removeRegion(source, names) {
  const pattern = new RegExp(`//#region src/Network/SocketHelpers/(?:${names.join('|')})\\.js\\r?\\n[\\s\\S]*?//#endregion`, 'g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) fail(`region:${names.join('|')}`);
  const match = matches[0];
  return source.slice(0, match.index) + source.slice(match.index + match[0].length);
}

function replaceFunctionBody(source, name, body) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1) fail(`function:${name}`);
  const node = matches[0];
  const start = node.body.getStart(file);
  return source.slice(0, start) + body + source.slice(node.body.end);
}

function patchLoginRegistrationHook(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'onConnectionRequest') matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1) fail('function:onConnectionRequest');
  const node = matches[0];
  let body = source.slice(node.body.getStart(file), node.body.end);
  const variants = [
    { send: '\t\t\t\tNetwork.sendPacket(pkt);', close3: '\t\t\t}', close2: '\t\t}', close1: '\t});', indent: '\t\t\t\t' },
    { send: '        Network.sendPacket(pkt);', close3: '      }', close2: '    }', close1: '  });', indent: '        ' },
  ];
  const matched = variants.filter((v) => count(body, `${v.send}\n${v.close3} else {`) === 1);
  if (matched.length !== 1) fail('anchor:login-han-send');
  const variant = matched[0];
  const hook = `\n${variant.indent}afterLastROLoginPassword(username, password);`;
  const hanMarker = `${variant.send}\n${variant.close3} else {`;
  const normalMarker = `${variant.send}\n${variant.close3}\n${variant.close2}\n${variant.close1}\n}`;
  if (count(body, normalMarker) !== 1) fail('anchor:login-send');
  body = body.replace(hanMarker, `${variant.send}${hook}\n${variant.close3} else {`);
  body = body.replace(normalMarker, `${variant.send}${hook}\n${variant.close3}\n${variant.close2}\n${variant.close1}\n}`);
  return source.slice(0, node.body.getStart(file)) + body + source.slice(node.body.end);
}

export function patchRuntimeJobLocalization(source) {
  // JobNameTable, PalNameTable and WeaponJobTable contain asset basenames,
  // not UI labels. Never translate these or bodies/weapons/palettes disappear.
  let replacements = 0;
  const output = source.replace(/\/\/#region src\/UI\/[^\r\n]+\r?\n[\s\S]*?\/\/#endregion/g, region =>
    region.replace(/MonsterTable_default\[([^\]\r\n]+)\]/g, (_match, id) => {
      replacements++; return `lastroJobDisplayName(${id})`;
    }));
  if (replacements !== 9) fail('anchor:job-display-lookups');
  const labels = { ...JOB_NAME_OVERRIDES };
  function resolveLabel(key, seen = new Set()) {
    if (Object.hasOwn(labels, key)) return labels[key];
    const target = jobNameAliases[key];
    if (typeof target !== 'string' || seen.has(key)) fail('localization:job-alias:' + key);
    const label = resolveLabel(target, new Set([...seen, key]));
    return labels[key] = key.endsWith('_B') && !target.endsWith('_B') ? '宝宝' + label : label;
  }
  for (const key of Object.keys(jobNameAliases)) resolveLabel(key);
  return `/* LASTRO Chinese job-name overlay: display only, never resource paths. */
const lastroJobLabels = ${JSON.stringify(labels)};
let lastroJobLabelsById;
function lastroJobDisplayName(id) {
  if (!lastroJobLabelsById) {
    init_JobConst();
    lastroJobLabelsById = Object.create(null);
    for (const [key, label] of Object.entries(lastroJobLabels)) {
      const job = JobConst_default[key];
      if (Number.isFinite(job)) lastroJobLabelsById[job] = label;
    }
  }
  return lastroJobLabelsById[id] ?? MonsterTable_default[id];
}
` + output;
}

function patchRuntimeLocalization(source) {
  let output = source;
  const hasLocalizationAnchors = output.includes('JobNameTable')
    || output.includes('function loadSkillInfoList(filename')
    || RUNTIME_TEXT_REPLACEMENTS.some(([from, to]) => output.includes(from) || output.includes(to))
    || /DB\.getMessage\(\s*\d+\s*,\s*"/.test(output);
  if (!hasLocalizationAnchors) return output;

  if (output.includes('JobNameTable')) output = patchRuntimeJobLocalization(output);

  for (const [from, to] of RUNTIME_TEXT_REPLACEMENTS) {
    const occurrences = count(output, from);
    if (occurrences > 0) output = output.replaceAll(from, to);
  }

  output = output.replace(/DB\.getMessage\(\s*(\d+)\s*,\s*"[^"]*"/g, (match, messageId) => {
    const fallback = MESSAGE_FALLBACKS[messageId];
    return fallback === undefined ? match : `DB.getMessage(${messageId}, ${JSON.stringify(fallback)}`;
  });
  // ui-text calls DB.getMessage again when mounted. Translate known English
  // table values as well as the HTML fallback, without changing Chinese data.
  if (output.includes('static getMessage(id, defaultText)')) {
    const labels = Object.fromEntries(RUNTIME_TEXT_REPLACEMENTS
      .filter(([from, to]) => /^>[^<>]+<$/.test(from) && /^>[^<>]+<$/.test(to))
      .map(([from, to]) => [from.slice(1, -1), to.slice(1, -1)]));
    const anchor = '      return MsgStringTable[id];';
    output = `const lastroUiMessages = ${JSON.stringify(labels)};\n` + replaceOnce(output, anchor, '      const text = MsgStringTable[id];\n      return Object.prototype.hasOwnProperty.call(lastroUiMessages, text) ? lastroUiMessages[text] : text;');
  }
  output = patchRuntimeSkillLocalization(output);
  return output;
}

export function patchRuntimeSkillLocalization(source) {
  if (!source.includes('SkillInfo')) return source;
  if (!source.includes('function loadSkillInfoList(filename') || !source.includes('main_skillInfoList()'))
    fail('anchor:skill-loader');

  let output = source;
  // Localize built-in fallbacks too: the Lua file may fail or omit a skill.
  output = output.replace(/(SkillInfo\[SkillConst_default\.([A-Z0-9_]+)\]\s*=\s*\{\s*Name:\s*"[^"]*",\s*SkillName:\s*)"[^"]*"/g,
    (match, prefix, key) => SKILL_NAME_OVERRIDES[key] ? prefix + JSON.stringify(SKILL_NAME_OVERRIDES[key]) : match);
  const skillNameEntries = Object.entries(SKILL_NAME_OVERRIDES);
  if (skillNameEntries.length > 0) {
    const skillNameOverlay = [
      '        /* LASTRO Chinese skill-name overlay */',
      `        const lastroSkillNameOverrides = ${JSON.stringify(Object.fromEntries(skillNameEntries))};`,
      '        for (const [skillName, localizedName] of Object.entries(lastroSkillNameOverrides)) {',
      '          const skillId = SkillConst_default[skillName];',
      '          if (Number.isFinite(skillId) && SkillInfo[skillId]) SkillInfo[skillId].SkillName = localizedName;',
      '        }',
    ].join('\n');
    const skillNameAnchor = '      } catch (error) {\n        console.error("[loadSkillInfoList] Error: ", error);';
    if (count(output, skillNameAnchor) !== 1) fail('anchor:skill-name-overlay');
    output = output.replace(skillNameAnchor, `${skillNameOverlay}\n${skillNameAnchor}`);
  }

  const skillDescriptionEntries = Object.entries(SKILL_DESCRIPTION_OVERRIDES);
  if (skillDescriptionEntries.length > 0) {
    const skillDescriptionOverlay = [
      '              /* LASTRO Chinese skill-description overlay */',
      `              const lastroSkillDescriptionOverrides = ${JSON.stringify(Object.fromEntries(skillDescriptionEntries))};`,
      '              for (const [skillName, description] of Object.entries(lastroSkillDescriptionOverrides)) {',
      '                const skillId = SkillConst_default[skillName];',
      '                if (Number.isFinite(skillId)) SkillDescription[skillId] = description;',
      '              }',
    ].join('\n');
    const skillDescriptionAnchor = '              SkillDescription = _json;';
    if (count(output, skillDescriptionAnchor) !== 1) fail('anchor:skill-description-overlay');
    output = output.replace(skillDescriptionAnchor, `${skillDescriptionAnchor}\n${skillDescriptionOverlay}`);
  }
  // Learned skill packets may retain an English name; prefer the local DB.
  output = output.replaceAll('skill.SkillName || info?.SkillName || info?.Name', 'info?.SkillName || skill.SkillName || info?.Name');
  return output;
}

export function patchLuaTableCompletion(source) {
  if (!source.includes('function loadLuaTable(')) return source;
  const start = source.indexOf('function loadLuaTable(');
  const script = source.slice(start).match(/lua\.doStringSync\((`[\s\S]*?`)\);/);
  if (!script || !script[1].includes('main_table()')) fail('anchor:lua-table-parser');
  return replaceFunctionBody(source, 'loadLuaTable', `{
  const mounted = [];
  const table = {};
  const read = (filename) => new Promise((resolve, reject) => {
    Client.loadFile(filename, resolve, () => reject(new Error("Failed to load " + filename)));
  });
  void (async () => {
    try {
      for (const filename of file_list) {
        const file = await read(filename);
        const buffer = file instanceof ArrayBuffer ? new Uint8Array(file) : file;
        lua.mountFile(filename, buffer);
        mounted.push(filename);
        await lua.doFile(filename);
      }
      const valueCharset = getLuaTableValueCharset(file_list[1], userCharpage);
      const ctx = lua.ctx;
      ctx.addKeyAndValueToTable = (key, value) => {
        table[key] = userStringDecoder.decode(value, valueCharset);
        return 1;
      };
      ctx.addKeyAndMoreValuesToTable = (key, value) => {
        table[key] = (table[key] || "") + userStringDecoder.decode(value, valueCharset) + "\\n";
        return 1;
      };
      ctx.addKeyAndValueToTable.$rawLuaStringArgs = [1];
      ctx.addKeyAndMoreValuesToTable.$rawLuaStringArgs = [1];
      lua.doStringSync(${script[1]});
      if (typeof contextFunc === "function") contextFunc();
      callback.call(null, table);
    } catch (error) {
      console.error("[loadLuaTable]", table_name, error);
    } finally {
      for (const filename of mounted.reverse()) {
        try { lua.unmountFile(filename); } catch (error) { console.error("[loadLuaTable] cleanup", error); }
      }
      if (typeof onEnd === "function") onEnd();
    }
  })();
}`);
}

function patchRuntimeUiLayout(source) {
  const itemObtainCss = ITEM_OBTAIN_CSS;
  const shortcutCss = [
    '\r\n\r\n/* LastRO shortcut typography and alignment */\r\n',
    '#ShortCut {\r\n',
    '\tfont-family: Arial, \'Microsoft YaHei\', \'MiSans\', \'LastRO Glyph Fallback\', sans-serif;\r\n',
    '\tfont-size: 10px;\r\n',
    '\tline-height: 1;\r\n',
    '}\r\n',
    '#ShortCut .row {\r\n',
    '\theight: 34px;\r\n',
    '}\r\n',
    '#ShortCut .row .container {\r\n',
    '\theight: 24px;\r\n',
    '\tmargin-bottom: 5px;\r\n',
    '}\r\n',
    '#ShortCut .row .index {\r\n',
    '\tfont-family: Arial, sans-serif;\r\n',
    '\tfont-size: 10px;\r\n',
    '\tline-height: 10px;\r\n',
    '}\r\n',
    '#ShortCut .icon .amount {\r\n',
    '\tright: 1px;\r\n',
    '\ttop: 17px;\r\n',
    '\theight: 10px;\r\n',
    '\tmin-width: 8px;\r\n',
    '\tfont-family: Arial, sans-serif;\r\n',
    '\tfont-size: 10px;\r\n',
    '\tline-height: 10px;\r\n',
    '}\r\n',
    '.shortcut-tooltip {\r\n',
    '\tfont-family: Arial, \'Microsoft YaHei\', \'MiSans\', \'LastRO Glyph Fallback\', sans-serif;\r\n',
    '\tfont-size: 10px;\r\n',
    '\tline-height: 12px;\r\n',
    '}\r\n',
  ].join('');

  if (source.includes('ItemObtain_default$1')) {
    source = appendCssToStringVariable(source, 'ItemObtain_default$1', itemObtainCss);
    const centeredPosition = 'this._host.style.left = `${(Renderer.width - (el ? el.offsetWidth : 0)) >> 1}px`;';
    const centeredPositionBlocks = [
      `const el = this.getRoot().querySelector("#ItemObtain");\n    ${centeredPosition}`,
      `const el = root.querySelector("#ItemObtain");\n    ${centeredPosition}`,
    ];
    const centeredPositionCount = centeredPositionBlocks.reduce((total, block) => total + count(source, block), 0);
    if (centeredPositionCount !== 2) fail('anchor:item-obtain-center');
    for (const block of centeredPositionBlocks)
      source = source.replaceAll(block, 'this._host.style.left = "auto";\n    this._host.style.right = "24px";');
    const behaviorPattern = /ItemObtain\.onRemove = function onRemove\(\) \{[\s\S]*?(?= {2}ItemObtain_default = UIManager\.addComponent\(ItemObtain\);)/g;
    if ([...source.matchAll(behaviorPattern)].length !== 1) fail('anchor:item-obtain-list');
    source = source.replace(behaviorPattern, () => `(${installLastroLootList.toString()})(ItemObtain, { DB, Client }, _life);\n`);
  }
  if (source.includes('ShortCut_default$1'))
    source = appendCssToStringVariable(source, 'ShortCut_default$1', shortcutCss);
  return source;
}

function teleportResourceLoaderCode() {
  return `filename => new Promise((resolve, reject) => {
    const resolvedFilename = (${resolveLastroMapResourceName.toString()})(filename, DB.mapalias);
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("download-timeout-65000ms: " + resolvedFilename));
    }, 65000);
    try {
      Thread.send("GET_FILE", { filename: resolvedFilename, args: null }, (bytes, error) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        if (error || !bytes) {
          console.warn("[LastRO] Teleport resource check failed", filename, resolvedFilename, error);
          reject(new Error(String(error?.message || error || "ResourceResolutionError") + ": " + resolvedFilename));
        } else resolve(bytes);
      });
    } catch (error) {
      settled = true;
      globalThis.clearTimeout(timer);
      reject(error);
    }
  })`;
}

export function patchRuntimeWorldMap(source) {
  const pattern = /\/\/#region src\/UI\/Components\/WorldMap\/WorldMap\.js\r?\n[\s\S]*?\/\/#endregion/g;
  if ([...source.matchAll(pattern)].length !== 1) fail('anchor:worldmap-component');
  return source.replace(pattern, () => `//#region src/UI/Components/WorldMap/WorldMap.js
var WorldMap, WorldMap_default;
var init_WorldMap = __esmMin(() => {
  init_DBManager(); init_Client(); init_UIManager(); init_GUIComponent();
  init_MonsterTable();
  init_NetworkManager(); init_PacketStructure(); init_SessionStorage(); init_MapRenderer(); init_Navigation();
  init_Thread(); init_Configs();
  const lastroWorldMapPreflight = (${createLastroTeleportPreflight.toString()})({
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    loadFile: ${teleportResourceLoaderCode()},
  });
  const lastroWorldMapTeleport = (${createLastroWorldMapTeleport.toString()})({
    preflight: lastroWorldMapPreflight,
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    getProfile: () => String(Configs.get("lastroNid", 0)) + ":" + String(Configs.get("clientVer", 0)),
    onSameMap: () => showLastroTeleportNotice("已在目标地图。"),
    showPrompt: (message, yes, no) => UIManager.showPromptBox(message, "ok", "cancel", yes, no),
    send: mapname => {
      if (!PACKET.CZ.PRIVATE_AIRSHIP_REQUEST) throw new Error("当前客户端不支持传送");
      const pkt = new PACKET.CZ.PRIVATE_AIRSHIP_REQUEST();
      Object.assign(pkt, buildPrivateAirshipRequest({ mapname }));
      Network.sendPacket(pkt);
    },
    onError: error => {
      console.warn("[LastRO] World map teleport check failed", error);
      if (error?.resource) {
        const diagnostic = describeLastroMapLoadFailure("", error);
        UIManager.showErrorBox("传送失败：" + diagnostic.reason + "。\\n文件：" + error.resource);
      } else UIManager.showErrorBox(error.message || "传送地点检查失败，请重试。");
    },
  });
  WorldMap = new GUIComponent("WorldMap", ${JSON.stringify(WORLD_MAP_CSS)});
  WorldMap._lastroTeleport = lastroWorldMapTeleport;
  WorldMap.render = () => ${JSON.stringify(WORLD_MAP_HTML)};
  (${installLastroWorldMap.toString()})(WorldMap, {
    DB, Client,
    monsterPortrait: (${createMonsterPortraitLoader.toString()})(Client, id => MonsterTable_default[id] ? DB.getBodyPath(id, 0) : null, document),
    itemTable: () => ItemTable_default,
    currentMap: () => MapRenderer.currentMap,
    accountId: () => SessionStorage_default.AID,
    loadData: async () => {
      const values = await Promise.all(["world-data", "mob-data"].map(async name => {
        const response = await fetch(new URL("../core/data/world/" + name + ".json", import.meta.url));
        if (!response.ok) throw new Error("World map data HTTP " + response.status);
        return response.json();
      }));
      return { worldData: values[0], mobData: values[1] };
    },
    navigate: mapname => {
      if (typeof LastROTools !== "undefined") LastROTools?._lastroPanels?.cancelRoute();
      if (normalizeLastROTeleportMap(MapRenderer.currentMap) === normalizeLastROTeleportMap(mapname)) {
        showLastroTeleportNotice("已在目标地图。");
        return;
      }
      const position = SessionStorage_default.Entity?.position || [0, 0];
      Navigation_default.show();
      Navigation_default.navigateTo({ startMap: MapRenderer.currentMap, startX: position[0] | 0, startY: position[1] | 0, endMap: mapname, endX: 0, endY: 0, displayName: mapname });
    },
    teleport: (mapname, label) => {
      if (typeof LastROTools !== "undefined") LastROTools?._lastroPanels?.cancelRoute();
      return lastroWorldMapTeleport.request(mapname, label);
    },
    cancelTeleport: () => lastroWorldMapTeleport.cancelPending(),
  }, ${JSON.stringify(worldMapLayout.regions)}, ${createWorldMapIndex.toString()});
  WorldMap.mouseMode = GUIComponent.MouseMode.STOP;
  WorldMap_default = UIManager.addComponent(WorldMap);
});
//#endregion`);
}

function replaceWorkerCreation(source) {
  const pattern = /if \(!_source\) _source = new Worker\(new URL\(\s*\/\* @vite-ignore \*\/\s*"" \+ new URL\("LastROThreadEventHandler\.js", import\.meta\.url\)\.href,\s*"" \+ import\.meta\.url\s*\), \{ type: "classic" \}\);/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length === 1) {
    const replacement = [
      'if (!_source) _source = new Worker(createLastROWorkerScriptUrl("LastROThreadEventHandler.js"), { type: "classic" });',
    ].join('\n');
    return source.replace(pattern, replacement);
  }
  return replaceOnceAny(source, [
    ['      if (!_source)\n        _source = new Worker(\n          new URL(\n            /* @vite-ignore */\n            "" +\n              new URL(\n                "LastROThreadEventHandler.js",\n                import.meta.url,\n              ).href,\n            "" + import.meta.url,\n          ),\n          { type: "classic" },\n        );',
      '      if (!_source) _source = new Worker(createLastROWorkerScriptUrl("LastROThreadEventHandler.js"), { type: "classic" });'],
  ]);
}

function replacePathFindingWorkerCreation(source) {
  return replaceOnceAny(source, [
    ['const workerUrl = new URL("PathFindingWorker.js", import.meta.url).href;',
      'const workerUrl = createLastROWorkerScriptUrl("PathFindingWorker.js");'],
    ['    const workerUrl = new URL(\n      "PathFindingWorker.js",\n      import.meta.url,\n    ).href;',
      '    const workerUrl = createLastROWorkerScriptUrl("PathFindingWorker.js");'],
  ]);
}

const webAudioRuntime = String.raw`
function installLastROWebAudio() {
	const stateKey = "__lastroWebAudio";
	if (globalThis[stateKey]) return globalThis[stateKey];
	const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
	let context;
	let unlocked = false;
	const buffers = new Map();
	const bgmPositions = new Map();
	const activeSounds = new Map();
	let bgm = null;
	let bgmGeneration = 0;
	const getContext = () => {
		if (!AudioContextCtor) throw new Error("Web Audio API is unavailable");
		if (!context) {
			context = LastROAudioRegisterContext(new AudioContextCtor());
			if (unlocked && context.state === "suspended") void context.resume().catch(() => {});
		}
		return context;
	};
	const resume = () => {
		unlocked = true;
		if (context?.state === "suspended") void context.resume().catch(() => {});
	};
	const decode = (key, url) => {
		const existing = buffers.get(key);
		if (existing) return existing;
		const promise = fetch(url).then((response) => {
			if (!response.ok) throw new Error("Audio request failed: " + response.status);
			return response.arrayBuffer();
		}).then((bytes) => getContext().decodeAudioData(bytes));
		buffers.set(key, promise);
		promise.catch(() => { if (buffers.get(key) === promise) buffers.delete(key); });
		return promise;
	};
	const disconnect = (node) => {
		try { node.stop(); } catch {}
		try { node.disconnect(); } catch {}
	};
	const stopBgm = () => {
		bgmGeneration++;
		if (!bgm) return 0;
		const ctx = getContext();
		const elapsed = Math.max(0, ctx.currentTime - bgm.startedAt);
		const offset = bgm.buffer.duration ? (bgm.offset + elapsed) % bgm.buffer.duration : 0;
		bgmPositions.set(bgm.filename, offset);
		disconnect(bgm.source);
		try { bgm.gain.disconnect(); } catch {}
		bgm = null;
		return offset;
	};
	const playBgm = async (filename, url, volume, requestedOffset = 0, isCurrent = () => true) => {
		const generation = ++bgmGeneration;
		const buffer = await decode("bgm:" + filename, url);
		if (generation !== bgmGeneration || !isCurrent()) return false;
		if (bgm?.filename === filename) return true;
		stopBgm();
		const ctx = getContext();
		const source = ctx.createBufferSource();
		const gain = ctx.createGain();
		const offset = bgmPositions.get(filename) ?? requestedOffset;
		source.buffer = buffer;
		source.loop = true;
		source.connect(gain);
		gain.connect(ctx.destination);
		gain.gain.value = Math.max(0, Math.min(1, volume));
		source.start(0, offset);
		bgm = { filename, source, gain, buffer, offset, startedAt: ctx.currentTime };
		return true;
	};
	const playSound = async (filename, url, volume) => {
		const buffer = await decode("sound:" + filename, url);
		const ctx = getContext();
		const source = ctx.createBufferSource();
		const gain = ctx.createGain();
		const entry = activeSounds.get(filename) || new Set();
		activeSounds.set(filename, entry);
		const item = { source, gain, baseVolume: volume };
		entry.add(item);
		source.buffer = buffer;
		source.connect(gain);
		gain.connect(ctx.destination);
		gain.gain.value = Math.max(0, Math.min(1, volume));
		source.addEventListener("ended", () => {
			entry.delete(item);
			if (!entry.size) activeSounds.delete(filename);
			try { source.disconnect(); gain.disconnect(); } catch {}
		}, { once: true });
		source.start();
	};
	const stopSound = (filename) => {
		const entries = filename ? [activeSounds.get(filename)] : [...activeSounds.values()];
		for (const entry of entries) {
			if (!entry) continue;
			for (const item of entry) disconnect(item.source);
		}
		if (filename) activeSounds.delete(filename); else activeSounds.clear();
	};
	const setBgmVolume = (volume) => { if (bgm) bgm.gain.gain.value = Math.max(0, Math.min(1, volume)); };
	const setSoundVolume = (volume) => {
		for (const entry of activeSounds.values()) for (const item of entry)
			item.gain.gain.value = Math.max(0, Math.min(1, item.baseVolume * volume));
	};
	const state = { getContext, decode, playBgm, stopBgm, playSound, stopSound, setBgmVolume, setSoundVolume };
	for (const event of ["pointerdown", "keydown", "touchstart", "click"]) document.addEventListener(event, resume, { capture: true, passive: true });
	globalThis[stateKey] = state;
	return state;
}
const LastROWebAudio = installLastROWebAudio();
`;

function replaceClassExpression(source, className, replacement) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.left.getText(file) === className && ts.isClassExpression(node.right)) matches.push(node.right);
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === className
      && node.initializer && ts.isClassExpression(node.initializer)) matches.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1) fail(`class:${className}`);
  return source.slice(0, matches[0].getStart(file)) + replacement + source.slice(matches[0].end);
}

export function patchWebAudioPlayback(source) {
  let output = source;
  for (const [name, anchors] of [
    ['src/Core/MemoryItem.js', ['_data = null;', 'complete = false;', 'return this._data;',
      'this._data = data; this.complete = true;', 'this._error = error; this.complete = true;']],
    ['src/Core/MemoryManager.js', ['const item = _memory[filename];', 'return item.data;', 'return !!_memory[filename];']],
  ]) {
    const marker = '//#region ' + name;
    const start = output.indexOf(marker), end = output.indexOf('//#endregion', start);
    if (start < 0 || end < start || output.indexOf(marker, start + marker.length) >= 0) fail('anchor:bgm:failed-cache');
    const region = output.slice(start, end).replace(/\s+/g, ' ');
    if (anchors.some((anchor) => !region.includes(anchor))) fail('anchor:bgm:failed-cache');
  }
  output = replaceOnce(output, 'MemoryManager = class MemoryManager {', `MemoryManager = class MemoryManager {
    static discardFailedMusic(filename) {
      const item = _memory[filename];
      if (item?.complete && !item.data) delete _memory[filename];
    }`);
  output = replaceClassExpression(output, 'BGM', `class BGM {
		static filename = null;
		static volume = Audio_default.BGM.volume;
		static extension = "mp3";
		static isInit = false;
		static stopped = true;
		static cache = { filename: null, currentTime: 0 };
		static init() { BGM.isInit = true; }
		static setAvailableExtensions(extensions) {
			if (extensions?.length) BGM.extension = extensions[0];
			BGM.init();
		}
		static play(filename) {
			if (!filename) return;
			if (filename.match(/bgm/i)) {
				filename = filename.match(/\\w+\\.mp3/i)?.toString();
				if (!filename) return;
			}
			if (!Audio_default.BGM.play) {
				BGM.stop();
				BGM.filename = filename;
				return;
			}
			if (BGM.filename === filename && !BGM.stopped) return;
			if (BGM.filename && !BGM.stopped) BGM.cache.filename = BGM.filename;
			BGM.filename = filename;
			BGM.stopped = false;
			const myToken = ++_playToken;
			const onError = (error) => {
				MemoryManager.discardFailedMusic("BGM/" + filename);
				if (myToken !== _playToken) return;
				BGM.stopped = true;
				console.warn("Failed to load BGM:", filename, error);
			};
			try {
				Client.loadFile("BGM/" + filename, (url) => {
					if (myToken !== _playToken || BGM.stopped) return;
					if (!Audio_default.BGM.play) { BGM.stopped = true; return; }
					if (BGM.filename === filename) BGM.load(url);
				}, onError);
			} catch (error) { onError(error); }
		}
		static load(url) {
			if (!Audio_default.BGM.play || !BGM.filename) return;
			const filename = BGM.filename;
			const myToken = _playToken;
			const targetTime = BGM.cache.filename === filename ? BGM.cache.currentTime : 0;
			const isCurrent = () => myToken === _playToken && !BGM.stopped && Audio_default.BGM.play && BGM.filename === filename;
			void LastROWebAudio.playBgm(filename, url, BGM.volume, targetTime, isCurrent).then((started) => {
				if (myToken === _playToken && !started) BGM.stopped = true;
			}).catch((error) => {
				if (myToken !== _playToken) return;
				BGM.stopped = true;
				console.warn("Failed to play BGM:", filename, error);
			});
		}
		static stop() {
			_playToken++;
			BGM.cache.filename = BGM.filename;
			BGM.cache.currentTime = LastROWebAudio.stopBgm();
			BGM.stopped = true;
		}
		static setVolume(volume) {
			BGM.volume = Math.max(0, Math.min(1, volume));
			Audio_default.BGM.volume = BGM.volume;
			Audio_default.save();
			LastROWebAudio.setBgmVolume(BGM.volume);
		}
	}`,);
  output = replaceClassExpression(output, 'SoundManager', `class SoundManager {
		static volume = Audio_default.Sound.volume;
		static play(filename, vol) {
			const volume = (vol === undefined ? 1 : vol) * this.volume;
			if (volume <= 0 || !Audio_default.Sound.play || !filename) return;
			Client.loadFile("data/wav/" + filename, (url) => {
				void LastROWebAudio.playSound(filename, url, volume).catch((error) => console.warn("Failed to play sound:", error));
			});
		}
		static playPosition(filename, srcPosition) {
			const dist = Math.floor(gl_matrix_default.vec2.dist(srcPosition, SessionStorage_default.Entity.position));
			const vol = Math.max(1 - Math.abs((dist - 1) * .99 / 24 + .01), .1);
			SoundManager.play(filename, vol);
		}
		static stop(filename) { LastROWebAudio.stopSound(filename); }
		static setVolume(volume) {
			this.volume = Math.max(0, Math.min(1, volume));
			Audio_default.Sound.volume = this.volume;
			Audio_default.save();
			LastROWebAudio.setSoundVolume(this.volume);
		}
	}`,);
  output = replaceOnce(
    output,
    'this.audioCtx = new AudioContext();',
    'this.audioCtx = LastROAudioRegisterContext(new AudioContext());',
  );
  return webAudioRuntime + output;
}

/**
 * Remove legacy html2canvas script injection paths. IWA Trusted Types blocks
 * dynamic TrustedScriptURL assignments, and these proxy/FlashCanvas branches
 * are obsolete in the canvas-capable browser runtime.
 */
export function patchLegacyScriptSinks(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const proxyFunctions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'proxyGetImage') proxyFunctions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (proxyFunctions.length === 1) {
    const node = proxyFunctions[0];
    const bodyStart = node.body.getStart(file);
    source = source.slice(0, bodyStart) + `{
    imageObj.succeeded = false;
    images.numLoaded++;
    images.numFailed++;
    start();
  }` + source.slice(node.body.end);
  } else if (proxyFunctions.length > 1) {
    fail('function:proxyGetImage');
  }
  const branch = /}\s*else if \(options\.flashcanvas !== undefined\) \{[\s\S]*?(?=\n\s*methods = \{)/;
  if (branch.test(source)) {
    source = source.replace(branch, '} else {\n\t\t\t\tcanvasReadyToDraw = false;\n\t\t\t}');
  }
  if (/createElement\(\s*["']script["']\s*\)/.test(source)
    || /(?:\.src|setAttribute\(\s*["']src["'])\s*=?.*(?:proxy|flashcanvas)/i.test(source)) {
    fail('legacy-script-sink');
  }
  return source;
}

export function patchGuildEmblemRequestCallbacks(source) {
  const callback = 'this.onSuccess(entry.guildId, entry.version, entry.image, entry.gif);';
  const replacement = 'this.onSuccess(entry.guildId, entry.image, entry.gif);';
  const count = source.split(callback).length - 1;
  if (count === 0) return source;
  if (count !== 1) fail('anchor:guild-emblem-onSuccess');
  return source.replace(callback, replacement);
}

export function patchTrustedTypesDomWrites(source) {
  const file = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  function visit(node) {
    if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left)
      && node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
      && node.left.name.text === 'innerHTML') {
      edits.push({
        start: node.getStart(file),
        end: node.end,
        text: `setLastROAdjacentHTML(${node.left.expression.getText(file)}, "beforeend", ${node.right.getText(file)})`,
      });
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)) {
      const property = node.left.name.text;
      const helper = property === 'innerHTML' ? 'setLastROInnerHTML'
        : property === 'outerHTML' ? 'setLastROOuterHTML' : undefined;
      if (helper) edits.push({
        start: node.getStart(file),
        end: node.end,
        text: `${helper}(${node.left.expression.getText(file)}, ${node.right.getText(file)})`,
      });
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'insertAdjacentHTML' && node.arguments.length === 2) {
      edits.push({
        start: node.getStart(file),
        end: node.end,
        text: `setLastROAdjacentHTML(${node.expression.expression.getText(file)}, ${node.arguments[0].getText(file)}, ${node.arguments[1].getText(file)})`,
      });
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'parseFromString' && node.arguments.length === 2
      && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text === 'application/xml') {
      edits.push({
        start: node.getStart(file),
        end: node.end,
        text: `parseLastROXML(${node.expression.expression.getText(file)}, ${node.arguments[0].getText(file)})`,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!edits.length) return source;
  edits.sort((left, right) => right.start - left.start);
  let output = source;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (!/from ["']\.\/lastro-trusted-dom\.mjs["']/.test(output)) {
    output = `import { setLastROAdjacentHTML, setLastROInnerHTML, setLastROOuterHTML } from "./lastro-trusted-dom.mjs";\n${output}`;
  }
  if (edits.some(edit => edit.text.startsWith('parseLastROXML('))
    && !/import\s*\{[^}]*\bparseLastROXML\b[^}]*\}\s*from ["']\.\/lastro-trusted-dom\.mjs["']/.test(output)) {
    output = `import { parseLastROXML } from "./lastro-trusted-dom.mjs";\n${output}`;
  }
  return output;
}

function patchLuaValueFailure(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const loader = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadLuaValue');
  if (loader.length !== 1) fail('function:loadLuaValue');
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.getText(file) === 'Client.loadFile' && node.arguments.length === 2) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(loader[0]);
  if (calls.length !== 1) fail('anchor:loadLuaValue-loadFile');
  const end = calls[0].arguments.end;
  return source.slice(0, end) + `, function(error) {
      console.error("[loadLuaValue] Failed to load " + file_path, error);
      if (onEnd) onEnd.call();
    }` + source.slice(end);
}

export function patchLuaJsonEscapes(source) {
  const anchor = String.raw`return str:gsub("\\", "\\\\"):gsub("\"", "\\\"")`;
  if (!source.includes('local function escape_str')) return source;
  const replacement = String.raw`return str
                  :gsub("\\", "\\\\")
                  :gsub("\"", "\\\"")
                  :gsub("\b", "\\b")
                  :gsub("\f", "\\f")
                  :gsub("\n", "\\n")
                  :gsub("\r", "\\r")
                  :gsub("\t", "\\t")
                  :gsub("%c", function(char)
                    return string.format("\\u%04x", string.byte(char))
                  end)`;
  return replaceOnce(source, anchor, replacement);
}

export function patchNpcMenuBlankArea(source) {
  const mousedownAnchor = 'if (div && content.contains(div)) selectIndex(div);';
  const dblclickAnchor = 'if (div && content.contains(div)) validate();';
  let output = source;
  if (output.includes(mousedownAnchor)) {
    output = replaceOnce(output, mousedownAnchor,
      'if (!div?.dataset?.index || !content.contains(div)) return;\n        selectIndex(div);');
  }
  if (output.includes(dblclickAnchor)) {
    output = replaceOnce(output, dblclickAnchor,
      'if (div?.dataset?.index && content.contains(div)) validate();');
  }
  return output;
}

export function patchAchievementClaimButton(source) {
  const lineBreak = String.raw`\r\n`;
  const claimMarker = 'd-claim-btn js-d-claim';
  // Some focused patch tests use a minimal runtime fixture without the
  // optional achievement component. Leave those fixtures untouched; when the
  // component exists, all of its anchors remain strict below.
  if (!source.includes(claimMarker)) return source;
  if (count(source, claimMarker) !== 1) fail('anchor:achievement-claim-template');
  const claimIndex = source.indexOf(claimMarker);
  const buttonStart = source.lastIndexOf('<ui-button', claimIndex);
  const styleIndex = source.indexOf('display: none', claimIndex);
  const styleEnd = source.indexOf(lineBreak, styleIndex);
  const buttonEndMarker = '</ui-button>';
  const buttonEnd = source.indexOf(buttonEndMarker, claimIndex);
  if (buttonStart < 0 || styleIndex < 0 || styleEnd < 0 || buttonEnd < 0 || buttonEnd < styleEnd) {
    fail('anchor:achievement-claim-template');
  }
  // The HTML is embedded in a JavaScript string and contains literal escaped
  // CR/LF sequences. Keep the existing prefix and replace only the missing
  // asset-backed button body so this works across bundle formatting variants.
  source = source.slice(0, buttonStart)
    + source.slice(buttonStart, styleEnd + lineBreak.length)
    + '\t\t>领取奖励</ui-button>'
    + source.slice(buttonEnd + buttonEndMarker.length);

  const cssMarker = '.detail-view .d-claim-btn';
  if (count(source, cssMarker) !== 1) fail('anchor:achievement-claim-css');
  const cssStart = source.indexOf(cssMarker);
  const scrollbarMarker = '/* Scrollbar area */';
  const scrollbarStart = source.indexOf(scrollbarMarker, cssStart);
  if (scrollbarStart < 0) fail('anchor:achievement-claim-css');
  const cssBlock = [
    '.detail-view .d-claim-btn {',
    '\tposition: absolute;',
    '\tbottom: 10px;',
    '\tright: 10px;',
    '\tleft: auto;',
    '\twidth: 110px;',
    '\theight: 26px;',
    '\tdisplay: none;',
    '\talign-items: center;',
    '\tjustify-content: center;',
    '\tbox-sizing: border-box;',
    '\tpadding: 0 8px;',
    '\tborder: 1px solid #80652f;',
    '\tborder-radius: 2px;',
    '\tbackground: #e8d08c;',
    '\tcolor: #3b2a12;',
    '\tfont-size: 11px;',
    '\tfont-weight: bold;',
    '\tline-height: 18px;',
    '\ttext-align: center;',
    '\tcursor: pointer;',
    '\ttext-shadow: 1px 1px 0 #fff4cf;',
    '}',
    '',
    '.detail-view .d-claim-btn:hover {',
    '\tbackground: #f3dfaa;',
    '}',
    '',
    '.detail-view .d-claim-btn:active {',
    '\tbackground: #d8bb70;',
    '}',
  ].join('\r\n');
  // JSON.stringify provides the correct escaping for the surrounding JS
  // string, including CR/LF and CSS quotes.
  const encodedCssBlock = JSON.stringify(cssBlock).slice(1, -1);
  source = source.slice(0, cssStart)
    + encodedCssBlock
    + lineBreak + lineBreak
    + source.slice(scrollbarStart);

  const clickAnchors = [
    ['const allAch = DB.getAchievementTable();\n          const sessAch =\n            SessionStorage_default.Achievement &&\n            SessionStorage_default.Achievement.list\n              ? SessionStorage_default.Achievement.list\n              : {};\n          const info = allAch[this.selectedAchId];\n          const state = sessAch[this.selectedAchId];\n          const canClaim =\n            this.selectedAchId !== null &&\n            this.claimingAchId !== this.selectedAchId &&\n            hasAchievementReward(info && info.reward) &&\n            !!state &&\n            !!(state.completed || state.Completed) &&\n            !(state.reward || state.rewarded);\n          if (canClaim) {',
      'const claimId = this.selectedAchId;\n          if (claimId !== null) {'],
  ];
  if (count(source, clickAnchors[0][0]) === 1) source = source.replace(clickAnchors[0][0], clickAnchors[0][1]);
  else if (!source.includes('const claimId = this.selectedAchId;')) fail('anchor:achievement-claim-click');
  source = source.replace(
    'this.claimingAchId = this.selectedAchId;\n            const pkt = new PACKET.CZ.REQ_ACH_REWARD();\n            pkt.achievementID = this.selectedAchId;',
    'this.claimingAchId = claimId;\n            const pkt = new PACKET.CZ.REQ_ACH_REWARD();\n            pkt.achievementID = claimId;',
  );

  const emptyDetailDisplayAnchor = 'root.querySelector(".js-d-claim").style.display = "none";';
  if (count(source, emptyDetailDisplayAnchor) === 1) {
    source = source.replace(
      emptyDetailDisplayAnchor,
      'root.querySelector(".js-d-claim").textContent = "领取奖励";\n'
        + '        root.querySelector(".js-d-claim").disabled = false;\n'
        + '        root.querySelector(".js-d-claim").style.display = "flex";',
    );
  } else if (!source.includes('root.querySelector(".js-d-claim").style.display = "flex";')) {
    fail('anchor:achievement-claim-empty-detail-display');
  }

  const displayAnchors = [
    ['const canClaim = hasAchievementReward(info.reward) &&\n        !!s &&\n        !!(s.completed || s.Completed) &&\n        !(s.reward || s.rewarded);\n      claimBtn.textContent = "领取奖励";\n      claimBtn.style.display = canClaim ? "flex" : "none";',
      'claimBtn.textContent = "领取奖励";\n      claimBtn.disabled = false;\n      claimBtn.style.display = "flex";'],
    ['if (canClaim)\n        claimBtn.style.display = "";\n      else claimBtn.style.display = "none";',
      'claimBtn.textContent = "领取奖励";\n      claimBtn.disabled = false;\n      claimBtn.style.display = "flex";'],
  ];
  if (count(source, displayAnchors[0][0]) === 1) source = source.replace(displayAnchors[0][0], displayAnchors[0][1]);
  else if (count(source, displayAnchors[1][0]) === 1) source = source.replace(displayAnchors[1][0], displayAnchors[1][1]);
  else if (source.includes('claimBtn.style.display = hasReward ? "flex" : "none";')) return source;
  else fail('anchor:achievement-claim-display');
  return source;
}

export function patchRuntimeChatMapLinks(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  let requestCount = 0, renderCount = 0, overrideCount = 0, clickCount = 0, inputCount = 0, itemCount = 0, announceCount = 0, broadcastInputCount = 0, playerNoticeCount = 0, npcNoticeCount = 0;
  function visit(node, scope = '') {
    if (ts.isFunctionDeclaration(node)) scope = node.name?.text ?? scope;
    if (ts.isFunctionDeclaration(node) && ['onPlayerMessage', 'onEntityTalkColor'].includes(node.name?.text)) {
      if (node.name.text === 'onPlayerMessage') playerNoticeCount++;
      else npcNoticeCount++;
      edits.push({ start: node.body.getStart(file) + 1, end: node.body.getStart(file) + 1, text: `
  if (Configs.get("lastroProtocol", false)) {
    const lastroMessage = LastROChatMapLinks.serverMessage(pkt.msg);
    if (lastroMessage !== null) {
      init_Announce();
      Announce_default.append();
      Announce_default.set(LastROChatMapLinks.plainText(lastroMessage), "#FFFF00", { life: 5000 });
      ChatBox_default.addText(lastroMessage, ChatBox_default.TYPE.ANNOUNCE, ChatBox_default.FILTER.PUBLIC_LOG);
      return false;
    }
  }
` });
    }
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'ChatBox.addText') {
      scope = 'ChatBox.addText';
      if (!ts.isFunctionExpression(node.right) || !node.right.body) fail('anchor:chat-input');
      inputCount++;
      edits.push({ start: node.right.body.getStart(file) + 1, end: node.right.body.getStart(file) + 1, text: '\n    text = LastROChatMapLinks.normalize(text);' });
    }
    if (ts.isCallExpression(node) && scope === 'ChatBox.addText' && node.expression.getText(file) === 'text.replace'
      && node.arguments[0]?.getText(file).includes('ITEMLINK') && node.arguments[1]) {
      itemCount++;
      edits.push({ start: node.arguments[1].getStart(file), end: node.arguments[1].end, text: `function (match) {
        const html = LastROChatMapLinks.formatItemLink(match, () => DB.parseItemLink(match));
        if (!html) return "[物品信息暂不可用]";
        override = true;
        return html;
      }` });
    }
    if (ts.isCallExpression(node) && scope === 'onGlobalAnnounce' && node.expression.getText(file) === 'Announce_default.set' && node.arguments[0]) {
      announceCount++;
      edits.push({ start: node.arguments[0].getStart(file), end: node.arguments[0].end, text: `LastROChatMapLinks.plainText(${node.arguments[0].getText(file)})` });
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'requestChatMapTeleport') {
      requestCount++;
      edits.push({ start: node.body.getStart(file), end: node.body.end, text: '{ return LastROChatMapLinks.request(link); }' });
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'onGlobalAnnounce') {
      broadcastInputCount++;
      edits.push({ start: node.body.getStart(file) + 1, end: node.body.getStart(file) + 1, text: '\n  pkt.msg = LastROChatMapLinks.serverMessage(pkt.msg) ?? LastROChatMapLinks.normalize(pkt.msg);\n  if (!pkt.msg) return;' });
    }
    if (ts.isIfStatement(node) && scope === 'flushMessageBuffer' && node.expression.getText(file) === '!msg.override'
      && node.thenStatement.getText(file).includes('div.textContent') && node.elseStatement?.getText(file).includes('div.innerHTML')) {
      renderCount++;
      edits.push({ start: node.getStart(file), end: node.end, text: 'LastROChatMapLinks.render(div, msg.text, msg.override);' });
    }
    if (ts.isIfStatement(node) && scope === 'ChatBox.addText' && node.expression.getText(file).includes('mapname')
      && node.thenStatement.getText(file) === 'override = true;') {
      overrideCount++;
      edits.push({ start: node.getStart(file), end: node.end, text: '' });
    }
    if (ts.isIfStatement(node) && node.expression.getText(file) === 'requestChatMapTeleport(mapLink)') {
      clickCount++;
      edits.push({ start: node.getStart(file), end: node.end, text: 'event.preventDefault();\n            event.stopImmediatePropagation();\n            requestChatMapTeleport(mapLink);' });
    }
    ts.forEachChild(node, child => visit(child, scope));
  }
  visit(file);
  if ([requestCount, renderCount, overrideCount, clickCount, inputCount, itemCount, announceCount, broadcastInputCount, playerNoticeCount, npcNoticeCount].some(value => value !== 1)) fail('anchor:chat-map-links');
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return `const LastROChatMapLinks = (${createLastroChatMapLinks.toString()})({
  setHtml: (parent, html) => setLastROInnerHTML(parent, html),
  showPrompt: (message, yes, no) => UIManager.showPromptBox(message, "ok", "cancel", yes, no),
  getMap: () => typeof MapRenderer !== "undefined" && !MapRenderer.loading ? normalizeLastROTeleportMap(MapRenderer.currentMap) : "",
  canTeleport: () => !!PACKET?.CZ?.PRIVATE_AIRSHIP_REQUEST && typeof MapRenderer !== "undefined" && !MapRenderer.loading && !!normalizeLastROTeleportMap(MapRenderer.currentMap),
  navigate: target => {
    init_SessionStorage(); init_Altitude();
    const position = SessionStorage_default.Entity?.position;
    const currentMap = normalizeLastROTeleportMap(MapRenderer.currentMap);
    if (MapRenderer.loading || currentMap !== target.mapname || !position || !Number.isFinite(position[0]) || !Number.isFinite(position[1]) || !(Altitude.width > 0) || !(Altitude.height > 0)) {
      showLastroTeleportNotice("当前地图尚未就绪，请稍后再试。");
      return;
    }
    if (target.x >= Altitude.width || target.y >= Altitude.height) {
      showLastroTeleportNotice("目标坐标超出地图范围，无法前往。");
      return;
    }
    if (typeof LastROTools !== "undefined") LastROTools?._lastroPanels?.cancelRoute();
    init_Navigation();
    return Navigation_default.navigateTo({startMap: currentMap, startX: Math.round(position[0]), startY: Math.round(position[1]), endMap: target.mapname, endX: target.x, endY: target.y, showWindow: false});
  },
  onError: error => console.warn("[LastRO] Notification recovered from an error", error),
  teleport: target => {
    const packet = new PACKET.CZ.PRIVATE_AIRSHIP_REQUEST();
    // Activity coordinates use the official notification handler's type 1.
    Object.assign(packet, buildPrivateAirshipRequest({ ...target, type: 1 }));
    Network.sendPacket(packet);
  },
});\n${source}`;
}

export function patchNavigationPendingTargets(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = [], waiters = [];
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.left.getText(file) === 'Navigation.navigateTo' && ts.isFunctionExpression(node.right)) functions.push(node.right);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.left.getText(file) === 'Navigation.waitForMapData' && ts.isFunctionExpression(node.right)) waiters.push(node.right);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (functions.length !== 1 || waiters.length !== 1) fail('anchor:navigation-pending-targets');
  const navigation = functions[0], assignments = [], callbacks = [];
  function findAnchors(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left) && node.left.text === '_finalTargetData') assignments.push(node);
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'this.waitForMapData') callbacks.push(node);
    if (ts.isIdentifier(node) && node.text === 'lastroNavigationPendingTarget') fail('anchor:navigation-pending-targets');
    ts.forEachChild(node, findAnchors);
  }
  findAnchors(navigation.body);
  const assignment = assignments[0], callback = callbacks[0]?.arguments[0];
  if (assignments.length !== 1 || callbacks.length !== 1 || !ts.isObjectLiteralExpression(assignment.right)
    || !ts.isExpressionStatement(assignment.parent) || assignment.parent.parent !== navigation.body
    || !callback || !ts.isFunctionExpression(callback) || !callback.body
    || callback.getStart(file) <= assignment.end) fail('anchor:navigation-pending-targets');
  const waiter = waiters[0], recursiveCalls = [];
  function findRecursion(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'Navigation.waitForMapData') recursiveCalls.push(node);
    if (ts.isIdentifier(node) && node.text === 'lastroNavigationWaitingTarget') fail('anchor:navigation-pending-targets');
    ts.forEachChild(node, findRecursion);
  }
  findRecursion(waiter.body);
  const parameter = waiter.parameters[0], recursive = recursiveCalls[0];
  if (waiter.parameters.length !== 1 || !ts.isIdentifier(parameter.name) || parameter.name.text !== 'callback'
    || parameter.initializer || recursiveCalls.length !== 1 || recursive.arguments.length !== 1
    || recursive.arguments[0].getText(file) !== 'callback') fail('anchor:navigation-pending-targets');
  const edits = [
    { start: assignment.parent.end, text: '\n    const lastroNavigationPendingTarget = _finalTargetData;' },
    { start: callback.body.getStart(file) + 1, text: '\n        if (_finalTargetData !== lastroNavigationPendingTarget) return;' },
    { start: parameter.end, text: ', lastroNavigationWaitingTarget = _finalTargetData' },
    { start: waiter.body.getStart(file) + 1, text: '\n    if (lastroNavigationWaitingTarget !== _finalTargetData) return;' },
    { start: recursive.arguments[0].end, text: ', lastroNavigationWaitingTarget' },
  ].sort((a, b) => b.start - a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.start);
  return source;
}

export function patchRuntimePreferencesSave(source) {
  const anchor = `    static save(data) {
      const key = data._key;
      delete data._key;
      delete data.save;
      const store = {};
      store[key] = JSON.stringify(data);
      Storage.set(store);
      data._key = key;
      data.save = selfSave;
    }`;
  return replaceOnce(source, anchor, `    static save(data) {
      const key = data._key;
      delete data._key;
      delete data.save;
      try {
        const store = {};
        store[key] = JSON.stringify(data);
        Storage.set(store);
      } finally {
        data._key = key;
        data.save = selfSave;
      }
    }`);
}

export function patchRuntimeToolsPanels(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const anchors = [], transitions = [], cleanups = [];
  function visit(node, scope = '') {
    if (ts.isFunctionDeclaration(node)) scope = node.name?.text ?? scope;
    if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'setMap' && ts.isClassExpression(node.parent) && node.parent.name?.text === 'MapRenderer') scope = 'MapRenderer.setMap';
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'UIManager.addComponent' && node.arguments[0]?.getText(file) === 'LastROTools') anchors.push(node);
    if (ts.isCallExpression(node) && scope === 'MapRenderer.setMap' && node.expression.getText(file) === 'UIManager.removeComponents') transitions.push(node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'cleanGameUI') cleanups.push(node);
    ts.forEachChild(node, child => visit(child, scope));
  }
  visit(file);
  if (anchors.length !== 1 || transitions.length !== 1 || cleanups.length !== 1) fail('anchor:lastro-tools-panels');
  const anchor = anchors[0];
  const install = `const lastroSendRouteTeleport = point => {
    if (!PACKET?.CZ?.PRIVATE_AIRSHIP_REQUEST) throw new Error("当前客户端不支持传送");
    const packet = new PACKET.CZ.PRIVATE_AIRSHIP_REQUEST();
    Object.assign(packet, buildPrivateAirshipRequest({mapname: normalizeLastROTeleportMap(point[0]), x: point[1], y: point[2], type: 1}));
    Network.sendPacket(packet);
    if (Navigation_default?.__loaded) Navigation_default.clear();
  };
  const lastroRouteNavigation = (${createLastroTeleportNavigation.toString()})({
    getMap: () => normalizeLastROTeleportMap(MapRenderer.currentMap),
    getPosition: () => SessionStorage_default.Entity?.position,
    clock: globalThis,
    sendTeleport: lastroSendRouteTeleport,
    stopNavigation: () => { if (Navigation_default?.__loaded) Navigation_default.clear(); },
    navigate: point => {
      const position = SessionStorage_default.Entity?.position;
      if (!position || !Navigation_default?.navigateTo) throw new Error("当前地图尚未就绪");
      return Navigation_default.navigateTo({startMap: MapRenderer.currentMap, startX: position[0], startY: position[1], endMap: point[0], endX: point[1], endY: point[2], showWindow: false});
    },
    setStatus: message => LastROTools._lastroPanels?.setStatus(message),
  });
  const lastroRoutePreflight = (${createLastroTeleportPreflight.toString()})({
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    loadFile: ${teleportResourceLoaderCode()},
  });
  const lastroVerifiedRouteRequest = (${createLastroVerifiedTeleportRequest.toString()})({
    sendTeleport: lastroSendRouteTeleport,
    preflight: lastroRoutePreflight, navigation: lastroRouteNavigation,
    getMap: () => MapRenderer.loading ? "" : normalizeLastROTeleportMap(MapRenderer.currentMap),
    getProfile: () => String(Configs.get("lastroNid", 0)) + ":" + String(Configs.get("clientVer", 0)),
    clearNavigation: () => {
      WorldMap_default?._lastroTeleport?.cancelPending();
      if (Navigation_default?.__loaded) Navigation_default.clear();
    },
  });
  LastROTools._lastroQuestRoute = lastroVerifiedRouteRequest;
  LastROTools._lastroTeleportRejected = message => lastroRouteNavigation.onTeleportRejected(message);
  const lastroNativeShortcutEntry = (${captureLastroShortcutEntry.toString()})(LastROTools);
  (${installLastroToolsPanels.toString()})(LastROTools, {
    document: globalThis.document, window: globalThis, GUIComponent, UIManager,
    setHtml: setLastROInnerHTML,
    normalizeRoute: normalizeRouteEntry,
    requestRoute: route => lastroVerifiedRouteRequest.request(route),
    cancelPendingRoute: () => lastroVerifiedRouteRequest.cancelPending(),
    routeMapChanging: () => { lastroVerifiedRouteRequest.cancelPending(); lastroRouteNavigation.onMapChanging(); },
    routeMapChanged: () => lastroRouteNavigation.onMapChanged(),
    cancelRoute: () => lastroVerifiedRouteRequest.cancel(),
    showPrompt: (message, yes, no) => UIManager.showPromptBox(message, "ok", "cancel", yes, no),
    getPresetRoutes: () => {
      const catalog = LastROTeleportPresets.profiles[Configs.get("clientVer", 0)];
      return catalog ? { ...catalog, custom: { ...LastROTeleportPresets.upstreamCustomRoutes, ...catalog.custom } } : {};
    },
    getProfile: () => Configs.get("lastroNid", 0),
    getCurrentLocation: () => {
      const position = SessionStorage_default.Entity?.position;
      const map = normalizeLastROTeleportMap(MapRenderer.currentMap);
      if (MapRenderer.loading || !map || !position
          || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) return;
      return { map, x: Math.floor(position[0]), y: Math.floor(position[1]) };
    },
    loadPreferences: () => {
      const key = "LastROTeleportOrder:" + Configs.get("lastroNid", 0);
      return Preferences.get(key, { _key: key, _version: 1, orders: {} }, 1);
    },
  }, ${JSON.stringify(LASTRO_TOOLS_CSS)});
  (${installLastroShortcutEntry.toString()})(LastROTools, lastroNativeShortcutEntry, {
    document: globalThis.document, setHtml: setLastROInnerHTML,
    getEnabled: getLastroShortcutEntryEnabled,
    normalizeRoute: normalizeRouteEntry,
    requestRoute: route => LastROTools._lastroPanels.requestCustomRoute(route),
  });\n  `;
  const edits = [
    { start: anchor.getStart(file), text: 'init_Preferences$1();\n  ' + install },
    { start: transitions[0].getStart(file), text: 'if (typeof LastROTools !== "undefined") LastROTools?._lastroPanels?.onMapChanging();\n      ' },
    { start: cleanups[0].body.getStart(file) + 1, text: '\n  if (typeof LastROTools !== "undefined") LastROTools?._lastroPanels?.cancelRoute();' },
  ].sort((a, b) => b.start - a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.start);
  return `const LastROTeleportPresets = ${JSON.stringify({ profiles: teleportRoutes.profiles, upstreamCustomRoutes: teleportRoutes.upstreamCustomRoutes })};\n` + patchNavigationPendingTargets(source);
}

export function patchRuntimeShortcutSettings(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const anchors = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'UIManager.addComponent'
        && node.arguments[0]?.getText(file) === 'GraphicsOption') anchors.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (anchors.length !== 1) fail('anchor:lastro-shortcut-settings');
  const call = anchors[0];
  const parent = call.parent;
  // Native registration assigns the returned GUI to GraphicsOption_default.
  // Insert before that whole statement so Escape keeps its append/remove target.
  const statement = ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && parent.left.getText(file) === 'GraphicsOption_default' && parent.right === call ? parent.parent : parent;
  if (!ts.isExpressionStatement(statement) || statement.expression !== call && statement.expression !== parent
    || !ts.isBlock(statement.parent) && !ts.isSourceFile(statement.parent)) fail('anchor:lastro-shortcut-settings:statement');
  const install = `(${installLastroShortcutSettings.toString()})(GraphicsOption, {
    document: globalThis.document,
    getEnabled: getLastroShortcutEntryEnabled,
    setEnabled: setLastroShortcutEntryEnabled,
    onError: () => UIManager.showErrorBox("快捷入口设置保存失败，请重试。"),
  });\n  `;
  const anchor = statement.getStart(file);
  const preference = `let lastroShortcutEntryPreferences;
function getLastroShortcutEntryPreferences() {
  init_Preferences$1();
  if (!lastroShortcutEntryPreferences) {
    const defaults = { _key: "LastROShortcutEntry", _version: 1, enabled: true };
    try { lastroShortcutEntryPreferences = Preferences.get("LastROShortcutEntry", defaults, 1); }
    catch { lastroShortcutEntryPreferences = { ...defaults, save() { Preferences.save(this); } }; }
  }
  return lastroShortcutEntryPreferences;
}
function getLastroShortcutEntryEnabled() {
  return getLastroShortcutEntryPreferences().enabled !== false;
}
async function setLastroShortcutEntryEnabled(enabled) {
  const preferences = getLastroShortcutEntryPreferences();
  const next = { ...preferences, enabled: enabled === true };
  if (typeof next.save !== "function" || await next.save.call(next) === false) throw new Error("Shortcut preference was not saved");
  preferences.enabled = next.enabled;
  if (typeof LastROTools !== "undefined") LastROTools?._lastroShortcutEntry?.setEnabled(next.enabled);
  return true;
}\n`;
  return preference + source.slice(0, anchor) + install + source.slice(anchor);
}

export function patchMapLoadFailureRecovery(source) {
  const file = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'onMapComplete') functions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const fn = functions[0];
  const failures = fn?.body?.statements.filter(node => ts.isIfStatement(node) && node.expression.getText(file) === '!success') || [];
  if (functions.length !== 1 || failures.length !== 1 || fn.parameters.map(node => node.getText(file)).join(',') !== 'success,error'
      || !failures[0].thenStatement.getText(file).includes('UIManager.showErrorBox(error)')
      || failures[0].thenStatement.getText(file).includes('lastroFailedMap')) fail('anchor:map-load-failure');
  const failure = failures[0].thenStatement;
  const replacement = `{
    const lastroFailedMap = this.currentMap;
    this.loading = false;
    this.currentMap = "";
    Mouse.intersect = false;
    if (typeof LastROTools !== "undefined") LastROTools?._lastroPanels?.cancelRoute();
    Network.close();
    console.error("[LastRO] Map load failed", lastroFailedMap, error);
    const lastroMapDiagnostic = describeLastroMapLoadFailure(lastroFailedMap, error);
    globalThis.LastROMapLoadFailure = lastroMapDiagnostic;
    try { globalThis.localStorage?.setItem("LastROMapLoadFailure", JSON.stringify(lastroMapDiagnostic)); } catch { /* Storage may be unavailable. */ }
    UIManager.showErrorBox(lastroMapDiagnostic.message).ui.css("zIndex", 1e3);
    return;
  }`;
  return describeLastroMapLoadFailure.toString() + '\n' + source.slice(0, failure.getStart(file)) + replacement + source.slice(failure.end);
}

export function patchV2Runtime(source) {
  if (!source.startsWith('import ')) fail('anchor:runtime-imports');
  const normalizedSource = source.replace(/\r\n/g, '\n');
  let output = `import { decorateLastROLoginTemplate, decorateLastROLoginStyles, installLastROLogin, beforeLastROLoginConnect, afterLastROLoginPassword } from "./lastro-account-login.mjs";
let lastroWorkerPolicy;
function createLastROWorkerScriptUrl(relativePath) {
	if (relativePath !== "LastROThreadEventHandler.js" && relativePath !== "PathFindingWorker.js") {
		throw new TypeError("Unexpected worker path");
	}
	const workerUrl = new URL(relativePath, import.meta.url);
	const trustedTypes = globalThis.trustedTypes;
	if (!trustedTypes) return workerUrl.href;
	const allowedWorkerUrls = ["LastROThreadEventHandler.js", "PathFindingWorker.js"]
		.map(path => new URL(path, import.meta.url).href);
	const policy = lastroWorkerPolicy ?? (lastroWorkerPolicy = trustedTypes.createPolicy("lastro-iwa-worker", {
		createScriptURL: (value) => {
			const candidate = new URL(value, import.meta.url);
			if (!allowedWorkerUrls.includes(candidate.href)) {
				throw new TypeError("Unexpected worker URL");
			}
			return candidate.href;
		},
	}));
	return policy.createScriptURL(workerUrl.href);
}
function installLastROAudioUnlock() {
	const stateKey = "__lastroAudioUnlock";
	if (globalThis[stateKey]) return globalThis[stateKey];
	let unlocked = false;
	let pendingBgm;
	const audioContexts = new Set();
	const resumeAudioContexts = () => {
		for (const context of audioContexts) {
			if (!context || typeof context.resume !== "function") continue;
			const promise = context.resume();
			if (promise && typeof promise.catch === "function") promise.catch(() => {});
		}
	};
	const retryBgm = () => {
		const audio = pendingBgm;
		pendingBgm = undefined;
		if (!audio || typeof audio.play !== "function") return;
		const promise = audio.play();
		if (promise && typeof promise.catch === "function") promise.catch((error) => {
			if (error?.name === "NotAllowedError") pendingBgm = audio;
		});
	};
	const unlock = () => {
		unlocked = true;
		resumeAudioContexts();
		retryBgm();
	};
	const registerContext = (context) => {
		if (!context || typeof context.resume !== "function") return context;
		audioContexts.add(context);
		if (unlocked && context.state === "suspended") {
			const promise = context.resume();
			if (promise && typeof promise.catch === "function") promise.catch(() => {});
		}
		return context;
	};
	const state = {
		unlock,
		registerContext,
		play(audio, retryOnUnlock = false) {
			const promise = audio.play();
			if (promise && typeof promise.catch === "function") promise.catch((error) => {
				if (error?.name === "NotAllowedError" && retryOnUnlock && !unlocked) pendingBgm = audio;
			});
			return promise;
		},
	};
	for (const event of ["pointerdown", "keydown", "touchstart", "click"])
		document.addEventListener(event, unlock, { capture: true, passive: true });
	globalThis[stateKey] = state;
	return state;
}
function LastROAudioPlay(audio, retryOnUnlock) {
	return installLastROAudioUnlock().play(audio, retryOnUnlock);
}
function LastROAudioUnlock() {
	installLastROAudioUnlock().unlock();
}
function LastROAudioRegisterContext(context) {
	return installLastROAudioUnlock().registerContext(context);
}
installLastROAudioUnlock();
${normalizedSource}`;
  output = output.replace(/\?build=[A-Za-z0-9._-]+/g, '');
  output = replaceOnceAny(output, [
    ['\troInitSpinner.add();\n\tPlugins.init();\n\tGameEngine.init();',
      '\troInitSpinner.add();\n\ttry {\n\t\tPlugins.init();\n\t\tGameEngine.init();\n\t} catch (error) {\n\t\troInitSpinner.remove();\n\t\tthrow error;\n\t}'],
    ['  roInitSpinner.add();\n  Plugins.init();\n  GameEngine.init();',
      '  roInitSpinner.add();\n  try {\n    Plugins.init();\n    GameEngine.init();\n  } catch (error) {\n    roInitSpinner.remove();\n    throw error;\n  }'],
  ]);
  output = replaceOnceAny(output, [
    ['if (_source instanceof Worker) _source.addEventListener("message", Thread.receive, false);',
      'if (_source instanceof Worker) {\n\t\t\t\tconsole.info("[LastRO IWA] waiting for resource worker");\n\t\t\t\t_source.addEventListener("error", (event) => console.error("[LastRO IWA] resource worker failed", event.message));\n\t\t\t\t_source.addEventListener("message", Thread.receive, false);\n\t\t\t}'],
    ['      if (_source instanceof Worker)\n        _source.addEventListener("message", Thread.receive, false);',
      '      if (_source instanceof Worker) {\n        console.info("[LastRO IWA] waiting for resource worker");\n        _source.addEventListener("error", (event) => console.error("[LastRO IWA] resource worker failed", event.message));\n        _source.addEventListener("message", Thread.receive, false);\n      }'],
  ]);
  output = replaceOnce(output, '_thread_ready = true;', '_thread_ready = true;\n\t\t\t\t\t\tconsole.info("[LastRO IWA] resource worker ready; initializing renderer");');
  output = replaceOnce(output, 'savingFiles(files);', 'console.info("[LastRO IWA] initializing remote client resources");\n\t\t\tThread.send("CLIENT_INIT", { files: [], save: false }, (...args) => Client.onFilesLoaded(...args));');
  output = replaceFunctionBody(output, 'defaultSocketFactory', '{\n\tif (typeof globalThis.LastRODirectSocketFactory !== "function") throw new Error("Direct TCP factory unavailable");\n\treturn globalThis.LastRODirectSocketFactory(host, port);\n}');
  output = patchLoginRegistrationHook(output);
  output = patchWebAudioPlayback(output);
  output = patchRuntimeAudioTiming(output);
  output = patchRuntimeFrameTiming(output);
  output = patchRuntimeEntitySync(output);
  output = patchRuntimeEntityAppearance(output);
  output = patchRuntimeEquipmentCatalog(output);
  output = patchRuntimeEquipmentView(output);
  output = patchRuntimeEquipmentAnimation(output);
  output = patchRuntimeMovementInput(output);
  output = patchRuntimeMovementSync(output);
  output = patchRuntimeLastROItemLayouts(output);
  output = patchRuntimeCharacterSwitch(output);
  output = patchRuntimeNetworkHandoffCleanup(output);
  output = patchRuntimeNetworkFramingRecovery(output);
  output = patchRuntimeNetworkCloseDrain(output);
  output = patchRuntimeNetworkDiagnostics(output);
  output = replaceOnce(output, 'init_WebSocket();', '');
  output = replaceOnce(output, 'init_NodeSocket();', '');
  output = replaceWorkerCreation(output);
  output = replacePathFindingWorkerCreation(output);
  output = patchLegacyScriptSinks(output);
  output = patchLuaValueFailure(output);
  output = patchLuaJsonEscapes(output);
  output = patchNpcMenuBlankArea(output);
  output = patchAchievementClaimButton(output);
  for (const table of ['map', 'npc', 'link', 'linkdistance', 'npcdistance']) {
    output = replaceOnce(output, `DB.LUA_PATH + "navigation/navi_${table}_krpri.lub"`,
      `DB.LUA_PATH + "navigation/" + (Configs.get("lastroProtocol", false) ? "navi_${table}_tw.lub" : "navi_${table}_krpri.lub")`);
  }

  output = replaceFunctionBody(output, 'loadXMLFile', `{
  Client.loadFile(filename, function(file) {
    try {
      console.log('Loading file "' + filename + '"...');
      let xml = file instanceof ArrayBuffer ? new Uint8Array(file) : file;
      xml = CodepageManager.decode(xml, userCharpage);
      xml = xml.replace(/^.*<\\?xml/, "<?xml");
      const parsedXML = new DOMParser().parseFromString(xml, "application/xml");
      callback.call(null, xmlparse_default.xml2json(parsedXML));
    } catch (error) {
      console.error("[loadXMLFile] Failed to load " + filename, error);
    } finally {
      onEnd();
    }
  }, onEnd);
}`);
  output = replaceOnce(output, 'const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];', [
    'let gamepads = [];',
    '// Gamepad input is optional; denied IWA permissions must not interrupt login.',
    'const gamepadPolicy = document.permissionsPolicy ?? document.featurePolicy;',
    'try {',
    '  if (typeof navigator.getGamepads === "function" && gamepadPolicy?.allowsFeature?.("gamepad") !== false) {',
    '    gamepads = navigator.getGamepads();',
    '  }',
    '} catch (error) {',
    '  if (error?.name !== "SecurityError") throw error;',
    '}',
  ].join('\n\t\t\t'));

  output = replaceOnceAny(output, [
    ['if (!Configs.get("remoteClient") && !count && !window.electronAPI?.isElectron) {', 'if (!Configs.get("remoteClient") && !count) {'],
    ['      if (\n        !Configs.get("remoteClient") &&\n        !count &&\n        !window.electronAPI?.isElectron\n      ) {', '      if (!Configs.get("remoteClient") && !count) {'],
  ]);
  output = replaceOnce(output, 'el.innerHTML = PRELOADER_INNER_HTML;', [
    'const spinner = document.createElement("div");',
    'spinner.className = "pre-spinner";',
    'const text = document.createElement("p");',
    'text.className = "pre-text";',
    'for (const [index, character] of Array.from("Loading...").entries()) {',
    'const span = document.createElement("span");',
    'span.style.setProperty("--i", String(index));',
    'span.textContent = character;',
    'text.appendChild(span);',
    '}',
    'el.append(spinner, text);',
  ].join('\n\t\t\t\t'));
  for (const pairs of [
    [
      ['      if (remoteClient) Thread.send("SET_HOST", remoteClient);', '      if (remoteClient) Thread.send("SET_HOST", remoteClient);\n      Thread.send("SET_EXECUTABLE_MANIFEST", globalThis.LastROExecutableManifest);'],
      ['if (remoteClient) Thread.send("SET_HOST", remoteClient);', 'if (remoteClient) Thread.send("SET_HOST", remoteClient);\n\t\t\tThread.send("SET_EXECUTABLE_MANIFEST", globalThis.LastROExecutableManifest);'],
    ],
    [
      ['        Thread.send("SET_HOST", remoteClient);', '        Thread.send("SET_HOST", remoteClient);\n      Thread.send("SET_EXECUTABLE_MANIFEST", globalThis.LastROExecutableManifest);'],
      ['\t\t\t\tThread.send("SET_HOST", remoteClient);', '\t\t\t\tThread.send("SET_HOST", remoteClient);\n\t\t\tThread.send("SET_EXECUTABLE_MANIFEST", globalThis.LastROExecutableManifest);'],
    ],
  ]) {
    output = replaceOnceAny(output, pairs);
  }
  output = replaceOnce(output, 'var root = freeGlobal || freeSelf || Function("return this")();', 'var root = freeGlobal || freeSelf || globalThis;');
  output = replaceOnceAny(output, [
    ['return Function(importsKeys, sourceURL + "return " + source).apply(undefined, importsValues);',
      'throw new Error("Dynamic templates are disabled in the IWA runtime");'],
    ['          return Function(importsKeys, sourceURL + "return " + source).apply(\n            undefined,\n            importsValues,\n          );',
      '          throw new Error("Dynamic templates are disabled in the IWA runtime");'],
  ]);
  output = removeRegion(output, ['legacy transport', 'WebSocket']);
  output = removeRegion(output, ['NodeSocket']);
  output = output.replace(/\/\*\*(?:(?!\*\/)[\s\S])*?Default socket factory(?:(?!\*\/)[\s\S])*?\*\/\r?\nfunction defaultSocketFactory/, 'function defaultSocketFactory');
  output = replaceOnceAny(output, [
    ['new GUIComponent(\n    name,\n    enhanceWinLoginStyles(name, cssText),\n  )',
      'new GUIComponent(\n    name,\n    decorateLastROLoginStyles(name, enhanceWinLoginStyles(name, cssText)),\n  )'],
    ['new GUIComponent(name, enhanceWinLoginStyles(name, cssText))',
      'new GUIComponent(name, decorateLastROLoginStyles(name, enhanceWinLoginStyles(name, cssText)))'],
  ]);
  output = replaceOnce(output, 'const renderedHtmlText = enhanceWinLoginTemplate(name, htmlText);',
    'const renderedHtmlText = decorateLastROLoginTemplate(name, enhanceWinLoginTemplate(name, htmlText));');
  output = replaceOnceAny(output, [
    ['    void 0;\n    populateLoginServerButtons(\n      root,\n      Configs.get("loginServerProfiles", []),\n      Configs.getServer?.().id || "lastro",\n      (profile) => Component.onServerSelect(profile),\n    );',
      '    installLastROLogin({ root, component: Component, configs: Configs });'],
    ['\t\tvoid 0;\n\t\tpopulateLoginServerButtons(root, Configs.get("loginServerProfiles", []), Configs.getServer?.().id || "lastro", (profile) => Component.onServerSelect(profile));',
      '\t\tinstallLastROLogin({ root, component: Component, configs: Configs });'],
  ]);
  output = replaceOnceAny(output, [
    ['    const pass = _inputPassword.value;\n    applyDebugLoginFields();',
      '    const pass = _inputPassword.value;\n    if (beforeLastROLoginConnect(user, pass) === false) return false;\n    applyDebugLoginFields();'],
    ['\t\tconst pass = _inputPassword.value;\n\t\tapplyDebugLoginFields();',
      '\t\tconst pass = _inputPassword.value;\n\t\tif (beforeLastROLoginConnect(user, pass) === false) return false;\n\t\tapplyDebugLoginFields();'],
  ]);
  output = patchRuntimeTypography(output);
  output = patchRuntimeDialogTypography(output);
  output = patchRuntimeLocalization(output);
  output = patchRuntimeUiText(output);
  output = patchRuntimeUiMessages(output);
  output = patchRuntimeMapLocalization(output);
  output = patchRuntimeStatusTooltips(output);
  output = patchRuntimeHotkeys(output);
  output = patchRuntimeLuaStartup(output);
  output = patchLuaTableCompletion(output);
  output = patchRuntimeUiLayout(output);
  output = patchScopedUiLayout(output);
  output = patchRuntimeBasicInfoLayout(output);
  output = patchRuntimeMail(output);
  output = patchPetDialogueDecoding(output);
  output = patchRuntimeWorldMap(output);
  output = patchRuntimeChatMapLinks(output);
  output = patchRuntimeNpcMapLinks(output, teleportResourceLoaderCode());
  output = patchRuntimeNpcDialogButtons(output);
  output = patchRuntimeVendingMovement(output);
  output = patchRuntimeAchievementLinks(output, teleportResourceLoaderCode());
  output = patchRuntimeTeleportFeedback(output);
  output = patchRuntimeAutolootSettings(output);
  output = patchRuntimeToolsPanels(output);
  output = patchRuntimeShortcutSettings(output);
  output = patchRuntimePreferencesSave(output);
  output = patchRuntimeNavigationUi(output);
  output = patchRuntimeQuests(output);
  output = patchRuntimeStoreScroll(output);
  output = patchRuntimeStorageCount(output);
  output = patchRuntimeItemName(output);
  output = patchRuntimeUiState(output);
  output = patchRuntimeUiInput(output);
  output = patchRuntimeItemDrag(output);
  output = patchMapLoadFailureRecovery(output);
  output = patchRuntimeTeleportFade(output);
  if (/new WebSocket|wss?:\/\/|socketProxy|electronAPI|NodeSocket/i.test(output)) fail('legacy-transport');
  output = patchRuntimeCredentialSecurity(output);
  output = patchRuntimePluginLoader(output);
  output = patchRuntimeDebugAccess(output);
  output = patchRuntimePlainTextSinks(output);
  const finalOutput = patchRuntimeNavigation(patchTrustedTypesDomWrites(output));
  assertRuntimeLocalizationMount(finalOutput, source);
  return finalOutput;
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: {
    input: { type: 'string' }, output: { type: 'string' }, manifest: { type: 'string' },
  } });
  if (!values.input || !values.output || !values.manifest || !path.isAbsolute(values.input)
    || !path.isAbsolute(values.output) || !path.isAbsolute(values.manifest)) fail('absolute-path-required');
  const input = await readFile(values.input);
  const output = Buffer.from(patchV2Runtime(input.toString('utf8')));
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, output);
  const manifest = {
    source: path.relative(repo, values.input),
    output: path.relative(repo, values.output),
    preSha256: createHash('sha256').update(input).digest('hex'),
    postSha256: createHash('sha256').update(output).digest('hex'),
    anchors: ['defaultSocketFactory', 'init_WebSocket', 'init_NodeSocket', 'electronAPI', 'legacy transport regions', 'Client.init resource manifest', 'LoginEngine.init resource manifest'],
  };
  await writeFile(values.manifest, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ bytes: output.length, ...manifest }) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
