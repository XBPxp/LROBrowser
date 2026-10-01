import ts from 'typescript';

// Keep only structural information: the decoder's input and exception messages
// may contain account, authentication, or chat data and must not be retained.
export function createLastroNetworkDiagnostics({ log, publish, now } = {}) {
  const failures = new WeakMap();
  const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError']);
  const kinds = new Set(['decode', 'handler', 'unknown', 'framing']);
  function emit(event, metadata) {
    const diagnostic = Object.freeze({ event, ...metadata });
    try {
      if (publish) publish(diagnostic);
      else globalThis.LastRONetworkDiagnostic = diagnostic;
    } catch { /* Diagnostics must never change native packet handling. */ }
    try {
      if (log) log(diagnostic);
      else globalThis.console?.warn('[LastRO] Network diagnostic', diagnostic);
    } catch { /* A console or diagnostic consumer may be unavailable. */ }
  }
  function record(socket, opcode, length, kind, error, reason) {
    try {
      if (!socket || !['object', 'function'].includes(typeof socket) || !kinds.has(kind)) return;
      const metadata = {
        atMs: now ? now() : Date.now(),
        opcode: Number.isInteger(opcode) && opcode >= 0 && opcode <= 65535 ? opcode : null,
        length: Number.isSafeInteger(length) && length > 0 ? length : null,
        phase: socket.isZone === true ? 'map' : 'login-or-char',
        kind,
      };
      if (kind === 'decode' || kind === 'handler') metadata.errorName = errorNames.has(error?.name) ? error.name : 'Error';
      if (kind === 'framing') metadata.reason = reason === 'registered packet has unknown length' ? 'unknown-length'
        : typeof reason === 'string' && reason.startsWith('invalid declared length ') ? 'invalid-length' : 'invalid-frame';
      failures.set(socket, Object.freeze(metadata));
      emit('packet-failure', metadata);
    } catch { /* Preserve the original exception even if metadata access fails. */ }
  }
  function disconnected(socket) {
    try {
      const metadata = socket && failures.get(socket);
      if (metadata) emit('disconnect', { ...metadata, ageMs: Math.max(0, (now ? now() : Date.now()) - metadata.atMs) });
    } catch { /* Recording a disconnect must not affect native UI callbacks. */ }
  }
  return { record, disconnected };
}

/** Add passive metadata around native packet decoding without replacing it. */
export function patchRuntimeNetworkDiagnostics(source) {
  const marker = '//#region src/Network/NetworkManager.js', start = source.indexOf(marker);
  if (start < 0) return source;
  if (source.includes('const lastroNetworkDiagnostics =')) throw new Error('anchor:network-diagnostics:already-installed');
  const end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:network-diagnostics:network');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('NetworkManager.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = name => file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const receive = functions('receive'), close = functions('onClose$9');
  if (receive.length !== 1 || close.length !== 1) throw new Error('anchor:network-diagnostics:lifecycle');
  const compact = node => node.getText(file).replace(/\s+/g, '');
  const decode = [], handlers = [], unknown = [], discards = [], warnings = [];
  function visitReceive(node) {
    if (ts.isExpressionStatement(node) && compact(node) === 'packet.instance=newpacket.Struct(fp,offset);') decode.push(node);
    if (ts.isIfStatement(node) && compact(node.expression) === 'packet.callback'
      && compact(node.thenStatement) === 'packet.callback(packet.instance);') handlers.push(node);
    if (ts.isIfStatement(node) && compact(node.expression) === 'Configs.get("lastroCustomPackets",false)&&!Packets.list[id]') unknown.push(node);
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'discardDesynchronizedChunk'
      && ts.isArrowFunction(node.initializer) && ts.isBlock(node.initializer.body)) discards.push(node.initializer.body);
    ts.forEachChild(node, visitReceive);
  }
  visitReceive(receive[0]);
  function visitClose(node) {
    if (ts.isExpressionStatement(node) && node.getText(file).includes('console.warn(')
      && node.getText(file).includes('[Network] Disconnect from server')) warnings.push(node);
    ts.forEachChild(node, visitClose);
  }
  visitClose(close[0]);
  if ([decode, handlers, unknown, discards, warnings].some(matches => matches.length !== 1)
    || !ts.isBlock(unknown[0].thenStatement)) throw new Error('anchor:network-diagnostics:packet-sites');
  const changes = [
    { start: decode[0].getStart(file), end: decode[0].end, text: `try { ${decode[0].getText(file)} } catch (lastroPacketError) {
            lastroNetworkDiagnostics.record(ownerSocket || _socket, id, length, "decode", lastroPacketError);
            throw lastroPacketError;
          }` },
    { start: handlers[0].getStart(file), end: handlers[0].end, text: `if (packet.callback) {
            try { packet.callback(packet.instance); } catch (lastroPacketError) {
              lastroNetworkDiagnostics.record(ownerSocket || _socket, id, length, "handler", lastroPacketError);
              throw lastroPacketError;
            }
          }` },
    { start: unknown[0].thenStatement.getStart(file) + 1, end: unknown[0].thenStatement.getStart(file) + 1,
      text: '\n      lastroNetworkDiagnostics.record(ownerSocket || _socket, id, null, "unknown");' },
    { start: discards[0].getStart(file) + 1, end: discards[0].getStart(file) + 1,
      text: '\n    lastroNetworkDiagnostics.record(ownerSocket || _socket, id, length, "framing", undefined, reason);' },
    { start: warnings[0].end, end: warnings[0].end, text: '\n    lastroNetworkDiagnostics.disconnected(this);' },
  ];
  let output = region;
  for (const change of changes.sort((a, b) => b.start - a.start)) output = output.slice(0, change.start) + change.text + output.slice(change.end);
  return source.slice(0, start) + `const lastroNetworkDiagnostics = (${createLastroNetworkDiagnostics.toString()})();\n` + output + source.slice(end);
}
