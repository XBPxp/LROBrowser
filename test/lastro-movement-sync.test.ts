import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { patchRuntimeEntitySync } from '../scripts/lastro-entity-sync.mjs';
import { patchRuntimeMovementSync } from '../scripts/lastro-movement-sync.mjs';

const vendor = readFileSync(new URL('../vendor/v2/Online.js', import.meta.url), 'utf8');
function region(name: string, source = vendor) {
  const start = source.indexOf(`//#region ${name}`);
  if (start < 0) throw new Error(name);
  const end = source.indexOf('//#endregion', start) + '//#endregion'.length;
  return source.slice(start, end);
}
const base = [
  'src/Renderer/Entity/EntityWalk.js', 'src/Engine/MapEngine/Entity.js',
  'src/Engine/MapEngine/Main.js', 'src/Engine/MapEngine.js', 'src/Network/NetworkManager.js',
].map(name => region(name)).join('\n');
const synchronized = patchRuntimeEntitySync(base);
const patched = patchRuntimeMovementSync(synchronized);
function declaration(source: string, name: string) {
  const file = ts.createSourceFile('native.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (nodes.length !== 1) throw new Error(name);
  return nodes[0]!.getText(file);
}

interface Walk {
  speed: number; tick: number; prevTick: number; dist: number; index: number; total: number;
  pos: Float32Array; lastPos: Float32Array; path: Int16Array; onEnd: (() => void) | null;
}
interface ActionOptions {
  action: number; frame?: number; repeat?: boolean; play?: boolean; next?: ActionOptions | false; delay?: number;
}
interface Entity {
  GID: number; objecttype: number; ACTION: Record<string, number>; action: number; display?: { name: string };
  position: Float32Array; walk: Walk; _lastroMovementEpoch?: number; _lastroApprovedRoute?: unknown;
  animation: { next: ActionOptions | false; save: ActionOptions | false; repeat: boolean; delay: number };
  _deathSyncTick: number;
  onWalkEnd: () => void;
  walkTo(x0: number, y0: number, x1: number, y1: number, range?: number, start?: number): void;
  walkProcess(): void; resetRoute(keepDistance?: boolean): void;
  setAction(options: ActionOptions): void;
  set(options: { PosDir: number[]; GID: number }): void;
}
interface HitPacket {
  damage: number; leftDamage?: number; count?: number; action: number; attackMT: number; attackedMT: number;
  startTime?: unknown;
}
interface MovePacket { MoveData: number[]; moveStartTime: number; }

function fixture(source = patched) {
  let now = 10000, dueTick: number | undefined;
  const SessionStorage_default = {
    serverTick: 10000, Entity: null as Entity | null, AID: 123, Playing: true,
    FreezeUI: false, ping: {
      returned: true, pingTime: 0, pongTime: 10000, lastroSentAt: 10000,
      _lastroUnansweredSince: undefined as number | undefined,
    },
  };
  const Renderer = { tick: now };
  const cells = new Uint8Array(24 * 24).fill(10);
  const Altitude = {
    width: 24, height: 24, cells, types: { NONE: 1, WALKABLE: 2, WATER: 4, SNIPABLE: 8 },
    getCellHeight: vi.fn((x: number, y: number) => x + y),
    getCellType: vi.fn((x: number, y: number): number | undefined => Altitude.cells[x + y * Altitude.width]),
  };
  const timers: { id: number; callback: () => void; due: number }[] = [];
  let timerId = 0;
  const Events = {
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      const id = timerId++;
      timers.push({ id, callback, due: now + delay });
      return id;
    }),
    clearTimeout: vi.fn((id: number) => {
      const index = timers.findIndex(timer => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    }),
  };
  const entries = new Map<number, Entity>();
  const EntityManager = {
    get: (id: number) => entries.get(id), getFocusEntity: () => SessionStorage_default.Entity,
    removeGID: vi.fn((id: number) => entries.delete(id)), removeLife: vi.fn(), add: vi.fn(),
  };
  const constants = {
    TYPE_PC: 0, TYPE_DISGUISED: 1, TYPE_MOB: 5, TYPE_NPC: 6, TYPE_PET: 7, TYPE_HOM: 8,
    TYPE_MERC: 9, TYPE_ELEM: 10, TYPE_NPC2: 12, TYPE_NPC_ABR: 13, TYPE_NPC_BIONIC: 14,
    TYPE_FALCON: 15, TYPE_WUG: 16, TYPE_WARP: -1,
    VT: { OUTOFSIGHT: 0, DEAD: 1, EXIT: 2, TELEPORT: 3 },
  };
  const LastROAdvanceServerTick = vi.fn(() => SessionStorage_default.serverTick);
  const MapRenderer = { loading: false, currentMap: 'prontera', onLoad: () => {}, setMap: vi.fn() };
  const MapControl = { _lastroMovementInput: { cancel: vi.fn() } };
  const Network = { sendPacket: vi.fn() };
  const context = vm.createContext({
    Date: { now: () => now }, performance: { now: () => now },
    console: { warn: vi.fn(), trace: vi.fn(), error: vi.fn(), log: vi.fn() },
    Float32Array, Int16Array, Uint32Array, Uint16Array, Uint8Array, ArrayBuffer, DataView,
    __esmMin: (init: () => void) => { let loaded = false; return () => { if (!loaded) { loaded = true; init(); } }; },
    init_PathFinding: () => {}, init_Altitude: () => {}, init_SessionStorage: () => {}, init_DBManager: () => {},
    SessionStorage_default, Renderer, Events, EntityManager, Altitude, Entity: constants, MapRenderer, MapControl, Network,
    LastROAdvanceServerTick, LastROEventDueTick: () => dueTick,
    Configs: { get: (name: string, fallback: unknown) => name === 'lastroProtocol' ? true : fallback },
    DB: { getWeaponAction: () => 0 },
    EffectManager: { remove: vi.fn(), spam: vi.fn() },
    StatusState_default: { EffectState: { INVISIBLE: 1 } }, EffectConst_default: { EF_DEVIL: 1 },
    StatusProperty_default: { SPEED: 0 },
    HomunInformations_default: { stopAI: vi.fn() }, MercenaryInformations_default: { stopAI: vi.fn() },
    Escape_default: { showDeathMenu: vi.fn() }, haveSiegfriedItem: () => false,
    WhisperBox: { clearAll: vi.fn() },
    BasicInfoController: {}, PlayerViewEquipController: {}, StatusIcons_default: {}, ChatBox_default: {},
    ShortCut_default: {}, Controller$3: {}, controller: {}, CashShop_default: {},
    PacketCrypt_default: { process: vi.fn() }, isObserverMode: () => false,
    C_DEATH_SYNC_OFFSET: 200, C_MULTIHIT_DELAY: 200,
  });
  vm.runInContext(region('src/Utils/PathFinding.js'), context);
  vm.runInContext('init_PathFinding(); PathFinding_default.setGat(Altitude);', context);
  const action = region('src/Renderer/Entity/EntityAction.js');
  vm.runInContext([
    declaration(action, 'Action'), declaration(action, 'Animation'), declaration(action, 'setAction'), declaration(action, 'Init$10'),
    source.replaceAll('import.meta.url', '"file:///native.js"'), 'init_EntityWalk();',
  ].join('\n'), context);
  const socket = {
    connected: true, isZone: true, handoffPending: false, _lastroMovementPacketAt: 10000, send: vi.fn(),
  };
  context._socket = socket;
  context._sockets = [socket];
  context._onDisconnect = vi.fn();
  const functions = vm.runInContext(`({
    action: Init$10, walk: Init$4, hit: onEntityWillBeHitSub,
    playerMove: onPlayerMove, move: onEntityMove, stop: onEntityStopMove,
    jump: onEntityJump, fastMove: onEntityFastMove,
    mapChange: onMapChange, mapEntry: resetEntityForMapEntry, cleanup: cleanGameUI,
    pong: onPong, sendPacket, closeEvent: onClose$9, parameter: onParameterChange$1,
  })`, context) as {
    action(this: Entity): void; walk(this: Entity): void; hit(pkt: HitPacket, entity: Entity): void;
    playerMove(pkt: MovePacket): void; move(pkt: MovePacket & { GID: number }): void;
    stop(pkt: { AID: number; xPos: number; yPos: number }): void;
    jump(pkt: { AID: number; xPos: number; yPos: number }): void;
    fastMove(pkt: { AID: number; targetXpos: number; targetYpos: number }): void;
    mapChange(pkt: { mapName: string; xPos: number; yPos: number }): void;
    mapEntry(entity: Entity, pkt: { xPos: number; yPos: number }, gid: number): void;
    cleanup(): void;
    pong(pkt: { time: number }): void;
    sendPacket(pkt: { constructor: { name: string }; build(): { buffer: ArrayBuffer; view: DataView } }): void;
    closeEvent(this: typeof socket, event: { code: number; wasClean: boolean }): void;
    parameter(pkt: { varID: number; amount: number }): void;
  };
  const entity = {
    constructor: constants, GID: 123, objecttype: constants.TYPE_PC, position: new Float32Array([1, 1, 2]),
    sound: { free: () => {} }, _job: 4010, _sex: 1, weapon: 0, _deathSyncTick: 0,
    set(this: Entity, options: { PosDir: number[]; GID: number }) {
      this.GID = options.GID;
      this.position.set([options.PosDir[0]!, options.PosDir[1]!, Altitude.getCellHeight(options.PosDir[0]!, options.PosDir[1]!)]);
    },
  } as unknown as Entity;
  functions.action.call(entity);
  functions.walk.call(entity);
  entity.setAction({ action: entity.ACTION.IDLE!, repeat: true, play: true });
  entries.set(entity.GID, entity);
  SessionStorage_default.Entity = entity;
  return {
    context, entity, functions, SessionStorage_default, Renderer, Events, timers, entries, cells,
    EntityManager, Altitude, MapRenderer, MapControl, Network, socket,
    setNow(value: number) { now = value; Renderer.tick = value; },
    flush(value: number) {
      now = value; Renderer.tick = value;
      const due = timers.filter(timer => timer.due <= now).sort((a, b) => a.due - b.due);
      for (const timer of due) {
        const index = timers.indexOf(timer);
        if (index < 0) continue;
        timers.splice(index, 1);
        dueTick = timer.due;
        try { timer.callback(); } finally { dueTick = undefined; }
      }
    },
  };
}

const normalHit: HitPacket = { damage: 10, count: 1, action: 0, attackMT: 150, attackedMT: 300 };
function beginWalk(f: ReturnType<typeof fixture>, speed = 150) {
  f.entity.walk.speed = speed;
  f.functions.playerMove({ MoveData: [1, 1, 12, 1], moveStartTime: 10000 });
}

function largerGat(f: ReturnType<typeof fixture>, size = 64) {
  f.Altitude.width = f.Altitude.height = size;
  f.Altitude.cells = new Uint8Array(size * size).fill(10);
  vm.runInContext('PathFinding_default.setGat(Altitude);', f.context);
}

function fastMovePacket(f: ReturnType<typeof fixture>, x: number, y: number, aid = 123) {
  const start = vendor.indexOf('  PACKET.ZC.FASTMOVE = function');
  const end = vendor.indexOf('  PACKET.ZC.FASTMOVE.size = 10;', start) + '  PACKET.ZC.FASTMOVE.size = 10;'.length;
  if (start < 0 || end < start) throw new Error('Missing FASTMOVE packet declaration');
  f.context.window = {};
  f.context.init_Struct = () => {};
  f.context.init_CodepageManager = () => {};
  vm.runInContext(region('src/Utils/BinaryReader.js') + '\ninit_BinaryReader(); var FAST_PACKET={ZC:{}};'
    + vendor.slice(start, end).replaceAll('PACKET.ZC', 'FAST_PACKET.ZC'), f.context);
  const bytes = new Uint8Array(10), view = new DataView(bytes.buffer);
  view.setUint16(0, 0x08d2, true); view.setUint32(2, aid, true);
  view.setInt16(6, x, true); view.setInt16(8, y, true);
  f.context.fastPacketBytes = bytes;
  return vm.runInContext(`(() => {
    const fp = new BinaryReader(fastPacketBytes);
    if (fp.readUShort() !== 0x08d2) throw new Error('Wrong packet id');
    return new FAST_PACKET.ZC.FASTMOVE(fp, fastPacketBytes.length);
  })()`, f.context) as { AID: number; targetXpos: number; targetYpos: number };
}


function nativeMovementPacket(f: ReturnType<typeof fixture>, name: 'NOTIFY_PLAYERMOVE' | 'NOTIFY_ACT', bytes: Uint8Array) {
  const start = vendor.indexOf('  PACKET.ZC.' + name + ' = function');
  const sizeStart = vendor.indexOf('  PACKET.ZC.' + name + '.size = ', start);
  const end = vendor.indexOf(';', sizeStart) + 1;
  if (start < 0 || sizeStart < start) throw new Error('Missing native packet ' + name);
  f.context.window = {};
  f.context.init_Struct = () => {}; f.context.init_CodepageManager = () => {};
  vm.runInContext(region('src/Utils/BinaryReader.js') + '\ninit_BinaryReader(); var MOVEMENT_PACKETS={ZC:{}};'
    + vendor.slice(start, end).replaceAll('PACKET.ZC', 'MOVEMENT_PACKETS.ZC'), f.context);
  f.context.movementBytes = bytes; f.context.movementPacketName = name;
  return vm.runInContext('(() => { const fp = new BinaryReader(movementBytes); fp.readUShort(); return new MOVEMENT_PACKETS.ZC[movementPacketName](fp, movementBytes.length); })()', f.context);
}

function receiveNativeDamageAction(f: ReturnType<typeof fixture>, count = 1) {
  const bytes = new Uint8Array(29), view = new DataView(bytes.buffer);
  view.setUint16(0, 0x8a, true); view.setUint32(2, 999, true); view.setUint32(6, 123, true);
  view.setUint32(10, 10000, true); view.setInt32(14, 150, true); view.setInt32(18, 300, true);
  view.setInt16(22, 10, true); view.setInt16(24, count, true); view.setUint8(26, 0); view.setInt16(27, 0, true);
  const packet = nativeMovementPacket(f, 'NOTIFY_ACT', bytes);
  f.context.DB.getWeaponSound = () => null; f.context.DB.getMessage = () => '%s %d';
  f.context.AE = { PROJECTILE: {}, SPAWN: {} };
  f.context.Damage = { TYPE: {}, add: vi.fn() }; f.context.MAX_ATTACKMT = 1000;
  f.context.ChatBox_default = { TYPE: { INFO: 0 }, FILTER: { BATTLE: 0 }, addText: vi.fn() };
  f.entity.display = { name: 'player' };
  f.entries.set(999, { GID: 999, objecttype: 5, job: 1002, weapon: 0, position: new Float32Array([0, 1, 1]),
    display: { name: 'monster' }, ACTION: f.entity.ACTION, lookTo() {}, setAction() {} } as unknown as Entity);
  f.context.damageActionPacket = packet;
  vm.runInContext('onEntityAction(damageActionPacket);', f.context);
  return packet;
}

describe('authoritative FASTMOVE Body Relocation targets', () => {
  it('reproduces the native empty-route buffer check after decoding a real FASTMOVE packet', () => {
    const f = fixture(synchronized); largerGat(f);
    const packet = fastMovePacket(f, 50, 1);
    expect({ ...packet }).toEqual({ AID: 123, targetXpos: 50, targetYpos: 1 });
    f.functions.fastMove(packet);
    expect(f.entity.walk.path.length).toBe(66);
    expect(f.entity.walk.total).toBe(0);
    expect(f.entity.walk.speed).toBe(10);
    f.setNow(12000); f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([1, 1, 2]);
  });

  it('applies a valid authoritative target when its local walking search fails, without leaving temporary speed', () => {
    const f = fixture(); largerGat(f);
    beginWalk(f);
    f.functions.fastMove(fastMovePacket(f, 50, 1));
    expect(Array.from(f.entity.position)).toEqual([50, 1, 51]);
    expect(f.entity.walk.total).toBe(0); expect(f.entity.walk.speed).toBe(150);
    expect(f.entity.walk.onEnd).toBeNull(); expect(f.entity._lastroApprovedRoute).toBeUndefined();
    f.setNow(12000); f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([50, 1, 51]);
    expect(f.Network.sendPacket).not.toHaveBeenCalled();
  });

  it('retains the normal 10ms route for a legal 32-step relocation and restores speed after arrival', () => {
    const f = fixture(); largerGat(f);
    f.functions.fastMove(fastMovePacket(f, 33, 1));
    expect(f.entity.walk.total).toBe(66); expect(f.entity.walk.speed).toBe(10);
    expect(f.entity.position[0]).toBe(1);
    f.setNow(10350); f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([33, 1, 34]);
    expect(f.entity.walk.total).toBe(0); expect(f.entity.walk.speed).toBe(150);
    expect(f.entity.walk.onEnd).toBeNull();
  });

  it('retires an old fast route for a same-position target and does not restart IDLE on repeated notifications', () => {
    const f = fixture(); f.functions.fastMove(fastMovePacket(f, 12, 1));
    expect(f.entity.walk.speed).toBe(10);
    const setAction = vi.spyOn(f.entity, 'setAction');
    f.functions.fastMove(fastMovePacket(f, 1, 1));
    expect(f.entity.walk.total).toBe(0); expect(f.entity.walk.speed).toBe(150);
    expect(f.entity.walk.onEnd).toBeNull(); expect(setAction).toHaveBeenCalledOnce();
    setAction.mockClear(); f.functions.fastMove(fastMovePacket(f, 1, 1));
    expect(setAction).not.toHaveBeenCalled(); expect(Array.from(f.entity.position)).toEqual([1, 1, 2]);
  });

  it('recovers a non-finite displayed position from a valid authoritative relocation target', () => {
    const f = fixture(); f.entity.position[0] = NaN;
    f.functions.fastMove(fastMovePacket(f, 12, 1));
    expect(Array.from(f.entity.position)).toEqual([12, 1, 13]);
    expect(f.entity.walk.total).toBe(0); expect(f.entity.walk.speed).toBe(150);
  });

  it.each(['loading', 'missing-gat', 'missing-cell', 'non-finite-height', 'height-error', 'negative', 'outside', 'fractional', 'missing-entity'])('leaves an active route unchanged for %s relocation input', kind => {
    const f = fixture(); beginWalk(f);
    const packet = { AID: 123, targetXpos: 12, targetYpos: 12 };
    if (kind === 'loading') f.MapRenderer.loading = true;
    if (kind === 'missing-gat') f.Altitude.width = f.Altitude.height = 0;
    if (kind === 'missing-cell') f.Altitude.getCellType.mockReturnValue(undefined);
    if (kind === 'non-finite-height') f.Altitude.getCellHeight.mockReturnValue(NaN);
    if (kind === 'height-error') f.Altitude.getCellHeight.mockImplementation(() => { throw new Error('GAT unavailable'); });
    if (kind === 'negative') packet.targetXpos = -1;
    if (kind === 'outside') packet.targetXpos = 24;
    if (kind === 'fractional') packet.targetXpos = 1.5;
    if (kind === 'missing-entity') packet.AID = 999;
    const before = {
      position: Array.from(f.entity.position), total: f.entity.walk.total, speed: f.entity.walk.speed,
      onEnd: f.entity.walk.onEnd, epoch: f.entity._lastroMovementEpoch,
    };
    f.functions.fastMove(packet);
    expect({
      position: Array.from(f.entity.position), total: f.entity.walk.total, speed: f.entity.walk.speed,
      onEnd: f.entity.walk.onEnd, epoch: f.entity._lastroMovementEpoch,
    }).toEqual(before);
  });
});

describe('damage visuals on server-approved movement', () => {

  it.each([1, 3])('finishes a whole approved route after a real 0x8a damage action with %s hits and no new movement packet', count => {
    const f = fixture();
    const moveBytes = new Uint8Array(12), view = new DataView(moveBytes.buffer);
    view.setUint16(0, 0x87, true); view.setUint32(2, 10000, true);
    moveBytes.set([0, 64, 16, 80, 1, 0], 6); // [1,1] -> [20,1]
    const move = nativeMovementPacket(f, 'NOTIFY_PLAYERMOVE', moveBytes) as MovePacket;
    expect(Array.from(move.MoveData)).toEqual([1, 1, 20, 1]);
    f.functions.playerMove(move);
    const routeEnd = vi.fn(), walkEnd = vi.fn();
    f.entity.walk.onEnd = routeEnd; f.entity.onWalkEnd = walkEnd;
    f.setNow(10050); f.SessionStorage_default.serverTick = 10050;
    f.entity.walkProcess();
    const action = receiveNativeDamageAction(f, count);
    expect(action).toMatchObject({ GID: 999, targetGID: 123, startTime: 10000, damage: 10, action: 0, count });
    f.flush(10150); f.entity.walkProcess();
    expect(f.entity.action).toBe(f.entity.ACTION.HURT);
    expect(f.entity.position[0]).toBe(2);
    expect(f.entity.walk.total).toBeGreaterThan(0);
    expect(f.entity.walk.onEnd).toBe(routeEnd);
    f.flush(10300); f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(3);
    f.flush(13000); f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([20, 1, 21]);
    expect(f.entity.walk.total).toBe(0);
    expect(routeEnd).toHaveBeenCalledOnce(); expect(walkEnd).toHaveBeenCalledOnce();
    expect(f.Network.sendPacket).not.toHaveBeenCalled();
  });

  it('schedules a late real damage visual at its impact time without rewinding the current position', () => {
    const f = fixture(); beginWalk(f);
    f.setNow(10300); f.SessionStorage_default.serverTick = 10300;
    f.entity.walkProcess(); expect(f.entity.position[0]).toBe(3);
    receiveNativeDamageAction(f);
    f.flush(10300); f.entity.walkProcess();
    expect(f.entity.action).toBe(f.entity.ACTION.HURT);
    expect(f.entity.position[0]).toBe(3);
    expect(f.entity.walk.total).toBeGreaterThan(0);
    f.flush(10450);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
    f.setNow(12000); f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([12, 1, 13]);
  });

  it('does not let old damage recovery replace a newer attack action on a newer route', () => {
    const f = fixture(); beginWalk(f);
    f.functions.hit({ ...normalHit, count: 4 }, f.entity);
    f.flush(10150);
    f.setNow(10200); f.SessionStorage_default.serverTick = 10200;
    f.functions.playerMove({ MoveData: [2, 1, 2, 12], moveStartTime: 10200 });
    f.entity.setAction({ action: f.entity.ACTION.ATTACK!, repeat: true, play: true });
    const newerAction = f.entity.action;
    expect(newerAction).toBe(f.entity.ACTION.ATTACK1);
    f.flush(11000); f.entity.walkProcess();
    expect(f.entity.action).toBe(newerAction);
    expect(f.entity.walk.total).toBeGreaterThan(0);
    expect(f.entity.position[1]).toBeCloseTo(1 + 800 / 150);
  });

  it('preserves native LastRO movement during HURT and recovery of the same approved route', () => {
    const f = fixture(synchronized);
    beginWalk(f);
    f.functions.hit(normalHit, f.entity);
    f.flush(10150);
    expect(f.entity.action).toBe(f.entity.ACTION.HURT);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(2);
    f.setNow(10300);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(3);
    f.flush(10450);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
    expect(f.entity.walk.total).toBeGreaterThan(0);
  });

  it.each([4, 9, 11, 14])('keeps immune or lucky-dodge action %s moving without interruption', action => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, action }, f.entity);
    f.flush(10300);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(3);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
    expect(f.entity.walk.total).toBeGreaterThan(0);
  });

  it.each([
    { damage: 0, leftDamage: 0, attackedMT: 300 },
    { damage: 10, attackedMT: 0 },
    { damage: 10, attackedMT: -1 },
  ])('does not stop non-flinching hit %j', detail => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, ...detail }, f.entity);
    f.flush(10300);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(3);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
  });

  it('lets a newer authoritative route win over an already-past attack impact received late', () => {
    const f = fixture();
    beginWalk(f);
    f.setNow(10300);
    f.SessionStorage_default.serverTick = 10300;
    f.functions.playerMove({ MoveData: [3, 1, 3, 12], moveStartTime: 10300 });
    f.functions.hit({ ...normalHit, startTime: 10000 }, f.entity);
    f.flush(10300);
    f.setNow(10600);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([3, 3, 6]);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
    expect(f.entity.walk.total).toBeGreaterThan(0);
  });

  it('allows a newly confirmed server route after a real hit and rejects remaining old multihit callbacks', () => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, count: 4 }, f.entity);
    f.flush(10150);
    f.setNow(10200);
    f.SessionStorage_default.serverTick = 10200;
    f.functions.playerMove({ MoveData: [2, 1, 2, 9], moveStartTime: 10200 });
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
    f.flush(10900);
    f.entity.walkProcess();
    expect(f.entity.position[1]).toBeCloseTo(1 + 700 / 150);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
    expect(f.entity.walk.total).toBeGreaterThan(0);
  });

  it('keeps a newer fast-move packet and restores normal speed if that route is later canceled', () => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, count: 3 }, f.entity);
    f.setNow(10100);
    f.functions.fastMove({ AID: 123, targetXpos: 1, targetYpos: 12 });
    expect(f.entity.walk.speed).toBe(10);
    f.flush(10800);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([1, 12, 13]);
    expect(f.entity.walk.speed).toBe(150);
    expect(f.entity.action).not.toBe(f.entity.ACTION.HURT);

    f.functions.fastMove({ AID: 123, targetXpos: 12, targetYpos: 12 });
    expect(f.entity.walk.speed).toBe(10);
    f.functions.stop({ AID: 123, xPos: 2, yPos: 12 });
    expect(f.entity.walk.speed).toBe(150);
    expect(Array.from(f.entity.position)).toEqual([2, 12, 14]);
  });

  it('rejects an older movement timestamp and accepts a uint32 wrap without corrupting the newer route', () => {
    const f = fixture();
    beginWalk(f);
    f.setNow(10100);
    f.SessionStorage_default.serverTick = 10100;
    f.functions.playerMove({ MoveData: [2, 1, 2, 12], moveStartTime: 10100 });
    f.functions.move({ GID: 123, MoveData: [1, 1, 12, 1], moveStartTime: 10050 });
    f.setNow(10400);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(2);
    expect(f.entity.position[1]).toBe(3);

    f.functions.mapEntry(f.entity, { xPos: 1, yPos: 1 }, 123);
    f.SessionStorage_default.serverTick = 0xfffffff0;
    f.functions.playerMove({ MoveData: [1, 1, 12, 1], moveStartTime: 0xfffffff0 });
    f.SessionStorage_default.serverTick = 16;
    f.functions.playerMove({ MoveData: [2, 1, 2, 12], moveStartTime: 16 });
    f.setNow(10550);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(2);
    expect(f.entity.position[1]).toBe(2);
  });

  it.each(['player', 'entity', 'zero'] as const)('lets a newer %s server correction supersede a pending hit', kind => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, count: 3 }, f.entity);
    f.setNow(10100);
    f.SessionStorage_default.serverTick = 10100;
    if (kind === 'player') f.functions.playerMove({ MoveData: [2, 1, 2, 12], moveStartTime: 10100 });
    else if (kind === 'entity') f.functions.move({ GID: 123, MoveData: [2, 1, 2, 12], moveStartTime: 10100 });
    else f.functions.playerMove({ MoveData: [7, 8, 7, 8], moveStartTime: 10100 });
    f.flush(10800);
    f.entity.walkProcess();
    if (kind === 'zero') expect(Array.from(f.entity.position)).toEqual([7, 8, 15]);
    else {
      expect(f.entity.position[0]).toBe(2);
      expect(f.entity.position[1]).toBeCloseTo(1 + 700 / 150);
      expect(f.entity.walk.total).toBeGreaterThan(0);
    }
    expect(f.entity.action).not.toBe(f.entity.ACTION.HURT);
  });

  it.each(['stop', 'jump'] as const)('uses authoritative %s coordinates and rejects old damage timers', kind => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, count: 3 }, f.entity);
    f.setNow(10100);
    f.functions[kind]({ AID: 123, xPos: 7, yPos: 8 });
    f.flush(10900);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([7, 8, 15]);
    expect(f.entity.walk.total).toBe(0);
    expect(f.entity.action).not.toBe(f.entity.ACTION.HURT);
  });

  it('ignores delayed damage after the entity identity is removed or replaced', () => {
    for (const replace of [false, true]) {
      const f = fixture();
      beginWalk(f);
      f.functions.hit(normalHit, f.entity);
      if (replace) f.entries.set(123, { ...f.entity, position: new Float32Array([8, 8, 16]) });
      else f.entries.delete(123);
      f.flush(10450);
      expect(f.entity.action).toBe(f.entity.ACTION.WALK);
      expect(f.entity.walk.total).toBeGreaterThan(0);
    }
  });

  it('ignores delayed damage after death without resurrecting a movement animation', () => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, count: 5 }, f.entity);
    f.entity.setAction({ action: f.entity.ACTION.DIE!, repeat: true });
    f.flush(11500);
    expect(f.entity.action).toBe(f.entity.ACTION.DIE);
  });

  it.each(['mapChange', 'mapEntry', 'cleanup'] as const)('invalidates pending hits at %s even when the player entity is reused', flow => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit({ ...normalHit, count: 3 }, f.entity);
    if (flow === 'mapChange') f.functions.mapChange({ mapName: 'prt_fild01', xPos: 8, yPos: 8 });
    else if (flow === 'mapEntry') f.functions.mapEntry(f.entity, { xPos: 8, yPos: 8 }, 123);
    else f.functions.cleanup();
    f.entity.setAction({ action: f.entity.ACTION.IDLE! });
    f.flush(11200);
    expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
  });

  it('keeps a legitimate pending hurt visual after route completion without restarting movement', () => {
    const f = fixture();
    f.functions.playerMove({ MoveData: [1, 1, 2, 1], moveStartTime: 10000 });
    f.functions.hit({ ...normalHit, attackMT: 300 }, f.entity);
    f.setNow(10150);
    f.entity.walkProcess();
    expect(f.entity.walk.total).toBe(0);
    f.flush(10300);
    expect(f.entity.action).toBe(f.entity.ACTION.HURT);
    f.flush(11000);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([2, 1, 3]);
    expect(f.entity.walk.total).toBe(0);
  });

  it('rejects a stale delayed hit when SessionStorage switches to a different character', () => {
    const f = fixture();
    beginWalk(f);
    f.functions.hit(normalHit, f.entity);
    f.SessionStorage_default.Entity = { ...f.entity, GID: 321 };
    f.flush(10450);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
  });
});

function moveRequest() {
  const buffer = new ArrayBuffer(5);
  return { constructor: { name: 'PACKET_CZ_REQUEST_MOVE2' }, build: vi.fn(() => ({ buffer, view: new DataView(buffer) })) };
}

describe('movement while the server is silent or disconnected', () => {
  it('sends an unacknowledged move request without starting a speculative local route', () => {
    const f = fixture();
    const packet = moveRequest();
    f.functions.sendPacket(packet);
    f.setNow(13000);
    f.entity.walkProcess();
    expect(packet.build).toHaveBeenCalledOnce();
    expect(f.socket.send).toHaveBeenCalledOnce();
    expect(f.entity.walk.total).toBe(0);
    expect(Array.from(f.entity.position)).toEqual([1, 1, 2]);
  });

  it('finishes a server-approved route without extra coordinate packets or a followup move acknowledgement', () => {
    const f = fixture();
    beginWalk(f);
    f.setNow(10300);
    f.entity.walkProcess();
    f.functions.sendPacket(moveRequest());
    f.setNow(12000);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([12, 1, 13]);
    expect(f.entity.walk.total).toBe(0);
  });

  it('immediately freezes a closed zone connection and blocks further movement packets', () => {
    const f = fixture();
    beginWalk(f);
    f.setNow(10300);
    f.entity.walkProcess();
    const position = Array.from(f.entity.position);
    const arrival = vi.fn();
    f.entity.walk.onEnd = arrival;
    f.socket.connected = false;
    f.functions.closeEvent.call(f.socket, { code: 0, wasClean: false });
    expect(f.entity.walk.total).toBe(0);
    expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
    expect(f.MapControl._lastroMovementInput.cancel).toHaveBeenCalled();
    f.setNow(12000);
    f.entity.walkProcess();
    const packet = moveRequest();
    f.functions.sendPacket(packet);
    expect(Array.from(f.entity.position)).toEqual(position);
    expect(arrival).not.toHaveBeenCalled();
    expect(packet.build).not.toHaveBeenCalled();
    expect(f.socket.send).not.toHaveBeenCalled();
  });

  it('does not cancel the new connection when a superseded socket closes during handoff', () => {
    const f = fixture();
    beginWalk(f);
    const old = { ...f.socket, connected: false, handoffPending: true };
    f.functions.closeEvent.call(old, { code: 0, wasClean: true });
    f.setNow(10300);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBe(3);
    expect(f.entity.walk.total).toBeGreaterThan(0);
    expect(f.MapControl._lastroMovementInput.cancel).not.toHaveBeenCalled();
  });

  it('handles a login connection closing before game session state has been initialized', () => {
    const f = fixture();
    const login = { ...f.socket, connected: false, isZone: false };
    f.context._socket = login;
    f.context._sockets = [login];
    f.context.SessionStorage_default = undefined;
    expect(() => f.functions.closeEvent.call(login, { code: 0, wasClean: false })).not.toThrow();
    expect(f.MapControl._lastroMovementInput.cancel).not.toHaveBeenCalled();
  });

  it('stops the current route after a persistently unanswered heartbeat while preserving the current display position', () => {
    const f = fixture();
    beginWalk(f, 10000);
    f.SessionStorage_default.ping.returned = false;
    f.SessionStorage_default.ping._lastroUnansweredSince = 10000;
    f.setNow(54000);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBeCloseTo(5.4);
    const position = Array.from(f.entity.position);
    f.setNow(56000);
    f.entity.walkProcess();
    expect(f.entity.walk.total).toBe(0);
    expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
    expect(Array.from(f.entity.position)).toEqual(position);
    const request = moveRequest();
    f.functions.sendPacket(request);
    expect(request.build).not.toHaveBeenCalled();
  });

  it('keeps an approved route moving when other valid server packets prove the connection is live', () => {
    const f = fixture();
    beginWalk(f, 10000);
    f.SessionStorage_default.ping.returned = false;
    f.SessionStorage_default.ping._lastroUnansweredSince = 10000;
    f.socket._lastroMovementPacketAt = 55000;
    f.setNow(56000);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBeCloseTo(5.6);
    expect(f.entity.walk.total).toBeGreaterThan(0);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
  });

  it('does not interpret a disabled or never-sent heartbeat as loss of movement authority', () => {
    const f = fixture();
    beginWalk(f, 10000);
    f.SessionStorage_default.ping.returned = false;
    f.SessionStorage_default.ping._lastroUnansweredSince = undefined;
    f.setNow(56000);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBeCloseTo(5.6);
    expect(f.entity.walk.total).toBeGreaterThan(0);
  });

  it('uses a returning heartbeat and newly approved movement to recover after a prolonged stall', () => {
    const f = fixture();
    beginWalk(f, 10000);
    f.SessionStorage_default.ping.returned = false;
    f.SessionStorage_default.ping._lastroUnansweredSince = 10000;
    f.setNow(56000);
    f.entity.walkProcess();
    expect(f.entity.walk.total).toBe(0);
    f.functions.pong({ time: 56000 });
    f.entity.walk.speed = 150;
    f.functions.playerMove({ MoveData: [4, 4, 4, 12], moveStartTime: 56000 });
    f.setNow(56300);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([4, 6, 10]);
    expect(f.entity.action).toBe(f.entity.ACTION.WALK);
  });
});

describe('movement patch source ownership', () => {
  it('leaves unrelated source and the native pathfinder unchanged', () => {
    expect(patchRuntimeMovementSync('const sample = 1;')).toBe('const sample = 1;');
    const output = patchRuntimeMovementSync(patchRuntimeEntitySync(vendor));
    expect(region('src/Utils/PathFinding.js', output)).toBe(region('src/Utils/PathFinding.js'));
    expect(region('src/Network/PacketStructure.js', output)).toBe(region('src/Network/PacketStructure.js'));
  });

  it('rejects a duplicate entity region before applying a possibly ambiguous patch', () => {
    expect(() => patchRuntimeMovementSync(synchronized + region('src/Engine/MapEngine/Entity.js'))).toThrow('anchor:movement-sync');
  });
});
