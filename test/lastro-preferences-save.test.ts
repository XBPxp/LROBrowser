import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { patchRuntimePreferencesSave } from '../scripts/patch-v2-runtime.mjs';

const original = readFileSync('vendor/v2/Online.js', 'utf8').replace(/\r\n/g, '\n');
const start = original.indexOf('//#region src/Core/Preferences.js');
const end = original.indexOf('//#endregion', start);
if (start < 0 || end < start) throw new Error('Missing native preferences module');
const module = patchRuntimePreferencesSave(original.slice(start, end));

function fixture() {
  const key = 'LastROTeleportOrder:5';
  const storage = new Map([[key, JSON.stringify({ _version: 1, orders: { npc: ['1', '0'] }, geometry: { teleport: { width: 590 } } })]]);
  let fail = false;
  const prefs = runInNewContext(`${module}\ninit_Preferences$1(); Preferences.get(${JSON.stringify(key)}, { orders: {} }, 1);`, {
    __esmMin: (initialize: () => void) => initialize,
    localStorage: {
      getItem: (name: string) => storage.get(name) ?? null,
      setItem: (name: string, value: string) => {
        if (fail) throw new Error('storage quota exceeded');
        storage.set(name, value);
      },
    },
  }) as { _key: string; save: () => void; customPlaces?: unknown; cyclic?: unknown };
  return { prefs, storage, key, setFailure: (value: boolean) => { fail = value; } };
}

describe('native persistent teleport preferences', () => {
  it('saves custom data alongside existing ordering and geometry without storing methods', () => {
    const f = fixture();
    f.prefs.customPlaces = { version: 1, entries: [{ id: 'saved-1', name: '挖宝任务', map: 'pay_fild11', x: 125, y: 175 }] };
    const save = f.prefs.save;
    f.prefs.save();
    const stored = JSON.parse(f.storage.get(f.key)!);
    expect(stored).toMatchObject({ orders: { npc: ['1', '0'] }, geometry: { teleport: { width: 590 } }, customPlaces: f.prefs.customPlaces });
    expect(stored._key).toBeUndefined(); expect(stored.save).toBeUndefined();
    expect(f.prefs._key).toBe(f.key); expect(f.prefs.save).toBe(save);
  });

  it('preserves the storage key and save callback after failure so saving can be retried', () => {
    const f = fixture(), before = f.storage.get(f.key), save = f.prefs.save;
    f.prefs.customPlaces = { version: 1, entries: [] };
    f.setFailure(true);
    expect(() => f.prefs.save()).toThrow('storage quota exceeded');
    expect(f.prefs._key).toBe(f.key); expect(f.prefs.save).toBe(save);
    expect(f.storage.get(f.key)).toBe(before);
    f.setFailure(false); f.prefs.save();
    expect(JSON.parse(f.storage.get(f.key)!).customPlaces).toEqual({ version: 1, entries: [] });
    expect(f.storage.has('undefined')).toBe(false);
  });

  it('also restores metadata when serialization fails before the storage write', () => {
    const f = fixture(), before = f.storage.get(f.key), save = f.prefs.save;
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    f.prefs.cyclic = cycle;
    expect(() => f.prefs.save()).toThrow('circular');
    expect(f.prefs._key).toBe(f.key); expect(f.prefs.save).toBe(save);
    expect(f.storage.get(f.key)).toBe(before);
    delete f.prefs.cyclic; f.prefs.save();
  });

  it('rejects missing or ambiguous source anchors on upstream changes', () => {
    expect(() => patchRuntimePreferencesSave('no native preference module')).toThrow();
    expect(() => patchRuntimePreferencesSave(original + original)).toThrow();
  });
});
