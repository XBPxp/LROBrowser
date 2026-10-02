import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  patchRuntimeEquipmentAppearance,
  patchRuntimeEquipmentCatalog,
  patchRuntimeEquipmentView,
} from '../scripts/lastro-equipment-view.mjs';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
function region(source: string, path: string) {
  const start = source.indexOf('//#region ' + path), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native equipment region: ' + path);
  return source.slice(start, end + '//#endregion'.length);
}
function nodeText(source: string, predicate: (node: ts.Node, file: ts.SourceFile) => boolean) {
  const file = ts.createSourceFile('native-equipment.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (predicate(node, file)) found.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (found.length !== 1) throw new Error('Missing/ambiguous native equipment node');
  return found[0]!;
}
function assignment(path: string) {
  const start = native.indexOf('  ' + path + ' =');
  if (start < 0) throw new Error('Missing native equipment assignment: ' + path);
  return nodeText(native.slice(start, start + 6000), (node, file) =>
    ts.isBinaryExpression(node) && node.left.getText(file) === path) + ';';
}
const itemRegion = region(native, 'src/Engine/MapEngine/Item.js');
const previewRegion = region(native, 'src/UI/Components/ItemPreview/ItemPreview.js');
const appearance = patchRuntimeEquipmentAppearance(itemRegion + '\n' + previewRegion);
const patchedItem = region(appearance, 'src/Engine/MapEngine/Item.js');
const patchedPreview = region(appearance, 'src/UI/Components/ItemPreview/ItemPreview.js');
const itemFunctions = new Map([itemRegion, patchedItem].map(source => {
  const file = ts.createSourceFile('Item.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return [source, file.statements.filter(node => ts.isFunctionDeclaration(node)
    && (['onItemEquip', 'onEquipementTakeOff', 'onItemListEquip', 'onInventorySetList', 'onItemPickAnswer'].includes(node.name?.text || '')
      || node.name?.text.startsWith('registerLastroCostumeRobe'))).map(node => node.getText(file)).join('\n')];
}));
const entityRegion = region(native, 'src/Engine/MapEngine/Entity.js');
const viewRegion = patchRuntimeEquipmentView(region(native, 'src/Renderer/Entity/EntityView.js'));
const equipmentRegion = region(native, 'src/UI/Components/Equipment/EquipmentCommon.js');
const inventoryRegion = region(native, 'src/UI/Components/Inventory/InventoryCommon.js');
const dbRegion = region(native, 'src/DB/DBManager.js');
const previewFunctions = new Map([previewRegion, patchedPreview].map(source => [source,
  ['getItemLocation', 'getPreviewSpriteId$1'].map(name => nodeText(source,
    node => ts.isFunctionDeclaration(node) && node.name?.text === name)).join('\n'),
]));
const viewHandler = nodeText(entityRegion,
  node => ts.isFunctionDeclaration(node) && node.name?.text === 'onEntityViewChange');
const nativeEquipmentMethods = ['equip', 'unEquip', 'checkEquipLoc'].map(name =>
  nodeText(equipmentRegion, (node, file) => ts.isBinaryExpression(node)
    && node.left.getText(file) === 'Component.' + name) + ';').join('\n');
const nativeInventoryMethods = ['setItems', 'addItemSub'].map(name =>
  nodeText(inventoryRegion, (node, file) => ts.isBinaryExpression(node)
    && node.left.getText(file) === 'Component.' + name) + ';').join('\n');
const nativeInventoryFunctions = ['getItemTab', 'countLabel'].map(name =>
  nodeText(inventoryRegion, node => ts.isFunctionDeclaration(node) && node.name?.text === name)).join('\n');
const nativeResourcePaths = ['getHatPath', 'getRobePath', 'getRobePathNoSex'].map(name =>
  nodeText(dbRegion, node => ts.isMethodDeclaration(node) && node.name.getText() === name)).join('\n');
const equipPackets = ['REQ_WEAR_EQUIP_ACK', 'REQ_WEAR_EQUIP_ACK2', 'ACK_WEAR_EQUIP_V5'] as const;
const takeoffPackets = ['REQ_TAKEOFF_EQUIP_ACK', 'REQ_TAKEOFF_EQUIP_ACK2', 'ACK_TAKEOFF_EQUIP_V5'] as const;
const listPackets = ['EQUIPMENT_ITEMLIST5', 'SPLIT_SEND_ITEMLIST_EQUIP', 'SPLIT_SEND_ITEMLIST_EQUIP2'] as const;
const packetNames = [...equipPackets, ...takeoffPackets, ...listPackets, 'ITEM_PICKUP_ACK3', 'SPRITE_CHANGE', 'SPRITE_CHANGE2'] as const;
type EquipPacket = typeof equipPackets[number];
type TakeoffPacket = typeof takeoffPackets[number];
type ListPacket = typeof listPackets[number];
type PacketName = typeof packetNames[number];
const packetSource = packetNames.flatMap(name => [assignment('PACKET.ZC.' + name), assignment('PACKET.ZC.' + name + '.size')]).join('\n');
const packetIds = new Map(packetNames.map(name => {
  const match = new RegExp('^    (\\d+): PACKET\\.ZC\\.' + name + ',', 'm').exec(native);
  if (!match) throw new Error('Missing native equipment packet ID: ' + name);
  return [name, Number(match[1])];
}));
const packetHandler = (name: PacketName) => name.startsWith('SPRITE_CHANGE') ? 'onEntityViewChange'
  : name.startsWith('SPLIT_SEND') ? 'onItemListEquip' : name === 'EQUIPMENT_ITEMLIST5' ? 'onInventorySetList'
  : name === 'ITEM_PICKUP_ACK3' ? 'onItemPickAnswer' : name.includes('TAKEOFF') ? 'onEquipementTakeOff' : 'onItemEquip';
const nativeHooks = packetNames.map(name => nodeText(name.startsWith('SPRITE_CHANGE') ? entityRegion : itemRegion,
  (node, file) => ts.isExpressionStatement(node) && node.getText(file) ===
    `Network.hookPacket(PACKET.ZC.${name}, ${packetHandler(name)});`)).join('\n');

type Part = 'robe' | 'weapon' | 'shield' | 'accessory' | 'accessory2' | 'accessory3';
interface Files { spr: string | null; act: string | null; pal: string | null; size: number; }
interface Actor {
  constructor: Record<string, number>; objecttype: number; GID: number; files: Record<string, Files>;
  _job: number; _sex: number; _body: number; _robe: number; _weapon: number; _shield: number;
  _head: number; _headpalette: number; _bodypalette: number;
  _accessory: number; _accessory2: number; _accessory3: number;
  job: number; robe: number; weapon: number; shield: number; accessory: number; accessory2: number; accessory3: number;
}
interface Item { index: number; ITID: number; WearState?: number; equipped?: number; wItemSpriteNumber?: number; type?: number; location?: number; }
interface Pending { path: string; success?: () => void; failure?: () => void; done?: boolean; }
interface Packet { index?: number; wearLocation?: number; viewid?: number; result?: boolean | number; GID?: number; type?: number; value?: number; value2?: number; ItemInfo?: Item[]; }
type PacketConstructor = (new (reader: { seek(offset: number): void }, end: number) => Packet) & { size: number };
const slots: { ordinary: string; costume: string; part: Part; look: number }[] = [
  { ordinary: 'HEAD_TOP', costume: 'COSTUME_HEAD_TOP', part: 'accessory2', look: 4 },
  { ordinary: 'HEAD_MID', costume: 'COSTUME_HEAD_MID', part: 'accessory3', look: 5 },
  { ordinary: 'HEAD_BOTTOM', costume: 'COSTUME_HEAD_BOTTOM', part: 'accessory', look: 3 },
  { ordinary: 'GARMENT', costume: 'COSTUME_ROBE', part: 'robe', look: 12 },
];

function fixture(source = patchedItem, packetVersion = 20240101) {
  const pending: Pending[] = [], inventory = new Map<number, Item>(), list: Record<number, Item> = {};
  const info = new Map<number, { identifiedResourceName: unknown; identifiedDisplayName: string }>();
  const hooks = new Map<unknown, (packet: Packet) => void>();
  const root = { querySelectorAll: () => [], querySelector: () => null };
  const equipment = { getRoot: () => root } as {
    getRoot(): typeof root; equip(item: Item, location: number): void; unEquip(index: number, location: number): Item;
    checkEquipLoc(location: number): number;
  };
  const inventoryUI = {
    equippedItems: [] as number[], list: [] as Item[], TAB: { USABLE: 0, EQUIP: 1, ETC: 2, FAV: 3 },
    isInEquipSwitchList: () => false, getRoot: () => root,
    getItemByIndex: (index: number) => inventory.get(index), onUpdateItem: vi.fn(),
    addItem: vi.fn((item: Item) => { inventory.set(item.index, item); }),
    removeItem: vi.fn((index: number) => { const item = inventory.get(index); inventory.delete(index); return item; }),
  };
  const effects = { chat: vi.fn(), switchTakeoff: vi.fn(), cartItems: vi.fn(), storageItems: vi.fn() };
  const db = {
    INTERFACE_PATH: 'interface/', getItemInfo: (id: number) => info.get(id),
    getItemName: (item: Item) => info.get(item.ITID)?.identifiedDisplayName,
    getMessage: (id: number) => String(id),
    getCartPath: (id: number) => 'cart/' + id,
    getBodyPath: (job: number, sex: number, style = 0) => `body/${job}/${sex}/${style}`,
    getAdminPath: (sex: number) => 'admin/' + sex,
    getWeaponPath: (id: number, job: number, sex: number) => `weapon/${id}/${job}/${sex}`,
    getWeaponViewID: (id: number) => id + 100,
    getWeaponSound: (id: number) => 'sound/' + id, getWeaponTrail: (id: number) => 'trail/' + id,
    getShieldPath: (id: number, job: number, sex: number) => `shield/${id}/${job}/${sex}`,
    isPlayer: (job: number) => job < 10000, isMonster: (job: number) => job >= 10000,
    isBaby: () => false, isDoram: () => false,
  };
  const context = vm.createContext({
    console, self: {}, __esmMin: (init: () => void) => init, ArrayBuffer, DataView, Uint8Array,
    DB: db, Client: { loadFile: (path: string, success?: () => void, failure?: () => void) => pending.push({ path, success, failure }) },
    PacketVerManager_default: { value: packetVersion }, PACKET: { ZC: {} },
    Network: { hookPacket: (name: unknown, callback: (packet: Packet) => void) => hooks.set(name, callback) },
    init_CodepageManager() {},
    Component: equipment, _list: list, entityRender: true, switchEquip: false, enchantGrade: false,
    getSelectorFromLocation$1: () => '.fixture-slot', EquipmentController: { getUI: () => equipment },
    InventoryController: { getUI: () => inventoryUI }, SwitchEquip_default: { unEquip: effects.switchTakeoff },
    CartItems_default: { setItems: effects.cartItems }, StorageController: { getUI: () => ({ setItems: effects.storageItems }) },
    ChatBox_default: { addText: effects.chat, TYPE: { ERROR: 1, BLUE: 2 }, FILTER: { ITEM: 1 } },
    ItemObtain_default: { append() {}, set() {} }, refreshLastROAutomationSelects() {},
    nativeInventoryUI: inventoryUI, favoriteTab: false, equipSwitch: false, _preferences: { tab: -1 },
    MountTable: {}, AllMountTable: {}, ShadowTable_default: {}, setTimeout() {},
  });
  vm.runInContext(`
    ${region(native, 'src/DB/Items/EquipmentLocation.js')}
    init_EquipmentLocation();
    ${region(native, 'src/DB/Items/ItemType.js')}
    init_ItemType();
    ${region(native, 'src/DB/Items/RobeTable.js')}
    init_RobeTable();
    ${region(native, 'src/DB/Items/HatTable.js')}
    init_HatTable();
    ${patchRuntimeEquipmentCatalog(region(native, 'src/DB/Jobs/JobConst.js'))}
    init_JobConst();
    ${region(native, 'src/DB/Jobs/JobNameTable.js')}
    init_JobNameTable();
    var SexTable;
    ${assignment('SexTable')}
    class NativeResourcePaths { ${nativeResourcePaths} }
    for (const name of ['getHatPath', 'getRobePath', 'getRobePathNoSex']) DB[name] = NativeResourcePaths[name];
    ${region(native, 'src/Utils/Struct.js')}
    ${region(native, 'src/Utils/BinaryReader.js')}
    init_BinaryReader();
    ${packetSource}
    ${nativeEquipmentMethods}
    function installNativeInventoryMethods(Component) {
      ${nativeInventoryFunctions}
      ${nativeInventoryMethods}
    }
    installNativeInventoryMethods(nativeInventoryUI);
    ${viewRegion}
    HeadParts = ['head', 'accessory', 'accessory2', 'accessory3'];
    ${itemFunctions.get(source)}
    ${previewFunctions.get(source === itemRegion ? previewRegion : patchedPreview)}
    ${viewHandler}
    ${nativeHooks}
    globalThis.initView = Init$5;
    globalThis.locations = EquipmentLocation_default;
    globalThis.robeTable = RobeTable_default;
    globalThis.hatTable = HatTable_default;
  `, context);
  const actor = {
    constructor: { TYPE_PC: 0, TYPE_UNKNOWN: -1 }, GID: 42, objecttype: 0, _job: 4010, _sex: 1,
    _robe: 0, _weapon: 0, _shield: 0, _head: -1, _headpalette: 0, _bodypalette: 0,
    _accessory: 0, _accessory2: 0, _accessory3: 0, sound: {},
  } as unknown as Actor;
  context.initView.call(actor); actor._body = 0;
  context.SessionStorage_default = { Entity: actor };
  context.EntityManager = { get: (id: number) => id === actor.GID ? actor : undefined };
  const locations = context.locations as Record<string, number>;
  const robeTable = context.robeTable as Record<number, string>, hatTable = context.hatTable as Record<number, string>;
  function add(index: number, location: number, view: number, equipped = true, resource?: unknown) {
    const item = { index, ITID: 1000 + index, WearState: equipped ? location : 0,
      equipped: equipped ? location : 0, wItemSpriteNumber: view };
    info.set(item.ITID, { identifiedResourceName: arguments.length >= 5 ? resource : `resource_${view}`, identifiedDisplayName: 'item ' + index });
    if (equipped) list[index] = item; else inventory.set(index, item);
    return item;
  }
  function decode(name: PacketName, bytes: Uint8Array) {
    const Constructor = context.PACKET.ZC[name] as PacketConstructor;
    const reader = new context.BinaryReader(bytes); reader.seek(Constructor.size < 0 ? 4 : 2);
    const packet = new Constructor(reader, bytes.length);
    const callback = hooks.get(Constructor);
    if (!callback) throw new Error('Missing real equipment hook: ' + name);
    expect(reader.tell()).toBe(bytes.length);
    callback(packet);
    return { packet, bytes: [...bytes] };
  }
  function equip(index: number, location: number, viewid: number, success = true, name: EquipPacket = 'ACK_WEAR_EQUIP_V5') {
    const wide = name === 'ACK_WEAR_EQUIP_V5', hasView = name !== 'REQ_WEAR_EQUIP_ACK' || packetVersion >= 20100629;
    const bytes = new Uint8Array(wide ? 11 : hasView ? 9 : 7), view = new DataView(bytes.buffer);
    view.setUint16(0, packetIds.get(name)!, true); view.setUint16(2, index, true);
    if (wide) view.setUint32(4, location, true); else view.setUint16(4, location, true);
    if (hasView) view.setUint16(wide ? 8 : 6, viewid, true);
    view.setUint8(bytes.length - 1, name === 'REQ_WEAR_EQUIP_ACK' ? Number(success) : Number(!success));
    return decode(name, bytes);
  }
  function takeoff(index: number, location: number, success = true, name: TakeoffPacket = 'ACK_TAKEOFF_EQUIP_V5') {
    const wide = name === 'ACK_TAKEOFF_EQUIP_V5', bytes = new Uint8Array(wide ? 9 : 7), view = new DataView(bytes.buffer);
    view.setUint16(0, packetIds.get(name)!, true); view.setUint16(2, index, true);
    if (wide) view.setUint32(4, location, true); else view.setUint16(4, location, true);
    view.setUint8(wide ? 8 : 6, name === 'REQ_TAKEOFF_EQUIP_ACK' ? Number(success) : Number(!success));
    return decode(name, bytes);
  }
  function look(type: number, value: number, name: 'SPRITE_CHANGE' | 'SPRITE_CHANGE2' = 'SPRITE_CHANGE2', gid = 42) {
    const modern = packetVersion >= 20180704;
    const bytes = new Uint8Array(name === 'SPRITE_CHANGE2' ? modern ? 15 : 11 : 8), view = new DataView(bytes.buffer);
    view.setUint16(0, packetIds.get(name)!, true); view.setUint32(2, gid, true); view.setUint8(6, type);
    if (name === 'SPRITE_CHANGE2' && modern) { view.setUint32(7, value, true); view.setUint32(11, 0, true); }
    else if (name === 'SPRITE_CHANGE2') { view.setInt16(7, value, true); view.setInt16(9, 0, true); }
    else view.setUint8(7, value);
    return decode(name, bytes);
  }
  function initialList(items: { index: number; location: number; view: number; worn?: boolean; resource?: unknown }[], name: ListPacket = 'SPLIT_SEND_ITEMLIST_EQUIP2', invType = 0) {
    const old = name === 'EQUIPMENT_ITEMLIST5', v2 = name === 'SPLIT_SEND_ITEMLIST_EQUIP2';
    const itemSize = old ? 57 : v2 ? 68 : 67, prefix = old ? 4 : 5;
    const bytes = new Uint8Array(prefix + items.length * itemSize), view = new DataView(bytes.buffer);
    view.setUint16(0, packetIds.get(name)!, true); view.setUint16(2, bytes.length, true);
    if (!old) view.setUint8(4, invType);
    items.forEach((item, index) => {
      const data = add(item.index, item.location, item.view, false, item.resource ?? `resource_${item.view}`);
      inventory.delete(data.index);
      let offset = prefix + index * itemSize;
      const short = (value: number) => { view.setUint16(offset, value, true); offset += 2; };
      const long = (value: number) => { view.setUint32(offset, value, true); offset += 4; };
      const byte = (value: number) => { view.setUint8(offset++, value); };
      short(item.index); if (old) short(data.ITID); else long(data.ITID);
      byte(context.ItemType_default.ARMOR); long(item.location); long(item.worn === false ? 0 : item.location);
      if (!v2) byte(0);
      for (let card = 0; card < 4; card++) { if (old) short(0); else long(0); }
      long(0); short(0); short(item.view); byte(0);
      offset += 25;
      if (v2) { byte(0); byte(0); }
      byte(1); expect(offset).toBe(prefix + (index + 1) * itemSize);
    });
    return decode(name, bytes);
  }
  function pickup(index: number, location: number, resource: unknown = 'picked_item') {
    const name = 'ITEM_PICKUP_ACK3', bytes = new Uint8Array(29), view = new DataView(bytes.buffer);
    info.set(1000 + index, { identifiedResourceName: resource, identifiedDisplayName: 'picked item' });
    view.setUint16(0, packetIds.get(name)!, true); view.setUint16(2, index, true); view.setUint16(4, 1, true);
    view.setUint16(6, 1000 + index, true); view.setUint8(8, 1); view.setUint16(19, location, true);
    view.setUint8(21, context.ItemType_default.ARMOR); view.setUint8(22, 0);
    return decode(name, bytes);
  }
  function path(part: Part, id: number) {
    const paths = context.DB as { getRobePath(id: number, job: number, sex: number): string; getHatPath(id: number, sex: number): string;
      getWeaponPath(id: number, job: number, sex: number): string; getShieldPath(id: number, job: number, sex: number): string };
    if (part === 'robe') return paths.getRobePath(id, actor.job, actor._sex) + '.spr';
    if (part === 'weapon') return paths.getWeaponPath(id, actor.job, actor._sex) + '.spr';
    if (part === 'shield') return paths.getShieldPath(id, actor.job, actor._sex) + '.spr';
    return paths.getHatPath(id, actor._sex) + '.spr';
  }
  function finish(resource: string, success = true) {
    const request = pending.find(item => item.path === resource && !item.done && (success ? item.success : item.failure));
    if (!request) throw new Error('No pending equipment resource: ' + resource);
    request.done = true; (success ? request.success : request.failure)?.();
  }
  const robeAct = (id: number) => context.DB.getRobePath(id, actor.job, actor._sex) + '.act';
  const preview = (item: Item, metadata: { identifiedResourceName: unknown; ClassNum?: number }) => context.getPreviewSpriteId$1(item, metadata) as number;
  return { actor, pending, inventory, list, equipment, inventoryUI, effects, locations, robeTable, hatTable, add, equip, takeoff, look, initialList, pickup, preview, path, robeAct, finish };
}

describe('native equipment ACK appearance priority', () => {
  it('reproduces the old costume-robe removal clearing the ordinary robe and restores its view after the fix', () => {
    for (const [source, expected] of [[itemRegion, 0], [patchedItem, 2]] as const) {
      const f = fixture(source), L = f.locations;
      f.add(1, L.GARMENT!, 2); f.add(2, L.COSTUME_ROBE!, 3); f.actor.robe = 3;
      f.takeoff(2, L.COSTUME_ROBE!);
      expect(f.actor.robe).toBe(expected);
      expect(f.equipment.checkEquipLoc(L.GARMENT!)).toBe(2);
      expect(f.inventory.get(2)?.WearState).toBe(0);
    }
  });

  it.each(takeoffPackets)('restores the ordinary robe through decoded %s, including its wire result convention', name => {
    const f = fixture(), L = f.locations;
    f.add(1, L.GARMENT!, 2); f.add(2, L.COSTUME_ROBE!, 3); f.actor.robe = 3;
    const response = f.takeoff(2, L.COSTUME_ROBE!, true, name);
    expect(Boolean(response.packet.result)).toBe(true); expect(f.actor.robe).toBe(2);
    expect(f.actor.files.robe).toMatchObject({ spr: null, act: null });
    f.finish(f.path('robe', 2)); expect(f.actor.files.robe!.spr).toBe(f.path('robe', 2));
  });

  it.each(slots)('preserves $costume priority across ordinary equip/remove and restores $ordinary after costume removal', slot => {
    const f = fixture(), L = f.locations;
    f.add(1, L[slot.ordinary]!, 2, false); f.add(2, L[slot.costume]!, 3, false);
    f.equip(1, L[slot.ordinary]!, 2); expect(f.actor[slot.part]).toBe(2);
    f.equip(2, L[slot.costume]!, 3); expect(f.actor[slot.part]).toBe(3);
    f.add(3, L[slot.ordinary]!, 4, false);
    f.takeoff(1, L[slot.ordinary]!); expect(f.actor[slot.part]).toBe(3);
    f.equip(3, L[slot.ordinary]!, 4); expect(f.actor[slot.part]).toBe(3);
    f.takeoff(2, L[slot.costume]!); expect(f.actor[slot.part]).toBe(4);
    f.takeoff(3, L[slot.ordinary]!); expect(f.actor[slot.part]).toBe(0);
  });

  it.each(slots)('caches the ACK view for a newly picked $costume so later ordinary equipment cannot replace it', slot => {
    const baseline = fixture(itemRegion), fixed = fixture();
    for (const [f, expected] of [[baseline, 2], [fixed, 3]] as const) {
      const L = f.locations, pickup = f.pickup(1, L[slot.costume]!);
      expect(pickup.packet).not.toHaveProperty('wItemSpriteNumber');
      f.equip(1, L[slot.costume]!, 3);
      expect(f.actor[slot.part]).toBe(3);
      f.add(2, L[slot.ordinary]!, 2, false); f.equip(2, L[slot.ordinary]!, 2);
      expect(f.actor[slot.part]).toBe(expected);
      if (f === fixed) expect(f.list[1]?.wItemSpriteNumber).toBe(3);
    }
  });

  it('retains the last known item view when an older successful ACK has no view field', () => {
    const f = fixture(patchedItem, 20090601), item = f.add(1, f.locations.HEAD_TOP!, 7, false);
    const response = f.equip(1, f.locations.HEAD_TOP!, 999, true, 'REQ_WEAR_EQUIP_ACK');
    expect(response.packet).not.toHaveProperty('viewid'); expect(item.wItemSpriteNumber).toBe(7);
    f.look(4, 7, 'SPRITE_CHANGE'); expect(f.actor.accessory2).toBe(7);
  });

  it('caches an explicit zero view from a successful ACK without retaining an older item view', () => {
    const f = fixture(), item = f.add(1, f.locations.WEAPON!, 7, false);
    f.equip(1, f.locations.WEAPON!, 0);
    expect(item.wItemSpriteNumber).toBe(0); expect(f.equipment.checkEquipLoc(f.locations.WEAPON!)).toBe(0);
    expect(f.actor.weapon).toBe(0);
  });

  it.each(equipPackets)('mounts a costume robe using decoded %s and the native item resource table', name => {
    const f = fixture(); f.add(1, f.locations.COSTUME_ROBE!, 3165, false, '  costume_wing  ');
    const response = f.equip(1, f.locations.COSTUME_ROBE!, 3165, true, name);
    expect(Boolean(response.packet.result)).toBe(true); expect(f.actor.robe).toBe(3165);
    expect(f.robeTable[3165]).toBe('costume_wing');
    const resource = f.path('robe', 3165);
    expect(resource).toContain('/costume_wing/'); expect(f.pending.some(item => item.path === resource)).toBe(true);
    f.finish(resource); expect(f.actor.files.robe).toMatchObject({ spr: resource, act: f.robeAct(3165) });
  });

  it.each([...equipPackets, ...takeoffPackets])('leaves every appearance and equipment entry unchanged for failed %s', name => {
    const f = fixture(), L = f.locations, mask = L.COSTUME_ROBE! | L.COSTUME_HEAD_TOP!;
    const takingOff = name.includes('TAKEOFF'), item = f.add(1, mask, 3, takingOff);
    f.actor.robe = 2; f.actor.accessory2 = 2;
    const before = f.pending.length;
    if (takingOff) f.takeoff(1, mask, false, name as TakeoffPacket);
    else f.equip(1, mask, 3, false, name as EquipPacket);
    expect(f.actor.robe).toBe(2); expect(f.actor.accessory2).toBe(2); expect(f.pending).toHaveLength(before);
    expect(takingOff ? f.list[1] : f.inventory.get(1)).toBe(item);
    expect(item.wItemSpriteNumber).toBe(3);
    expect(f.inventoryUI.addItem).not.toHaveBeenCalled(); expect(f.inventoryUI.removeItem).not.toHaveBeenCalled();
    expect(f.effects.switchTakeoff).not.toHaveBeenCalled();
  });

  it('handles one item occupying all costume head slots and the robe without disturbing independent ordinary slots', () => {
    const f = fixture(), L = f.locations;
    const mask = slots.reduce((value, slot) => value | L[slot.costume]!, 0);
    slots.forEach((slot, index) => f.add(index + 1, L[slot.ordinary]!, index + 2));
    f.add(10, mask, 7, false); f.equip(10, mask, 7);
    slots.forEach(slot => expect(f.actor[slot.part]).toBe(7));
    f.takeoff(10, mask);
    slots.forEach((slot, index) => expect(f.actor[slot.part]).toBe(index + 2));
  });

  it('updates multiple ordinary head slots with their independent costume overrides', () => {
    const f = fixture(), L = f.locations;
    const mask = L.HEAD_TOP! | L.HEAD_MID! | L.HEAD_BOTTOM!;
    f.add(1, L.COSTUME_HEAD_TOP!, 3); f.add(2, L.COSTUME_HEAD_BOTTOM!, 4);
    f.add(3, mask, 2, false); f.equip(3, mask, 2);
    expect(f.actor.accessory2).toBe(3); expect(f.actor.accessory3).toBe(2); expect(f.actor.accessory).toBe(4);
    f.takeoff(3, mask);
    expect(f.actor.accessory2).toBe(3); expect(f.actor.accessory3).toBe(0); expect(f.actor.accessory).toBe(4);
  });

  it('leaves an ordinary robe visible when only head costumes are equipped and removed', () => {
    const f = fixture(), L = f.locations;
    f.add(1, L.GARMENT!, 2); f.actor.robe = 2; f.finish(f.path('robe', 2));
    for (const [index, slot] of slots.filter(slot => slot.part !== 'robe').entries()) {
      f.add(index + 2, L[slot.costume]!, 3, false); f.equip(index + 2, L[slot.costume]!, 3);
      expect(f.actor.robe).toBe(2); expect(f.actor.files.robe!.spr).toBe(f.path('robe', 2));
      f.takeoff(index + 2, L[slot.costume]!); expect(f.actor.robe).toBe(2);
    }
  });

  it('clears the costume robe after removal when no ordinary garment remains', () => {
    const f = fixture(); f.add(1, f.locations.COSTUME_ROBE!, 3); f.actor.robe = 3;
    f.takeoff(1, f.locations.COSTUME_ROBE!);
    expect(f.actor.robe).toBe(0); expect(f.actor.files.robe).toMatchObject({ spr: null, act: null });
  });

  it.each([{ location: 'WEAPON', part: 'weapon' }, { location: 'SHIELD', part: 'shield' }] as const)('equips and removes $location without touching other visible slots', ({ location, part }) => {
    const f = fixture(); f.actor.robe = 2; f.actor.accessory2 = 3;
    f.add(1, f.locations[location]!, 7, false); f.equip(1, f.locations[location]!, 7);
    expect(f.actor[part]).toBe(7); expect(f.pending.some(item => item.path === f.path(part, 7))).toBe(true);
    f.takeoff(1, f.locations[location]!); expect(f.actor[part]).toBe(0);
    expect(f.actor.robe).toBe(2); expect(f.actor.accessory2).toBe(3);
  });

  it('decodes 32-bit shadow-equipment locations without treating them as ordinary or costume visible slots', () => {
    const f = fixture(), L = f.locations, mask = L.SHADOW_WEAPON! | L.SHADOW_SHIELD!;
    f.actor.weapon = 2; f.actor.shield = 3; f.actor.robe = 4;
    f.add(1, mask, 7, false); const response = f.equip(1, mask, 7);
    expect(response.packet.wearLocation).toBe(mask); expect(f.list[1]?.equipped).toBe(mask);
    f.takeoff(1, mask); expect(f.actor.weapon).toBe(2); expect(f.actor.shield).toBe(3); expect(f.actor.robe).toBe(4);
  });
});

describe('native LOOK and resource authority after equipment changes', () => {
  it.each(slots)('uses server LOOK for $part, including clearing it and ignoring another entity', slot => {
    const f = fixture(); f.actor[slot.part] = 2; const old = f.path(slot.part, 2);
    f.look(slot.look, 3); const newest = f.path(slot.part, 3);
    f.finish(newest); f.finish(old);
    expect(f.actor[slot.part]).toBe(3); expect(f.actor.files[slot.part]!.spr).toBe(newest);
    f.look(slot.look, 4, 'SPRITE_CHANGE2', 999); expect(f.actor[slot.part]).toBe(3);
    f.look(slot.look, 0); expect(f.actor[slot.part]).toBe(0); expect(f.actor.files[slot.part]!.spr).toBeNull();
  });

  it.each([0, 3])('does not resurrect a pending backpack after authoritative LOOK_ROBE=%s', view => {
    const f = fixture(); f.look(12, 2); const backpack = f.path('robe', 2);
    f.look(12, view); if (view) f.finish(f.path('robe', view));
    f.finish(backpack);
    expect(f.actor.robe).toBe(view); expect(f.actor.files.robe!.spr).toBe(view ? f.path('robe', view) : null);
  });

  it('does not start a shared backpack fallback after the server has cleared its robe view', () => {
    const f = fixture(); f.look(12, 2); const backpack = f.path('robe', 2);
    f.look(12, 0); const before = f.pending.length; f.finish(backpack, false);
    expect(f.actor.robe).toBe(0); expect(f.actor.files.robe!.spr).toBeNull(); expect(f.pending).toHaveLength(before);
  });

  it('retains the ordinary robe for both LOOK-before-ACK and ACK-before-LOOK costume-removal sequences', () => {
    for (const lookFirst of [true, false]) {
      const f = fixture(), L = f.locations;
      f.add(1, L.GARMENT!, 2); f.add(2, L.COSTUME_ROBE!, 3); f.actor.robe = 3;
      if (lookFirst) f.look(12, 2);
      f.takeoff(2, L.COSTUME_ROBE!);
      if (!lookFirst) f.look(12, 2);
      expect(f.actor.robe).toBe(2);
    }
  });

  it('accepts the legacy LOOK packet for a valid 8-bit head view', () => {
    const f = fixture(); const response = f.look(4, 7, 'SPRITE_CHANGE');
    expect(response.packet.value).toBe(7); expect(f.actor.accessory2).toBe(7);
    f.finish(f.path('accessory2', 7)); expect(f.actor.files.accessory2!.spr).toBe(f.path('accessory2', 7));
  });

  it.each(slots.filter(slot => slot.part !== 'robe'))('mounts $costume through the native HatTable and sex-specific path', slot => {
    const f = fixture(); f.hatTable[3100] = '_costume_hat';
    f.add(1, f.locations[slot.costume]!, 3100, false); f.equip(1, f.locations[slot.costume]!, 3100);
    const resource = f.path(slot.part, 3100);
    expect(resource).toContain('_costume_hat.spr'); expect(f.pending.some(item => item.path === resource)).toBe(true);
    f.finish(resource); expect(f.actor.files[slot.part]!.spr).toBe(resource);
  });

  it('preserves a known canonical robe sprite when its item icon has a different basename', () => {
    const baseline = fixture(itemRegion), fixed = fixture();
    const canonical = fixed.robeTable[3];
    for (const f of [baseline, fixed]) {
      f.add(1, f.locations.COSTUME_ROBE!, 3, false, 'different_icon'); f.equip(1, f.locations.COSTUME_ROBE!, 3);
    }
    expect(baseline.robeTable[3]).toBe('different_icon'); expect(fixed.robeTable[3]).toBe(canonical);
    expect(fixed.pending.some(item => item.path === fixed.path('robe', 3))).toBe(true);
  });

  it.each(['../wrong', 'folder/resource', 'folder\\resource', '   ', 42, {}, null, undefined, '.', '..', 'bad:resource', 'bad?resource', 'bad\0resource'])('rejects invalid unknown-robe metadata %j without throwing or mounting an icon path', resource => {
    const f = fixture(); delete f.robeTable[3165];
    f.add(1, f.locations.COSTUME_ROBE!, 3165, false, resource);
    expect(() => f.equip(1, f.locations.COSTUME_ROBE!, 3165)).not.toThrow();
    expect(f.robeTable).not.toHaveProperty('3165'); expect(f.actor.robe).toBe(3165);
    expect(f.actor.files.robe).toMatchObject({ spr: null, act: null });
  });

  it('allows later canonical Lua mappings to replace an unknown view registered from item metadata', () => {
    const f = fixture(); delete f.robeTable[3165];
    f.add(1, f.locations.COSTUME_ROBE!, 3165, false, 'compatibility_fallback');
    f.equip(1, f.locations.COSTUME_ROBE!, 3165); expect(f.robeTable[3165]).toBe('compatibility_fallback');
    const old = f.path('robe', 3165);
    // This is the actual native loadLuaTable callback for RobeNameTable.
    Object.assign(f.robeTable, { 3165: 'canonical_robe' });
    f.look(12, 3165); const canonical = f.path('robe', 3165); f.finish(canonical); f.finish(old);
    expect(f.robeTable[3165]).toBe('canonical_robe'); expect(f.actor.files.robe!.spr).toBe(canonical);
  });

  it('keeps canonical robe mappings while previewing an item with a different icon resource', () => {
    const f = fixture(), canonical = f.robeTable[3];
    const item = f.add(1, f.locations.COSTUME_ROBE!, 3);
    expect(f.preview({ ...item, location: f.locations.COSTUME_ROBE! }, { identifiedResourceName: 'different_icon' })).toBe(3);
    expect(f.robeTable[3]).toBe(canonical);
  });

  it('registers a safe unknown preview fallback while rejecting unsafe or non-string metadata', () => {
    const f = fixture(), item = f.add(1, f.locations.COSTUME_ROBE!, 3165);
    const previewItem = { ...item, location: f.locations.COSTUME_ROBE! };
    for (const resource of ['../bad', '.', '..', 'bad:name', 'bad\0name', 42, {}, null, undefined]) {
      delete f.robeTable[3165];
      expect(() => f.preview(previewItem, { identifiedResourceName: resource })).not.toThrow();
      expect(f.robeTable).not.toHaveProperty('3165');
    }
    f.preview(previewItem, { identifiedResourceName: '  compatibility_robe  ' });
    expect(f.robeTable[3165]).toBe('compatibility_robe');
  });
});

describe('initial native equipment-list appearance registration', () => {
  it.each(listPackets)('registers an unknown equipped robe through %s before or after its server LOOK, without wearing it again', name => {
    for (const lookFirst of [true, false]) {
      const f = fixture(); delete f.robeTable[3165];
      if (lookFirst) { f.look(12, 3165); expect(f.actor.files.robe!.spr).toBeNull(); }
      const response = f.initialList([{ index: 1, location: f.locations.COSTUME_ROBE!, view: 3165, resource: 'initial_robe' }], name);
      expect(response.packet.ItemInfo?.[0]?.wItemSpriteNumber).toBe(3165);
      expect(f.robeTable[3165]).toBe('initial_robe'); expect(f.list[1]?.wItemSpriteNumber).toBe(3165);
      if (!lookFirst) f.look(12, 3165);
      f.finish(f.path('robe', 3165)); expect(f.actor.files.robe!.spr).toBe(f.path('robe', 3165));
      expect(f.inventoryUI.removeItem).not.toHaveBeenCalled();
    }
  });

  it('preserves canonical names and does not replace a different current server robe while registering a list fallback', () => {
    const f = fixture(), canonical = f.robeTable[3]; delete f.robeTable[3165];
    f.look(12, 2); const before = f.pending.length;
    f.initialList([
      { index: 1, location: f.locations.COSTUME_ROBE!, view: 3, resource: 'wrong_icon' },
      { index: 2, location: f.locations.COSTUME_ROBE!, view: 3165, resource: 'initial_robe' },
    ]);
    expect(f.robeTable[3]).toBe(canonical); expect(f.robeTable[3165]).toBe('initial_robe');
    expect(f.actor.robe).toBe(2);
    expect(f.pending.slice(before).filter(item => item.path.endsWith('.spr'))).toHaveLength(0);
  });

  it('does not register an unworn costume item from the initial inventory list', () => {
    const f = fixture(); delete f.robeTable[3165];
    f.initialList([{ index: 1, location: f.locations.COSTUME_ROBE!, view: 3165, worn: false }]);
    expect(f.robeTable).not.toHaveProperty('3165'); expect(f.list).not.toHaveProperty('1');
    expect(f.inventoryUI.list).toHaveLength(1); expect(f.actor.robe).toBe(0);
  });

  it.each([1, 2])('does not register inventory appearances from a cart/storage list with invType=%s', invType => {
    const f = fixture(); delete f.robeTable[3165];
    f.initialList([{ index: 1, location: f.locations.COSTUME_ROBE!, view: 3165 }], 'SPLIT_SEND_ITEMLIST_EQUIP2', invType);
    expect(f.robeTable).not.toHaveProperty('3165'); expect(f.list).not.toHaveProperty('1'); expect(f.actor.robe).toBe(0);
    expect(invType === 1 ? f.effects.cartItems : f.effects.storageItems).toHaveBeenCalledOnce();
  });
});

describe('equipment appearance patch boundaries', () => {
  it('changes only the native item and preview regions and rejects an already installed patch', () => {
    let expected = native;
    for (const [original, replacement] of [[itemRegion, patchedItem], [previewRegion, patchedPreview]]) {
      const start = expected.indexOf(original!), end = start + original!.length;
      expected = expected.slice(0, start) + replacement + expected.slice(end);
    }
    expect(patchRuntimeEquipmentAppearance(native)).toBe(expected);
    expect(patchRuntimeEquipmentAppearance('const unrelated = 1;')).toBe('const unrelated = 1;');
    expect(() => patchRuntimeEquipmentAppearance(patchedItem)).toThrow('anchor:equipment-appearance:already-installed');
  });
});
