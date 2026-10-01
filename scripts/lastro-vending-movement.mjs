import ts from 'typescript';

/* global NpcStore, SessionStorage_default, Mouse, MapControl, Events, _walkTimer,
          Navigation_default, LastROTools, stopMovement, UIManager, GUIComponent, document */

function lastroVendingShoppingActive() {
  return typeof NpcStore !== 'undefined' && !!NpcStore?._lastroVendingShopping
    && NpcStore.__active && !!NpcStore._host?.isConnected && NpcStore._host.style.display !== 'none';
}

function lastroSetVendingShopping(component, type) {
  const shopping = type === component.Type.VENDING_STORE || type === component.Type.BUYING_STORE;
  const entering = shopping && !component._lastroVendingShopping;
  component._lastroVendingShopping = shopping;
  if (!entering || !component.__active || !component._host?.isConnected) return;
  // Reuse the store's native FREEZE mode and retire movement queued before it opened.
  SessionStorage_default.FreezeUI = true;
  Mouse.intersect = false;
  SessionStorage_default.moveAction = null;
  SessionStorage_default.autoFollow = false;
  if (typeof MapControl !== 'undefined') MapControl?._lastroMovementInput?.cancel();
  if (typeof Events !== 'undefined' && typeof _walkTimer !== 'undefined') Events.clearTimeout(_walkTimer);
  if (typeof Navigation_default !== 'undefined' && Navigation_default?.__loaded) Navigation_default.clear();
  if (typeof LastROTools !== 'undefined') {
    LastROTools?._lastroPanels?.cancelRoute();
    LastROTools?._lastroQuestRoute?.cancel();
  }
  if (typeof stopMovement === 'function') stopMovement();
}

function lastroInstallVendingRemoval(component) {
  const remove = component.remove;
  component.remove = function (...args) {
    const shopping = this._lastroVendingShopping;
    try { return remove.apply(this, args); }
    finally {
      this._lastroVendingShopping = false;
      if (shopping) {
        // Native remove() clears a shared boolean even when another frozen UI remains.
        const frozen = Object.values(UIManager.components).some(other => other !== this && other.__active
          && other.mouseMode === GUIComponent.MouseMode.FREEZE && other._host?.isConnected)
          // Native WinPopup clones are deliberately absent from the manager's registry.
          || Array.from(document.body.children).some(host => host !== this._host && host.style.display !== 'none'
            && !!host.shadowRoot?.querySelector('#win_popup'));
        SessionStorage_default.FreezeUI = frozen;
        Mouse.intersect = !frozen;
      }
    }
  };
}

function lastroCloseVendingShopping() {
  if (typeof NpcStore === 'undefined' || !NpcStore?._lastroVendingShopping) return;
  // A map/session transition has already ended the old server-side store interaction.
  NpcStore.setClosePacketSent(true);
  NpcStore.remove();
}

function fail(label) { throw new Error('anchor:vending-movement:' + label); }

function patchRegion(source, path, mutate) {
  const marker = '//#region ' + path, start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < start || source.indexOf(marker, start + marker.length) >= 0) fail(path);
  const region = source.slice(start, end);
  if (region.includes('lastro-vending-movement-installed')) fail('already-installed');
  const file = ts.createSourceFile(path, region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  const find = predicate => {
    const matches = [];
    function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
    visit(file); return matches;
  };
  const one = predicate => { const matches = find(predicate); if (matches.length !== 1) fail(path); return matches[0]; };
  mutate({ file, edits, one });
  edits.push({ start: markerLength(region), text: '// lastro-vending-movement-installed\n' });
  let output = region;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end ?? edit.start);
  return source.slice(0, start) + output + source.slice(end);
}

/** Protect player-store shopping without changing merchant setup or packet layouts. */
export function patchRuntimeVendingMovement(source) {
  source = patchRegion(source, 'src/UI/Components/NpcStore/NpcStore.js', ({ file, edits, one }) => {
    const setType = one(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'NpcStore.setType'
      && ts.isFunctionExpression(node.right));
    const type = one(node => ts.isBinaryExpression(node) && node.left.getText(file) === '_type' && node.right.getText(file) === 'type');
    const remove = one(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'NpcStore.onRemove'
      && ts.isFunctionExpression(node.right));
    const registration = one(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'NpcStore_default'
      && node.right.getText(file) === 'UIManager.addComponent(NpcStore)');
    if (!setType.right.body || !remove.right.body || !ts.isExpressionStatement(type.parent)
      || !ts.isExpressionStatement(registration.parent)
      || !file.text.includes('NpcStore.mouseMode = GUIComponent.MouseMode.FREEZE;')) fail('store-lifecycle');
    edits.push({ start: type.parent.end, text: '\n    lastroSetVendingShopping(this, type);' });
    edits.push({ start: remove.right.body.getStart(file) + 1, text: '\n    this._lastroVendingShopping = false;' });
    edits.push({ start: registration.parent.getStart(file), text: 'lastroInstallVendingRemoval(NpcStore);\n  ' });
    const helpers = [lastroVendingShoppingActive, lastroSetVendingShopping, lastroInstallVendingRemoval, lastroCloseVendingShopping];
    edits.push({ start: markerLength(file.text), text: '\n' + helpers.map(fn => fn.toString()).join('\n') + '\n' });
  });
  source = patchRegion(source, 'src/Network/NetworkManager.js', ({ file, edits, one }) => {
    const send = one(node => ts.isFunctionDeclaration(node) && node.name?.text === 'sendPacket');
    if (!send.body || send.parameters.length !== 1 || send.parameters[0].name.getText(file) !== 'Packet'
      || !send.body.getText(file).includes('Packet.build()')) fail('send-packet');
    edits.push({ start: send.body.getStart(file) + 1, text: `
  if ((Packet.constructor === PACKET.CZ.REQUEST_MOVE || Packet.constructor === PACKET.CZ.REQUEST_MOVE2)
      && lastroVendingShoppingActive()) {
    SessionStorage_default.FreezeUI = true;
    Mouse.intersect = false;
    return false;
  }` });
  });
  source = patchRegion(source, 'src/Engine/MapEngine.js', ({ file, edits, one }) => {
    for (const name of ['onMapChange', 'cleanGameUI']) {
      const entry = one(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
      if (!entry.body) fail(name);
      edits.push({ start: entry.body.getStart(file) + 1, text: '\n  lastroCloseVendingShopping();' });
    }
    const walk = one(node => ts.isFunctionDeclaration(node) && node.name?.text === 'onRequestWalk');
    if (!walk.body) fail('onRequestWalk');
    edits.push({ start: walk.body.getStart(file) + 1, text: '\n  if (lastroVendingShoppingActive()) return false;' });
  });
  const gates = [
    ['src/Controls/MapControl.js', 'onMouseDown', 'if ((event.which || (event.button === 2 ? 3 : 1)) === 1 && lastroVendingShoppingActive()) return false;'],
    ['src/UI/Components/JoystickUI/JoystickCharacterControl.js', 'move$1'],
    ['src/UI/Components/MobileUI/MobileUI.js', 'moveCharacter'],
    ['src/UI/Components/Navigation/Navigation.js', 'requestNavigationMove'],
  ];
  for (const [path, name, guard = 'if (lastroVendingShoppingActive()) return false;'] of gates) {
    source = patchRegion(source, path, ({ file, edits, one }) => {
      const entry = one(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
      if (!entry.body) fail(name);
      edits.push({ start: entry.body.getStart(file) + 1, text: '\n  ' + guard });
    });
  }
  return source;
}

function markerLength(region) { const end = region.indexOf('\n'); if (end < 0) fail('region-header'); return end + 1; }
