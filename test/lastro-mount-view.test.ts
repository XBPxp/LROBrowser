import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { patchRuntimeEquipmentCatalog, patchRuntimeEquipmentView } from '../scripts/lastro-equipment-view.mjs';

const vendor = fs.readFileSync('vendor/v2/Online.js', 'utf8');
const catalogSource = patchRuntimeEquipmentCatalog(vendor);
function region(source: string, path: string) {
  const marker = '//#region ' + path, start = source.indexOf(marker), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error('Missing native region: ' + path);
  return source.slice(start, end);
}
function declarations(source: string, names: string[]) {
  const file = ts.createSourceFile('native.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return names.map(name => {
    const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1) throw new Error('Missing native function: ' + name);
    return matches[0]!.getText(file);
  }).join('\n');
}
const nativeView = region(vendor, 'src/Renderer/Entity/EntityView.js') + '\n//#endregion';
const fixedView = patchRuntimeEquipmentView(nativeView);
const paths = ['Jobs/JobConst', 'Jobs/JobNameTable', 'Jobs/MountTable', 'Jobs/AllMountTable', 'Jobs/BabyTable', 'Status/StatusConst', 'Status/StatusState'];
const tableSource = paths.map(path => region(catalogSource, 'src/DB/' + path + '.js')).join('\n');
const dbFile = ts.createSourceFile('DB.js', region(vendor, 'src/DB/DBManager.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const methods: string[] = [];
function visitDb(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && ['getBodyPath', 'isPlayer', 'isDoram', 'isBaby'].includes(node.name.getText(dbFile))) methods.push(node.getText(dbFile));
  ts.forEachChild(node, visitDb);
}
visitDb(dbFile);
if (methods.length !== 4) throw new Error('Missing native body path method');
const stateSource = declarations(region(vendor, 'src/Renderer/Entity/EntityState.js'), ['updateAllRidingState', 'updateEffectState']);
const entityFile = ts.createSourceFile('Entity.js', region(vendor, 'src/Renderer/Entity/Entity.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const setMethods: string[] = [];
function visitEntity(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(entityFile) === 'set' && node.parameters[0]?.name.getText(entityFile) === 'unit') setMethods.push(node.getText(entityFile));
  ts.forEachChild(node, visitEntity);
}
visitEntity(entityFile);
if (setMethods.length !== 1) throw new Error('Missing native Entity.set');
interface FilePair { spr: string | null; act: string | null; pal: string | null; }
interface Actor {
  constructor: { TYPE_PC: number; TYPE_UNKNOWN: number }; objecttype: number;
  _job: number; _sex: number; _body: number; _effectiveJob: number; _transformationSeq: number;
  _active_monster_transform: number | null; _bodypalette: number; _robe: number;
  _allRidingState: number; _effectState: number; costume: number;
  job: number; sex: number; body: number; allRidingState: number; effectState: number;
  files: Record<string, FilePair> & { body: FilePair }; head: number;
}
interface Request { path: string; success?: () => void; done?: boolean; }
interface Tables {
  jobs: Record<string, number>; names: Record<string, string>;
  cash: Record<string, number>; ordinary: Record<string, number>;
  effect: Record<string, number>;
  path(job: number, sex: number, style?: number, cash?: boolean): string;
}
function fixture(source = fixedView, version = 20211103) {
  const requests: Request[] = [], timers: (() => void)[] = [];
  const context = vm.createContext({
    Client: { loadFile: (path: string, success?: () => void) => requests.push({ path, success }) },
    setTimeout: (callback: () => void) => timers.push(callback),
    console, SessionStorage_default: { AdminList: [], Entity: null }, EntityManager: {},
    ShadowTable_default: {}, PacketVerManager_default: { value: version },
    __esmMin: (callback: () => void) => { let loaded = false; return () => { if (!loaded) { loaded = true; callback(); } }; },
  });
  vm.runInContext(`${tableSource}
    init_JobConst(); init_JobNameTable(); init_MountTable(); init_AllMountTable(); init_BabyTable(); init_StatusState();
    const SexTable = ['¿©', '³²'];
    class DB { ${methods.join('\n')}
      static getCartPath(id) { return 'cart/' + id; }
      static isMonster(id) { return id >= 10000; }
    }
    ${source}
    ${stateSource}
    function recalculateBlendingColor() {}
    HeadParts = ['head', 'accessory', 'accessory2', 'accessory3'];
    class Entity { ${setMethods[0]} }
    Entity.prototype._allRidingState = 0; Entity.prototype._effectState = 0; Entity.prototype._body = 0;
  `, context);
  const native = vm.runInContext('({init: Init$5, ride: updateAllRidingState, effect: updateEffectState, set: Entity.prototype.set})', context) as {
    init(this: Actor): void; ride(this: Actor, value: number): void; effect(this: Actor, value: number): void;
    set(this: Actor, unit: Record<string, unknown>): void;
  };
  const tables = vm.runInContext('({jobs:JobConst_default, names:JobNameTable, cash:AllMountTable, ordinary:MountTable, effect:StatusState_default.EffectState, path:DB.getBodyPath})', context) as Tables;
  const actor = {
    constructor: { TYPE_PC: 0, TYPE_UNKNOWN: -4 }, objecttype: 0, _job: -1, _sex: -1,
    _head: -1, _headpalette: 0, _bodypalette: 0, _weapon: 0, _shield: 0, _robe: 0,
    _accessory: 0, _accessory2: 0, _accessory3: 0, costume: 0,
    _effectState: 0, _allRidingState: 0, _effectStateColor: new Float32Array([1, 1, 1, 1]),
    _transformationSeq: 0, _active_monster_transform: null, sound: {},
    ACTION: { IDLE: 0 }, setAction: () => {}, life: { hp: -1, hp_max: -1 },
  } as unknown as Actor;
  native.init.call(actor);
  Object.defineProperty(actor, 'allRidingState', { get: () => actor._allRidingState, set: value => native.ride.call(actor, value as number) });
  Object.defineProperty(actor, 'effectState', { get: () => actor._effectState, set: value => native.effect.call(actor, value as number) });
  function mount(job: number, sex = 1, cash = true) {
    actor.sex = sex; actor.job = job;
    if (cash) actor.allRidingState = 1;
    else actor.effectState = tables.effect.RIDING!;
  }
  function finish(request: Request) {
    if (request.done || !request.success) throw new Error('Not a pending SPR: ' + request.path);
    request.done = true; request.success();
  }
  function latestSpr() {
    const request = requests.filter(item => item.path.endsWith('.spr') && item.success).at(-1);
    if (!request) throw new Error('No pending body SPR');
    return request;
  }
  function resetStyle() { actor.body = 0; timers.at(-1)!(); return latestSpr(); }
  return { actor, tables, requests, timers, mount, finish, latestSpr, resetStyle, set: (unit: Record<string, unknown>) => native.set.call(actor, unit) };
}
const catalog = fixture().tables;
const cases = (['cash', 'ordinary'] as const).flatMap(type => Object.entries(catalog[type]).flatMap(([base, mount]) => [0, 1].map(sex => ({ type, base: Number(base), mount, sex }))));

describe('native mounted body reset', () => {
  it.each(cases)('retains $type mount $mount for profession $base sex $sex after body zero', ({ type, mount, sex }) => {
    const f = fixture(); f.actor.sex = sex; f.actor.job = mount;
    // The server may supply the mounted LOOK_BASE directly. Several base/style
    // IDs share one mount, so assert the actual requested mount, not its first
    // reverse-lookup alias in the native table.
    if (type === 'cash') f.actor.allRidingState = 1;
    else f.actor.effectState = f.tables.effect.RIDING!;
    expect(f.actor.costume).toBe(mount);
    const expected = f.tables.path(mount, sex), request = f.resetStyle();
    expect(request.path).toBe(expected + '.spr'); f.finish(request);
    expect(f.actor.files.body).toMatchObject({ spr: expected + '.spr', act: expected + '.act' });
    expect(f.actor.costume).toBe(mount);
  });

  it.each([true, false])('reproduces native Poring overwrite with delayed resource completion (correct mount first=%s)', correctFirst => {
    const f = fixture(nativeView); f.mount(f.tables.jobs.MAGICIAN!);
    const fox = f.latestSpr(), poring = f.resetStyle();
    expect(fox.path).toBe(f.tables.path(f.tables.cash[f.tables.jobs.MAGICIAN!]!, 1) + '.spr');
    expect(poring.path).toBe(f.tables.path(f.tables.cash[0]!, 1) + '.spr');
    if (correctFirst) { f.finish(fox); f.finish(poring); }
    else { f.finish(poring); f.finish(fox); }
    expect(f.actor.files.body.spr).toBe(correctFirst ? poring.path : fox.path);
  });

  it.each([true, false])('keeps the current fox for either asynchronous return order (earlier job request first=%s)', jobFirst => {
    const f = fixture(); f.mount(f.tables.jobs.MAGICIAN!);
    const previous = f.latestSpr(), current = f.resetStyle();
    expect(current.path).toBe(previous.path);
    if (jobFirst) { f.finish(previous); expect(f.actor.files.body.spr).toBeNull(); f.finish(current); }
    else { f.finish(current); f.finish(previous); }
    expect(f.actor.files.body.spr).toBe(current.path);
  });

  it.each([0, 1].flatMap(sex => [true, false].map(bodyFirst => ({ sex, bodyFirst }))))('runs native Entity.set with remote field order (sex=$sex bodyFirst=$bodyFirst)', ({ sex, bodyFirst }) => {
    const f = fixture();
    const unit = bodyFirst ? { body: 0, allRidingState: 1, job: f.tables.jobs.MAGICIAN, sex }
      : { allRidingState: 1, body: 0, sex, job: f.tables.jobs.MAGICIAN };
    f.set(unit);
    for (const timer of f.timers) timer();
    const current = f.latestSpr(); f.finish(current);
    expect(f.actor._job).toBe(f.tables.jobs.MAGICIAN);
    expect(f.actor.files.body.spr).toBe(f.tables.path(f.tables.cash[f.tables.jobs.MAGICIAN!]!, sex) + '.spr');
  });

  it('cancels a pending unmounted reset when a later cash riding status arrives', () => {
    const f = fixture(); f.actor.sex = 1; f.actor.job = f.tables.jobs.MAGICIAN!;
    f.actor.body = 0; const pending = f.timers.at(-1)!;
    f.actor.allRidingState = 1; const mounted = f.latestSpr(), before = f.requests.length;
    pending(); expect(f.requests).toHaveLength(before); f.finish(mounted);
    expect(f.actor.files.body.spr).toBe(mounted.path);
  });
});

describe('body style request ordering', () => {
  it('allows a pending body to complete after the native negative-job no-update sentinel', () => {
    const f = fixture(); f.mount(f.tables.jobs.MAGICIAN!);
    const current = f.latestSpr(), job = f.actor.job;
    f.actor.job = -1; f.finish(current);
    expect(f.actor.job).toBe(job);
    expect(f.actor.files.body.spr).toBe(current.path);
  });

  it('cancels an older timer when another style is requested for the same profession', () => {
    const f = fixture(undefined, 20240101); f.actor.sex = 1; f.actor.job = f.tables.jobs.WARLOCK!;
    f.actor.body = f.tables.jobs.WARLOCK_2ND!; const previous = f.timers.at(-1)!;
    f.actor.body = 0; const current = f.timers.at(-1)!, before = f.requests.length;
    previous(); expect(f.requests).toHaveLength(before); current(); f.finish(f.latestSpr());
    expect(f.actor.body).toBe(0);
    expect(f.actor.files.body.spr).toBe(f.tables.path(f.tables.jobs.WARLOCK!, 1, 0) + '.spr');
  });

  it.each(['style', 'job', 'sex', 'unmount', 'transform'] as const)('rejects a late style SPR after a %s change', change => {
    const f = fixture(undefined, 20240101); f.mount(f.tables.jobs.WARLOCK!);
    f.actor.body = f.tables.jobs.WARLOCK_2ND!; f.timers.at(-1)!(); const previous = f.latestSpr();
    if (change === 'style') { f.actor.body = 0; f.timers.at(-1)!(); }
    if (change === 'job') { f.actor.allRidingState = 0; f.actor.job = f.tables.jobs.MAGICIAN!; }
    if (change === 'sex') f.actor.sex = 0;
    if (change === 'unmount') f.actor.allRidingState = 0;
    if (change === 'transform') { f.actor._active_monster_transform = 10000; f.actor._transformationSeq++; }
    const before = { ...f.actor.files.body }; f.finish(previous);
    expect(f.actor.files.body).toEqual(before);
  });

  it.each(['job', 'sex', 'unmount', 'transform'] as const)('cancels a style timer before resource requests after a %s change', change => {
    const f = fixture(undefined, 20240101); f.mount(f.tables.jobs.WARLOCK!);
    f.actor.body = f.tables.jobs.WARLOCK_2ND!; const previous = f.timers.at(-1)!;
    if (change === 'job') { f.actor.allRidingState = 0; f.actor.job = f.tables.jobs.MAGICIAN!; }
    if (change === 'sex') f.actor.sex = 0;
    if (change === 'unmount') f.actor.allRidingState = 0;
    if (change === 'transform') { f.actor._active_monster_transform = 10000; f.actor._transformationSeq++; }
    const before = f.requests.length; previous(); expect(f.requests).toHaveLength(before);
  });

  it('retains the previously loaded body during a slow current mount request', () => {
    const f = fixture(); f.actor.sex = 1; f.actor.job = f.tables.jobs.MAGICIAN!;
    f.finish(f.latestSpr()); const unmounted = f.actor.files.body.spr;
    f.actor.allRidingState = 1; const pending = f.latestSpr();
    expect(f.actor.files.body.spr).toBe(unmounted);
    f.finish(pending); expect(f.actor.files.body.spr).toBe(pending.path);
  });

  it('rejects an earlier same-profession job SPR after the current style completes', () => {
    const f = fixture(undefined, 20240101); f.actor.sex = 1; f.actor.job = f.tables.jobs.WARLOCK!;
    const previous = f.latestSpr(); f.actor.body = f.tables.jobs.WARLOCK_2ND!; f.timers.at(-1)!();
    const current = f.latestSpr(); f.finish(current); f.finish(previous);
    expect(f.actor.files.body.spr).toBe(current.path);
  });

  it.each([20211103, 20240101])('retains native nonzero second-costume cash mount paths (packet version=%s)', version => {
    const native = fixture(nativeView, version), fixed = fixture(undefined, version);
    for (const f of [native, fixed]) {
      f.mount(f.tables.jobs.WARLOCK!); f.actor.body = version === 20211103 ? 1 : f.tables.jobs.WARLOCK_2ND!;
      f.timers.at(-1)!(); f.finish(f.latestSpr());
    }
    expect(fixed.actor.files.body).toEqual(native.actor.files.body);
    expect(fixed.actor.files.body.spr).toContain('/costume_1/');
  });
});
