import ts from 'typescript';

/* global SessionStorage_default, MapControl, _socket, LastROAdvanceServerTick */

function lastroCancelMovement(entity, invalidate = true) {
  if (!entity) return;
  const epoch = entity._lastroMovementEpoch || 0;
  if (invalidate) {
    entity._lastroMovementEpoch = epoch + 1;
    delete entity._lastroApprovedRoute;
    delete entity._lastroApprovedEpoch;
    delete entity._lastroHitStop;
  }
  if (entity.walk) {
    // Cancellation must not run an arrival callback or a deferred attack.
    entity.walk.onEnd = null;
    if (Number.isFinite(entity.walk._lastroNormalSpeed)) {
      entity.walk.speed = entity.walk._lastroNormalSpeed;
      delete entity.walk._lastroNormalSpeed;
    }
    entity.resetRoute();
    if (!invalidate) entity._lastroMovementEpoch = epoch;
  }
  if (entity === SessionStorage_default.Entity) SessionStorage_default.moveAction = null;
  if (entity.action === entity.ACTION?.WALK) entity.setAction({ action: entity.ACTION.IDLE, frame: 0, repeat: true, play: true });
}

function lastroMovementUnavailable() {
  if (!SessionStorage_default.Playing || typeof _socket === 'undefined') return false;
  if (!_socket || !_socket.isZone || !_socket.connected || _socket.handoffPending) return true;
  const ping = SessionStorage_default.ping;
  // A whole approved route normally needs no more position packets. Only
  // known disconnection or a persistently unanswered heartbeat proves a stall.
  return !!ping && ping.returned === false && Number.isFinite(ping._lastroUnansweredSince)
    && Date.now() - Math.max(ping._lastroUnansweredSince, _socket._lastroMovementPacketAt || 0) > 45000;
}

function lastroCheckMovementConnection() {
  if (!lastroMovementUnavailable()) return true;
  const entity = SessionStorage_default.Entity;
  lastroCancelMovement(entity);
  if (typeof MapControl !== 'undefined') MapControl._lastroMovementInput?.cancel();
  return false;
}

function lastroCaptureHitRoute(entity) {
  if (!entity.walk?.total) return null;
  const copy = Object.create(entity);
  copy.position = new Float32Array(entity.position);
  copy.walk = { ...entity.walk, path: new Int16Array(entity.walk.path), pos: new Float32Array(entity.walk.pos), lastPos: new Float32Array(entity.walk.lastPos), onEnd: null };
  copy.action = entity.ACTION.WALK;
  copy.setAction = () => {};
  copy.onWalkEnd = () => {};
  copy.resetRoute = () => { copy.walk.total = 0; };
  return copy;
}

function lastroHitStartTick(packet) {
  const now = Date.now();
  if (typeof LastROAdvanceServerTick === 'function') LastROAdvanceServerTick();
  const serverTick = SessionStorage_default.serverTick;
  if (!Number.isInteger(packet.startTime) || packet.startTime < 0 || packet.startTime > 0xffffffff
      || !Number.isFinite(serverTick) || serverTick === 0) return now;
  const elapsed = ((serverTick % 0x100000000) - packet.startTime) | 0;
  // Old or implausible clock samples must not rewind a currently approved path.
  return elapsed >= 0 && elapsed <= 5000 ? now - elapsed : now;
}

function replaceExact(source, needle, text) {
  if (source.split(needle).length !== 2) throw new Error('anchor:movement-sync');
  return source.replace(needle, text);
}

function patchRegion(source, path, update) {
  const marker = '//#region ' + path, start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:movement-sync');
  const region = source.slice(start, end).replace(/\r\n/g, '\n');
  const file = ts.createSourceFile(path, region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  function body(name, params, change) {
    const found = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (found.length !== 1 || !found[0].body || found[0].parameters.map(node => node.name.getText(file)).join(',') !== params) throw new Error('anchor:movement-sync:' + name);
    edits.push({ start: found[0].body.getStart(file), end: found[0].body.end, text: change(found[0].body.getText(file)) });
  }
  update(body, edits, file);
  let output = region;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return source.slice(0, start) + output + source.slice(end);
}

export function patchRuntimeMovementSync(source) {
  if (source.includes('function lastroCancelMovement(')) throw new Error('anchor:movement-sync:installed');
  const walkMarker = '//#region src/Renderer/Entity/EntityWalk.js';
  if (!source.includes(walkMarker)) return source;
  source = patchRegion(source, 'src/Renderer/Entity/EntityWalk.js', (body, edits, file) => {
    body('walkTo', 'from_x,from_y,to_x,to_y,range,moveStartTime', original => `{
  if (Number.isInteger(moveStartTime) && moveStartTime >= 0 && moveStartTime <= 0xffffffff) {
    if (Number.isInteger(this._lastroServerMoveStart) && ((moveStartTime - this._lastroServerMoveStart) | 0) < 0) return;
    this._lastroServerMoveStart = moveStartTime;
  }
  this._lastroMovementEpoch = (this._lastroMovementEpoch || 0) + 1;
  delete this._lastroApprovedRoute;
  delete this._lastroApprovedEpoch;
  delete this._lastroHitStop;` + original.slice(1));
    const walkToEdit = edits.at(-1);
    const record = `    this._lastroApprovedRoute = lastroCaptureHitRoute(this);
    this._lastroApprovedEpoch = this._lastroMovementEpoch;
`;
    if (walkToEdit.text.includes('    if (serverMove) this.walkProcess();')) walkToEdit.text = replaceExact(walkToEdit.text, '    if (serverMove) this.walkProcess();', record + '    if (serverMove) this.walkProcess();');
    else walkToEdit.text = replaceExact(walkToEdit.text, '    this.headDir = 0;', record + '    this.headDir = 0;');
    body('walkProcess', '', original => {
      let output = replaceExact(original, '  const pos = this.position;', `  if (this === SessionStorage_default.Entity && !lastroCheckMovementConnection()) return;
  const pos = this.position;`);
      const patchedClock = '  const TICK = Date.now();';
      if (output.includes(patchedClock)) output = replaceExact(output, patchedClock, '  const TICK = Number.isFinite(lastroTick) ? lastroTick : Date.now();');
      else output = replaceExact(output, '  const wallTick = Date.now();', '  const wallTick = Number.isFinite(lastroTick) ? lastroTick : Date.now();');
      return output;
    });
    const walkProcess = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'walkProcess');
    edits.push({ start: walkProcess.parameters.pos, end: walkProcess.parameters.end, text: 'lastroTick' });
  });
  source = patchRegion(source, 'src/Engine/MapEngine/Entity.js', body => {
    body('onEntityWillBeHitSub', 'pkt,dstEntity', original => {
      let output = replaceExact(original, '    pkt.action !== 11', '    pkt.action !== 11 &&\n    pkt.action !== 14 &&\n    pkt.attackedMT > 0');
      output = replaceExact(output, '    const count = pkt.count || 1;', `    const count = pkt.count || 1;
    const epoch = dstEntity._lastroMovementEpoch || 0;
    const self = dstEntity === SessionStorage_default.Entity;
    // A speed change makes the old route sample unsafe for rejecting a hit
    // that predates the currently approved movement.
    const saved = dstEntity._lastroApprovedRoute;
    const approved = dstEntity._lastroApprovedEpoch === epoch && saved?.walk.speed === dstEntity.walk?.speed ? saved : null;
    const hitStart = lastroHitStartTick(pkt);
    if (approved && hitStart + pkt.attackMT < approved.walk.tick) return;`);
      output = replaceExact(output, '    function impendingAttack() {\n      if (dstEntity.action !== dstEntity.ACTION.DIE)', `    function impendingAttack() {
      if (EntityManager.get(dstEntity.GID) !== dstEntity || (self && dstEntity !== SessionStorage_default.Entity) || (dstEntity._lastroMovementEpoch || 0) !== epoch || dstEntity.action === dstEntity.ACTION.DIE) return;
      if (dstEntity.action !== dstEntity.ACTION.DIE)`);
      output = replaceExact(output, '    function resumeWalk() {', `    function resumeWalk() {
      if (EntityManager.get(dstEntity.GID) !== dstEntity || (self && dstEntity !== SessionStorage_default.Entity) || (dstEntity._lastroMovementEpoch || 0) !== epoch || dstEntity.action === dstEntity.ACTION.DIE) return;`);
      output = replaceExact(output, 'pkt.attackMT + C_MULTIHIT_DELAY * i', 'Math.max(0, hitStart + pkt.attackMT + C_MULTIHIT_DELAY * i - Date.now())');
      output = replaceExact(output, 'pkt.attackMT + C_MULTIHIT_DELAY * 1.75 * i', 'Math.max(0, hitStart + pkt.attackMT + C_MULTIHIT_DELAY * 1.75 * i - Date.now())');
      return replaceExact(output, `      pkt.attackMT +
        C_MULTIHIT_DELAY * (pkt.leftDamage ? 1.75 : 1) * (count - 1) +
        pkt.attackedMT,`, '      Math.max(0, hitStart + lastHitDelay + pkt.attackedMT - Date.now()),');
    });
    for (const name of ['onEntityStopMove', 'onEntityJump']) {
      body(name, 'pkt', original => replaceExact(original, '  if (entity) {', '  if (entity) {\n    lastroCancelMovement(entity);'));
    }
    body('onEntityFastMove', 'pkt', original => {
      let output = replaceExact(original, '  if (entity) {', `  if (entity) {
    const x = pkt.targetXpos, y = pkt.targetYpos;
    if (MapRenderer.loading || !Number.isInteger(Altitude.width) || !Number.isInteger(Altitude.height)
      || Altitude.width <= 0 || Altitude.height <= 0 || !Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= Altitude.width || y >= Altitude.height) return;
    let height;
    try {
      if (!Number.isFinite(Altitude.getCellType(x, y))) return;
      height = Altitude.getCellHeight(x, y);
    } catch { return; }
    if (!Number.isFinite(height)) return;
    // FASTMOVE is an authoritative Body Relocation target. A missing walking
    // route must not discard that target or install a speed override forever.
    if ((entity.position[0] === x && entity.position[1] === y)
      || !Number.isFinite(entity.position[0]) || !Number.isFinite(entity.position[1])) {
      lastroCancelMovement(entity);
      entity.position[0] = x; entity.position[1] = y; entity.position[2] = height;
      return;
    }`);
      output = replaceExact(output, '    if (entity.walk.path.length) {', `    const walk = entity.walk;
    if (Number.isInteger(walk.total) && walk.total >= 4 && walk.total % 2 === 0
      && walk.total <= walk.path.length && walk.path[walk.total - 2] === x && walk.path[walk.total - 1] === y) {`);
      output = replaceExact(output, '      entity.walk.speed = 10;', '      entity.walk._lastroNormalSpeed = speed;\n      entity.walk.speed = 10;\n      entity._lastroApprovedRoute = lastroCaptureHitRoute(entity);\n      entity._lastroApprovedEpoch = entity._lastroMovementEpoch;');
      output = replaceExact(output, '        entity.walk.speed = speed;', '        entity.walk.speed = speed;\n        delete entity.walk._lastroNormalSpeed;');
      return replaceExact(output, '      };\n    }\n  }\n}', `      };
    } else {
      lastroCancelMovement(entity);
      entity.position[0] = x; entity.position[1] = y; entity.position[2] = height;
    }
  }
}`);
    });
    body('onEntityVanish', 'pkt', original => replaceExact(original, '  const entity = EntityManager.get(pkt.GID);', '  const entity = EntityManager.get(pkt.GID);\n  lastroCancelMovement(entity);'));
  });
  source = patchRegion(source, 'src/Engine/MapEngine.js', body => {
    for (const name of ['onMapChange', 'cleanGameUI']) body(name, name === 'onMapChange' ? 'pkt' : '', original => '{\n  lastroCancelMovement(SessionStorage_default.Entity);' + original.slice(1));
    body('resetEntityForMapEntry', 'entity,pkt,gid', original => '{\n  lastroCancelMovement(entity);\n  delete entity._lastroServerMoveStart;' + original.slice(1));
    body('onPong', 'pkt', original => '{\n  SessionStorage_default.ping._lastroUnansweredSince = undefined;' + original.slice(1));
  });
  source = patchRegion(source, 'src/Network/NetworkManager.js', body => {
    body('onClose$9', 'event', original => '{\n  if (this === _socket && this.isZone && !this.handoffPending) {\n    lastroCancelMovement(SessionStorage_default.Entity);\n    if (typeof MapControl !== "undefined") MapControl._lastroMovementInput?.cancel();\n  }' + original.slice(1));
    body('sendPacket', 'Packet', original => '{\n  if (/REQUEST_MOVE2?$/.test(Packet.constructor?.name || "") && !lastroCheckMovementConnection()) return false;' + original.slice(1));
    body('receive', 'buf', original => replaceExact(original, '          packet.instance = new packet.Struct(fp, offset);', '          packet.instance = new packet.Struct(fp, offset);\n          if (this === _socket && this.isZone) this._lastroMovementPacketAt = Date.now();'));
  });
  // The heartbeat lambda is nested in MapEngine initialization.
  if (source.includes('SP.returned = false;')) source = replaceExact(source, 'SP.returned = false;', 'if (SP.returned || !Number.isFinite(SP._lastroUnansweredSince)) SP._lastroUnansweredSince = Date.now();\n                SP.returned = false;');
  const helpers = [lastroCancelMovement, lastroMovementUnavailable, lastroCheckMovementConnection, lastroCaptureHitRoute, lastroHitStartTick].map(fn => fn.toString()).join('\n');
  return source.replace(walkMarker, walkMarker + '\n' + helpers);
}
