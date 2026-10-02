import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { patchRuntimeEquipmentCatalog, patchRuntimeEquipmentView } from '../scripts/lastro-equipment-view.mjs';
import { patchRuntimeWeaponViewFallback } from '../scripts/lastro-weapon-view-fallback.mjs';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
function region(source: string, path: string) {
  const start = source.indexOf('//#region ' + path), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native weapon region: ' + path);
  return source.slice(start, end + '//#endregion'.length);
}
function nodeText(source: string, predicate: (node: ts.Node, file: ts.SourceFile) => boolean) {
  const file = ts.createSourceFile('native-weapon.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), found: string[] = [];
  function visit(node: ts.Node) {
    if (predicate(node, file)) found.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (found.length !== 1) throw new Error('Missing/ambiguous native weapon node');
  return found[0]!;
}
function assignment(name: string) {
  const start = native.indexOf('  ' + name + ' =');
  return nodeText(native.slice(start, start + 6000), (node, file) => ts.isBinaryExpression(node)
    && node.left.getText(file) === name) + ';';
}
const dbRegion = region(native, 'src/DB/DBManager.js'), viewRegion = region(native, 'src/Renderer/Entity/EntityView.js');
const source = dbRegion + '\n' + viewRegion, fixed = patchRuntimeWeaponViewFallback(source);
const patchedView = patchRuntimeEquipmentView(region(fixed, 'src/Renderer/Entity/EntityView.js'));
const paths = ['Jobs/JobConst', 'Jobs/JobNameTable', 'Jobs/WeaponJobTable', 'Items/WeaponType',
  'Items/WeaponTable', 'Items/WeaponTypeExpansion', 'Items/WeaponTrailTable'];
const catalog = paths.map(path => region(native, 'src/DB/' + path + '.js')).join('\n');
const correctedCatalog = patchRuntimeEquipmentCatalog(catalog);
const methods = ['getWeaponType', 'getWeaponPath', 'getWeaponTrail', 'getWeaponViewID', 'isAssassin', 'isKatar', 'isShield'];
const assassinJobs = nodeText(dbRegion, (node, file) => ts.isPropertyDeclaration(node) && node.name.getText(file) === 'S_JOBS_ASSASSIN');
const dbMethods = (text: string, includeFallback: boolean) => [...methods, ...(includeFallback ? ['getWeaponFallbackViewID'] : [])]
  .map(name => nodeText(text, (node, file) => ts.isMethodDeclaration(node) && node.name.getText(file) === name)).join('\n') + '\n' + assassinJobs;
const originalDBMethods = dbMethods(dbRegion, false), fixedDBMethods = dbMethods(region(fixed, 'src/DB/DBManager.js'), true);
const viewHandler = nodeText(region(native, 'src/Engine/MapEngine/Entity.js'), node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'onEntityViewChange');
const packetNames = ['SPRITE_CHANGE', 'SPRITE_CHANGE2'] as const;
const packets = packetNames.flatMap(name => [assignment('PACKET.ZC.' + name), assignment('PACKET.ZC.' + name + '.size')]).join('\n');
const packetIds = Object.fromEntries(packetNames.map(name => {
  const match = new RegExp('^    (\\d+): PACKET\\.ZC\\.' + name + ',', 'm').exec(native);
  if (!match) throw new Error('Missing native weapon packet ID');
  return [name, Number(match[1])];
}));

interface File { spr: string | null; act: string | null; pal: string | null; }
interface Actor {
  GID: number; weapon: number; shield: number; job: number; _job: number; _sex: number; _weapon: number;
  files: Record<string, File> & { weapon: File }; sound: Record<string, unknown>; aura: { load: () => void };
}
interface Pending { path: string; success?: () => void; failure?: () => void; done?: boolean; }
interface DB {
  getWeaponViewID(id: unknown): unknown; getWeaponFallbackViewID(id: unknown): unknown;
  getWeaponType(id: unknown, real?: boolean): number; getWeaponPath(id: unknown, job: number, sex: number): string;
  getWeaponTrail(id: unknown, job: number, sex: number): string;
}
function fixture(fallback = true, sex = 0, job = 0, version = 20240101) {
  const pending: Pending[] = [];
  const actor = {
    GID: 42, constructor: { TYPE_PC: 0, TYPE_UNKNOWN: -1 }, objecttype: 0, _job: job, _sex: sex, _weapon: 0,
    _shield: 0, _head: -1, _headpalette: 0, _bodypalette: 0, _accessory: 0, _accessory2: 0, _accessory3: 0,
    sound: {}, aura: { load: vi.fn() },
  } as unknown as Actor;
  const context = vm.createContext({
    console, ArrayBuffer, DataView, Uint8Array, window: { ArrayBuffer, DataView, Uint8Array },
    PacketVerManager_default: { value: version }, PACKET: { ZC: {} },
    __esmMin: (initialize: () => void) => { let initialized = false; return () => { if (!initialized) { initialized = true; initialize(); } }; },
    Client: { loadFile: (path: string, success?: () => void, failure?: () => void) => pending.push({ path, success, failure }) },
    MountTable: {}, AllMountTable: {}, ShadowTable_default: {}, setTimeout() {}, init_CodepageManager() {}, init_Struct() {},
    EntityManager: { get: (gid: number) => gid === 42 ? actor : null },
    Entity: { TYPE_EFFECT: 3, TYPE_UNIT: 4, TYPE_TRAP: 5 }, SessionStorage_default: {}, EffectManager: {},
  });
  vm.runInContext(`
    ${correctedCatalog}
    ${paths.map(path => 'init_' + path.split('/')[1] + '();').join('\n')}
    const SexTable = ['¿©', '³²'], ItemTable_default = {};
    class DB { ${fallback ? fixedDBMethods : originalDBMethods} }
    DB.getWeaponSound = () => null;
    DB.isPlayer = () => true; DB.isMonster = () => false; DB.isBaby = () => false;
    DB.getShieldPath = () => null; DB.getCartPath = () => null;
    ${region(native, 'src/Utils/BinaryReader.js')}
    init_BinaryReader();
    ${packets}
    ${fallback ? patchedView : patchRuntimeEquipmentView(viewRegion)}
    ${viewHandler}
  `, context);
  const data = vm.runInContext('({ DB, WeaponTypeExpansion, ItemTable_default, init: Init$5, BinaryReader, PACKET })', context) as {
    DB: DB; WeaponTypeExpansion: Record<string, number>; ItemTable_default: Record<string, { ClassNum: unknown }>;
    init(this: Actor): void; BinaryReader: new (bytes: ArrayBuffer) => { seek(position: number): void };
    PACKET: { ZC: Record<string, (new (reader: unknown, end: number) => unknown) & { size: number }> };
  };
  data.init.call(actor);
  function finish(path: string, success: boolean) {
    const item = pending.find(item => item.path === path && !item.done && (success ? item.success : item.failure));
    if (!item) throw new Error('Missing native resource callback: ' + path);
    item.done = true; (success ? item.success : item.failure)?.();
  }
  function look(value: number, name: typeof packetNames[number] = 'SPRITE_CHANGE2') {
    const constructor = data.PACKET.ZC[name]!, bytes = new ArrayBuffer(constructor.size), writer = new DataView(bytes);
    writer.setUint16(0, packetIds[name]!, true); writer.setUint32(2, actor.GID, true); writer.setUint8(6, 2);
    if (name === 'SPRITE_CHANGE2' && version >= 20180704) {
      writer.setUint32(7, value, true); writer.setUint32(11, 0, true);
    } else if (name === 'SPRITE_CHANGE2') {
      writer.setInt16(7, value, true);
      writer.setInt16(9, 0, true);
    } else writer.setUint8(7, value);
    const reader = new data.BinaryReader(bytes); reader.seek(2);
    context.packet = new constructor(reader, bytes.byteLength);
    vm.runInContext('onEntityViewChange(packet)', context);
  }
  return { actor, pending, finish, look, ...data };
}
const expansions = Object.entries(fixture().WeaponTypeExpansion).map(([view, base]) => ({ view: Number(view), base }));

describe('expanded weapon resource fallback', () => {
  it('reproduces the native retry of the same missing Main Gauche SPR and changes only its failure fallback', () => {
    const baseline = fixture(false), current = fixture();
    for (const f of [baseline, current]) f.look(31);
    const requested = current.DB.getWeaponPath(31, 0, 0) + '.spr';
    const base = current.DB.getWeaponPath(1, 0, 0) + '.spr';
    expect(requested).toBe('data/sprite/ÀÎ°£Á·/ÃÊº¸ÀÚ/ÃÊº¸ÀÚ_¿©_31.spr');
    expect(base).toBe('data/sprite/ÀÎ°£Á·/ÃÊº¸ÀÚ/ÃÊº¸ÀÚ_¿©_´Ü°Ë.spr');
    expect(baseline.pending.map(item => item.path)).toEqual(current.pending.map(item => item.path));
    baseline.finish(requested, false); current.finish(requested, false);
    expect(baseline.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual([requested, requested]);
    expect(current.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual([requested, base]);
    current.finish(base, true);
    expect(current.actor.files.weapon).toMatchObject({ spr: base, act: base.replace('.spr', '.act') });
    expect(current.actor.weapon).toBe(1);
  });

  it.each(expansions.flatMap(entry => [0, 1].map(sex => ({ ...entry, sex }))))(
    'uses native class $base for failed expanded view $view with sex $sex', ({ view, base, sex }) => {
      const f = fixture(true, sex);
      f.look(view);
      const requested = f.DB.getWeaponPath(view, 0, sex), fallback = f.DB.getWeaponPath(base, 0, sex);
      expect(f.pending.find(item => item.path.endsWith('.spr'))?.path).toBe(requested + '.spr');
      expect(requested).not.toBe(fallback);
      f.finish(requested + '.spr', false); f.finish(fallback + '.spr', true);
      expect(f.actor.files.weapon).toMatchObject({ spr: fallback + '.spr', act: fallback + '.act' });
      expect(f.actor.weapon).toBe(base);
      const trail = f.DB.getWeaponTrail(base, 0, sex);
      if (trail) expect(f.pending.some(item => item.path === trail + '.spr')).toBe(true);
    },
  );

  it.each(['number', 'string', 'item'] as const)('resolves a known expansion from %s input without changing the native view resolver', input => {
    const f = fixture(); f.ItemTable_default[12001] = { ClassNum: 31 };
    const value = input === 'number' ? 31 : input === 'string' ? '31' : 12001;
    expect(f.DB.getWeaponViewID(value)).toBe(input === 'string' ? '31' : 31);
    expect(f.DB.getWeaponFallbackViewID(value)).toBe(1);
  });

  it.each([['modern LOOK', 'SPRITE_CHANGE2', 20240101], ['old LOOK2', 'SPRITE_CHANGE2', 20170101], ['original LOOK', 'SPRITE_CHANGE', 20240101]] as const)(
    'retains a successful expanded sprite from the real %s decoder', (_label, name, version) => {
      const f = fixture(true, 1, 0, version); f.look(31, name);
      const requested = f.DB.getWeaponPath(31, 0, 1) + '.spr'; f.finish(requested, true);
      expect(f.actor.weapon).toBe(31); expect(f.actor.files.weapon.spr).toBe(requested);
      expect(f.pending.filter(item => item.failure)).toHaveLength(1);
    },
  );

  it('keeps item-ID path selection and nonexpanded native resolver results', () => {
    const f = fixture(); f.ItemTable_default[12001] = { ClassNum: 31 }; f.ItemTable_default[12002] = { ClassNum: 2 };
    expect(f.DB.getWeaponPath(12001, 0, 0)).toBe(f.DB.getWeaponPath(1, 0, 0));
    for (const value of [0, 1, 2, 23, 24, 25, 30, '2', 12002, 1101, 999999, 'invalid', NaN]) {
      expect(f.DB.getWeaponFallbackViewID(value)).toBe(f.DB.getWeaponViewID(value));
    }
  });

  it('rejects invalid expansion metadata and preserves the native view', () => {
    const f = fixture();
    for (const base of [undefined, null, '1', 1.5, -1, NaN, Infinity, 103]) {
      f.WeaponTypeExpansion[31] = base as unknown as number;
      expect(f.DB.getWeaponFallbackViewID(31)).toBe(31);
    }
  });

  it('does not restart a missing expansion after its base sprite also fails', () => {
    const f = fixture(); f.look(31);
    f.finish(f.DB.getWeaponPath(31, 0, 0) + '.spr', false); f.finish(f.DB.getWeaponPath(1, 0, 0) + '.spr', false);
    expect(f.pending.filter(item => item.failure)).toHaveLength(2); expect(f.actor.files.weapon.spr).toBeNull();
  });

  it('inherits current request guards when an old fallback finishes after a newer LOOK', () => {
    const f = fixture(); f.look(31); f.finish(f.DB.getWeaponPath(31, 0, 0) + '.spr', false);
    f.look(39); const current = f.DB.getWeaponPath(39, 0, 0) + '.spr'; f.finish(current, true);
    f.finish(f.DB.getWeaponPath(1, 0, 0) + '.spr', true);
    expect(f.actor.weapon).toBe(39); expect(f.actor.files.weapon.spr).toBe(current);
  });
});

describe('weapon fallback transformation anchors', () => {
  it('preserves the original packet-facing resolver and all nonweapon factories', () => {
    const resolver = (text: string) => nodeText(text, (node, file) => ts.isMethodDeclaration(node)
      && node.name.getText(file) === 'getWeaponViewID');
    expect(resolver(fixed)).toBe(resolver(source));
    expect(region(fixed, 'src/Renderer/Entity/EntityView.js')).toBe(viewRegion.replace(
      'UpdateGeneric("weapon", "getWeaponPath", "getWeaponViewID")', 'UpdateGeneric("weapon", "getWeaponPath", "getWeaponFallbackViewID")'));
    expect(expansions).toHaveLength(72);
  });
  it('rejects duplicate installation and incomplete or changed native anchors', () => {
    expect(patchRuntimeWeaponViewFallback('unrelated source')).toBe('unrelated source');
    expect(() => patchRuntimeWeaponViewFallback(fixed)).toThrow('already-installed');
    expect(() => patchRuntimeWeaponViewFallback(dbRegion)).toThrow('regions');
    expect(() => patchRuntimeWeaponViewFallback(source + '\n' + viewRegion)).toThrow('region');
    expect(() => patchRuntimeWeaponViewFallback(source.replace('static getWeaponViewID(id)', 'static getWeaponViewID(view)'))).toThrow('resolver-signature');
    expect(() => patchRuntimeWeaponViewFallback(source.replace('UpdateGeneric("weapon", "getWeaponPath", "getWeaponViewID")',
      'UpdateGeneric("weapon", "getWeaponPath", "different")'))).toThrow('factory-signature');
  });
  it('produces valid JavaScript before and after the existing view transformation', () => {
    const parsed = ts.createSourceFile('weapon.js', fixed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) as
      ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
    expect(parsed.parseDiagnostics).toHaveLength(0);
    expect(patchRuntimeWeaponViewFallback(dbRegion + '\n' + patchRuntimeEquipmentView(viewRegion)))
      .toBe(region(fixed, 'src/DB/DBManager.js') + '\n' + patchedView);
  });
});
