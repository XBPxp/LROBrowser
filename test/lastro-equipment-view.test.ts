import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { patchRuntimeEquipmentView } from '../scripts/lastro-equipment-view.mjs';

const vendor = readFileSync('vendor/v2/Online.js', 'utf8');
const marker = '//#region src/Renderer/Entity/EntityView.js';
const start = vendor.indexOf(marker), end = vendor.indexOf('//#endregion', start) + '//#endregion'.length;
const native = vendor.slice(start, end), patched = patchRuntimeEquipmentView(native);
type Part = 'robe' | 'weapon' | 'shield' | 'accessory' | 'accessory2' | 'accessory3';
interface Files { spr: string | null; act: string | null; pal: string | null; size: number; }
interface Actor {
  constructor: Record<string, number>; objecttype: number; files: Record<string, Files>;
  _job: number; _sex: number; _body: number; _robe: number; _weapon: number; _shield: number;
  _head: number; _headpalette: number; _bodypalette: number;
  _accessory: number; _accessory2: number; _accessory3: number;
  job: number; robe: number; weapon: number; shield: number; accessory: number; accessory2: number; accessory3: number;
  _transformationSeq: number; _active_monster_transform: number | null; _effectiveJob: number;
}
interface Pending { path: string; success?: () => void; failure?: () => void; done?: boolean; }
const iceWingSprite = (id = 3160, doram = false) => `robe/${id}/C_Ice_Wing/C_Ice_Wing${doram ? '_doram' : ''}.spr`;
function fixture(source = patched, sharedRobe = true, robeNames: Record<number, string> = { 71: 'C_Ice_Wing', 3160: 'C_Ice_Wing' }) {
  const pending: Pending[] = [], timers: (() => void)[] = [];
  const loadFile = vi.fn((path: string, success?: () => void, failure?: () => void) => { pending.push({ path, success, failure }); });
  const db = {
    getCartPath: (id: number) => 'cart/' + id,
    getBodyPath: (job: number, sex: number, style = 0) => `body/${job}/${sex}/${style}`,
    getAdminPath: (sex: number) => `admin/${sex}`,
    getRobePath: (id: number, job: number, sex: number) => id === 999 ? null : `robe/${id}/${job}/${sex}`,
    getRobePathNoSex: (id: number, job: number) => {
      const name = robeNames[id];
      return !sharedRobe ? null : name ? `robe/${id}/${name}/${name}${job === 4218 ? '_doram' : ''}` : `robe/${id}/shared`;
    },
    getWeaponPath: (id: number, job: number, sex: number) => `weapon/${id}/${job}/${sex}`,
    getWeaponViewID: (id: number) => id + 100,
    getWeaponSound: (id: number) => 'sound/' + id,
    getWeaponTrail: (id: number) => 'trail/' + id,
    getShieldPath: (id: number, job: number, sex: number) => `shield/${id}/${job}/${sex}`,
    getHatPath: (id: number, sex: number) => `hat/${id}/${sex}`,
    isPlayer: (job: number) => job < 10000,
    isMonster: (job: number) => job >= 10000,
    isBaby: () => false,
  };
  const context = vm.createContext({
    console, DB: db, Client: { loadFile }, MountTable: {}, AllMountTable: {}, ShadowTable_default: {},
    PacketVerManager_default: { value: 20240101 }, JobConst_default: {},
    __esmMin: (init: () => void) => init, setTimeout: (callback: () => void) => timers.push(callback),
  });
  vm.runInContext(patched === source ? patched : source, context);
  vm.runInContext('HeadParts = ["head", "accessory", "accessory2", "accessory3"];', context);
  const functions = vm.runInContext('({ init: Init$5, body: UpdateBody, style: UpdateBodyStyle })', context) as {
    init(this: Actor): void; body(this: Actor, job: number): void; style(this: Actor, style: number): void;
  };
  const actor = {
    constructor: { TYPE_PC: 0, TYPE_UNKNOWN: -1 }, objecttype: 0, _job: 4010, _sex: 1,
    _robe: 0, _weapon: 0, _shield: 0, _head: -1, _headpalette: 0, _bodypalette: 0,
    _accessory: 0, _accessory2: 0, _accessory3: 0,
    sound: {},
  } as unknown as Actor;
  functions.init.call(actor);
  actor._body = 0;
  function finish(path: string, success = true) {
    const request = pending.find(item => item.path === path && !item.done && (success ? item.success : item.failure));
    if (!request) throw new Error('No pending resource: ' + path);
    request.done = true;
    (success ? request.success : request.failure)?.();
  }
  return { actor, pending, functions, timers, finish };
}

describe('native equipment resource request lifecycle', () => {
  it.each<Part>(['robe', 'weapon', 'shield', 'accessory', 'accessory2', 'accessory3'])('clears the previous %s sprite while its replacement loads', part => {
    const f = fixture(), a = f.actor;
    a[part] = 1; const first = f.pending.find(item => item.path.endsWith('.spr'))!.path;
    f.finish(first); expect(a.files[part]!.spr).toBe(first);
    a.files[part]!.pal = 'old-palette';
    a[part] = 2;
    expect(a[part]).toBe(2);
    expect(a.files[part]).toMatchObject({ spr: null, act: null, pal: null });
  });

  it.each<Part>(['robe', 'weapon', 'shield', 'accessory', 'accessory2', 'accessory3'])('keeps the newest %s after an older resource finishes last', part => {
    const f = fixture(), a = f.actor;
    a[part] = 1; const old = f.pending.find(item => item.path.endsWith('.spr'))!.path;
    a[part] = 2; const newest = f.pending.filter(item => item.path.endsWith('.spr')).at(-1)!.path;
    f.finish(newest); f.finish(old);
    expect(a[part]).toBe(2); expect(a.files[part]!.spr).toBe(newest);
  });

  it('retains a requested robe before it has loaded so a body change reloads its matching ACT', () => {
    const f = fixture(), a = f.actor;
    a.robe = 3165;
    expect(a._robe).toBe(3165);
    f.functions.body.call(a, 0);
    f.finish('robe/3165/4010/1.spr');
    expect(a.files.robe!.spr).toBeNull();
    f.finish('body/0/1/0.spr');
    expect(f.pending.some(item => item.path === 'robe/3165/0/1.act')).toBe(true);
    f.finish('robe/3165/0/1.spr');
    expect(a.files.robe).toMatchObject({ spr: 'robe/3165/0/1.spr', act: 'robe/3165/0/1.act' });
  });

  it('does not resurrect an unequipped robe or start its fallback from an older failure', () => {
    const f = fixture(), a = f.actor;
    a.robe = 3165; a.robe = 0;
    f.finish('robe/3165/4010/1.spr', false);
    expect(a.robe).toBe(0); expect(a.files.robe).toMatchObject({ spr: null, act: null, pal: null });
    expect(f.pending.some(item => item.path === 'robe/3165/shared.spr')).toBe(false);
  });

  it('keeps the profession ACT when the robe uses a shared SPR', () => {
    const f = fixture(); f.actor.robe = 3165;
    f.finish('robe/3165/4010/1.spr', false);
    f.finish('robe/3165/shared.spr');
    expect(f.actor.files.robe).toMatchObject({ spr: 'robe/3165/shared.spr', act: 'robe/3165/4010/1.act' });
  });

  it('rejects an older common robe failure after a new robe has loaded', () => {
    const f = fixture(), a = f.actor;
    a.robe = 3160;
    a.robe = 2; f.finish('robe/2/4010/1.spr'); f.finish(iceWingSprite(), false);
    expect(a.robe).toBe(2); expect(a.files.robe!.act).toBe('robe/2/4010/1.act');
    expect(f.pending.some(item => item.path === 'robe/3160/4010/1.spr')).toBe(false);
  });

  it('protects the weapon type fallback with the same request sequence', () => {
    const f = fixture(), a = f.actor;
    a.weapon = 1; f.finish('weapon/1/4010/1.spr', false);
    a.weapon = 2; f.finish('weapon/2/4010/1.spr'); f.finish('weapon/101/4010/1.spr');
    expect(a.weapon).toBe(2); expect(a.files.weapon!.spr).toBe('weapon/2/4010/1.spr');
  });

  it('rejects a pending weapon trail after a weapon change and after unequipping', () => {
    const f = fixture(), a = f.actor;
    a.weapon = 1; f.finish('weapon/1/4010/1.spr');
    a.weapon = 2; f.finish('weapon/2/4010/1.spr'); f.finish('trail/1.spr');
    expect(a.files.weapon_trail!.spr).toBeNull();
    f.finish('trail/2.spr'); expect(a.files.weapon_trail!.act).toBe('trail/2.act');
    a.weapon = 3; f.finish('weapon/3/4010/1.spr'); a.weapon = 0; f.finish('trail/3.spr');
    expect(a.files.weapon_trail).toMatchObject({ spr: null, act: null }); expect(a.weapon).toBe(0);
  });

  it('allows independent head slots to finish and retains current head suppression', () => {
    const f = fixture(), a = f.actor;
    a.accessory = 1; a.accessory2 = 2;
    f.finish('hat/1/1.spr'); f.finish('hat/2/1.spr');
    expect(a.files.accessory!.spr).toBe('hat/1/1.spr'); expect(a.files.accessory2!.spr).toBe('hat/2/1.spr');
    a.accessory3 = 3; a._active_monster_transform = 10000;
    f.finish('hat/3/1.spr'); expect(a.files.accessory3!.spr).toBeNull();
  });

  it('ignores resources from an older sex and invalidates a missing equipment path', () => {
    const f = fixture(), a = f.actor;
    a.robe = 3165; a._sex = 0; f.finish('robe/3165/4010/1.spr');
    expect(a.files.robe!.spr).toBeNull();
    a.robe = 3165; a.robe = 999; f.finish('robe/3165/4010/0.spr');
    expect(a.robe).toBe(999); expect(a.files.robe!.spr).toBeNull();
  });
});

describe('verified Ice Wing artwork with profession-specific ACTs', () => {
  it.each([71, 3160, 9005])('selects canonical Ice Wing artwork by resource name for view %s', id => {
    const f = fixture(patched, true, { [id]: 'C_Ice_Wing' }); f.actor.robe = id;
    expect(f.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual([iceWingSprite(id)]);
    f.finish(iceWingSprite(id));
    expect(f.actor.files.robe!.act).toBe(`robe/${id}/4010/1.act`);
  });

  it('recognizes the canonical Doram Ice Wing common artwork', () => {
    const f = fixture(); f.actor._job = f.actor._effectiveJob = 4218; f.actor.robe = 3160;
    expect(f.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual([iceWingSprite(3160, true)]);
    f.finish(iceWingSprite(3160, true));
    expect(f.actor.files.robe).toMatchObject({ spr: iceWingSprite(3160, true), act: 'robe/3160/4218/1.act' });
  });

  it.each(['C_Ice_Wing_Extra', 'Other_Costume', 'C_Ice_Wing_doram'])('uses native order for a different resource at the known Ice Wing ID (%s)', resource => {
    const f = fixture(patched, true, { 3160: resource }); f.actor.robe = 3160;
    expect(f.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual(['robe/3160/4010/1.spr']);
  });

  it('selects common artwork before a successful profession SPR can supply a placeholder', () => {
    const baseline = fixture(native), fixed = fixture();
    baseline.actor.robe = 3160; fixed.actor.robe = 3160;
    expect(baseline.pending.find(item => item.path.endsWith('.spr'))!.path).toBe('robe/3160/4010/1.spr');
    baseline.finish('robe/3160/4010/1.spr');
    expect(baseline.actor.files.robe!.spr).toBe('robe/3160/4010/1.spr');
    expect(baseline.pending.some(item => item.path === iceWingSprite())).toBe(false);
    expect(fixed.pending.find(item => item.path.endsWith('.spr'))!.path).toBe(iceWingSprite());
    expect(fixed.pending.some(item => item.path === 'robe/3160/4010/1.spr')).toBe(false);
    fixed.finish(iceWingSprite());
    expect(fixed.actor.files.robe).toMatchObject({ spr: iceWingSprite(), act: 'robe/3160/4010/1.act' });
  });

  it('falls back to the profession SPR only after the common SPR fails', () => {
    const f = fixture(); f.actor.robe = 3160;
    expect(f.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual([iceWingSprite()]);
    f.finish(iceWingSprite(), false);
    expect(f.actor.files.robe).toMatchObject({ spr: null, act: null });
    expect(f.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual([iceWingSprite(), 'robe/3160/4010/1.spr']);
    f.finish('robe/3160/4010/1.spr');
    expect(f.actor.files.robe).toMatchObject({ spr: 'robe/3160/4010/1.spr', act: 'robe/3160/4010/1.act' });
  });

  it('stops after both robe sprite candidates fail without looping back to common', () => {
    const f = fixture(); f.actor.robe = 3160;
    f.finish(iceWingSprite(), false); f.finish('robe/3160/4010/1.spr', false);
    expect(f.pending.filter(item => item.path.endsWith('.spr'))).toHaveLength(2);
    expect(f.actor.files.robe).toMatchObject({ spr: null, act: null });
    expect(f.actor.robe).toBe(3160);
  });

  it('keeps the legacy robe route when no common artwork path exists', () => {
    const f = fixture(patched, false); f.actor.robe = 2;
    expect(f.pending.filter(item => item.path.endsWith('.spr')).map(item => item.path)).toEqual(['robe/2/4010/1.spr']);
    f.finish('robe/2/4010/1.spr');
    expect(f.actor.files.robe).toMatchObject({ spr: 'robe/2/4010/1.spr', act: 'robe/2/4010/1.act' });
  });

  it.each<Part>(['weapon', 'shield', 'accessory', 'accessory2', 'accessory3'])('preserves the native %s sprite route', part => {
    const baseline = fixture(native), fixed = fixture();
    baseline.actor[part] = 2; fixed.actor[part] = 2;
    expect(fixed.pending.map(item => item.path)).toEqual(baseline.pending.map(item => item.path));
  });

  it('rejects an older legacy robe success after newer common artwork has loaded', () => {
    const f = fixture(); f.actor.robe = 3160; f.finish(iceWingSprite(), false);
    f.actor.robe = 71; f.finish(iceWingSprite(71)); f.finish('robe/3160/4010/1.spr');
    expect(f.actor.robe).toBe(71);
    expect(f.actor.files.robe).toMatchObject({ spr: iceWingSprite(71), act: 'robe/71/4010/1.act' });
  });

  it('does not resurrect an unequipped robe from a pending legacy SPR', () => {
    const f = fixture(); f.actor.robe = 3160; f.finish(iceWingSprite(), false);
    f.actor.robe = 0; f.finish('robe/3160/4010/1.spr');
    expect(f.actor.robe).toBe(0); expect(f.actor.files.robe).toMatchObject({ spr: null, act: null });
  });

  it.each([true, false])('rejects a common robe callback after a sex change (success=%s)', success => {
    const f = fixture(); f.actor.robe = 3160; f.actor._sex = 0;
    f.finish(iceWingSprite(), success);
    expect(f.actor.files.robe).toMatchObject({ spr: null, act: null });
    expect(f.pending.some(item => item.path === 'robe/3160/4010/1.spr')).toBe(false);
  });

  it('ignores a stale common failure while refreshing the robe for a new profession', () => {
    const f = fixture(); f.actor.robe = 3160; f.functions.body.call(f.actor, 0);
    f.finish(iceWingSprite(), false);
    expect(f.pending.some(item => item.path === 'robe/3160/4010/1.spr')).toBe(false);
    f.finish('body/0/1/0.spr'); f.finish(iceWingSprite());
    expect(f.actor.files.robe).toMatchObject({ spr: iceWingSprite(), act: 'robe/3160/0/1.act' });
  });
});

describe('native profession-first order for every other robe', () => {
  it.each([1, 5, 6, 33, 3165])('preserves native profession SPR and ACT requests for robe %s on Madogear', id => {
    const baseline = fixture(native), fixed = fixture();
    for (const f of [baseline, fixed]) {
      f.actor._job = f.actor._effectiveJob = 4086;
      f.actor.robe = id;
    }
    expect(fixed.pending.map(item => item.path)).toEqual(baseline.pending.map(item => item.path));
    expect(fixed.pending.some(item => item.path === `robe/${id}/shared.spr`)).toBe(false);
    fixed.finish(`robe/${id}/4086/1.spr`);
    expect(fixed.actor.files.robe).toMatchObject({ spr: `robe/${id}/4086/1.spr`, act: `robe/${id}/4086/1.act` });
  });

  it('uses the native shared SPR fallback only after a profession SPR failure', () => {
    const f = fixture(); f.actor.robe = 5;
    expect(f.pending.map(item => item.path)).toEqual(['robe/5/4010/1.act', 'robe/5/4010/1.spr']);
    f.finish('robe/5/4010/1.spr', false);
    expect(f.pending.map(item => item.path)).toEqual(['robe/5/4010/1.act', 'robe/5/4010/1.spr', 'robe/5/shared.spr']);
    f.finish('robe/5/shared.spr');
    expect(f.actor.files.robe).toMatchObject({ spr: 'robe/5/shared.spr', act: 'robe/5/4010/1.act' });
    expect(f.pending.some(item => item.path === 'robe/5/shared.act')).toBe(false);
  });

  it.each(['unequip', 'replacement', 'sex', 'job'] as const)('rejects the ordinary shared fallback after %s', change => {
    const f = fixture(); f.actor.robe = 5; f.finish('robe/5/4010/1.spr', false);
    if (change === 'unequip') f.actor.robe = 0;
    if (change === 'replacement') { f.actor.robe = 6; f.finish('robe/6/4010/1.spr'); }
    if (change === 'sex') f.actor._sex = 0;
    if (change === 'job') f.functions.body.call(f.actor, 0);
    const before = { ...f.actor.files.robe }; f.finish('robe/5/shared.spr');
    expect(f.actor.files.robe).toEqual(before);
    expect(f.actor.robe).toBe(change === 'unequip' ? 0 : change === 'replacement' ? 6 : 5);
  });
});

describe('native body linked robe refresh', () => {
  it('clears the old profession robe when the new body loads before its matching robe', () => {
    const f = fixture(), a = f.actor;
    a.robe = 3165; f.finish('robe/3165/4010/1.spr');
    expect(a.files.robe!.act).toBe('robe/3165/4010/1.act');
    f.functions.body.call(a, 0); f.finish('body/0/1/0.spr');
    expect(a.files.body!.act).toBe('body/0/1/0.act');
    expect(a._robe).toBe(3165); expect(a.files.robe).toMatchObject({ spr: null, act: null });
    f.finish('robe/3165/0/1.spr');
    expect(a.files.robe!.act).toBe('robe/3165/0/1.act');
  });

  it('refreshes the robe after a body style loads', () => {
    const f = fixture(); f.actor.robe = 3165; f.finish('robe/3165/4010/1.spr');
    const previous = f.pending.length;
    f.functions.style.call(f.actor, 1); f.timers.shift()!();
    f.finish('body/4010/1/1.spr');
    expect(f.pending.slice(previous).filter(item => item.path === 'robe/3165/4010/1.act')).toHaveLength(1);
  });

  it('preserves the existing transformation sequence check when refreshing a robe', () => {
    const f = fixture(); f.actor.robe = 3165; f.finish('robe/3165/4010/1.spr');
    const previous = f.pending.length;
    f.functions.body.call(f.actor, 4010); f.actor._transformationSeq++;
    f.finish('body/4010/1/0.spr');
    expect(f.pending.slice(previous).some(item => item.path.startsWith('robe/'))).toBe(false);
  });
});

describe('equipment view patch boundaries', () => {
  it('leaves unrelated source untouched and changes only the EntityView region', () => {
    expect(patchRuntimeEquipmentView('const unrelated = 1;')).toBe('const unrelated = 1;');
    expect(patchRuntimeEquipmentView(vendor)).toBe(vendor.slice(0, start) + patched + vendor.slice(end));
  });

  const lineEndings = [{ name: 'LF', newline: '\n' }, { name: 'CRLF', newline: '\r\n' }];
  it.each(lineEndings)('patches unchanged native anchors with $name line endings', ({ newline }) => {
    const source = native.replace(/\r?\n/g, newline);
    expect(patchRuntimeEquipmentView(source).replace(/\r\n/g, '\n')).toBe(patched.replace(/\r\n/g, '\n'));
  });

  describe.each(lineEndings)('with $name line endings', ({ newline }) => {
    const source = native.replace(/\r?\n/g, newline);
    it.each([
      (input: string) => input.replace('function UpdateGeneric(type, func, fallback)', 'function UpdateGeneric(type, changed, fallback)'),
      (input: string) => input.replace('let _val = val;', 'let _val = other;'),
      (input: string) => input.replace(/refreshHeadState\.call\(this\);(\r?\n) {6}}/,
        (_match, ending: string) => `refreshHeadState.call(this);${ending}        changed();${ending}      }`),
      (input: string) => input + input,
      () => patched,
    ])('fails on changed, duplicate or already patched native anchors', change => {
      const changed = change(source);
      expect(changed).not.toBe(source);
      expect(() => patchRuntimeEquipmentView(changed)).toThrow('anchor:equipment-view');
    });
  });
});
