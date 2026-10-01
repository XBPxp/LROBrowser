import ts from 'typescript';

/** Discard the unusable TCP chunk without permanently disabling its live socket. */
export function patchRuntimeNetworkFramingRecovery(source) {
  const marker = '//#region src/Network/NetworkManager.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:network-framing-recovery:region');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('NetworkManager.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'discardDesynchronizedChunk') matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1 || !matches[0].initializer || !ts.isArrowFunction(matches[0].initializer)) {
    throw new Error('anchor:network-framing-recovery:discard');
  }
  const body = matches[0].initializer.body;
  if (!ts.isBlock(body)) throw new Error('anchor:network-framing-recovery:discard-body');
  const statements = body.statements.filter(node => ts.isIfStatement(node) && node.expression.getText(file) === 'state');
  if (statements.length !== 1 || !ts.isExpressionStatement(statements[0].thenStatement)
    || statements[0].thenStatement.expression.getText(file) !== 'clearReceiveState(ownerSocket)') {
    throw new Error('anchor:network-framing-recovery:receive-state');
  }
  const statement = statements[0].thenStatement;
  const position = start + statement.getStart(file);
  return source.slice(0, position) + 'state.saveBuffer = null;' + source.slice(start + statement.end);
}

/** Let the native receive batches finish before EOF clears their already-read bytes. */
export function patchRuntimeNetworkCloseDrain(source) {
  const marker = '//#region src/Network/NetworkManager.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:network-close-drain:region');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('NetworkManager.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'onClose$9');
  if (matches.length !== 1 || !matches[0].body || matches[0].parameters.map(node => node.name.getText(file)).join(',') !== 'event') {
    throw new Error('anchor:network-close-drain:on-close');
  }
  const body = matches[0].body;
  const guard = body.statements.some(node => ts.isIfStatement(node)
    && node.expression.getText(file).replace(/\s/g, '') === 'this===_socket&&!this.handoffPending');
  if (!guard || body.getText(file).includes('lastroPendingCloseState')) throw new Error('anchor:network-close-drain:lifecycle');
  const prefix = `
  const lastroPendingCloseState = typeof _receiveStates !== "undefined" && this ? _receiveStates.get(this) : null;
  if (this === _socket && !this.handoffPending && lastroPendingCloseState && !lastroPendingCloseState.closed && lastroPendingCloseState.yieldPending && typeof setTimeout === "function") {
    if (!lastroPendingCloseState.closePending) {
      lastroPendingCloseState.closePending = true;
      setTimeout(() => {
        lastroPendingCloseState.closePending = false;
        if (lastroPendingCloseState.closed) return;
        onClose$9.call(this, event);
      }, 0);
    }
    return;
  }
`;
  const position = start + body.getStart(file) + 1;
  return source.slice(0, position) + prefix + source.slice(position);
}
