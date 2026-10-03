import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { patchRuntimeEntitySync } from '../scripts/lastro-entity-sync.mjs';

const vendor = readFileSync(new URL('../vendor/v2/Online.js', import.meta.url), 'utf8');
function region(name: string, source = vendor) {
  const start = source.indexOf(`//#region ${name}`);
  if (start < 0) throw new Error(name);
  const end = source.indexOf('//#endregion', start) + '//#endregion'.length;
  return source.slice(start, end);
}
const native = region('src/Renderer/Entity/EntityWalk.js') + '\n' + region('src/Engine/MapEngine/Entity.js');
const patched = patchRuntimeEntitySync(native);
function declaration(source: string, name: string) {
  const file = ts.createSourceFile('native.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (nodes.length !== 1) throw new Error(name);
  return nodes[0]!.getText(file);
}
function entityMethod(name: string) {
  const file = ts.createSourceFile('Entity.js', region('src/Renderer/Entity/Entity.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods: ts.MethodDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) methods.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (methods.length !== 1) throw new Error(name);
  return methods[0]!.getText(file);
}

interface Walk {
  speed: number; tick: number; prevTick: number; dist: number; index: number; total: number;
  pos: Float32Array; lastPos: Float32Array; path: Int16Array; onEnd: (() => void) | null;
}
interface ActionOptions {
  action: number; frame?: number; repeat?: boolean; play?: boolean; next?: ActionOptions | false; delay?: number;
}
interface Entity {
  GID: number; objecttype: number; ACTION: Record<string, number>; action: number;
  position: Float32Array; walk: Walk;
  animation: { next: ActionOptions | false; save: ActionOptions | false; repeat: boolean; delay: number };
  _deathSyncTick: number; remove_tick: number; remove_delay: number;
  onWalkEnd: () => void;
  walkTo(x0: number, y0: number, x1: number, y1: number, range?: number, start?: number): void;
  walkToNonWalkableGround(x0: number, y0: number, x1: number, y1: number, range?: number, overshoot?: boolean, attacking?: boolean, start?: number): void;
  walkProcess(): void; resetRoute(keepDistance?: boolean): void; remove(type: number): void;
  setAction(options: ActionOptions): void;
}

function fixture(source = patched, objecttype = 5, size = 12) {
  let now = 10000;
  const SessionStorage_default = { serverTick: 10000, Entity: null as Entity | null };
  const Renderer = { tick: now };
  const cells = new Uint8Array(size * size).fill(10);
  const Altitude = {
    width: size, height: size, cells, types: { NONE: 1, WALKABLE: 2, WATER: 4, SNIPABLE: 8 },
    TYPE: { NONE: 1, WALKABLE: 2, WATER: 4, SNIPABLE: 8 },
    getCellType: (x: number, y: number) => cells[x + y * size],
    getCellHeight: vi.fn((x: number, y: number) => x + y),
  };
  const timers: { callback: () => void; due: number }[] = [];
  const Events = { setTimeout: vi.fn((callback: () => void, delay: number) => { timers.push({ callback, due: now + delay }); }) };
  const entries = new Map<number, Entity>();
  const EntityManager = {
    get: (id: number) => entries.get(id),
    removeGID: vi.fn((id: number) => entries.delete(id)),
    removeLife: vi.fn(), getFocusEntity: () => SessionStorage_default.Entity,
  };
  const constants = {
    TYPE_PC: 0, TYPE_DISGUISED: 1, TYPE_MOB: 5, TYPE_NPC: 6, TYPE_PET: 7, TYPE_HOM: 8,
    TYPE_MERC: 9, TYPE_ELEM: 10, TYPE_NPC2: 12, TYPE_NPC_ABR: 13, TYPE_NPC_BIONIC: 14,
    TYPE_FALCON: 15, TYPE_WUG: 16, TYPE_WARP: -1,
    VT: { OUTOFSIGHT: 0, DEAD: 1, EXIT: 2, TELEPORT: 3 },
  };
  const LastROAdvanceServerTick = vi.fn(() => SessionStorage_default.serverTick);
  const context = vm.createContext({
    Date: { now: () => now }, console, Float32Array, Int16Array, Uint32Array, Uint16Array, Uint8Array,
    __esmMin: (init: () => void) => { let loaded = false; return () => { if (!loaded) { loaded = true; init(); } }; },
    init_PathFinding: () => {}, init_Altitude: () => {},
    init_SessionStorage: () => {}, init_DBManager: () => {},
    SessionStorage_default, Renderer, Events, EntityManager, Altitude, Entity: constants,
    LastROAdvanceServerTick,
    Configs: { get: (name: string, fallback: unknown) => name === 'lastroProtocol' ? true : fallback },
    DB: { getWeaponAction: () => 0 },
    EffectManager: { remove: vi.fn(), spam: vi.fn() },
    StatusState_default: { EffectState: { INVISIBLE: 1 } },
    EffectConst_default: { EF_DEVIL: 1 },
    HomunInformations_default: { stopAI: vi.fn() }, MercenaryInformations_default: { stopAI: vi.fn() },
    Escape_default: { showDeathMenu: vi.fn() }, haveSiegfriedItem: () => false,
    C_DEATH_SYNC_OFFSET: 200, C_MULTIHIT_DELAY: 200,
  });
  vm.runInContext(region('src/Utils/PathFinding.js'), context);
  vm.runInContext('init_PathFinding(); PathFinding_default.setGat(Altitude);', context);
  const action = region('src/Renderer/Entity/EntityAction.js');
  const walk = region('src/Renderer/Entity/EntityWalk.js', source);
  const engine = region('src/Engine/MapEngine/Entity.js', source);
  vm.runInContext([
    declaration(action, 'Action'), declaration(action, 'Animation'), declaration(action, 'setAction'), declaration(action, 'Init$10'),
    walk,
    declaration(region('src/Engine/MapEngine/Main.js'), 'onPlayerMove'),
    declaration(engine, 'onEntityMove'),
    declaration(engine, 'onEntityVanish'), declaration(engine, 'onEntityWillBeHitSub'),
    'init_EntityWalk();',
  ].join('\n'), context);
  const functions = vm.runInContext(`({
    action: Init$10, walk: Init$4, compute: computeWalkStartTick,
    project: typeof lastroProjectWalkDistance === 'function' ? lastroProjectWalkDistance : undefined,
    vanish: onEntityVanish, hit: onEntityWillBeHitSub,
    playerMove: onPlayerMove, entityMove: onEntityMove,
    methods: {${entityMethod('remove')}, ${entityMethod('clean')}}
  })`, context) as {
    action(this: Entity): void; walk(this: Entity): void;
    compute(now: number, start: unknown, duration: number, limit?: number): number;
    project?: (walk: Walk, tick: number) => number | undefined;
    playerMove(pkt: { MoveData: number[]; moveStartTime: number }): void;
    entityMove(pkt: { GID: number; MoveData: number[]; moveStartTime: number }): void;
    vanish(pkt: { GID: number; type: number }): void;
    hit(pkt: { damage: number; leftDamage?: number; count?: number; action: number; attackMT: number; attackedMT: number }, entity: Entity): void;
    methods: Record<string, unknown>;
  };
  const noop = () => {};
  const component = { clean: noop, free: noop, remove: noop };
  const entity = Object.assign({
    constructor: constants, GID: 123, objecttype, position: new Float32Array([1, 1, 2]),
    sound: { free: noop }, _job: 1002, _sex: 0, weapon: 0, _effectState: 0,
    life: component, emblem: component, display: component, dialog: component, cast: component,
    room: component, attachments: component, animations: component, aura: component, dropEffect: component,
    _deathSyncTick: 0, remove_tick: 0, remove_delay: 0,
  }, functions.methods) as unknown as Entity;
  functions.action.call(entity);
  functions.walk.call(entity);
  entity.setAction({ action: entity.ACTION.IDLE!, repeat: true, play: true });
  entries.set(entity.GID, entity);
  // A separate current player keeps NPC deaths out of the player death-menu branch.
  SessionStorage_default.Entity = objecttype === constants.TYPE_PC ? entity : { GID: 999 } as Entity;
  return {
    entity, functions, SessionStorage_default, Renderer, Events, timers, entries, cells, EntityManager,
    Altitude, LastROAdvanceServerTick,
    setNow(value: number) { now = value; },
    flush(value: number) { now = value; for (const timer of timers.filter(timer => timer.due <= now)) timer.callback(); },
  };
}

describe('server-authoritative entity synchronization', () => {
  it.each(['player', 'entity'])('reconstructs a server-approved short detour after native index collisions: %s packet', entry => {
    const fixed = fixture(patched, 0, 128);
    const old = fixture(native, 0, 128);
    for (const f of [old, fixed]) {
      for (let y = 43; y <= 55; y++) f.cells[60 + y * 128] = 1;
      f.entity.position.set([27, 50, 77]);
      const packet = { GID: 123, MoveData: [50, 50, 69, 50], moveStartTime: 10000 };
      if (entry === 'player') f.functions.playerMove(packet);
      else f.functions.entityMove(packet);
    }
    expect(old.entity.walk.total).toBe(0);
    expect(Array.from(old.entity.position)).toEqual([27, 50, 77]);
    expect(fixed.entity.walk.total).toBeGreaterThan(0);
    expect(fixed.entity.walk.total).toBeLessThanOrEqual(66);
    const path = Array.from(fixed.entity.walk.path.slice(0, fixed.entity.walk.total));
    for (let i = 0; i < path.length; i += 2) {
      expect(fixed.cells[path[i]! + path[i + 1]! * 128]! & 2).not.toBe(0);
      if (i >= 2 && path[i] !== path[i - 2] && path[i + 1] !== path[i - 1]) {
        expect(fixed.cells[path[i]! + path[i - 1]! * 128]! & 2).not.toBe(0);
        expect(fixed.cells[path[i - 2]! + path[i + 1]! * 128]! & 2).not.toBe(0);
      }
    }
    const arrived = vi.fn(); fixed.entity.walk.onEnd = arrived;
    const action = vi.spyOn(fixed.entity, 'setAction');
    for (let elapsed = 16; elapsed <= 7000; elapsed += 16) {
      fixed.setNow(10000 + elapsed); fixed.entity.walkProcess();
      expect(Array.from(fixed.entity.position).every(Number.isFinite)).toBe(true);
    }
    expect(Array.from(fixed.entity.position)).toEqual([69, 50, 119]);
    expect(arrived).toHaveBeenCalledOnce();
    expect(action.mock.calls.filter(([option]) => option.action === fixed.entity.ACTION.IDLE)).toHaveLength(1);
  });

  it('retains ordinary native route selection and rejects oversized or unreachable server routes safely', () => {
    const old = fixture(native, 0, 96), fixed = fixture(patched, 0, 96);
    for (const f of [old, fixed]) f.entity.walkTo(1, 1, 20, 10, undefined, 10000);
    expect(Array.from(fixed.entity.walk.path.slice(0, fixed.entity.walk.total)))
      .toEqual(Array.from(old.entity.walk.path.slice(0, old.entity.walk.total)));
    for (const type of ['long', 'blocked', 'loading', 'local']) {
      const f = fixture(patched, 0, 96);
      if (type === 'blocked') f.cells[20 + 1 * 96] = 1;
      const end = type === 'long' ? 41 : type === 'blocked' ? 20 : 30;
      if (type === 'loading' || type === 'local') for (let y = 0; y <= 14; y++) f.cells[16 + y * 96] = 1;
      if (type === 'loading') {
        // An unavailable cell accessor prevents use of a stale map.
        f.Altitude.getCellType = () => undefined;
      }
      f.entity.walkTo(1, 1, end, 1, undefined, type === 'local' ? undefined : 10000);
      expect(f.entity.walk.total).toBe(0);
      f.setNow(20000); f.entity.walkProcess();
      expect(Array.from(f.entity.position).every(Number.isFinite)).toBe(true);
    }
  });

  it.each([0, 5, 7, 8, 9, 10, 15, 16])('preserves continuous animation distance for delayed and repeated routes: type %s', type => {
    const f = fixture(patched, type, 48);
    f.entity.walkTo(1, 1, 20, 1, undefined, 10000);
    const callbacks = vi.fn();
    f.entity.onWalkEnd = callbacks;
    for (let step = 1; step <= 8; step++) {
      const receipt = 10000 + step * 150 + 85;
      f.setNow(receipt);
      f.SessionStorage_default.serverTick = receipt;
      // A packet arrives between render frames. The previous route has not
      // been processed to this time before replacement.
      f.entity.walkTo(1 + step, 1, 20, 1, undefined, 10000 + step * 150);
      expect(f.entity.walk.dist).toBeCloseTo((receipt - 10000) / 150, 4);
      expect(f.entity.position[0]).toBeCloseTo(1 + (receipt - 10000) / 150, 4);
      expect(f.entity.action).toBe(f.entity.ACTION.WALK);
    }
    const priorDistance = f.entity.walk.dist;
    const priorPosition = Array.from(f.entity.position);
    f.entity.walkTo(9, 1, 20, 1, undefined, 11200);
    expect(f.entity.walk.dist).toBeCloseTo(priorDistance, 5);
    expect(Array.from(f.entity.position)).toEqual(priorPosition);
    expect(callbacks).not.toHaveBeenCalled();
  });

  it('projects unrendered path distance without mutating the live route or invoking arrival callbacks', () => {
    const f = fixture(patched, 0, 48);
    let seed = 37;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let sample = 0; sample < 160; sample++) {
      f.entity.resetRoute();
      f.entity.position.set([1, 1, 2]);
      f.entity.setAction({ action: f.entity.ACTION.IDLE!, repeat: true, play: true });
      f.entity.walk.speed = 100 + Math.floor(random() * 150);
      f.setNow(10000); f.SessionStorage_default.serverTick = 10000;
      f.entity.walkTo(1, 1, 3 + Math.floor(random() * 22), 2 + Math.floor(random() * 15), undefined, 10000);
      f.setNow(10000 + Math.floor(random() * 100));
      f.entity.walkProcess();
      if (sample % 3 === 0) f.entity.walk.speed = 50 + Math.floor(random() * 250);
      const tick = 10100 + Math.floor(random() * 7000);
      const live = f.entity.walk;
      const before = {
        ...live, path: Array.from(live.path), pos: Array.from(live.pos), lastPos: Array.from(live.lastPos),
        position: Array.from(f.entity.position),
      };
      const arrived = vi.fn();
      const reference = Object.assign({}, f.entity, {
        position: new Float32Array(f.entity.position),
        walk: { ...live, path: new Int16Array(live.path), pos: new Float32Array(live.pos), lastPos: new Float32Array(live.lastPos), onEnd: null },
        setAction: () => {}, onWalkEnd: arrived,
        resetRoute() { this.walk.total = 0; },
      });
      f.setNow(tick);
      reference.walkProcess();
      expect(f.functions.project!(live, tick)).toBeCloseTo(reference.walk.dist, 9);
      expect({
        ...live, path: Array.from(live.path), pos: Array.from(live.pos), lastPos: Array.from(live.lastPos),
        position: Array.from(f.entity.position),
      }).toEqual(before);
      // Only the separate reference may finish; projection has no callback.
      expect(f.entity.walk.onEnd).toBe(before.onEnd);
    }
  });

  it('keeps animation phase through an unrendered old endpoint and resets it when the new route completes', () => {
    const f = fixture(patched, 0);
    f.entity.walkTo(1, 1, 3, 1, undefined, 10000);
    f.setNow(10500); f.SessionStorage_default.serverTick = 10500;
    f.entity.walkTo(3, 1, 8, 1, undefined, 10500);
    expect(f.entity.walk.dist).toBeCloseTo(2);
    expect(f.entity.position[0]).toBe(3);
    f.setNow(11300);
    f.entity.walkProcess();
    expect(f.entity.walk.total).toBe(0);
    expect(f.entity.walk.dist).toBe(0);
    expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
  });

  it('reproduces native coordinate overflow on a 32-step route', () => {
    const f = fixture(native, 0, 48);
    f.entity.walkTo(1, 1, 33, 1, undefined, 10000);
    expect(f.entity.walk.total).toBe(66);
    expect(f.entity.walk.path.length).toBe(64);
    let invalid = false;
    for (let elapsed = 0; elapsed <= 4800; elapsed += 16) {
      f.setNow(10000 + elapsed);
      f.entity.walkProcess();
      invalid ||= Array.from(f.entity.position).some(value => !Number.isFinite(value));
    }
    expect(invalid).toBe(true);
  });

  it.each([
    [0, 1, 1, 33, 1], [5, 1, 1, 33, 1],
    [0, 1, 1, 33, 33], [5, 1, 1, 33, 33],
    [0, 33, 33, 1, 33], [5, 33, 33, 1, 33],
    [0, 33, 33, 1, 1], [5, 33, 33, 1, 1],
  ])('finishes 32 steps with finite coordinates: type %s, [%s,%s] to [%s,%s]', (type, x0, y0, x1, y1) => {
    const f = fixture(patched, type, 48);
    const arrival = vi.fn(), end = vi.fn();
    f.entity.onWalkEnd = end;
    // Complete the route twice so resetRoute must preserve the required capacity.
    for (const start of [10000, 20000]) {
      f.setNow(start);
      f.SessionStorage_default.serverTick = start;
      f.entity.walkTo(x0, y0, x1, y1, undefined, start);
      expect(f.entity.walk.total).toBe(66);
      expect(f.entity.walk.path.length).toBeGreaterThanOrEqual(f.entity.walk.total);
      expect(Array.from(f.entity.walk.path.slice(64, 66))).toEqual([x1, y1]);
      f.entity.walk.onEnd = arrival;
      for (let elapsed = 0; elapsed <= 7008; elapsed += 16) {
        f.setNow(start + elapsed);
        f.entity.walkProcess();
        expect([...f.entity.position, ...f.entity.walk.lastPos, f.entity.walk.dist]
          .every(Number.isFinite)).toBe(true);
      }
      expect(Array.from(f.entity.position)).toEqual([x1, y1, x1 + y1]);
      expect(f.entity.walk.total).toBe(0);
      expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
    }
    expect(arrival).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);
  });

  it.each([0, 15, 16])('preserves 32-step non-walkable paths for entity type %s', type => {
    const f = fixture(patched, type, 48);
    const end = vi.fn();
    f.entity.onWalkEnd = end;
    f.entity.walkToNonWalkableGround(1, 1, 33, 1, 0, false, false, 10000);
    expect(f.entity.walk.total).toBe(66);
    expect(f.entity.walk.path.length).toBeGreaterThanOrEqual(f.entity.walk.total);
    for (let elapsed = 0; elapsed <= 5008; elapsed += 16) {
      f.setNow(10000 + elapsed);
      f.entity.walkProcess();
      expect(Array.from(f.entity.position).every(Number.isFinite)).toBe(true);
    }
    expect(Array.from(f.entity.position.slice(0, 2))).toEqual([33, 1]);
    expect(f.entity.walk.total).toBe(0);
    expect(end).toHaveBeenCalledOnce();
  });

  it('reproduces the native wait for attack motion plus 200ms before showing a received death', () => {
    const f = fixture(native);
    f.functions.hit({ damage: 10, count: 4, action: 0, attackMT: 800, attackedMT: 400 }, f.entity);
    f.functions.vanish({ GID: 123, type: 1 });
    expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
    expect(f.Events.setTimeout.mock.calls.at(-1)?.[1]).toBe(1600);
    expect(f.entries.has(123)).toBe(false);
    f.flush(11600);
    expect(f.entity.action).toBe(f.entity.ACTION.DIE);
  });

  it('plays native death immediately and clears saved/next animations despite pending multihits', () => {
    const f = fixture();
    f.entity.setAction({ action: f.entity.ACTION.ATTACK!, next: { action: f.entity.ACTION.WALK! } });
    f.entity.setAction({ action: f.entity.ACTION.HURT!, delay: 20000 });
    f.functions.hit({ damage: 10, leftDamage: 10, count: 5, action: 0, attackMT: 800, attackedMT: 400 }, f.entity);
    const timers = f.timers.length;
    f.functions.vanish({ GID: 123, type: 1 });
    expect(f.entity.action).toBe(f.entity.ACTION.DIE);
    expect(f.entity.animation.next).toBe(false);
    expect(f.entity.animation.save).toBe(false);
    expect(f.entity._deathSyncTick).toBe(0);
    expect(f.entity.remove_delay).toBe(5000);
    expect(f.timers).toHaveLength(timers);
    f.flush(20000);
    expect(f.entity.action).toBe(f.entity.ACTION.DIE);
  });

  it('preserves native player death/repeat and out-of-sight cleanup', () => {
    const player = fixture(patched, 0);
    player.entity._deathSyncTick = 50000;
    player.functions.vanish({ GID: 123, type: 1 });
    expect(player.entity.action).toBe(player.entity.ACTION.DIE);
    expect(player.entity.animation.repeat).toBe(true);
    expect(player.entity.GID).toBe(123);
    expect(player.Events.setTimeout).not.toHaveBeenCalled();
    const mob = fixture();
    mob.functions.vanish({ GID: 123, type: 0 });
    expect(mob.entity.GID).toBe(-1);
    expect(mob.entity.remove_tick).toBe(10000);
    expect(mob.entity.remove_delay).toBe(1000);
  });

  it('uses a fresh server clock when the packet arrives before the next render frame', () => {
    const f = fixture();
    f.LastROAdvanceServerTick.mockImplementation(() => f.SessionStorage_default.serverTick = 10450);
    f.entity.walk.speed = 150;
    f.entity.walkTo(1, 1, 6, 1, undefined, 10000);
    expect(f.LastROAdvanceServerTick).toHaveBeenCalledOnce();
    expect(f.entity.position[0]).toBeCloseTo(4);
    expect(f.entity.position[1]).toBe(1);
    expect(f.entity.walk.tick).toBe(10000);
  });

  it('reproduces the native ignored moveStartTime and fixes it for monsters and players', () => {
    const old = fixture(native);
    old.SessionStorage_default.serverTick = 10300;
    old.entity.walkTo(1, 1, 6, 1, undefined, 10000);
    expect(old.entity.position[0]).toBe(1);
    expect(old.entity.walk.tick).toBe(10000);
    for (const type of [5, 0]) {
      const f = fixture(patched, type);
      f.SessionStorage_default.serverTick = 10300;
      f.entity.walkTo(1, 1, 6, 1, undefined, 10000);
      expect(f.entity.position[0]).toBeCloseTo(3);
      expect(f.entity.walk.tick).toBe(10000);
    }
  });

  it('resumes at current authoritative route time after a stall and then advances at normal speed', () => {
    const f = fixture();
    f.entity.walk.speed = 150;
    f.entity.walkTo(1, 1, 10, 1, undefined, 10000);
    f.setNow(10600);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBeCloseTo(5);
    f.setNow(10616);
    f.entity.walkProcess();
    expect(f.entity.position[0]).toBeCloseTo(5 + 16 / 150);
    f.setNow(13000);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([10, 1, 11]);
    expect(f.entity.walk.total).toBe(0);
    expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
  });

  it('does not interpolate a stale displayed position through a wall to the first server path cell', () => {
    const old = fixture(native);
    const fixed = fixture();
    for (const f of [old, fixed]) {
      f.cells[3 + 3 * 12] = 1;
      f.entity.position.set([2, 3, 5]);
      f.entity.walk.speed = 150;
      f.entity.walkTo(4, 3, 7, 3, undefined, 10000);
      f.setNow(10150);
      f.entity.walkProcess();
    }
    expect(old.entity.position[0]).toBeCloseTo(3);
    expect(fixed.entity.position[0]).toBeCloseTo(5);
    expect(fixed.entity.position[1]).toBe(3);
    expect(fixed.entity.position[2]).toBe(8);
  });

  it('retains native A* obstacle routing rather than turning the whole route into a straight segment', () => {
    const f = fixture();
    f.cells[3 + 3 * 12] = 1;
    f.entity.walk.speed = 150;
    f.entity.position.set([1, 3, 4]);
    f.entity.walkTo(1, 3, 5, 3, undefined, 10000);
    const points = Array.from(f.entity.walk.path.slice(0, f.entity.walk.total));
    for (let i = 0; i < points.length; i += 2) {
      expect(f.cells[points[i]! + points[i + 1]! * 12]).not.toBe(1);
    }
    expect(points.some((value, index) => index % 2 === 1 && value !== 3)).toBe(true);
    f.setNow(10300);
    f.entity.walkProcess();
    expect(Math.round(f.entity.position[1]!)).not.toBe(3);
    f.setNow(12000);
    f.entity.walkProcess();
    expect(Array.from(f.entity.position)).toEqual([5, 3, 8]);
  });

  it('replaces an old route using the native reset/onEnd lifecycle exactly once', () => {
    const f = fixture();
    f.entity.walkTo(1, 1, 7, 1, undefined, 10000);
    const previous = vi.fn();
    f.entity.walk.onEnd = previous;
    f.SessionStorage_default.serverTick = 10150;
    f.entity.walkTo(2, 1, 2, 5, undefined, 10150);
    expect(previous).toHaveBeenCalledOnce();
    expect(f.entity.walk.onEnd).toBe(null);
    const current = vi.fn();
    f.entity.walk.onEnd = current;
    f.setNow(11000);
    f.entity.walkProcess();
    f.entity.walkProcess();
    expect(previous).toHaveBeenCalledOnce();
    expect(current).toHaveBeenCalledOnce();
    expect(Array.from(f.entity.position)).toEqual([2, 5, 7]);
  });

  it('applies a zero-distance server movement correction and stops the previous route', () => {
    const f = fixture();
    f.entity.walkTo(1, 1, 7, 1, undefined, 10000);
    f.entity.walkTo(3, 4, 3, 4, undefined, 10000);
    expect(Array.from(f.entity.position)).toEqual([3, 4, 7]);
    expect(f.entity.walk.total).toBe(0);
    expect(f.entity.action).toBe(f.entity.ACTION.IDLE);
  });

  it('preserves the no-timestamp native movement and non-walkable follower API', () => {
    const f = fixture();
    f.entity.position.set([1.5, 1, 2.5]);
    f.entity.walkTo(1, 1, 4, 1);
    expect(Array.from(f.entity.walk.pos)).toEqual([1.5, 1, 2.5]);
    expect(f.entity.walk.prevTick).toBe(10000);
    expect(f.entity.position[0]).toBe(1.5);
    expect(declaration(region('src/Renderer/Entity/EntityWalk.js', patched), 'walkToNonWalkableGround'))
      .toBe(declaration(region('src/Renderer/Entity/EntityWalk.js'), 'walkToNonWalkableGround'));
  });

  it('clamps a delayed completed route to its endpoint instead of replaying a stale movement', () => {
    const f = fixture();
    f.SessionStorage_default.serverTick = 20000;
    f.entity.walkTo(1, 1, 4, 1, undefined, 10000);
    expect(Array.from(f.entity.position)).toEqual([4, 1, 5]);
    expect(f.entity.walk.total).toBe(0);
  });

  it('handles uint32 rollover and a zero packet timestamp', () => {
    const f = fixture();
    f.SessionStorage_default.serverTick = 50;
    expect(f.functions.compute(10000, 0xfffffff0, 500)).toBe(9934);
    f.SessionStorage_default.serverTick = 0x100000032;
    expect(f.functions.compute(10000, 0xfffffff0, 500)).toBe(9934);
    expect(f.functions.compute(10000, 0, 500)).toBe(9950);
  });

  it.each([undefined, NaN, Infinity, -1, 0x100000000, 1.5, '10000'])('does not fast-forward an invalid packet timestamp %s', start => {
    const f = fixture();
    f.SessionStorage_default.serverTick = 11000;
    expect(f.functions.compute(10000, start, 500)).toBe(10000);
  });

  it('does not fast-forward a future timestamp or an unsampled server clock', () => {
    const f = fixture();
    expect(f.functions.compute(10000, 10500, 500)).toBe(10000);
    f.SessionStorage_default.serverTick = 0;
    expect(f.functions.compute(10000, 1, 500)).toBe(10000);
  });
});

describe('entity synchronization patch anchors', () => {
  it('skips small fixtures without either independent region', () => {
    expect(patchRuntimeEntitySync('const sample = 1;')).toBe('const sample = 1;');
  });
  it.each([
    native.replace('function walkTo(', 'function renamedWalkTo('),
    native.replaceAll('this.walk.pos.set(this.position);', 'this.walk.pos.set(otherPosition);'),
    native.replace('walk.prevTick + MAX_WALK_CATCHUP_DELTA', 'walk.prevTick + 200'),
    native.replace('entity.remove(pkt.type);', 'entity.remove(otherType);'),
    native.replace('this.path = new Int16Array(PathFinding_default.MAX_WALKPATH * 2);', 'this.path = new Int16Array(64);'),
    native.replace('this.walk.path = new Int16Array(PathFinding_default.MAX_WALKPATH * 2);', 'this.walk.path = new Int16Array(64);'),
    native + region('src/Renderer/Entity/EntityWalk.js'),
  ])('rejects changed or duplicate native anchors', source => {
    expect(() => patchRuntimeEntitySync(source)).toThrow('anchor:entity-sync');
  });
  it('applies the allocation anchors to LF and CRLF source', () => {
    const lf = native.replaceAll('\r\n', '\n');
    expect(patchRuntimeEntitySync(lf.replaceAll('\n', '\r\n')).replaceAll('\r\n', '\n'))
      .toBe(patchRuntimeEntitySync(lf));
  });
  it('preserves the native packet handlers, movement pathfinder and damage scheduling', () => {
    const engine = region('src/Engine/MapEngine/Entity.js', patched);
    for (const name of ['onEntityMove', 'onEntityStopMove', 'onEntityWillBeHitSub']) {
      expect(declaration(engine, name)).toBe(declaration(region('src/Engine/MapEngine/Entity.js'), name));
    }
    const output = patchRuntimeEntitySync(vendor);
    expect(region('src/Utils/PathFinding.js', output)).toBe(region('src/Utils/PathFinding.js'));
    expect(region('src/Engine/MapEngine/Main.js', output)).toBe(region('src/Engine/MapEngine/Main.js'));
  });
});
