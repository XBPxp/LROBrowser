import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { buildClientConfig } from '../src/runtime/client-config';
import { getAvailableServerProfile } from '../src/servers/server-profiles';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
const prepared = readFileSync('generated/runtime/Online.js', 'utf8');
function region(source: string, path: string) {
  const start = source.indexOf('//#region ' + path), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + path);
  return source.slice(start, end);
}
function functions(source: string, path: string, names: string[]) {
  const file = ts.createSourceFile('fixture.js', region(source, path), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return names.map(name => {
    const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!fn) throw new Error('Missing native function: ' + name);
    return fn.getText(file);
  }).join('\n');
}
type Handler = (packet: Record<string, unknown>) => void;
function fixture(source: string, fail: 'card-prepare' | 'tools-append' | null = null) {
  const timeline: string[] = [], hooks = new Map<string, Handler>();
  const components = new Map<string, Record<string, unknown>>();
  const packetTypes = new Map<string, { new(): { label: string }; id: number; label: string }>();
  const lifecycleFailure = new Error('synthetic panel lifecycle failure');
  function component(name: string) {
    if (components.has(name)) return components.get(name)!;
    const ui: Record<string, unknown> = {
      prepare() { timeline.push('prepare:' + name); if (name === 'CardConnection2' && fail === 'card-prepare') throw lifecycleFailure; },
      append() { timeline.push('append:' + name); if (name === 'LastROTools' && fail === 'tools-append') throw lifecycleFailure; },
      selectUIVersion() {}, selectUIVersionWithJob() {},
      update: vi.fn(), setItems: vi.fn(), setList: vi.fn(), setMap() {}, onMapChanged() {},
      init() {}, onLevelUp() {}, free() {}, load() {}, setTarget() {}, setType() {},
      weight: 0, weight_max: 1,
    };
    ui.getUI = () => ui;
    components.set(name, ui); return ui;
  }
  const packetNamespace = new Proxy({}, { get(_target, key) {
    if (typeof key !== 'string') return undefined;
    if (!packetTypes.has(key)) {
      const id = packetTypes.size + 1, label = key;
      packetTypes.set(key, class { static id = id; static label = label; label = label; });
    }
    return packetTypes.get(key);
  } });
  const config = buildClientConfig(getAvailableServerProfile('lastro-2x'), { username: '', password: '' });
  const life = { hp: -1, hp_max: -1, sp: -1, sp_max: -1, update: vi.fn() };
  const session = { Entity: { life, effectState: 0, position: [0, 0], job: 1, aura: { free() {}, load() {} }, walk: {}, display: {}, set() {}, resetRoute() {} },
    AID: 1, GID: 2, Sex: 0, AuthCode: 3, pet: { friendly: 0 }, ping: {}, Playing: false };
  const connections: Array<(success: boolean) => void> = [];
  const itemInfo = new Map<number, { identifiedResourceName: string }>();
  const getItemInfo = vi.fn((id: number) => itemInfo.get(id));
  const context = vm.createContext({
    window: { ROConfig: config }, document: {}, console, Object, Number, String, Date, Map, Array,
    __esmMin: (init: () => void) => init, __exportAll: (value: unknown) => value,
    PACKET: { ZC: packetNamespace, CZ: packetNamespace },
    SessionStorage_default: session, PacketVerManager_default: { value: 20211103 },
    Network: {
      connect: (_host: string, _port: number, callback: (success: boolean) => void) => { connections.push(callback); },
      hookPacket: (type: { label: string }, callback: Handler) => { timeline.push('hook:' + type.label); hooks.set(type.label, callback); },
      sendPacket: (packet: { label: string }) => { timeline.push('send:' + packet.label); },
      read() {}, setPing() {}, utils: { longToIP: () => 'fixture.invalid' },
    },
    MapRenderer: { currentMap: 'fixture.gat', onLoad: () => {}, setMap() {} },
    DB: { getAllSignboardsForMap: () => null, getJobClass: () => 1, getItemInfo },
    EntityManager: { add: () => timeline.push('entity') },
    StatusState_default: { EffectState: { FALCON: 1, WUG: 2 } },
    shouldUseDebugLegacyMapEnter: () => false, shouldUseLegacyMapEnter: () => true,
    applyLegacyMapEnterFields() {}, applyDebugMapEnterFields() {}, shouldSendMapTimeSync: () => false,
    refreshLastROAutomationSelects() {}, showLastroTeleportNotice() {}, lastroCancelMovement() {}, resetEntityForMapEntry() {},
    LastROInvalidateServerTick() {}, LastROResetServerTick() {},
  });
  const engine = region(source, 'src/Engine/MapEngine.js');
  // Inventory hooks share these real declarations in the prepared Item module.
  // Keep the isolated startup fixture's dependency graph equivalent to that module.
  const robeRegistration = source.includes('function registerLastroCostumeRobeList(')
    ? functions(source, 'src/Engine/MapEngine/Item.js', ['registerLastroCostumeRobeAppearance', 'registerLastroCostumeRobeList']) : '';
  const registers = [
    robeRegistration,
    functions(source, 'src/Engine/MapEngine/Main.js', ['MainEngine$11', 'onParameterChange$1']),
    functions(source, 'src/Engine/MapEngine/Item.js', ['ItemEngine', 'onInventorySetList']),
    functions(source, 'src/Engine/MapEngine/Skill.js', ['SkillEngine', 'onShortCutList']),
  ].join('\n');
  const file = ts.createSourceFile('fixture.js', engine + '\n' + registers, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function stubDependencies(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.right)
      && /^(?:on[A-Z]|req[A-Z]|showLastro)/.test(node.right.text)) context[node.right.text] ??= () => {};
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && (/^init_/.test(node.expression.text) || /(?:Engine|MainEngine)(?:\$\d+)?$/.test(node.expression.text)
        || node.expression.text === 'hookSkillWindow')) context[node.expression.text] ??= () => {};
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const name = node.expression.expression.text;
        if (name !== 'Object' && name !== 'String') context[name] ??= component(name);
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'hookPacket' && node.arguments[1]
        && ts.isIdentifier(node.arguments[1])) context[node.arguments[1].text] ??= () => {};
    }
    ts.forEachChild(node, stubDependencies);
  }
  stubDependencies(file);
  // These are referenced through property assignment or optional lifecycle access.
  for (const name of ['BasicInfoController', 'InventoryController', 'WinStatsController', 'MapControl', 'Camera', 'Cursor',
    'EffectManager', 'Plugins', 'SkillListMH_default', 'Controller$4', 'Controller$3', 'Controller$5', 'controller',
    'EquipmentController', 'PlayerViewEquipController', 'StorageController']) context[name] ??= component(name);
  context.SkillListMH_default = { homunculus: component('homunculus'), mercenary: component('mercenary') };
  context.MapControl = { ...component('MapControl'), init() {} };
  context.Plugins = { init() {} };
  context.Cursor = { ACTION: { DEFAULT: 0, ROTATE: 1 }, setType() {} };
  context.Events ??= { setTimeout, clearTimeout };
  context.Mouse ??= { world: { x: 0, y: 0 }, MOUSE_STATE: { USESKILL: 1 } };
  context.KEYS ??= { SHIFT: false };
  context.Altitude ??= { width: 100, height: 100 };
  context.performance ??= performance;
  const shoppingLifecycle = source.includes('function lastroCloseVendingShopping(')
    ? functions(source, 'src/UI/Components/NpcStore/NpcStore.js', ['lastroCloseVendingShopping']) : '';
  vm.runInContext(region(source, 'src/Core/Configs.js') + '\ninit_Configs(); Configs.setServer(window.ROConfig.servers[0]);\n'
    + region(source, 'src/DB/Status/StatusProperty.js') + '\ninit_StatusProperty();\n'
    + region(source, 'src/DB/Items/EquipmentLocation.js') + '\ninit_EquipmentLocation();\n'
    + region(source, 'src/DB/Items/RobeTable.js') + '\ninit_RobeTable();\n'
    + shoppingLifecycle + '\n' + engine.replaceAll('import.meta.url', '"isolated-app://synthetic/runtime/Online.js"') + '\n' + registers
    + '\ninit_MapEngine();', context);
  return { context, timeline, hooks, components, session, connections, lifecycleFailure, itemInfo, getItemInfo,
    start: () => vm.runInContext('MapEngine.init(0, 5121, "fixture.gat");', context),
    mapLoaded: () => vm.runInContext('onMapChange({xPos:1,yPos:2,mapName:"fixture.gat"}); MapRenderer.onLoad();', context) };
}

describe.each([['native', native], ['prepared', prepared]])('%s map initialization', (_kind, source) => {
  it('prepares the card panel and installs real status, inventory and shortcut callbacks before connecting completes', () => {
    const f = fixture(source); f.start();
    for (const name of ['ACCEPT_ENTER', 'PAR_CHANGE', 'LONGPAR_CHANGE', 'LONGLONGPAR_CHANGE', 'STATUS',
      'NORMAL_ITEMLIST', 'EQUIPMENT_ITEMLIST', 'SHORTCUT_KEY_LIST_V2', 'SKILLINFO_LIST']) expect(f.hooks.has(name)).toBe(true);
    expect(f.timeline.indexOf('prepare:CardConnection2')).toBeLessThan(f.timeline.indexOf('hook:PAR_CHANGE'));
    expect(f.connections).toHaveLength(1); f.connections[0]!(true); expect(f.session.Playing).toBe(true);
    for (const [varID, count] of [[6, 1000], [5, 750], [8, 300], [7, 225], [25, 50000], [24, 12000]])
      f.hooks.get('PAR_CHANGE')!({ varID, count });
    expect(f.session.Entity.life).toMatchObject({ hp: 750, hp_max: 1000, sp: 225, sp_max: 300 });
    expect(f.components.get('BasicInfoController')!.update).toHaveBeenCalledWith('hp', 750, 1000);
    expect(f.components.get('BasicInfoController')!.update).toHaveBeenCalledWith('weight', 12000, 50000);
    const items = [{ index: 1, ITID: 501, count: 11 }], shortcuts = [{ isSkill: false, ID: 501, count: 11 }];
    f.hooks.get('NORMAL_ITEMLIST')!({ itemInfo: items });
    f.hooks.get('SHORTCUT_KEY_LIST_V2')!({ tab: 0, ShortCutKey: shortcuts });
    expect(f.components.get('InventoryController')!.setItems).toHaveBeenCalledExactlyOnceWith(items);
    expect(f.components.get('ShortCut_default')!.setList).toHaveBeenCalledExactlyOnceWith(shortcuts);
  });

  it('exposes a card prepare failure rather than reporting the later status engines as initialized', () => {
    const f = fixture(source, 'card-prepare'); expect(() => f.start()).toThrow(f.lifecycleFailure);
    expect(f.hooks.has('ACCEPT_ENTER')).toBe(true);
    expect(f.hooks.has('PAR_CHANGE')).toBe(false); expect(f.hooks.has('NORMAL_ITEMLIST')).toBe(false);
    expect(f.hooks.has('SHORTCUT_KEY_LIST_V2')).toBe(false);
  });

  it('sends actor-ready only after the real map-load callback finishes mounting game UI', () => {
    const f = fixture(source); f.start(); f.mapLoaded();
    expect(f.timeline).toContain('entity'); expect(f.timeline).toContain('send:NOTIFY_ACTORINIT');
    expect(f.timeline.indexOf('append:LastROTools')).toBeLessThan(f.timeline.indexOf('send:NOTIFY_ACTORINIT'));
  });

  it('keeps a map-load panel failure visible and does not pretend the actor-ready handshake completed', () => {
    const f = fixture(source, 'tools-append'); f.start(); expect(() => f.mapLoaded()).toThrow(f.lifecycleFailure);
    expect(f.timeline).toContain('entity'); expect(f.timeline).not.toContain('send:NOTIFY_ACTORINIT');
    expect(f.hooks.has('PAR_CHANGE')).toBe(true);
  });
});

it('registers worn costume visuals through real startup inventory hooks without changing ordinary inventory', () => {
  const f = fixture(prepared); f.start();
  const slots = f.context.EquipmentLocation_default;
  const robes = f.context.RobeTable_default as Record<number, string>;
  const ordinary = { index: 1, ITID: 501, count: 11 };
  f.hooks.get('NORMAL_ITEMLIST')!({ itemInfo: [ordinary] });
  expect(f.getItemInfo).not.toHaveBeenCalled();
  expect(f.components.get('InventoryController')!.setItems).toHaveBeenLastCalledWith([ordinary]);
  expect(ordinary).toEqual({ index: 1, ITID: 501, count: 11 });
  for (const id of [45000, 45001, 45002]) f.itemInfo.set(id, { identifiedResourceName: '测试披肩时装' });
  const worn = { index: 2, ITID: 45000, WearState: slots.COSTUME_ROBE, wItemSpriteNumber: 9001 };
  const items = [worn,
    { index: 3, ITID: 45001, WearState: slots.GARMENT, wItemSpriteNumber: 9002 },
    { index: 4, ITID: 45002, WearState: 0, wItemSpriteNumber: 9003 }];
  expect(robes[9001]).toBeUndefined();
  f.hooks.get('EQUIPMENT_ITEMLIST')!({ itemInfo: items });
  expect(robes[9001]).toBe('测试披肩时装');
  expect(robes[9002]).toBeUndefined(); expect(robes[9003]).toBeUndefined();
  expect(f.getItemInfo).toHaveBeenCalledExactlyOnceWith(45000);
  expect(f.components.get('InventoryController')!.setItems).toHaveBeenLastCalledWith(items);
  expect((f.components.get('InventoryController')!.setItems as ReturnType<typeof vi.fn>).mock.lastCall?.[0]).toBe(items);
});
