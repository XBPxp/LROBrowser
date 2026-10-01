// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchRuntimeMovementInput } from '../scripts/lastro-movement-input.mjs';
import { patchRuntimeVendingMovement } from '../scripts/lastro-vending-movement.mjs';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
function region(source: string, path: string) {
  const start = source.indexOf('//#region ' + path), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + path);
  return source.slice(start, end);
}
const paths = [
  'src/UI/Components/NpcStore/NpcStore.js', 'src/Network/NetworkManager.js', 'src/Engine/MapEngine.js',
  'src/Controls/MapControl.js', 'src/UI/Components/JoystickUI/JoystickCharacterControl.js',
  'src/UI/Components/MobileUI/MobileUI.js', 'src/UI/Components/Navigation/Navigation.js',
  'src/Engine/MapEngine/Store.js',
];
const focused = paths.map(path => region(native, path) + '\n//#endregion').join('\n');
const patched = patchRuntimeVendingMovement(focused);
function declarations(source: string) {
  const file = ts.createSourceFile('Native.js', source, ts.ScriptTarget.Latest, true), functions = new Map<string, string>(), assignments = new Map<string, string>();
  let gui = '', html = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(file));
    if (ts.isBinaryExpression(node)) {
      assignments.set(node.left.getText(file), node.getText(file) + ';');
      if (node.left.getText(file) === 'GUIComponent' && ts.isClassExpression(node.right)) gui = node.right.getText(file);
      if (ts.isStringLiteral(node.right) && node.left.getText(file) === 'NpcStore_default$2') html = node.right.text;
    }
    ts.forEachChild(node, visit);
  }
  visit(file); return { functions, assignments, gui, html };
}
const common = declarations(region(native, 'src/UI/GUIComponent.js') + '\n' + region(native, 'src/UI/Components/NpcStore/NpcStore.html?raw'));
const packetSources = declarations(region(native, 'src/Network/PacketStructure.js'));
const sources = { original: declarations(focused), fixed: declarations(patched) };
afterEach(() => { document.body.replaceChildren(); });

interface Component {
  _host: HTMLElement; _shadow: ShadowRoot; __loaded: boolean; __active: boolean;
  _lastroVendingShopping?: boolean; mouseMode: number;
  Type: { VENDING_STORE: number; BUYING_STORE: number; BUY: number };
  append(): void; remove(): void; setType(type: number): void; onKeyDown(event: { key: string }): void;
  setClosePacketSent(value: boolean): void; setList(list: unknown[]): void;
}
function fixture(fixed = true) {
  const parts = fixed ? sources.fixed : sources.original;
  const session = { FreezeUI: false, Entity: { position: [10, 20], __navigationMovePending: undefined as unknown }, moveAction: {} as unknown, autoFollow: true };
  const mouse = { intersect: true, screen: {}, world: { x: 15, y: 25 } };
  const send = vi.fn(), cancelInput = vi.fn(), clearRoute = vi.fn(() => { session.Entity.__navigationMovePending = null; }), cancelRoute = vi.fn(), cancelQuest = vi.fn(), stopMobile = vi.fn();
  const eventCancel = vi.fn(), build = vi.fn(() => ({ buffer: Uint8Array.from([0x5f, 0x03, 0x04, 0x08, 0x10]).buffer })), close = vi.fn();
  class PACKET_CZ_REQUEST_MOVE { dest = [0, 0]; build = build; }
  class PACKET_CZ_REQUEST_MOVE2 extends PACKET_CZ_REQUEST_MOVE {}
  class PACKET_CZ_REQUEST_MOVENPC extends PACKET_CZ_REQUEST_MOVE { GID = 9; }
  class PACKET_CZ_PC_PURCHASE_ITEMLIST_FROMMC extends PACKET_CZ_REQUEST_MOVE { itemList: unknown[] = []; AID = 1; }
  const packets = { REQUEST_MOVE: PACKET_CZ_REQUEST_MOVE, REQUEST_MOVE2: PACKET_CZ_REQUEST_MOVE2, REQUEST_MOVENPC: PACKET_CZ_REQUEST_MOVENPC,
    PC_PURCHASE_ITEMLIST_FROMMC: PACKET_CZ_PC_PURCHASE_ITEMLIST_FROMMC, REQ_TRADE_BUYING_STORE: PACKET_CZ_PC_PURCHASE_ITEMLIST_FROMMC };
  const context = vm.createContext({ document, window, Event, console, SessionStorage_default: session, Mouse: mouse,
    UIManager: { components: {} as Record<string, Component>, addComponent: (component: Component) => component },
    MouseMode: { STOP: 1, FREEZE: 2 }, _Cursor: null, _ScrollBar: null, setTimeout: () => 0,
    Preferences: { get: () => ({ save: vi.fn() }) }, Client: { loadFile: vi.fn() }, DB: { INTERFACE_PATH: '' }, Renderer: { width: 1400, height: 900 },
    Events: { clearTimeout: eventCancel }, _walkTimer: 9, KEYS: { ESCAPE: 27 },
    MapControl: { _lastroMovementInput: { cancel: cancelInput } }, Navigation_default: { __loaded: true, clear: clearRoute },
    LastROTools: { _lastroPanels: { cancelRoute }, _lastroQuestRoute: { cancel: cancelQuest } }, stopMovement: stopMobile,
    PACKET: { CZ: packets, ZC: { PC_PURCHASE_ITEMLIST_FROMMC2: class {}, PC_PURCHASE_ITEMLIST_FROMMC3: class {} } },
    PacketVerManager_default: { value: 20211103 }, Network: { sendPacket: () => {} },
    EntityManager: { get: () => null }, packetDump: false, _socket: { isZone: false }, send,
    __esmMin: (init: () => void) => init, init_CodepageManager: () => {}, recordBuild: build,
  });
  vm.runInContext(region(native, 'src/Utils/BinaryWriter.js') + '\ninit_BinaryWriter();\n' + [
    'PACKET.CZ.REQUEST_MOVE', 'PACKET.CZ.REQUEST_MOVE.prototype.build', 'PACKET.CZ.REQUEST_MOVE2', 'PACKET.CZ.REQUEST_MOVE2.prototype.build',
  ].map(name => packetSources.assignments.get(name)).join('\n') + `
    PACKET.CZ.REQUEST_MOVE.prototype.getPacketVersion = () => [0, 0x0085, 5, 2];
    for (const kind of ['REQUEST_MOVE', 'REQUEST_MOVE2']) {
      const nativeBuild = PACKET.CZ[kind].prototype.build;
      PACKET.CZ[kind].prototype.build = function() { recordBuild(); return nativeBuild.call(this); };
    }
  `, context);
  vm.runInContext('var GUIComponent=' + common.gui + '; var NpcStore=new GUIComponent("NpcStore", "");', context);
  const component = context.NpcStore as Component;
  const host = document.createElement('div'); host.attachShadow({ mode: 'open' }); host.shadowRoot!.innerHTML = common.html;
  Object.assign(component, { _host: host, _shadow: host.shadowRoot, __loaded: true, StoreClosePacket: close, setList: vi.fn(), setPriceLimit: vi.fn(),
    ui: { find: () => ({ text: vi.fn() }) } });
  (context.UIManager as { components: Record<string, Component> }).components.NpcStore = component;
  const assignments = ['NpcStore.Type', 'initialPreferences', '_preferences$2', 'NpcStore.mouseMode', 'NpcStore.onAppend', 'NpcStore.setType', 'NpcStore.onRemove', 'NpcStore.onKeyDown', 'NpcStore.setClosePacketSent'];
  const functions = ['getCurrentPref', '_hideAll', '_showAll', 'resize', 'onVendingStoreList', 'onBuyingStoreList', 'sendPacket'];
  const helpers = ['lastroVendingShoppingActive', 'lastroSetVendingShopping', 'lastroInstallVendingRemoval', 'lastroCloseVendingShopping'];
  vm.runInContext(`var _input=[], _output=[], _type=0, _closePacketSent=false, NpcStore_default=NpcStore;
    ${functions.map(name => parts.functions.get(name)).join('\n')}
    ${assignments.map(name => parts.assignments.get(name)).join('\n')}
    ${fixed ? helpers.map(name => parts.functions.get(name)).join('\n') + '\nlastroInstallVendingRemoval(NpcStore);' : ''}
    Network.sendPacket=sendPacket;
  `, context);
  const open = (type = component.Type.VENDING_STORE) => {
    vm.runInContext((type === component.Type.BUYING_STORE ? 'onBuyingStoreList' : 'onVendingStoreList') + '({AID:1,itemList:[],limitZeny:100});', context);
  };
  const packet = (kind: keyof typeof packets = 'REQUEST_MOVE2') => {
    const value = new packets[kind](); value.dest = [15, 25]; return value;
  };
  const sendPacket = (kind: keyof typeof packets = 'REQUEST_MOVE2') => (context.Network as { sendPacket(packet: unknown): boolean | undefined }).sendPacket(packet(kind));
  const entry = (path: string, name: string, args = '') => {
    const fn = declarations(region(fixed ? patched : focused, path)).functions.get(name)!;
    vm.runInContext(fn + '\n' + name + '(' + args + ');', context);
  };
  const transition = (name: 'onMapChange' | 'cleanGameUI') => {
    const code = parts.functions.get(name)!, file = ts.createSourceFile('Entry.js', code, ts.ScriptTarget.Latest, true);
    const fn = file.statements[0] as ts.FunctionDeclaration;
    vm.runInContext(fn.body!.statements[0]!.getText(file), context);
  };
  return { context, component, session, mouse, send, build, close, open, sendPacket, entry, transition, cancelInput, clearRoute, cancelRoute, cancelQuest, stopMobile, eventCancel };
}

describe('native player-store shopping movement', () => {
  it('reproduces the native lost shared freeze and movement-send bypass', () => {
    const f = fixture(false); f.open(); expect(f.session.FreezeUI).toBe(true);
    f.session.FreezeUI = false; f.mouse.intersect = true;
    f.sendPacket(); expect(f.build).toHaveBeenCalledOnce(); expect(f.send).toHaveBeenCalledOnce();
  });
  it.each([2, 3])('locks real player store type %i, cancels queued movement and preserves server coordinates', type => {
    const f = fixture(); f.open(type);
    expect(f.session.FreezeUI).toBe(true); expect(f.mouse.intersect).toBe(false);
    expect(f.component._lastroVendingShopping).toBe(true);
    expect(f.cancelInput).toHaveBeenCalledOnce(); expect(f.clearRoute).toHaveBeenCalledOnce();
    expect(f.cancelRoute).toHaveBeenCalledOnce(); expect(f.cancelQuest).toHaveBeenCalledOnce(); expect(f.stopMobile).toHaveBeenCalledOnce();
    expect(f.eventCancel).toHaveBeenCalledWith(9); expect(f.session.moveAction).toBeNull(); expect(f.session.autoFollow).toBe(false);
    expect(f.session.Entity.position).toEqual([10, 20]);
    f.sendPacket('REQUEST_MOVE'); f.sendPacket(); expect(f.build).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('blocks native click, keyboard walk, joystick, legacy touch and navigation before their body mutates movement state', () => {
    const f = fixture(); f.open(); f.session.FreezeUI = false; f.mouse.intersect = true;
    f.entry('src/Controls/MapControl.js', 'onMouseDown', '{which:1}');
    f.entry('src/Engine/MapEngine.js', 'onRequestWalk');
    f.entry('src/UI/Components/JoystickUI/JoystickCharacterControl.js', 'move$1', '1,0');
    f.entry('src/UI/Components/MobileUI/MobileUI.js', 'moveCharacter', '1,0,3');
    f.entry('src/UI/Components/Navigation/Navigation.js', 'requestNavigationMove', '[{x:10,y:20},{x:20,y:30}],{x:20,y:30}');
    expect(f.session.Entity.position).toEqual([10, 20]); expect(f.session.Entity.__navigationMovePending).toBeNull();
    expect(f.build).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('retains a final send guard if a nested frozen window releases native shared flags', () => {
    const f = fixture(); f.open(); f.session.FreezeUI = false; f.mouse.intersect = true;
    expect(f.sendPacket()).toBe(false); expect(f.session.FreezeUI).toBe(true); expect(f.mouse.intersect).toBe(false); expect(f.build).not.toHaveBeenCalled();
  });
  it('does not suppress buying or pet movement at the native send boundary', () => {
    const f = fixture(); f.open();
    f.sendPacket('REQUEST_MOVENPC'); f.sendPacket('PC_PURCHASE_ITEMLIST_FROMMC');
    expect(f.build).toHaveBeenCalledTimes(2); expect(f.send).toHaveBeenCalledTimes(2);
  });
  it.each(['REQUEST_MOVE', 'REQUEST_MOVE2'] as const)('keeps native %s BinaryWriter bytes unchanged after closing shopping', kind => {
    const baseline = fixture(false); baseline.sendPacket(kind);
    const f = fixture(); f.open(); f.sendPacket(kind); expect(f.send).not.toHaveBeenCalled();
    f.component.remove(); f.sendPacket(kind);
    const expected = Array.from(new Uint8Array(baseline.send.mock.calls[0]![0] as ArrayBuffer));
    expect(expected).toEqual([kind === 'REQUEST_MOVE' ? 0x85 : 0x5f, kind === 'REQUEST_MOVE' ? 0 : 3, 3, 0xc1, 0x90]);
    expect(Array.from(new Uint8Array(f.send.mock.calls[0]![0] as ArrayBuffer))).toEqual(expected);
  });
  it.each(['cancel', 'escape', 'submit'])('restores movement after native %s removal without suppressing a normal close', reason => {
    const f = fixture(); f.open();
    if (reason === 'escape') f.component.onKeyDown({ key: 'Escape' });
    else if (reason === 'submit') {
      f.component.setClosePacketSent(true);
      vm.runInContext('NpcStore.onSubmit([{index:1,count:2}]);', f.context);
    } else f.component.remove();
    expect(f.component._host.isConnected).toBe(false); expect(f.session.FreezeUI).toBe(false); expect(f.mouse.intersect).toBe(true);
    expect(f.close).toHaveBeenCalledTimes(reason === 'submit' ? 0 : 1);
    f.sendPacket(); expect(f.send).toHaveBeenCalledTimes(reason === 'submit' ? 2 : 1);
    f.open(); expect(f.sendPacket()).toBe(false);
  });
  it.each(['registered', 'clone'])('preserves a remaining %s frozen dialog while shopping closes', kind => {
    const f = fixture(); f.open(); const host = document.createElement('div'); document.body.append(host);
    if (kind === 'registered') (f.context.UIManager as { components: Record<string, unknown> }).components.InputBox = { __active: true, mouseMode: 2, _host: host };
    else host.attachShadow({ mode: 'open' }).innerHTML = '<div id="win_popup"></div>';
    f.component.remove(); expect(f.session.FreezeUI).toBe(true); expect(f.mouse.intersect).toBe(false);
  });
  it.each(['onMapChange', 'cleanGameUI'] as const)('ends local shopping on %s without sending an old-store close to the new session', transition => {
    const f = fixture(); f.open(); f.transition(transition);
    expect(f.component._host.isConnected).toBe(false); expect(f.component._lastroVendingShopping).toBe(false);
    expect(f.close).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.session.FreezeUI).toBe(false);
    f.sendPacket(); expect(f.send).toHaveBeenCalledOnce();
  });
  it('does not extend movement gates to a normal NPC store or an unmounted player shop', () => {
    const f = fixture(); f.component.append(); f.component.setType(0); f.sendPacket();
    expect(f.cancelInput).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledOnce();
    f.component.remove(); f.component.setType(2); f.sendPacket(); expect(f.send).toHaveBeenCalledTimes(2);
  });
  it('preserves merchant configuration/own inventory and authoritative entity movement', () => {
    for (const path of ['src/UI/Components/Vending/Vending.js', 'src/UI/Components/VendingShop/VendingShop.js', 'src/Renderer/Entity/EntityWalk.js', 'src/Engine/MapEngine/Entity.js'])
      expect(patchRuntimeVendingMovement(region(native, path) + '\n//#endregion')).toBe(region(native, path) + '\n//#endregion');
  });
  it('applies after the existing movement input patch and rejects patch drift or duplicate installation', () => {
    expect(() => patchRuntimeVendingMovement(patchRuntimeMovementInput(focused))).not.toThrow();
    expect(() => patchRuntimeVendingMovement(patched)).toThrow('anchor:vending-movement:already-installed');
    expect(() => patchRuntimeVendingMovement(focused.replace('NpcStore.mouseMode = GUIComponent.MouseMode.FREEZE;', 'NpcStore.mouseMode = 1;'))).toThrow('anchor:vending-movement:store-lifecycle');
    expect(() => patchRuntimeVendingMovement(focused.replace('function move$1(', 'function driftMove('))).toThrow('anchor:vending-movement:');
  });
});
