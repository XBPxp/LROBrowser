import ts from 'typescript';
import { findLastroServerWalkPath } from './lastro-server-walk.mjs';

// Project only the unrendered distance. Replacing a route must not replay its
// historical catch-up distance in the walk animation or allocate another route.
function lastroProjectWalkDistance(walk, tick) {
  if (!walk || !Number.isFinite(tick) || !Number.isFinite(walk.dist) || !Number.isFinite(walk.speed)) return;
  const path = walk.path, total = walk.total;
  let index = walk.index;
  if (!path || !Number.isInteger(index) || !Number.isInteger(total) || index % 2 || index < 2 || index >= total
    || total % 2 || total > path.length) return;
  let startX = walk.pos[0], startY = walk.pos[1];
  let lastX = walk.lastPos[0], lastY = walk.lastPos[1];
  let nextX = path[index], nextY = path[index + 1];
  let dx = nextX - startX, dy = nextY - startY;
  let duration = Math.sqrt(dx * dx + dy * dy);
  duration = duration > 0 ? walk.speed * duration : walk.speed;
  if (!duration || duration < 1) duration = 1;
  let start = walk.tick || tick, end = start + duration;
  let distance = 0;
  while (index < total - 2 && tick >= end) {
    dx = nextX - lastX; dy = nextY - lastY;
    distance += Math.sqrt(dx * dx + dy * dy);
    startX = lastX = nextX; startY = lastY = nextY;
    index += 2;
    nextX = path[index]; nextY = path[index + 1];
    dx = nextX - startX; dy = nextY - startY;
    duration = Math.sqrt(dx * dx + dy * dy);
    duration = duration > 0 ? walk.speed * duration : walk.speed;
    if (!duration || duration < 1) duration = 1;
    start = end; end = start + duration;
  }
  const progress = Math.min(Math.max((tick - start) / Math.max(end - start, 1), 0), 1);
  dx = startX + (nextX - startX) * progress - lastX;
  dy = startY + (nextY - startY) * progress - lastY;
  distance += Math.sqrt(dx * dx + dy * dy);
  const projected = walk.dist + distance;
  return Number.isFinite(projected) ? projected : undefined;
}

function replaceExact(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error('anchor:entity-sync');
  return source.replace(needle, replacement);
}

function patchRegion(source, name, patch) {
  const marker = `//#region ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:entity-sync');
  const region = source.slice(start, end);
  const file = ts.createSourceFile(name, region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const changes = [];
  function body(name, parameters, update) {
    const nodes = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (nodes.length !== 1 || !nodes[0].body
      || nodes[0].parameters.map(node => node.name.getText(file)).join(',') !== parameters) throw new Error('anchor:entity-sync');
    changes.push([nodes[0].body, update(nodes[0].body.getText(file).replace(/\r\n/g, '\n'))]);
  }
  patch(body);
  let output = region;
  for (const [node, text] of changes.sort((a, b) => b[0].getStart(file) - a[0].getStart(file))) {
    output = output.slice(0, node.getStart(file)) + text + output.slice(node.end);
  }
  return source.slice(0, start) + output + source.slice(end);
}

export function patchRuntimeEntitySync(source) {
  source = patchRegion(source, 'src/Renderer/Entity/EntityWalk.js', body => {
    // Paths include the starting cell followed by up to MAX_WALKPATH steps.
    for (const [name, parameters] of [['WalkStructure', ''], ['resetRoute', 'keepDistance']]) {
      body(name, parameters, original => replaceExact(original,
        'new Int16Array(PathFinding_default.MAX_WALKPATH * 2)',
        'new Int16Array((PathFinding_default.MAX_WALKPATH + 1) * 2)'));
    }
    body('computeWalkStartTick', 'nowTick,moveStartTime,pathDuration,maxClamp', original => {
      // Reject a changed native clock contract rather than patching a different helper.
      replaceExact(original, 'let elapsed = SessionStorage_default.serverTick - moveStartTime;', '');
      return `{
  if (typeof LastROAdvanceServerTick === "function") LastROAdvanceServerTick();
  if (!Number.isInteger(moveStartTime) || moveStartTime < 0 || moveStartTime > 0xffffffff ||
      !SessionStorage_default || !Number.isFinite(SessionStorage_default.serverTick) ||
      SessionStorage_default.serverTick === 0) return nowTick;
  // Packet timestamps wrap at uint32; the sampled server clock can be continuous.
  let elapsed = (SessionStorage_default.serverTick - moveStartTime) % 0x100000000;
  if (elapsed > 0x7fffffff) elapsed -= 0x100000000;
  if (elapsed < -0x80000000) elapsed += 0x100000000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return nowTick;
  const duration = Number.isFinite(pathDuration) && pathDuration > 0 ? pathDuration : 1000;
  const limit = Number.isFinite(maxClamp) && maxClamp >= 0 ? Math.min(maxClamp, duration) : duration;
  return nowTick - Math.min(elapsed, limit);
}`;
    });
    body('walkTo', 'from_x,from_y,to_x,to_y,range,moveStartTime', original => {
      let output = replaceExact(original, 'if (from_x === to_x && from_y === to_y) return;', `const serverMove = Number.isInteger(moveStartTime) && moveStartTime >= 0 && moveStartTime <= 0xffffffff;
  if (from_x === to_x && from_y === to_y) {
    if (serverMove) {
      this.resetRoute();
      this.position[0] = from_x;
      this.position[1] = from_y;
      this.position[2] = Altitude.getCellHeight(from_x, from_y);
      if (this.action === this.ACTION.WALK) this.setAction({ action: this.ACTION.IDLE, frame: 0, repeat: true, play: true });
    }
    return;
  }`);
      output = replaceExact(output, 'this.walk.pos.set(this.position);', `if (serverMove) {
      // Interpolate along the server's GAT path, never a shortcut from a stale display position.
      this.position[0] = from_x | 0;
      this.position[1] = from_y | 0;
      this.position[2] = Altitude.getCellHeight(this.position[0], this.position[1]);
    }
    this.walk.pos.set(this.position);`);
      output = replaceExact(output, 'this.walk.tick = this.walk.prevTick = nowTick;', `const duration = estimatePathDuration(this.walk.path, this.walk.total, this.walk.speed, this.position);
    this.walk.tick = this.walk.prevTick = computeWalkStartTick(nowTick, moveStartTime, duration);`);
      output = replaceExact(output, '  this.resetRoute(hadRoute);', `  const continuedDistance = serverMove && hadRoute && wasWalkingAction
    ? lastroProjectWalkDistance(this.walk, Date.now()) : undefined;
  this.resetRoute(hadRoute);`);
      output = replaceExact(output, '  const total = PathFinding_default.search(', '  let total = PathFinding_default.search(');
      output = replaceExact(output, '  this.walk.index = 2;', `  if (serverMove && (!total || total * 2 > path.length) && !range
    && (typeof MapRenderer === "undefined" || !MapRenderer.loading)) {
    total = findLastroServerWalkPath(from_x, from_y, to_x, to_y, path, Altitude);
  }
  // A declared route must fit the buffer before interpolation reads it.
  if (total * 2 > path.length) total = 0;
  this.walk.index = 2;`);
      output = replaceExact(output, `        play: true,
      });
  }
}`, `        play: true,
      });
    if (serverMove) this.walkProcess();
    if (serverMove && this.walk.total > 0 && Number.isFinite(continuedDistance)) this.walk.dist = continuedDistance;
  }
}`);
      return output;
    });
    body('walkProcess', '', original => {
      const start = original.indexOf('  const wallTick = Date.now();');
      const end = original.indexOf('  const falconGliding = 5;');
      if (start < 0 || end <= start || !original.slice(start, end).includes('walk.prevTick + MAX_WALK_CATCHUP_DELTA')) throw new Error('anchor:entity-sync');
      // Resume at the server timeline after a stall; do not accelerate 100ms per frame.
      return original.slice(0, start) + '  const TICK = Date.now();\n' + original.slice(end);
    });
  });
  const marker = '//#region src/Renderer/Entity/EntityWalk.js';
  if (source.includes(marker)) source = source.replace(marker, marker + '\n'
    + findLastroServerWalkPath.toString() + '\n' + lastroProjectWalkDistance.toString());
  return patchRegion(source, 'src/Engine/MapEngine/Entity.js', body => {
    body('onEntityVanish', 'pkt', original => {
      const start = original.indexOf('    const deathDelay =');
      const end = original.indexOf('    } else playDeath();', start);
      if (start < 0 || end < 0) throw new Error('anchor:entity-sync');
      const old = original.slice(start, end + '    } else playDeath();'.length);
      if (!old.includes('EntityManager.removeGID(pkt.GID);') || !old.includes('Events.setTimeout(playDeath, deathDelay);')
        || !old.includes('entity.remove(pkt.type);')) throw new Error('anchor:entity-sync');
      return original.slice(0, start) + `    // A server DEAD notification wins over pending hit/attack animations.
    entity._deathSyncTick = 0;
    EntityManager.removeGID(pkt.GID);
    entity.remove(pkt.type);` + original.slice(end + '    } else playDeath();'.length);
    });
  });
}
