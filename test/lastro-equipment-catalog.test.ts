import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { patchRuntimeEquipmentCatalog } from '../scripts/lastro-equipment-view.mjs';

const vendor = fs.readFileSync('vendor/v2/Online.js', 'utf8');
const patched = patchRuntimeEquipmentCatalog(vendor);
function region(source: string, name: string) {
  const marker = '//#region ' + name, start = source.indexOf(marker), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error('Missing native region: ' + name);
  return source.slice(start, end);
}
const paths = ['Jobs/JobConst', 'Jobs/JobNameTable', 'Jobs/WeaponJobTable', 'Jobs/MountTable', 'Jobs/AllMountTable',
  'Items/WeaponType', 'Items/HatTable', 'Items/RobeTable', 'Items/ShieldTable', 'Items/WeaponTable', 'Items/WeaponTypeExpansion', 'Items/WeaponTrailTable'];
const methodNames = ['getHatPath', 'getRobePath', 'getRobePathNoSex', 'isDoram', 'getWeaponPath', 'getWeaponTrail', 'getWeaponType', 'getShieldPath', 'isShield', 'getBodyPath', 'isPlayer'];
interface Catalog {
  HatTable_default: Record<string, string>; RobeTable_default: Record<string, string>;
  JobNameTable: Record<string, string>; WeaponJobTable: Record<string, string>;
  MountTable: Record<string, number>; AllMountTable: Record<string, number>; JobConst_default: Record<string, number>;
  WeaponType_default: Record<string, number>; WeaponTypeExpansion: Record<string, number>;
  WeaponName: Record<string, string>; WeaponTrail: Record<string, string>; ShieldTable_default: Record<string, string>;
  ItemTable_default: Record<number, { ClassNum: number }>;
  DB: {
    getBodyPath(id: number, sex: number, alternative?: number, cashMount?: boolean): string | null;
    getHatPath(id: number, sex: number): string | null;
    getRobePath(id: number, job: number, sex: number): string | null;
    getRobePathNoSex(id: number, job: number, sex: number): string | null;
    getWeaponType(id: number, real?: boolean, dual?: boolean): number;
    getWeaponPath(id: number, job: number, sex: number): string | null;
    getWeaponTrail(id: number, job: number, sex: number): string | null;
    getShieldPath(id: number, job: number, sex: number): string | null;
  };
}
function load(source: string): Catalog {
  const file = ts.createSourceFile('DB.js', region(source, 'src/DB/DBManager.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && methodNames.includes(node.name.getText(file))) methods.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (methods.length !== methodNames.length) throw new Error('Missing or duplicate native equipment path method');
  return vm.runInNewContext(`
    const __esmMin = fn => { let ready = false; return () => { if (!ready) { ready = true; fn(); } }; };
    ${paths.map(path => region(source, 'src/DB/' + path + '.js')).join('\n')}
    ${paths.map(path => 'init_' + path.split('/')[1] + '();').join('\n')}
    const SexTable = ['¿©', '³²'], ItemTable_default = {}, PacketVerManager_default = { value: 20240101 };
    class DB { ${methods.join('\n')} }
    ({DB, ItemTable_default, HatTable_default, RobeTable_default, JobNameTable, WeaponJobTable,
      MountTable, AllMountTable, JobConst_default, WeaponType_default, WeaponTypeExpansion, WeaponName, WeaponTrail, ShieldTable_default});
  `) as Catalog;
}
function applyLuaNames(source: string, catalog: Catalog, names: Record<string, unknown> | null | undefined,
  tableName: 'AccNameTable' | 'RobeNameTable') {
  const file = ts.createSourceFile('DB.js', region(source, 'src/DB/DBManager.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const callbacks: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'lazyInit') {
      function findCallback(child: ts.Node) {
        if (ts.isCallExpression(child) && child.expression.getText(file) === 'loadLuaTable' &&
            ts.isStringLiteral(child.arguments[1]!) && child.arguments[1].text === tableName && child.arguments[2]) {
          callbacks.push(child.arguments[2].getText(file));
        }
        ts.forEachChild(child, findCallback);
      }
      ts.forEachChild(node, findCallback);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (callbacks.length !== 1) throw new Error('Missing or duplicate native Lua callback: ' + tableName);
  const apply = vm.runInNewContext('(' + callbacks[0] + ')', {
    HatTable_default: catalog.HatTable_default, RobeTable_default: catalog.RobeTable_default,
  }) as (names: unknown) => void;
  apply(names);
}
function applyAccessoryNames(source: string, catalog: Catalog, names: Record<string, unknown> | null | undefined) {
  applyLuaNames(source, catalog, names, 'AccNameTable');
}

function bundledRobeNames(): Record<string, string> {
  const base = 'vendor/core/data/luafiles514/lua files/datainfo/';
  const ids = Object.fromEntries([...fs.readFileSync(base + 'spriterobeid.lub', 'latin1')
    .matchAll(/(ROBE_\w+)\s*=\s*(\d+)/g)].map(match => [match[1]!, Number(match[2])]));
  const table = fs.readFileSync(base + 'spriterobename.lub', 'latin1')
    .match(/RobeNameTable\s*=\s*\{([\s\S]*?)\}/)?.[1];
  if (!table) throw new Error('Unsupported bundled robe table');
  const entries = [...table.matchAll(/\[SPRITE_ROBE_IDs\.(\w+)\]\s*=\s*"([^"]*)"/g)];
  if (entries.length !== [...table.matchAll(/\[SPRITE_ROBE_IDs\./g)].length ||
      entries.some(match => ids[match[1]!] === undefined)) throw new Error('Unresolved bundled robe entry');
  return Object.fromEntries(entries.map(match => [ids[match[1]!]!, match[2]!]));
}

// These bundled Lua 5.1 chunks contain only top-level table assignments. Execute
// their actual instructions so the regression follows the shipped ID/name pair.
function bundledAccessoryNames(): Record<string, unknown> {
  const globals: Record<string, unknown> = {};
  function table(value: unknown) {
    if (typeof value !== 'object' || value === null) throw new Error('Expected an accessory Lua table');
    return value as Record<string, unknown>;
  }
  function key(value: unknown) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid accessory Lua key');
    return String(value);
  }
  for (const name of ['accessoryid', 'accname']) {
    const data = fs.readFileSync(`vendor/core/data/luafiles514/lua files/datainfo/${name}.lub`);
    if (!data.subarray(0, 12).equals(Buffer.from([0x1b, 0x4c, 0x75, 0x61, 0x51, 0, 1, 4, 4, 4, 8, 0]))) throw new Error('Unsupported accessory Lua format');
    let offset = 12;
    const integer = () => { const value = data.readUInt32LE(offset); offset += 4; return value; };
    const string = () => { const length = integer(), start = offset; offset += length; return data.subarray(start, offset - 1).toString('latin1'); };
    string(); integer(); integer(); offset += 4;
    const instructions = Array.from({ length: integer() }, integer);
    const constants: unknown[] = Array.from({ length: integer() }, () => {
      const tag = data[offset++]!;
      if (tag === 0) return null;
      if (tag === 1) return Boolean(data[offset++]!);
      if (tag === 3) { const value = data.readDoubleLE(offset); offset += 8; return value; }
      if (tag === 4) return string();
      throw new Error('Unsupported accessory Lua constant: ' + tag);
    });
    const registers: unknown[] = [], rk = (index: number) => index >= 256 ? constants[index - 256] : registers[index];
    for (const instruction of instructions) {
      const op = instruction & 63, a = instruction >>> 6 & 255, b = instruction >>> 23 & 511,
        c = instruction >>> 14 & 511, bx = instruction >>> 14;
      if (op === 0) registers[a] = registers[b];
      else if (op === 1) registers[a] = constants[bx];
      else if (op === 5) registers[a] = globals[key(constants[bx])];
      else if (op === 6) registers[a] = table(registers[b])[key(rk(c))];
      else if (op === 7) globals[key(constants[bx])] = registers[a];
      else if (op === 9) table(registers[a])[key(rk(b))] = rk(c);
      else if (op === 10) registers[a] = {};
      else if (op === 30) break;
      else throw new Error('Unsupported accessory Lua instruction: ' + op);
    }
  }
  return table(globals.AccNameTable);
}
const catalog = load(patched);
const numericKeys = (table: object) => Object.keys(table).filter(key => /^\d+$/.test(key)).map(Number);
const jobs = numericKeys(catalog.JobNameTable), weaponJobs = numericKeys(catalog.WeaponJobTable);

describe('complete bundled equipment catalogs through native resource resolvers', () => {
  it('loads every bundled Lua appearance through the real startup callbacks, including Ice Wing 3160', () => {
    const fixed = load(patched), robes = bundledRobeNames();
    expect(fixed.RobeTable_default[3160]).toBeUndefined();
    applyLuaNames(patched, fixed, robes, 'RobeNameTable');
    applyAccessoryNames(patched, fixed, bundledAccessoryNames());
    expect(fixed.RobeTable_default[3160]).toBe('C_Ice_Wing');
    expect(fixed.RobeTable_default[71]).toBe('C_Ice_Wing');
    const failures: string[] = [];
    for (const [id, resource] of Object.entries(fixed.HatTable_default)) {
      if (+id <= 0) continue;
      for (const sex of [0, 1]) if (!fixed.DB.getHatPath(+id, sex)?.endsWith(resource)) failures.push(`hat ${id}/${sex}`);
    }
    for (const [id, resource] of Object.entries(fixed.RobeTable_default)) {
      if (+id <= 0 || resource === 'LAST') continue;
      for (const job of jobs) for (const sex of [0, 1]) {
        const path = fixed.DB.getRobePath(+id, job, sex);
        if (!path?.includes('/' + resource + '/') || /undefined|null/.test(path)) failures.push(`robe ${id}/${job}/${sex}`);
      }
    }
    expect(failures).toEqual([]);
    expect(Object.keys(fixed.HatTable_default)).toHaveLength(4405);
    expect(Object.keys(fixed.RobeTable_default)).toHaveLength(222);
  });

  it('preserves all existing valid resource names and job IDs while repairing missing aliases', () => {
    const native = load(vendor);
    for (const name of ['HatTable_default', 'RobeTable_default', 'WeaponName', 'WeaponTrail', 'ShieldTable_default', 'WeaponType_default'] as const) {
      expect(catalog[name]).toEqual(native[name]);
    }
    for (const name of ['JobNameTable', 'WeaponJobTable', 'MountTable', 'AllMountTable'] as const) {
      for (const [key, value] of Object.entries(native[name])) {
        if (key !== 'undefined' && value !== undefined) expect(catalog[name][key]).toBe(value);
      }
    }
  });

  it('keeps every catalog entry resolvable for both sexes without losing its resource identifier', () => {
    const failures: string[] = [];
    for (const [id, resource] of Object.entries(catalog.HatTable_default)) {
      if (+id === 0) continue;
      for (const sex of [0, 1]) {
        const path = catalog.DB.getHatPath(+id, sex);
        if (typeof resource !== 'string' || !resource || !path?.endsWith(resource) || /undefined|null|\.\.\//.test(path)) failures.push(`hat ${id}/${sex}`);
      }
    }
    for (const [id, resource] of Object.entries(catalog.RobeTable_default)) {
      if (+id === 0) continue;
      for (const job of jobs) for (const sex of [0, 1]) {
        const path = catalog.DB.getRobePath(+id, job, sex);
        if (typeof resource !== 'string' || !resource || !path?.includes('/' + resource + '/') || !path.includes(catalog.JobNameTable[job]!) || /undefined|null|\.\.\//.test(path)) failures.push(`robe ${id}/${job}/${sex}`);
      }
    }
    expect(failures).toEqual([]);
    expect(Object.keys(catalog.HatTable_default).length).toBeGreaterThan(2000);
    expect(Object.keys(catalog.RobeTable_default).length).toBeGreaterThan(200);
  });

  it('maps every expanded weapon class to a defined base weapon and trail', () => {
    const failures = Object.entries(catalog.WeaponTypeExpansion).filter(([, base]) =>
      !Number.isInteger(base) || !(base in catalog.WeaponName) || !(base in catalog.WeaponTrail));
    expect(failures).toEqual([]);
    for (const [classId, base] of Object.entries(catalog.WeaponTypeExpansion)) {
      expect(catalog.DB.getWeaponType(+classId, true)).toBe(base);
    }
  });

  it('regresses the two staff classes that previously produced undefined weapon resources', () => {
    const native = load(vendor);
    for (const id of [catalog.WeaponType_default.Staff_Of_Soul!, catalog.WeaponType_default.Wizardy_Staff!]) {
      expect(native.DB.getWeaponType(id, true)).toBeUndefined();
      expect(catalog.DB.getWeaponType(id, true)).toBe(catalog.WeaponType_default.TWOHANDROD);
      expect(catalog.DB.getWeaponTrail(id, 4010, 1)).not.toContain('undefined');
    }
  });

  it('resolves all base weapon and shield families for every bundled job and sex', () => {
    const failures: string[] = [];
    for (const job of weaponJobs) for (const sex of [0, 1]) {
      for (const type of numericKeys(catalog.WeaponName).filter(id => id !== 0)) {
        const weapon = catalog.DB.getWeaponPath(type, job, sex), trail = catalog.DB.getWeaponTrail(type, job, sex);
        if (!weapon || !trail || /undefined|null/.test(weapon + trail)) failures.push(`weapon ${type}/${job}/${sex}`);
      }
      for (const type of numericKeys(catalog.ShieldTable_default)) {
        const itemId = 2100 + type;
        catalog.ItemTable_default[itemId] = { ClassNum: type };
        const path = catalog.DB.getShieldPath(itemId, job, sex);
        if (!path?.endsWith(catalog.ShieldTable_default[type]!) || /undefined|null/.test(path)) failures.push(`shield ${type}/${job}/${sex}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('preserves missing and unequipped resource behavior', () => {
    for (const sex of [0, 1]) for (const id of [0, 999999]) {
      expect(catalog.DB.getHatPath(id, sex)).toBeNull();
      expect(catalog.DB.getRobePath(id, 4010, sex)).toBeNull();
      expect(catalog.DB.getRobePathNoSex(id, 4010, sex)).toBeNull();
    }
    expect(catalog.DB.getWeaponPath(0, 4010, 1)).toBeNull();
    expect(catalog.DB.getShieldPath(0, 4010, 1)).toBeNull();
  });

  it('resolves every native mount to a numeric job with a real bundled body name', () => {
    for (const table of [catalog.MountTable, catalog.AllMountTable]) {
      const failures = Object.entries(table).filter(([key, value]) => !/^\d+$/.test(key) || !Number.isInteger(value) || typeof catalog.JobNameTable[value] !== 'string');
      expect(failures).toEqual([]);
      for (const target of Object.values(table)) for (const sex of [0, 1]) {
        const path = catalog.DB.getBodyPath(target, sex);
        expect(path).toContain(catalog.JobNameTable[target]);
        expect(path).not.toMatch(/undefined|null/);
      }
    }
    expect(Object.hasOwn(catalog.JobNameTable, 'undefined')).toBe(false);
    expect(Object.hasOwn(catalog.WeaponJobTable, 'undefined')).toBe(false);
  });

  it('uses the intended body and robe names for alternate Archbishop and Soul Reaper mounts', () => {
    const native = load(vendor);
    expect(native.JobNameTable[4336]).toBeUndefined();
    for (const job of [4336, 4246, 4248]) for (const sex of [0, 1]) {
      const resource = catalog.JobNameTable[job]!;
      expect(resource).toBeTruthy();
      expect(resource).not.toBe(catalog.JobNameTable[0]);
      expect(catalog.DB.getBodyPath(job, sex)).toContain(resource);
      for (const robe of numericKeys(catalog.RobeTable_default).filter(id => id !== 0)) expect(catalog.DB.getRobePath(robe, job, sex)).toContain(resource);
    }
    expect(catalog.AllMountTable[4227]).toBe(4235);
    expect(catalog.AllMountTable[4228]).toBe(4236);
    expect(catalog.AllMountTable[4240]).toBe(4246);
    expect(catalog.AllMountTable[4242]).toBe(4248);
  });

  it('keeps the reviewed costume headgear IDs and both shared robe resource forms', () => {
    for (const [id, name] of [[3133, '_44503'], [3134, '_44504'], [3143, '_44565']] as const) expect(catalog.HatTable_default[id]).toBe(name);
    for (const id of numericKeys(catalog.RobeTable_default).filter(id => id !== 0)) {
      const shared = catalog.DB.getRobePathNoSex(id, 4010, 1)!;
      expect(shared.endsWith(catalog.RobeTable_default[id]!)).toBe(true);
      expect(catalog.DB.getRobePathNoSex(id, 4218, 0)).toBe(shared + '_doram');
    }
  });

  it('keeps the Justitia mantle resource when the real bundled Lua has an empty costume name', () => {
    const names = bundledAccessoryNames();
    expect(names[3169]).toBe('');
    expect(Object.entries(names).filter(([, value]) => value === '')).toEqual([['3169', '']]);
    const native = load(vendor), fixed = load(patched);
    applyAccessoryNames(vendor, native, names);
    applyAccessoryNames(patched, fixed, names);
    expect(native.HatTable_default[3169]).toBe('');
    expect(fixed.HatTable_default[3169]).toBe('_gucn088');
    for (const sex of [0, 1]) {
      expect(native.DB.getHatPath(3169, sex)).toBe(`data/sprite/¾Ç¼¼»ç¸®/${['¿©', '³²'][sex]}/${['¿©', '³²'][sex]}`);
      expect(fixed.DB.getHatPath(3169, sex)).toBe(`data/sprite/¾Ç¼¼»ç¸®/${['¿©', '³²'][sex]}/${['¿©', '³²'][sex]}_gucn088`);
    }
  });

  it('repairs only the verified missing Ape Mask alias in the real bundled Lua', () => {
    const names = bundledAccessoryNames(), native = load(vendor), fixed = load(patched);
    const canonical = native.HatTable_default[1462];
    expect(canonical).toBe('_\xc0\xaf\xc0\xce\xbf\xf8\xb8\xb6\xbd\xba\xc5\xa9');
    expect(names[1462]).toBe('_\xc0\xaf\xc0\xce\xbf\xf8\xb0\xa1\xb8\xe9');
    applyAccessoryNames(vendor, native, names);
    applyAccessoryNames(patched, fixed, names);
    expect(native.HatTable_default[1462]).toBe(names[1462]);
    expect(fixed.HatTable_default[1462]).toBe(canonical);
    for (const sex of [0, 1]) expect(fixed.DB.getHatPath(1462, sex)?.endsWith(canonical!)).toBe(true);
    applyAccessoryNames(patched, fixed, { 1462: '_new_server_ape_mask' });
    expect(fixed.HatTable_default[1462]).toBe('_new_server_ape_mask');
  });

  it('still accepts named Lua overrides and additions through the native database callback', () => {
    const fixed = load(patched);
    applyAccessoryNames(patched, fixed, { 3169: '_updated_mantle', 999999: 'C_Server_Costume' });
    expect(fixed.HatTable_default[3169]).toBe('_updated_mantle');
    expect(fixed.HatTable_default[999999]).toBe('C_Server_Costume');
    for (const sex of [0, 1]) {
      expect(fixed.DB.getHatPath(3169, sex)).toMatch(/_updated_mantle$/);
      expect(fixed.DB.getHatPath(999999, sex)).toMatch(/C_Server_Costume$/);
    }
  });

  it.each(['', ' \t\r\n ', null, undefined, 123, false])('ignores invalid Lua resource names (%j) for existing and new IDs', value => {
    const fixed = load(patched);
    applyAccessoryNames(patched, fixed, { 3169: value, 999999: value });
    expect(fixed.HatTable_default[3169]).toBe('_gucn088');
    expect(Object.hasOwn(fixed.HatTable_default, '999999')).toBe(false);
    for (const sex of [0, 1]) {
      expect(fixed.DB.getHatPath(3169, sex)).toMatch(/_gucn088$/);
      expect(fixed.DB.getHatPath(999999, sex)).toBeNull();
    }
  });

  it.each([null, undefined])('retains default resources when Lua returns no table (%j)', value => {
    const fixed = load(patched), defaults = { ...fixed.HatTable_default };
    expect(() => applyAccessoryNames(patched, fixed, value)).not.toThrow();
    expect(fixed.HatTable_default).toEqual(defaults);
  });

  it('fails closed if an upstream catalog changes the reviewed patch anchors', () => {
    expect(() => patchRuntimeEquipmentCatalog(patched)).toThrow('anchor:equipment-catalog');
    expect(() => patchRuntimeEquipmentCatalog(vendor.replace('WeaponType_default.WPCLASS_TWOHANDROD', 'WeaponType_default.TWOHANDROD'))).toThrow('anchor:equipment-catalog');
    expect(() => patchRuntimeEquipmentCatalog(vendor.replace('Object.assign(HatTable_default, json);', 'Object.assign(HatTable_default, {});'))).toThrow('anchor:equipment');
  });
});
