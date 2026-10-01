import ts from 'typescript';

/** Close the acknowledged map session before the asynchronous character UI reload. */
export function patchRuntimeCharacterSwitch(source) {
  const marker = '//#region src/Engine/MapEngine.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:character-switch:map-engine');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('MapEngine.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'onRestartAnswer');
  if (matches.length !== 1 || matches[0].parameters.map(node => node.name.getText(file)).join(',') !== 'pkt') {
    throw new Error('anchor:character-switch:restart-answer');
  }
  const statement = matches[0].body?.statements[0];
  if (!statement || !ts.isIfStatement(statement) || statement.expression.getText(file).replace(/\s/g, '') !== '!pkt.type'
    || !statement.elseStatement || !ts.isBlock(statement.elseStatement)) throw new Error('anchor:character-switch:restart-result');
  const accepted = statement.elseStatement;
  const expected = ['GuildEngine.guild_id=0', 'cleanGameUI()', 'SessionStorage_default.Achievement=null',
    'Mouse.intersect=false', 'MapRenderer.free()', 'Renderer.stop()', 'onRestart()'];
  const expressions = accepted.statements.filter(ts.isExpressionStatement).map(node => node.expression.getText(file).replace(/\s/g, ''));
  if (accepted.statements.length !== expected.length || expressions.join(';') !== expected.join(';')) {
    throw new Error('anchor:character-switch:restart-close');
  }
  const position = start + accepted.getStart(file) + 1;
  return source.slice(0, position) + '\n    // The server accepted returning to character selection; this map socket is finished.\n    // Detach it now so EOF cannot queue a disconnect dialog while the UI reload awaits.\n    Network.close();' + source.slice(position);
}

/** Remove a superseded socket before close, which can synchronously invoke onClose. */
export function patchRuntimeNetworkHandoffCleanup(source) {
  const marker = '//#region src/Network/NetworkManager.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:character-switch:network');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('NetworkManager.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'setPing');
  if (matches.length !== 1 || !matches[0].body) throw new Error('anchor:character-switch:set-ping');
  const loops = [];
  function visit(node) {
    if (ts.isWhileStatement(node) && node.expression.getText(file).replace(/\s/g, '') === '_sockets.length>1') loops.push(node);
    ts.forEachChild(node, visit);
  }
  visit(matches[0].body);
  const condition = loops[0]?.statement;
  if (loops.length !== 1 || !ts.isIfStatement(condition) || condition.expression.getText(file).replace(/\s/g, '') !== '_socket!==_sockets[0]'
    || !ts.isBlock(condition.thenStatement)) throw new Error('anchor:character-switch:old-socket');
  const block = condition.thenStatement;
  const text = block.getText(file).replace(/\s/g, '');
  if (!text.includes('_sockets[0].close();_sockets.splice(0,1);')) throw new Error('anchor:character-switch:cleanup-order');
  const replacement = `{
        const previousSocket = _sockets.shift();
        if (typeof clearReceiveState === "function") clearReceiveState(previousSocket);
        previousSocket.close();
      }`;
  return source.slice(0, start + block.getStart(file)) + replacement + source.slice(start + block.end);
}
