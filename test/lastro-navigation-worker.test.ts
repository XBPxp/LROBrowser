import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { patchNavigationWorker } from '../scripts/lastro-navigation-worker.mjs';

const native = readFileSync(new URL('../vendor/v2/PathFindingWorker.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const patched = patchNavigationWorker(native);
const membership = 'f.values.some((s) => e(s.val[0], s.val[1]) === t)';

interface Point { x: number; y: number; isWarp?: boolean; warpId?: string }
interface Warp { srcX: number; srcY: number; destX: number; destY: number; id: string }
interface Request {
  type: 'findPath'; startX: number; startY: number; endX: number; endY: number;
  mapData: { width: number; height: number; cellTypes: Uint8Array; walkableType: number; warps: Warp[] };
  existingPath?: Point[]; requestId: number; workerId: string;
}
interface Result { type: string; path: Point[]; requestId: number; workerId: string; workerBuild: string }
interface Queue {
  values: { val: number[]; priority: number }[];
  enqueue(value: number[], priority: number): void;
  dequeue(): { val: number[]; priority: number } | undefined;
  has(key: string): boolean;
}

function worker(source: string) {
  let result: Result | undefined;
  const self: { postMessage(value: Result): void; onmessage?: (event: { data: Request }) => void } = {
    postMessage(value) { result = structuredClone(value); },
  };
  vm.runInNewContext(source, { self });
  return (request: Request): Result => {
    result = undefined;
    self.onmessage!({ data: request });
    if (!result) throw new Error('Missing worker result');
    return result as Result;
  };
}

function request(width: number, height = width, start = [1, 1], end = [width - 2, height - 2]): Request {
  return {
    type: 'findPath', startX: start[0]!, startY: start[1]!, endX: end[0]!, endY: end[1]!,
    mapData: { width, height, cellTypes: new Uint8Array(width * height).fill(1), walkableType: 1, warps: [] },
    requestId: 921, workerId: 'navigation-worker-test',
  };
}

function nativeQueueSource(source: string) {
  const start = source.indexOf('\tvar t = class {');
  const end = source.indexOf('\n\tfunction e(', start);
  if (start < 0 || end < start) throw new Error('Missing queue');
  return source.slice(start, end);
}

describe('navigation worker stable heap', () => {
  it('preserves FIFO ties while interleaving enqueues and dequeues, with exact open membership', () => {
    const context = vm.createContext({ self: { postMessage() {} } });
    vm.runInContext(patched.replace('})();', 'globalThis.queue = new t();})();'), context);
    const queue = context.queue as Queue;
    const original = worker(native), optimized = worker(patched);
    // Path finding uses unique coordinates while open; dequeue removes membership immediately.
    for (const [id, priority] of [[1, 3], [2, 1], [3, 1], [4, 2], [5, 1]]) queue.enqueue([id!, 0], priority!);
    expect(queue.dequeue()?.val[0]).toBe(2);
    expect(queue.has('2,0')).toBe(false);
    expect(queue.has('3,0')).toBe(true);
    queue.enqueue([6, 0], 1);
    queue.enqueue([7, 0], 0);
    const order = [];
    while (queue.values.length) order.push(queue.dequeue()!.val[0]);
    expect(order).toEqual([7, 3, 5, 6, 4, 1]);
    expect(queue.has('1,0')).toBe(false);
    expect(queue.dequeue()).toBeUndefined();
    // Equal-cost alternatives must also preserve the native full route, not only its length.
    expect(optimized(request(12, 12, [1, 1], [9, 9]))).toEqual(original(request(12, 12, [1, 1], [9, 9])));
  });

  it('changes only the queue and membership expression', () => {
    const beforeQueue = nativeQueueSource(native), afterQueue = nativeQueueSource(patched);
    expect(patched.replace(afterQueue, beforeQueue).replace('f.has(t)', membership)).toBe(native);
  });

  it('matches native worker results for long, obstacle, unreachable, warp and cached routes', () => {
    const original = worker(native), optimized = worker(patched);
    const straight = request(96, 96, [1, 1], [94, 1]);
    const diagonal = request(160);
    const walls = request(160);
    for (let x = 16, index = 0; x < 152; x += 16, index++) {
      for (let y = 0; y < 160; y++) {
        if (y < (index % 2 ? 140 : 20) || y > (index % 2 ? 158 : 38)) walls.mapData.cellTypes[x + y * 160] = 0;
      }
    }
    const unreachable = request(96);
    for (let y = 0; y < 96; y++) unreachable.mapData.cellTypes[48 + y * 96] = 0;
    const warp = request(96);
    warp.mapData.warps.push({ srcX: 3, srcY: 3, destX: 91, destY: 91, id: 'test-warp' });
    const cached = request(160, 160, [20, 1], [158, 1]);
    cached.existingPath = Array.from({ length: 158 }, (_, index) => ({ x: index + 1, y: 1, isWarp: false }));
    for (const row of [straight, diagonal, walls, unreachable, warp, cached]) {
      const result = optimized(row);
      expect(result).toEqual(original(row));
      expect(result.requestId).toBe(row.requestId);
      expect(result.workerId).toBe(row.workerId);
      expect(result.workerBuild).toBe('20260924-v2-navigation-worker-1');
    }
    expect(optimized(unreachable).path).toEqual([]);
    expect(optimized(warp).path.some(point => point.isWarp && point.warpId === 'test-warp')).toBe(true);
    expect(optimized(cached).path).toEqual(cached.existingPath.slice(19));
  });

  it('matches native full paths on 80 deterministic random obstacle maps', () => {
    const original = worker(native), optimized = worker(patched);
    let seed = 443;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let index = 0; index < 80; index++) {
      const width = 16 + Math.floor(random() * 32), row = request(width);
      for (let cell = 0; cell < row.mapData.cellTypes.length; cell++) {
        if (random() < 0.25) row.mapData.cellTypes[cell] = 0;
      }
      row.mapData.cellTypes[row.startX + row.startY * width] = 1;
      row.mapData.cellTypes[row.endX + row.endY * width] = 1;
      expect(optimized(row), `random map ${index}`).toEqual(original(row));
    }
  });

  it.each(['\n', '\r\n'])('accepts a consistent %j newline format and preserves it', newline => {
    const source = native.replace(/\r\n/g, '\n').replaceAll('\n', newline);
    const output = patchNavigationWorker(source);
    expect(output.replace(/\r\n/g, '\n')).toBe(patched);
    if (newline === '\r\n') expect(output.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it.each([
    native.replace('this.sort();', 'this.reorder();'),
    native.replace(membership, 'f.has(t)'),
    native + '\n' + nativeQueueSource(native),
    native + '\n//' + membership,
    patched,
    native.replaceAll('\n', '\r\n') + '\n',
  ])('rejects missing, duplicate, already patched or mixed-newline anchors', source => {
    expect(() => patchNavigationWorker(source)).toThrow(/anchor:navigation-worker/);
  });
});
