import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import catalogJson from '../scripts/lastro-teleport-routes.json';
import sourceJson from './fixtures/teleport-011-quick-routes.json';

type Route = {
  npc: string;
  desc: string;
  outset: [string, number, number];
  path: [string, number, number][];
  breakpoint?: boolean;
  position?: number[];
};
type Catalog = {
  profiles: Record<string, Record<string, Record<string, Route>>>;
  upstreamCatalog: {
    version: string;
    tag: string;
    commit: string;
    sourceFiles: Record<string, { sha256: string }>;
    sourceCategoryCounts: Record<string, number>;
    sourceRouteCount: number;
    customRouteCount: number;
    npcCoordinateMappings: Record<string, Record<string, string>>;
    excludedCustomRouteKeys: string[];
  };
  upstreamCustomRoutes: Record<string, Route>;
};

const catalog = catalogJson as unknown as Catalog;
const source = sourceJson as unknown as {
  version: string;
  tag: string;
  commit: string;
  onlineSha256: string;
  quickCatalogSha256: string;
  routesSha256: string;
  baselineSha256: Record<string, string>;
  routes: Record<string, Record<string, Route>>;
};
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The fixture is the complete static quick-route data extracted from iwa-11,
// independently of the current profile catalogue and the UI implementation.
describe('upstream 0.1.11 teleport catalogue', () => {
  it('pins the requested release and the two original upstream source files', () => {
    expect(catalog.upstreamCatalog).toMatchObject({
      version: '0.1.11',
      tag: 'iwa-11',
      commit: '8251745549a676983fdf7d5c5835af923260744b',
      sourceCategoryCounts: { guide: 72, train: 74, wild: 13 },
      sourceRouteCount: 159,
      customRouteCount: 150,
    });
    expect(source).toMatchObject({ version: '0.1.11', tag: 'iwa-11', commit: catalog.upstreamCatalog.commit });
    expect(catalog.upstreamCatalog.sourceFiles['vendor/v2/Online.js']?.sha256).toBe(source.onlineSha256);
    expect(catalog.upstreamCatalog.sourceFiles['vendor/v2/lastro-quick-teleport-catalog.mjs']?.sha256).toBe(source.quickCatalogSha256);
    expect(sha256(source.routes)).toBe(source.routesSha256);
  });

  it('uses each explicitly matched service entry from 0.1.11 for profile 5', () => {
    const mappings = catalog.upstreamCatalog.npcCoordinateMappings['5']!;
    expect(Object.keys(mappings)).toHaveLength(14);
    for (const [id, sourceKey] of Object.entries(mappings)) {
      const [category, key] = sourceKey.split(':');
      expect(catalog.profiles['5']?.npc?.[id]?.outset, `profile 5 NPC ${id}`).toEqual(source.routes[category!]?.[key!]?.outset);
    }
    expect(catalog.profiles['5']?.npc?.['1']).toMatchObject({ outset: ['prontera', 149, 89] });
    expect(catalog.profiles['5']?.npc?.['11']).toMatchObject({ outset: ['prontera', 156, 117] });
    expect(catalog.profiles['5']?.npc?.['9']).toMatchObject({ outset: ['prontera', 152, 129] });
  });

  it('represents every upstream entry exactly once as an existing service or a custom preset', () => {
    const mapped = new Set(Object.values(catalog.upstreamCatalog.npcCoordinateMappings['5']!));
    expect(new Set(catalog.upstreamCatalog.excludedCustomRouteKeys)).toEqual(mapped);
    expect(mapped.size).toBe(9);
    let rows = 0;
    for (const [category, entries] of Object.entries(source.routes)) {
      expect(Object.keys(entries)).toHaveLength(catalog.upstreamCatalog.sourceCategoryCounts[category]!);
      for (const [id, original] of Object.entries(entries)) {
        rows++;
        const key = `${category}:${id}`;
        const imported = catalog.upstreamCustomRoutes[`upstream:${key}`];
        if (mapped.has(key)) expect(imported, key).toBeUndefined();
        else expect(imported, key).toEqual({ ...original, breakpoint: false, position: [] });
      }
    }
    expect(rows).toBe(159);
    expect(Object.keys(catalog.upstreamCustomRoutes)).toHaveLength(150);
  });

  it('keeps upstream city, regional, lost-NPC, field and dungeon additions in custom', () => {
    const custom = catalog.upstreamCustomRoutes;
    expect(Object.keys(custom).filter(id => id.startsWith('upstream:guide:'))).toHaveLength(63);
    expect(Object.keys(custom).filter(id => id.startsWith('upstream:train:'))).toHaveLength(74);
    expect(Object.keys(custom).filter(id => id.startsWith('upstream:wild:'))).toHaveLength(13);
    expect(Object.keys(custom).filter(id => /^upstream:guide:lost/.test(id))).toHaveLength(10);
    expect(custom['upstream:guide:lostMermaid']).toMatchObject({ npc: '走失的美人鱼', outset: ['comodo', 87, 242] });
    expect(custom['upstream:guide:lostGrandma']).toMatchObject({ npc: '走失的老奶奶', outset: ['payon', 171, 134] });
    expect(custom['upstream:guide:treasureHunt']).toMatchObject({ npc: '⭐挖宝任务', outset: ['pay_fild11', 125, 175] });
    expect(custom['upstream:train:ghRoom4']).toMatchObject({ outset: ['glast_01', 237, 330] });
    expect(custom['upstream:wild:magmaPoring']).toMatchObject({ outset: ['ve_fild03', 200, 203] });
  });

  it('preserves server-specific catalogues and unrelated categories', () => {
    expect(sha256(catalog.profiles['3'])).toBe(source.baselineSha256.profile3Sha256);
    expect(catalog.profiles['3']?.npc?.['1']).toMatchObject({ outset: ['izlude', 127, 162], path: [['izlude', 128, 144]] });
    expect(sha256(Object.fromEntries(Object.entries(catalog.profiles['5']!).filter(([category]) => category !== 'npc')))).toBe(source.baselineSha256.profile5OtherCategoriesSha256);
    expect(Object.values(catalog.profiles['6']!).every(entries => Object.keys(entries).length === 0)).toBe(true);
  });

  it('preserves each original NPC name and exact indoor navigation path', () => {
    const preserved = Object.fromEntries(Object.entries(catalog.profiles['5']!.npc!).map(([id, route]) => {
      const { outset: ignoredOutset, ...rest } = route;
      void ignoredOutset;
      return [id, rest];
    }));
    expect(sha256(preserved)).toBe(source.baselineSha256.profile5NpcExceptOutsetSha256);
    expect(catalog.profiles['5']?.npc?.['6']).toMatchObject({ outset: ['prontera', 134, 220], path: [['prontera', 134, 220], ['prt_in', 126, 73]] });
    expect(catalog.profiles['5']?.npc?.['13']).toMatchObject({ outset: ['prontera', 178, 185], path: [['prontera', 178, 185], ['prt_in', 60, 64]] });
    expect(catalog.profiles['5']?.npc?.['0']).toMatchObject({ npc: '胖大海', outset: ['prontera', 116, 72], path: [['prontera', 139, 92]] });
  });

  it('retains valid original map identifiers and integer tile coordinates in every addition', () => {
    for (const [id, route] of Object.entries(catalog.upstreamCustomRoutes)) {
      expect(id).toMatch(/^upstream:(guide|train|wild):[a-zA-Z0-9]+$/);
      expect(route.npc.trim(), id).not.toBe('');
      for (const [map, x, y] of [route.outset, ...route.path]) {
        expect(map, id).toMatch(/^[a-z0-9_]{1,16}$/);
        expect(Number.isInteger(x) && x >= 0 && x <= 65535, id).toBe(true);
        expect(Number.isInteger(y) && y >= 0 && y <= 65535, id).toBe(true);
      }
    }
  });
});
