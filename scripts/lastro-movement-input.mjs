import ts from 'typescript';

/* global SessionStorage_default, KEYS, Controls_default, Mouse */

function lastroCanPassPlayerClick(entity) {
  return SessionStorage_default.FreezeUI === false
    && Mouse.state === Mouse.MOUSE_STATE.NORMAL
    && SessionStorage_default.captchaGetIdOnEntityClick === false
    && SessionStorage_default.captchaGetIdOnFloorClick === false
    && SessionStorage_default.TouchTargeting === false
    && SessionStorage_default.mapState?.isPVP === false
    && SessionStorage_default.mapState?.isGVG === false
    && KEYS.SHIFT === false && KEYS.CTRL === false && KEYS.ALT === false
    && Controls_default.noshift === false
    && typeof entity.canAttackEntity === 'function' && entity.canAttackEntity() === false;
}

// All callbacks are explicit because this factory is serialized into MapEngine.
export function createLastroMovementInput({ getTarget, getContext, canMove, sendMove, onManualMove,
  onError, clock = globalThis, now = () => globalThis.performance.now() }) {
  let held = false, pending = null, pendingTimer, repeatTimer, generation = 0;
  let lastSent = -Infinity;
  const interval = 200, repeatInterval = 500;

  function report(error) { try { onError?.(error); } catch { /* Input cleanup must continue. */ } }
  function cancel() {
    generation++;
    held = false; pending = null;
    if (pendingTimer !== undefined) clock.clearTimeout(pendingTimer);
    if (repeatTimer !== undefined) clock.clearTimeout(repeatTimer);
    pendingTimer = repeatTimer = undefined;
  }
  function stop() {
    held = false;
    if (repeatTimer !== undefined) clock.clearTimeout(repeatTimer);
    repeatTimer = undefined;
  }
  function point() {
    const value = getTarget();
    if (!value || !Number.isInteger(value.x) || !Number.isInteger(value.y)
      || value.x < 0 || value.y < 0 || value.x > 65535 || value.y > 65535) return null;
    return { x: value.x, y: value.y };
  }
  function current(input) {
    const context = getContext();
    return input.generation === generation && !!context?.map && !!context.player
      && context.map === input.context.map && context.player === input.context.player && canMove(input.target, input.phase);
  }
  function repeat(input) {
    if (!held || input.generation !== generation) return;
    repeatTimer = clock.setTimeout(() => {
      repeatTimer = undefined;
      if (!held || input.generation !== generation) return;
      try {
        const repeating = { ...input, phase: 'repeat' };
        if (!current(repeating)) { cancel(); return; }
        const target = point();
        if (!target) {
          repeat(repeating);
          return;
        }
        submit({ ...repeating, target });
      } catch (error) { cancel(); report(error); }
    }, repeatInterval);
  }
  function submit(input) {
    if (!current(input)) { cancel(); return false; }
    const remaining = interval - (now() - lastSent);
    if (remaining > 0) {
      pending = { ...input, phase: 'pending' };
      if (pendingTimer !== undefined) clock.clearTimeout(pendingTimer);
      pendingTimer = clock.setTimeout(() => {
        pendingTimer = undefined;
        const next = pending; pending = null;
        if (!next) return;
        try { submit(next); } catch (error) { cancel(); report(error); }
      }, remaining);
      return true;
    }
    pending = null;
    if (sendMove(input.target) !== false) lastSent = now();
    repeat(input);
    return true;
  }
  function request() {
    try {
      const target = point(), context = getContext();
      if (!context?.map || !context.player) { cancel(); return false; }
      if (!target) { stop(); return false; }
      if (!canMove(target, 'request')) { cancel(); return false; }
      cancel();
      const input = { target, context: { ...context }, generation, phase: 'request' };
      onManualMove?.();
      if (!current(input)) return false;
      held = true;
      return submit(input);
    } catch (error) { cancel(); report(error); return false; }
  }
  return { request, stop, cancel };
}

// Use the click's screen position instead of the preceding render frame's picker.
// Only an actual ground target can recover a stale UI hover lock.
export function refreshLastroGroundInput(event, { mouse, canvas, ready, pick, getHeight, refreshEntity, onError }) {
  const action = event?.which || (event?.button === 2 ? 3 : 1);
  const ground = event?.composedPath?.().includes(canvas) || event?.target === canvas;
  if (action !== 1 || !canvas || !ground || !ready || mouse.state === mouse.MOUSE_STATE.USESKILL) return false;
  if (Number.isFinite(event.pageX) && Number.isFinite(event.pageY)) {
    mouse.screen.x = event.pageX; mouse.screen.y = event.pageY;
  }
  mouse.intersect = true;
  const point = new Int16Array(2);
  try {
    if (!pick(point)) {
      mouse.world.x = mouse.world.y = mouse.world.z = -1;
      refreshEntity?.();
      return false;
    }
    mouse.world.x = point[0]; mouse.world.y = point[1]; mouse.world.z = getHeight(point[0], point[1]);
    refreshEntity?.();
    return true;
  } catch (error) {
    mouse.world.x = mouse.world.y = mouse.world.z = -1;
    try { onError?.(error); } catch { /* An input diagnostic must not break the event chain. */ }
    return false;
  }
}

function fail() { throw new Error('anchor:movement-input'); }
function patchRegion(source, path, mutate) {
  const marker = `//#region ${path}`, start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) fail();
  const region = source.slice(start, end);
  if (region.includes('lastro-movement-input-installed')) fail();
  const file = ts.createSourceFile(path, region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  const find = predicate => {
    const matches = [];
    function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
    visit(file); return matches;
  };
  const fn = name => {
    const matches = find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1 || !matches[0].body) fail();
    return matches[0];
  };
  mutate({ file, edits, find, fn });
  let output = region;
  for (const { start: at, end: until = at, text } of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, at) + text + output.slice(until);
  }
  return source.slice(0, start) + output + source.slice(end);
}

export function patchRuntimeMovementInput(source) {
  source = patchRegion(source, 'src/Engine/MapEngine.js', ({ file, edits, find, fn }) => {
    const walk = fn('onRequestWalk'), stop = fn('onRequestStopWalk'), interval = fn('walkIntervalProcess');
    if (walk.parameters.length || stop.parameters.length || interval.parameters.length) fail();
    const direction = walk.body.statements.filter(ts.isIfStatement).find(node => node.expression.getText(file).includes('ACTION.SIT'));
    const send = interval.body.statements.filter(ts.isIfStatement).find(node => node.expression.getText(file) === 'isWalkable && !isCurrentPos');
    const binds = find(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'MapControl.onRequestWalk' && node.right.getText(file) === 'onRequestWalk');
    if (!direction || !send || binds.length !== 1 || !ts.isExpressionStatement(binds[0].parent)
      || !interval.body.getText(file).includes('_walkLastTick + 200 > Renderer.tick')
      || !send.getText(file).includes('checkFreeCell(Mouse.world.x, Mouse.world.y, 9, pkt.dest)')) fail();
    const cancelNavigation = `
    if (typeof LastROTools !== "undefined") {
      LastROTools?._lastroPanels?.cancelRoute();
      LastROTools?._lastroQuestRoute?.cancel();
    }
    if (Navigation_default?.clear) Navigation_default.clear();`;
    const directionText = direction.getText(file).replace('{', '{\n    MapControl._lastroMovementInput?.cancel();' + cancelNavigation);
    edits.push({ start: walk.body.getStart(file), end: walk.body.end, text: `{
  const player = SessionStorage_default.Entity;
  if (MapRenderer.loading || SessionStorage_default.FreezeUI || !player?.position
      || !Number.isFinite(player.position[0]) || !Number.isFinite(player.position[1])) {
    MapControl._lastroMovementInput?.cancel();
    return false;
  }
  ${directionText}
  return MapControl._lastroMovementInput.request();
}` });
    edits.push({ start: stop.body.getStart(file), end: stop.body.end, text: '{ MapControl._lastroMovementInput?.stop(); }' });
    edits.push({ start: interval.parameters.pos, text: 'target' });
    const sendBody = send.thenStatement.getText(file).replace(/Mouse\.world\.x/g, 'target.x').replace(/Mouse\.world\.y/g, 'target.y');
    const fallback = /if \(!checkFreeCell\(target\.x, target\.y, 9, pkt\.dest\)\) \{\s*pkt\.dest\[0\] = target\.x;\s*pkt\.dest\[1\] = target\.y;\s*\}/g;
    if (sendBody.match(fallback)?.length !== 1) fail();
    // Occupancy prefers an empty cell; it must not reject walkable crowded ground.
    const sendText = sendBody.replace(fallback, `if (!checkFreeCell(target.x, target.y, 9, pkt.dest)) {
      if (!(Altitude.getCellType(target.x, target.y) & Altitude.TYPE.WALKABLE)) return false;
      pkt.dest[0] = target.x;
      pkt.dest[1] = target.y;
    }`);
    const freeCell = fn('checkFreeCell'), cell = fn('isFreeCell');
    const occupancy = 'entity.objecttype != entity.constructor.TYPE_EFFECT && entity.objecttype != entity.constructor.TYPE_UNIT && entity.objecttype != entity.constructor.TYPE_TRAP && Math.round(entity.position[0]) === x && Math.round(entity.position[1]) === y';
    const checks = find(node => ts.isIfStatement(node) && node.expression.getText(file).replace(/\s/g, '') === occupancy.replace(/\s/g, ''));
    const candidate = find(node => ts.isCallExpression(node) && node.expression.getText(file) === 'isFreeCell');
    const loops = freeCell.body.statements.filter(ts.isForStatement);
    const walkable = cell.body.statements[0];
    if (freeCell.parameters.map(node => node.name.getText(file)).join(',') !== 'x,y,range,out'
      || cell.parameters.map(node => node.name.getText(file)).join(',') !== 'x,y'
      || checks.length !== 1 || candidate.length !== 1 || loops.length !== 1
      || candidate[0].getText(file) !== 'isFreeCell(x + _x * d_x, y + _y * d_y)'
      || !walkable || !ts.isIfStatement(walkable)
      || walkable.getText(file).replace(/\s/g, '') !== 'if(!(Altitude.getCellType(x,y)&Altitude.TYPE.WALKABLE))returnfalse;') fail();
    // Keep native cell order and exclusions, but scan the crowd only once per request.
    edits.push({ start: loops[0].getStart(file), text: 'const occupied = { cells: null };\n  ' });
    edits.push({ start: candidate[0].arguments.end, text: ', occupied' });
    edits.push({ start: cell.parameters.end, text: ', occupied' });
    edits.push({ start: cell.body.getStart(file), end: cell.body.end, text: `{
  ${walkable.getText(file)}
  if (!occupied.cells) {
    const cells = new Set();
    EntityManager.forEach(function (entity) {
      if (entity.objecttype != entity.constructor.TYPE_EFFECT
        && entity.objecttype != entity.constructor.TYPE_UNIT
        && entity.objecttype != entity.constructor.TYPE_TRAP) {
        cells.add(Math.round(entity.position[0]) + "," + Math.round(entity.position[1]));
      }
      return true;
    });
    occupied.cells = cells;
  }
  return !occupied.cells.has(x + "," + y);
}` });
    edits.push({ start: interval.body.getStart(file), end: interval.body.end, text: `{
  const position = SessionStorage_default.Entity.position;
  if (Math.round(position[0]) === target.x && Math.round(position[1]) === target.y) return false;
  ${sendText.slice(1, -1)}
  return true;
}` });
    edits.push({ start: binds[0].parent.getStart(file), text: `// lastro-movement-input-installed
        MapControl._lastroMovementInput = (${createLastroMovementInput.toString()})({
          clock: globalThis, now: () => globalThis.performance.now(),
          getTarget: () => ({ x: Mouse.world.x, y: Mouse.world.y }),
          getContext: () => ({ map: MapRenderer.loading ? "" : MapRenderer.currentMap, player: SessionStorage_default.Entity }),
          canMove: (target, phase) => {
            const player = SessionStorage_default.Entity;
            return !MapRenderer.loading && (phase === "pending" || Mouse.intersect) && !SessionStorage_default.FreezeUI
              && Mouse.state !== Mouse.MOUSE_STATE.USESKILL && !KEYS.SHIFT
              && !!player?.position && Number.isFinite(player.position[0]) && Number.isFinite(player.position[1])
              && player.action !== player.ACTION.SIT && !(player.ACTION.DIE !== undefined && player.action === player.ACTION.DIE)
              && target.x < Altitude.width && target.y < Altitude.height;
          },
          sendMove: walkIntervalProcess,
          onManualMove: () => {${cancelNavigation}
          },
          onError: error => console.warn("[LastRO] Movement input recovered from an error", error),
        });
        ` });
    for (const name of ['onMapChange', 'cleanGameUI']) {
      const reset = fn(name);
      edits.push({ start: reset.body.getStart(file) + 1, text: '\n  MapControl._lastroMovementInput?.cancel();' });
    }
  });
  source = patchRegion(source, 'src/Controls/MapControl.js', ({ file, edits, fn, find }) => {
    const down = fn('onMouseDown'), release = fn('onMouseUpCapture');
    const action = down.body.statements[0];
    const gate = down.body.statements.filter(ts.isIfStatement).find(node => node.expression.getText(file) === '!Mouse.intersect');
    const init = find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'init');
    if (!action || !ts.isVariableStatement(action) || action.declarationList.declarations[0]?.name.getText(file) !== 'action'
      || !gate || init.length !== 1 || !init[0].body || !release.body.getText(file).includes('Camera.rotate(false)')) fail();
    edits.push({ start: 0, text: `// lastro-movement-input-installed\nconst refreshLastroGroundInput = ${refreshLastroGroundInput.toString()};\n` });
    // Skill/attack/item handlers can return early after restoring Mouse.state.
    // Retire the old floor click before any of those native handlers can act.
    edits.push({ start: action.end, text: '\n  if (action === 1) MapControl._lastroMovementInput?.cancel();' });
    edits.push({ start: gate.getStart(file), text: `refreshLastroGroundInput(event, {
    mouse: Mouse, canvas: Renderer.canvas,
    ready: !MapRenderer.loading && !!MapRenderer.currentMap && !!SessionStorage_default.Entity && !SessionStorage_default.FreezeUI
      && Altitude.width > 0 && Altitude.height > 0 && !!Camera.modelView && !!Camera.projection,
    pick: out => Altitude.intersect(Camera.modelView, Camera.projection, out),
    getHeight: (x, y) => Altitude.getCellHeight(x, y),
    refreshEntity: () => EntityManager.setOverEntity(EntityManager.intersect()),
    onError: error => console.warn("[LastRO] Ground picker recovered from an error", error),
  });
  ` });
    edits.push({ start: release.body.getStart(file) + 1, text: '\n  if ((event.which || (event.button === 2 ? 3 : 1)) === 1) MapControl._lastroMovementInput?.stop();' });
    edits.push({ start: init[0].body.getStart(file) + 1, text: `
      window.addEventListener("blur", () => MapControl._lastroMovementInput?.cancel());
      document.addEventListener("visibilitychange", () => { if (document.hidden) MapControl._lastroMovementInput?.cancel(); });` });
  });
  source = patchRegion(source, 'src/Controls/EntityControl.js', ({ file, edits, find }) => {
    if (file.parseDiagnostics.length) fail();
    const classes = find(node => ts.isClassExpression(node)
      && ts.isBinaryExpression(node.parent) && node.parent.left.getText(file) === 'EntityControl');
    if (classes.length !== 1) fail();
    const method = name => {
      const matches = classes[0].members.filter(node => ts.isMethodDeclaration(node)
        && node.name.getText(file) === name);
      if (matches.length !== 1 || !matches[0].body || matches[0].parameters.length
        || !matches[0].modifiers?.some(node => node.kind === ts.SyntaxKind.StaticKeyword)) fail();
      return matches[0];
    };
    const down = method('onMouseDown'), focus = method('onFocus');
    const branch = (owner, name) => {
      const switches = owner.body.statements.filter(ts.isSwitchStatement);
      if (switches.length !== 1 || switches[0].expression.getText(file) !== 'this.objecttype') fail();
      const matches = switches[0].caseBlock.clauses.filter(node => ts.isCaseClause(node)
        && node.expression.getText(file) === 'Entity.' + name);
      if (matches.length !== 1) fail();
      return matches[0];
    };
    const pc = branch(down, 'TYPE_PC'), focusPC = branch(focus, 'TYPE_PC');
    const element = branch(focus, 'TYPE_ELEM'), hom = branch(focus, 'TYPE_HOM');
    const captcha = pc.statements[0], stop = pc.statements[1];
    const expected = 'if(SessionStorage_default.captchaGetIdOnEntityClick)CaptchaSelector_default.addPlayer(this.GID);';
    const nativeFocus = 'if(KEYS.SHIFT===false&&Controls_default.noshift===false&&!this.canAttackEntity()){if(!Camera.action.active)Cursor.setType(Cursor.ACTION.DEFAULT);if(!SessionStorage_default.TouchTargeting&&!SessionStorage_default.autoFollow)break;}';
    if (down.body.statements[0]?.getText(file).replace(/\s/g, '') !== 'constEntity=this.constructor;'
      || pc.statements.length !== 2 || !captcha || !ts.isIfStatement(captcha)
      || captcha.getText(file).replace(/\s/g, '') !== expected
      || !stop || !ts.isReturnStatement(stop) || stop.expression?.kind !== ts.SyntaxKind.TrueKeyword
      || focusPC.statements.length || element.statements.length
      || hom.statements[0]?.getText(file).replace(/\s/g, '') !== nativeFocus) fail();
    method('canAttackEntity');
    const eol = file.text.includes('\r\n') ? '\r\n' : '\n';
    edits.push({ start: file.text.indexOf('\n') + 1,
      text: ('// lastro-movement-input-installed\n' + lastroCanPassPlayerClick.toString() + '\n').replace(/\n/g, eol) });
    // Native onFocus can then let an ordinary noncombat click reach walking.
    edits.push({ start: stop.getStart(file), text: 'if (lastroCanPassPlayerClick(this)) return false;' + eol + '          ' });
  });
  source = patchRegion(source, 'src/Renderer/MapRenderer.js', ({ edits, find }) => {
    const setMap = find(node => ts.isMethodDeclaration(node) && node.name.getText() === 'setMap');
    if (setMap.length !== 1 || !setMap[0].body) fail();
    edits.push({ start: setMap[0].body.getStart() + 1, text: '\n      if (typeof MapControl !== "undefined") MapControl?._lastroMovementInput?.cancel();' });
  });
  return patchRegion(source, 'src/UI/Components/Navigation/Navigation.js', ({ edits, find }) => {
    const navigate = find(node => ts.isBinaryExpression(node) && node.left.getText() === 'Navigation.navigateTo'
      && ts.isFunctionExpression(node.right));
    if (navigate.length !== 1 || !navigate[0].right.body) fail();
    edits.push({ start: 0, text: '// lastro-movement-input-installed\n' });
    edits.push({ start: navigate[0].right.body.getStart() + 1,
      text: '\n    if (typeof MapControl !== "undefined") MapControl?._lastroMovementInput?.cancel();' });
  });
}
