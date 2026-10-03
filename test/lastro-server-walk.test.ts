import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { findLastroServerWalkPath, type LastroServerWalkAltitude } from '../scripts/lastro-server-walk.mjs';

const vendor = readFileSync(new URL('../vendor/v2/Online.js', import.meta.url), 'utf8');
const marker = vendor.indexOf('//#region src/Utils/PathFinding.js');
const nativePathFinding = vendor.slice(marker, vendor.indexOf('//#endregion', marker));

function map(width = 96, height = width) {
  const cells = new Uint8Array(width * height).fill(10);
  const altitude = {
    width, height, TYPE: { WALKABLE: 2 },
    getCellType: vi.fn((x: number, y: number) => cells[x + y * width]),
  };
  return { cells, altitude };
}

function nativeSearch(from: number[], to: number[], cells: Uint8Array, altitude: LastroServerWalkAltitude) {
  const context = vm.createContext({
    __esmMin: (initialize: () => void) => initialize,
    gat: { width: altitude.width, height: altitude.height, cells, types: { NONE: 1, WALKABLE: 2, WATER: 4, SNIPABLE: 8 } },
    from, to, out: new Int16Array(66),
  });
  return vm.runInContext(nativePathFinding + '\ninit_PathFinding(); setGat(gat); search(...from,...to,0,out);', context) as number;
}

function shortestSteps(from: number[], to: number[], altitude: LastroServerWalkAltitude): number | null {
  const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < altitude.width && y < altitude.height
    && (altitude.getCellType(x, y)! & altitude.TYPE.WALKABLE) !== 0;
  if (!walkable(from[0]!, from[1]!) || !walkable(to[0]!, to[1]!)) return null;
  const distance = new Map<string, number>([[from.join(','), 0]]), queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head]!, steps = distance.get(x + ',' + y)!;
    if (x === to[0] && y === to[1]) return steps;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x! + dx, ny = y! + dy, key = nx + ',' + ny;
      if (!walkable(nx, ny) || distance.has(key) || dx && dy && (!walkable(x! + dx, y!) || !walkable(x!, y! + dy))) continue;
      distance.set(key, steps + 1); queue.push([nx, ny]);
    }
  }
  return null;
}

function referenceCost(from: number[], to: number[], altitude: LastroServerWalkAltitude, limit = 32): number | null {
  const width = altitude.width, area = width * altitude.height;
  const cells = new Uint8Array(area);
  for (let index = 0; index < area; index++) {
    cells[index] = altitude.getCellType(index % width, Math.floor(index / width))! & altitude.TYPE.WALKABLE;
  }
  const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < altitude.height
    && cells[x + y * width] !== 0;
  if (!walkable(from[0]!, from[1]!) || !walkable(to[0]!, to[1]!)) return null;
  // Independent Dijkstra over (cell,steps): integer costs allow simple buckets,
  // without the production heuristic, heap or Pareto pruning.
  const distance = new Int16Array(area * (limit + 1)).fill(32767);
  const buckets: number[][] = Array.from({ length: limit * 14 + 1 }, () => []);
  const start = from[0]! + from[1]! * width;
  distance[start] = 0; buckets[0]!.push(start);
  for (let cost = 0; cost < buckets.length; cost++) {
    for (const state of buckets[cost]!) {
      if (distance[state] !== cost) continue;
      const steps = Math.floor(state / area), cell = state % area, x = cell % width, y = Math.floor(cell / width);
      if (x === to[0] && y === to[1]) return cost;
      if (steps === limit) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!walkable(nx, ny) || dx && dy && (!walkable(x + dx, y) || !walkable(x, y + dy))) continue;
        const next = (steps + 1) * area + nx + ny * width, nextCost = cost + (dx && dy ? 14 : 10);
        if (nextCost >= distance[next]!) continue;
        distance[next] = nextCost; buckets[nextCost]!.push(next);
      }
    }
  }
  return null;
}

function routeCost(out: Int16Array, count: number) {
  let cost = 0;
  for (let index = 2; index < count * 2; index += 2) {
    cost += out[index] !== out[index - 2] && out[index + 1] !== out[index - 1] ? 14 : 10;
  }
  return cost;
}

function expectLegalPath(out: Int16Array, count: number, from: number[], to: number[], altitude: LastroServerWalkAltitude) {
  expect(Array.from(out.slice(0, 2))).toEqual(from);
  expect(Array.from(out.slice((count - 1) * 2, count * 2))).toEqual(to);
  expect(count).toBeLessThanOrEqual(33);
  for (let index = 0; index < count * 2; index += 2) {
    const x = out[index]!, y = out[index + 1]!;
    expect(altitude.getCellType(x, y)! & altitude.TYPE.WALKABLE).not.toBe(0);
    if (!index) continue;
    const previousX = out[index - 2]!, previousY = out[index - 1]!;
    const dx = x - previousX, dy = y - previousY;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
    if (dx && dy) {
      expect(altitude.getCellType(previousX + dx, previousY)! & altitude.TYPE.WALKABLE).not.toBe(0);
      expect(altitude.getCellType(previousX, previousY + dy)! & altitude.TYPE.WALKABLE).not.toBe(0);
    }
  }
}

describe('bounded fallback for rejected server walking paths', () => {
  it.each([
    { wallX: 60, wallBottom: 43, wallTop: 55, from: [50, 50], to: [69, 50], expectedSteps: 19 },
    { wallX: 16, wallBottom: 0, wallTop: 14, from: [1, 1], to: [30, 1], expectedSteps: 30 },
  ])('recovers the $expectedSteps-step obstacle route rejected by native search', ({ wallX, wallBottom, wallTop, from, to, expectedSteps }) => {
    const { cells, altitude } = map();
    for (let y = wallBottom; y <= wallTop; y++) cells[wallX + y * altitude.width] = 1;
    const out = new Int16Array(66).fill(-123);
    expect(nativeSearch(from, to, cells, altitude)).toBe(0);
    expect(shortestSteps(from, to, altitude)).toBe(expectedSteps);
    const count = findLastroServerWalkPath(...from as [number, number], ...to as [number, number], out, altitude);
    expect(count).toBeGreaterThan(0);
    expect(routeCost(out, count)).toBe(referenceCost(from, to, altitude));
    expectLegalPath(out, count, from, to, altitude);
    expect(Array.from(out.slice(count * 2))).toEqual(new Array(out.length - count * 2).fill(-123));
  });

  it('does not cut a blocked diagonal corner', () => {
    const { cells, altitude } = map(8);
    cells[2 + altitude.width] = cells[1 + 2 * altitude.width] = 1;
    const out = new Int16Array(66), count = findLastroServerWalkPath(1, 1, 2, 2, out, altitude);
    expect(routeCost(out, count)).toBe(referenceCost([1, 1], [2, 2], altitude));
    expect(count).toBeGreaterThan(2);
    expectLegalPath(out, count, [1, 1], [2, 2], altitude);
  });

  it('preserves FIFO alternatives at equal estimated costs', () => {
    const { altitude } = map(4);
    const out = new Int16Array(66), count = findLastroServerWalkPath(0, 0, 2, 1, out, altitude);
    expect(count).toBe(3);
    expect(Array.from(out.slice(0, count * 2))).toEqual([0, 0, 1, 0, 2, 1]);
  });

  it.each([[1, 1, 33, 1], [1, 1, 1, 33], [1, 1, 33, 33], [65, 33, 33, 1]])('holds 32 steps without coordinate-key collisions: %s,%s -> %s,%s', (x0, y0, x1, y1) => {
    const { altitude } = map(), out = new Int16Array(66);
    const count = findLastroServerWalkPath(x0, y0, x1, y1, out, altitude);
    expect(count).toBe(33);
    expectLegalPath(out, count, [x0, y0], [x1, y1], altitude);
  });

  it('matches independent constrained Dijkstra costs on 60 deterministic obstacle maps', () => {
    let seed = 917;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let scenario = 0; scenario < 60; scenario++) {
      const width = 8 + Math.floor(random() * 13), { cells, altitude } = map(width);
      for (let index = 0; index < cells.length; index++) if (random() < 0.25) cells[index] = 1;
      const from = [1, 1], to = [width - 2, width - 2], out = new Int16Array(66).fill(-123);
      cells[1 + width] = cells[width - 2 + (width - 2) * width] = 10;
      const expected = referenceCost(from, to, altitude);
      const count = findLastroServerWalkPath(...from as [number, number], ...to as [number, number], out, altitude);
      if (expected === null) {
        expect(count, `map ${scenario}`).toBe(0);
        expect(Array.from(out)).toEqual(new Array(66).fill(-123));
      } else {
        expect(count, `map ${scenario}`).toBeGreaterThan(0);
        expect(routeCost(out, count), `map ${scenario}`).toBe(expected);
        expectLegalPath(out, count, from, to, altitude);
      }
    }
  });

  it('rejects direct and obstacle routes beyond 32 steps, retaining the output', () => {
    const { cells, altitude } = map(), out = new Int16Array(66).fill(-123);
    expect(findLastroServerWalkPath(1, 1, 34, 1, out, altitude)).toBe(0);
    for (let y = 0; y <= 22; y++) cells[16 + y * altitude.width] = 1;
    expect(shortestSteps([1, 1], [30, 1], altitude)).toBeGreaterThan(32);
    expect(findLastroServerWalkPath(1, 1, 30, 1, out, altitude)).toBe(0);
    expect(Array.from(out)).toEqual(new Array(66).fill(-123));
  });

  it('rejects blocked and sealed targets without writing a partial route', () => {
    const { cells, altitude } = map(), out = new Int16Array(66).fill(-123);
    cells[12 + 12 * altitude.width] = 1;
    expect(findLastroServerWalkPath(1, 1, 12, 12, out, altitude)).toBe(0);
    cells[12 + 12 * altitude.width] = 10;
    for (let x = 10; x <= 14; x++) for (let y = 10; y <= 14; y++) {
      if (x === 10 || x === 14 || y === 10 || y === 14) cells[x + y * altitude.width] = 1;
    }
    expect(findLastroServerWalkPath(1, 1, 12, 12, out, altitude)).toBe(0);
    expect(Array.from(out)).toEqual(new Array(66).fill(-123));
  });

  it('bounds exploration around a sealed interior target', () => {
    const { cells, altitude } = map(), out = new Int16Array(66).fill(-123);
    for (let x = 48; x <= 50; x++) for (let y = 48; y <= 50; y++) {
      if (x !== 49 || y !== 49) cells[x + y * altitude.width] = 1;
    }
    expect(findLastroServerWalkPath(47, 47, 49, 49, out, altitude)).toBe(0);
    // Fixed node budget and cached cell checks bound work even on a large unreachable map.
    expect(altitude.getCellType.mock.calls.length).toBeLessThanOrEqual(2048 * 16 + 2);
    expect(Array.from(out)).toEqual(new Array(66).fill(-123));
  });

  it.each([
    [NaN, 1, 2, 2], [1.5, 1, 2, 2], [-1, 1, 2, 2], [1, 1, Infinity, 2],
    [1, 1, 96, 2], [1, 1, 2, -1], [1, 1, 1, 1], [32768, 0, 32767, 0],
  ])('rejects invalid or empty endpoint pairs %s,%s -> %s,%s', (x0, y0, x1, y1) => {
    const { altitude } = map(), out = new Int16Array(66).fill(-123);
    expect(findLastroServerWalkPath(x0, y0, x1, y1, out, altitude)).toBe(0);
    expect(Array.from(out)).toEqual(new Array(66).fill(-123));
  });

  it('accepts the upper Int16 coordinate edge', () => {
    const altitude = { width: 32768, height: 2, TYPE: { WALKABLE: 2 }, getCellType: () => 10 };
    const out = new Int16Array(4);
    expect(findLastroServerWalkPath(32766, 0, 32767, 0, out, altitude)).toBe(2);
    expect(Array.from(out)).toEqual([32766, 0, 32767, 0]);
  });

  it('rejects unavailable GAT dimensions, types and cell readers', () => {
    const { altitude } = map();
    for (const replacement of [
      { width: 0 }, { height: NaN }, { TYPE: { WALKABLE: 0 } },
      { getCellType: undefined }, { getCellType: () => undefined }, { getCellType: () => NaN },
      { getCellType: () => { throw new Error('GAT unavailable'); } },
    ]) {
      const out = new Int16Array(66).fill(-123);
      expect(findLastroServerWalkPath(1, 1, 2, 2, out, { ...altitude, ...replacement } as LastroServerWalkAltitude)).toBe(0);
      expect(Array.from(out)).toEqual(new Array(66).fill(-123));
    }
  });

  it('requires sufficient Int16 output capacity and writes only complete routes', () => {
    const { altitude } = map();
    for (const length of [0, 2, 64]) {
      const out = new Int16Array(length).fill(-123);
      expect(findLastroServerWalkPath(1, 1, 33, 1, out, altitude)).toBe(0);
      expect(Array.from(out)).toEqual(new Array(length).fill(-123));
    }
    const out = new Uint16Array(66).fill(123);
    expect(findLastroServerWalkPath(1, 1, 2, 2, out as unknown as Int16Array, altitude)).toBe(0);
    expect(Array.from(out)).toEqual(new Array(66).fill(123));
  });
});
