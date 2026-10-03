// Recover only a rejected server route; the caller retains native successful paths.
export function findLastroServerWalkPath(x0, y0, x1, y1, out, altitude) {
  const MAX_STEPS = 32, MAX_NODES = 2048;
  const width = altitude?.width, height = altitude?.height;
  const walkableType = altitude?.TYPE?.WALKABLE;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0
    || !Number.isInteger(walkableType) || walkableType <= 0
    || typeof altitude?.getCellType !== 'function' || !(out instanceof Int16Array) || out.length < 4) return 0;
  const valid = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0
    && x < width && y < height && x <= 32767 && y <= 32767;
  const cells = new Map();
  const walkable = (x, y) => {
    if (!valid(x, y)) return false;
    const key = x + ',' + y;
    if (cells.has(key)) return cells.get(key);
    let value;
    try { value = altitude.getCellType(x, y); } catch { value = undefined; }
    const result = Number.isInteger(value) && (value & walkableType) !== 0;
    cells.set(key, result);
    return result;
  };
  if (!walkable(x0, y0) || !walkable(x1, y1) || x0 === x1 && y0 === y1) return 0;
  const limit = Math.min(MAX_STEPS, (out.length >> 1) - 1);
  const remainingSteps = (x, y) => Math.max(Math.abs(x1 - x), Math.abs(y1 - y));
  const estimate = (x, y) => {
    const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y);
    return 14 * Math.min(dx, dy) + 10 * Math.abs(dx - dy);
  };
  if (remainingSteps(x0, y0) > limit) return 0;
  const heap = [], best = new Map();
  let allocated = 0, sequence = 0;
  const before = (a, b) => a.f < b.f || a.f === b.f && a.sequence < b.sequence;
  const push = node => {
    heap.push(node);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!before(heap[index], heap[parent])) break;
      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    }
  };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        const next = right < heap.length && before(heap[right], heap[left]) ? right : left;
        if (!before(heap[next], heap[index])) break;
        [heap[next], heap[index]] = [heap[index], heap[next]];
        index = next;
      }
    }
    return first;
  };
  const add = (x, y, steps, cost, parent) => {
    const key = x + ',' + y, previous = best.get(key) || [];
    if (steps + remainingSteps(x, y) > limit
      || previous.some(node => node.steps <= steps && node.cost <= cost)) return true;
    if (++allocated > MAX_NODES) return false;
    // A cheaper arrival using more steps must not discard a route that can
    // still reach the target within the buffer's step limit.
    const labels = previous.filter(node => {
      if (steps <= node.steps && cost <= node.cost) node.active = false;
      return node.active;
    });
    const node = { x, y, steps, cost, f: cost + estimate(x, y), parent, sequence: sequence++, active: true };
    labels.push(node);
    best.set(key, labels);
    push(node);
    return true;
  };
  add(x0, y0, 0, 0, null);
  // Match native costs and neighbor order, retaining FIFO at equal priorities.
  const directions = [[0, 1], [-1, 0], [0, -1], [1, 0], [-1, 1], [-1, -1], [1, -1], [1, 1]];
  while (heap.length) {
    const node = pop();
    if (!node.active) continue;
    if (node.x === x1 && node.y === y1) {
      const path = [];
      for (let current = node; current; current = current.parent) path.push(current.x, current.y);
      // Do not touch the caller's buffer until the complete bounded path exists.
      for (let index = 0, end = path.length - 2; index < path.length; index += 2, end -= 2) {
        out[index] = path[end]; out[index + 1] = path[end + 1];
      }
      return path.length >> 1;
    }
    for (const [dx, dy] of directions) {
      const x = node.x + dx, y = node.y + dy;
      if (!walkable(x, y) || dx && dy && (!walkable(node.x + dx, node.y) || !walkable(node.x, node.y + dy))) continue;
      if (!add(x, y, node.steps + 1, node.cost + (dx && dy ? 14 : 10), node)) return 0;
    }
  }
  return 0;
}
