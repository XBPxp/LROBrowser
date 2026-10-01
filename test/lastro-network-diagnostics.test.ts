import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createLastroNetworkDiagnostics, patchRuntimeNetworkDiagnostics } from '../scripts/lastro-network-diagnostics.mjs';
import { patchRuntimeNetworkFramingRecovery } from '../scripts/lastro-network-receive-recovery.mjs';
// @ts-expect-error The reviewed vendored protocol module has no declaration file.
import * as framing from '../vendor/v2/lastro-packet-framing.mjs';
// @ts-expect-error The reviewed vendored card module has no declaration file.
import * as cards from '../vendor/v2/lastro-card-collection.mjs';
// @ts-expect-error The reviewed vendored observer module has no declaration file.
import { isObserverMode, runObserverPacketHandler } from '../vendor/v2/lastro-observer-mode.mjs';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
const patched = patchRuntimeNetworkDiagnostics(native);
function region(source: string, name: string): string {
  const start = source.indexOf('//#region ' + name), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native region: ' + name);
  return source.slice(start, end);
}
function runtime(source = patched) {
  const warning = vi.fn(), errors = vi.fn(), disconnect = vi.fn();
  const context = vm.createContext({
    ...framing, ...cards, isObserverMode, runObserverPacketHandler,
    ArrayBuffer, Uint8Array, DataView, Int8Array, Int32Array, Float32Array, Math, Number, WeakMap,
    Date: class FixedDate extends Date { static now() { return 12345; } },
    RangeError, TypeError, Error, SEEK_SET: 2, SEEK_CUR: 1,
    window: {}, console: { log: vi.fn(), warn: warning, error: errors },
    CodepageManager: { decode: (bytes: Uint8Array) => new TextDecoder().decode(bytes) },
    __esmMin: (callback: () => void) => {
      let initialized = false;
      return () => { if (!initialized) { initialized = true; callback(); } };
    },
    __exportAll: (entries: Record<string, () => unknown>) => Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value()])),
    init_CodepageManager() {}, init_BinaryWriter() {}, init_PacketVerManager() {}, init_Configs() {},
    PacketVerManager_default: { value: 20211103 },
    Configs: { get: (key: string) => ['renewal', 'lastroProtocol', 'lastroCustomPackets'].includes(key) },
  });
  for (const name of ['src/Utils/Struct.js', 'src/Utils/BinaryReader.js', 'src/Network/PacketStructure.js',
    'src/Network/PacketRegister.js', 'src/Network/Packets/packets2021_len_main.js', 'src/Network/PacketLength.js']) {
    vm.runInContext(region(source, name), context);
  }
  context.init_BinaryReader(); context.init_PacketRegister(); context.init_packets2021_len_main();
  context.packetModules = { './Packets/packets2021_len_main.js': { init: context.init$19 } }; context.init$14(20211103);
  const decoded: number[] = [], scheduled: Array<() => void> = [];
  const socket = { close: vi.fn(), isZone: true };
  const packetList: Record<number, { Struct: unknown; callback: (packet: unknown) => void }> = {};
  for (const [key, Struct] of Object.entries(context.PacketRegister)) {
    const id = Number(key); packetList[id] = { Struct, callback: () => decoded.push(id) };
  }
  Object.assign(context, {
    _receiveStates: new WeakMap(), _socket: socket, _sockets: [socket], _onDisconnect: disconnect,
    _save_buffer: null, _receive_yield_pending: false, clearInterval: vi.fn(),
    read$1: {}, packetDump: false, Packets: { list: packetList },
    PacketLength_default: { getPacketLength: context.getPacketLength }, setTimeout: (callback: () => void) => scheduled.push(callback),
  });
  const prefix = source.slice(source.indexOf('const lastroNetworkDiagnostics ='), source.indexOf('//#region src/Network/NetworkManager.js'));
  vm.runInContext(prefix, context);
  const file = ts.createSourceFile('NetworkManager.js', region(source, 'src/Network/NetworkManager.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Set(['createReceiveState', 'getReceiveState', 'clearReceiveState', 'receive', 'onClose$9']);
  vm.runInContext(file.statements.filter(node => ts.isFunctionDeclaration(node) && functions.has(node.name?.text ?? ''))
    .map(node => node.getText(file)).join('\n').replaceAll('import.meta.url', '"fixture"'), context);
  const state = context.getReceiveState(socket);
  return { context, socket, state, decoded, warning, errors, disconnect, scheduled, packetList,
    send: (bytes: Uint8Array) => context.receive.call(socket, bytes), close: () => context.onClose$9.call(socket) };
}
function frame(opcode: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length); new DataView(bytes.buffer).setUint16(0, opcode, true); return bytes;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}

describe('passive native network diagnostics', () => {
  it('decodes native map accept, second check and restart ACK without adding logs or packets', () => {
    const h = runtime(), ack = frame(0x00b3, 3); ack[2] = 1;
    h.send(join(frame(0x0073, 11), frame(0x0ad5, 10), ack));
    expect(h.decoded).toEqual([0x0073, 0x0ad5, 0x00b3]); expect(h.warning).not.toHaveBeenCalled();
    expect(h.context.LastRONetworkDiagnostic).toBeUndefined(); expect(h.socket.close).not.toHaveBeenCalled();
  });

  it('records decoder metadata and throws the identical original exception without closing', () => {
    const h = runtime(), original = new RangeError('private message must not appear');
    h.packetList[0x00b3]!.Struct = function () { throw original; };
    expect(() => h.send(frame(0x00b3, 3))).toThrow(original);
    expect(h.context.LastRONetworkDiagnostic).toEqual({ event: 'packet-failure', atMs: 12345, opcode: 0x00b3, length: 3,
      phase: 'map', kind: 'decode', errorName: 'RangeError' });
    expect(h.warning).toHaveBeenCalledExactlyOnceWith('[LastRO] Network diagnostic', h.context.LastRONetworkDiagnostic);
    expect(JSON.stringify(h.warning.mock.calls)).not.toContain('private message');
    expect(h.socket.close).not.toHaveBeenCalled(); expect(h.state.closed).toBe(false);
  });

  it('distinguishes handler errors and preserves the native continuation on the next read', () => {
    const h = runtime(), original = new TypeError('private handler input');
    h.packetList[0x00b3]!.callback = () => { throw original; };
    let actual: unknown; try { h.send(frame(0x00b3, 3)); } catch (error) { actual = error; }
    expect(actual).toBe(original); expect(h.context.LastRONetworkDiagnostic.kind).toBe('handler');
    h.send(frame(0x0073, 11)); expect(h.decoded).toEqual([0x0073]);
    expect(h.socket.close).not.toHaveBeenCalled(); expect(JSON.stringify(h.context.LastRONetworkDiagnostic)).not.toContain('private');
  });

  it('associates a later unexpected disconnect with this socket only', () => {
    const h = runtime(); h.packetList[0x00b3]!.callback = () => { throw new Error('private'); };
    expect(() => h.send(frame(0x00b3, 3))).toThrow(); h.close();
    expect(h.context.LastRONetworkDiagnostic).toEqual({ event: 'disconnect', atMs: 12345, ageMs: 0, opcode: 0x00b3, length: 3,
      phase: 'map', kind: 'handler', errorName: 'Error' });
    expect(h.disconnect).toHaveBeenCalledOnce();
    const newSocket = { close() {}, isZone: true }; h.context._socket = newSocket; h.context._sockets = [newSocket];
    h.warning.mockClear(); h.context.onClose$9.call(newSocket);
    expect(h.warning.mock.calls.filter(([label]) => label === '[LastRO] Network diagnostic')).toEqual([]);
  });

  it('keeps unknown opcode behavior and logs no unparsed bytes', () => {
    const h = runtime(); h.send(join(frame(0xffff, 3), frame(0x0073, 11)));
    expect(h.context.LastRONetworkDiagnostic).toEqual({ event: 'packet-failure', atMs: 12345, opcode: 0xffff, length: null,
      phase: 'map', kind: 'unknown' });
    expect(h.decoded).toEqual([]); h.send(frame(0x0073, 11)); expect(h.decoded).toEqual([0x0073]);
    expect(h.state.closed).toBe(false); expect(h.socket.close).not.toHaveBeenCalled();
  });

  it.each(['before', 'after'] as const)('coexists with framing recovery when applied %s it', order => {
    const source = order === 'before' ? patchRuntimeNetworkFramingRecovery(patched)
      : patchRuntimeNetworkDiagnostics(patchRuntimeNetworkFramingRecovery(native));
    const h = runtime(source), originalLength = h.context.PacketLength_default.getPacketLength;
    h.context.PacketLength_default.getPacketLength = (opcode: number) => opcode === 0x00b3 ? 0 : originalLength(opcode);
    h.send(frame(0x00b3, 3));
    expect(h.context.LastRONetworkDiagnostic).toEqual({ event: 'packet-failure', atMs: 12345, opcode: 0x00b3, length: null,
      phase: 'map', kind: 'framing', reason: 'unknown-length' });
    expect(h.state.closed).toBe(false); h.send(frame(0x0073, 11)); expect(h.decoded).toEqual([0x0073]);
  });

  it('records only the declared invalid length and leaves the native discard untouched', () => {
    const h = runtime(), bytes = frame(0x008d, 4); new DataView(bytes.buffer).setUint16(2, 3, true);
    h.send(bytes);
    expect(h.context.LastRONetworkDiagnostic).toEqual({ event: 'packet-failure', atMs: 12345, opcode: 0x008d, length: 3,
      phase: 'map', kind: 'framing', reason: 'invalid-length' });
    expect(h.state.closed).toBe(true); expect(h.socket.close).not.toHaveBeenCalled();
  });

  it('does not alter the native 32-frame yield or terminal receive-state cleanup', () => {
    const h = runtime(), ack = frame(0x00b3, 3); ack[2] = 1;
    h.send(join(...Array.from({ length: 32 }, () => frame(0x0073, 11)), ack));
    expect(h.decoded).toHaveLength(32); expect(h.scheduled).toHaveLength(1);
    h.close(); h.scheduled.shift()!();
    expect(h.decoded).toHaveLength(32); expect(h.state.closed).toBe(true); expect(h.state.saveBuffer).toBeNull();
  });

  it('does not report a normal handoff close as an unexpected disconnect', () => {
    const h = runtime(); h.send(frame(0xffff, 2)); h.context._socket.handoffPending = true;
    h.warning.mockClear(); h.close(); expect(h.warning).not.toHaveBeenCalled(); expect(h.disconnect).not.toHaveBeenCalled();
  });

  it('limits names and framing reasons to structural enums, regardless of input', () => {
    const log = vi.fn(), publish = vi.fn(), diagnostics = createLastroNetworkDiagnostics({ log, publish, now: () => 1000 });
    const socket = { isZone: false };
    diagnostics.record(socket, 179, 3, 'decode', { name: 'private-account-name', message: 'private-token', packet: 'private-payload' });
    expect(publish).toHaveBeenLastCalledWith({ event: 'packet-failure', atMs: 1000, opcode: 179, length: 3,
      phase: 'login-or-char', kind: 'decode', errorName: 'Error' });
    diagnostics.record(socket, 179, 3, 'framing', undefined, 'private raw framing reason');
    expect(publish.mock.calls[1]![0].reason).toBe('invalid-frame'); expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    expect(Object.isFrozen(publish.mock.calls[0]![0])).toBe(true);
  });

  it('never replaces native behavior when diagnostic consumers or error access fail', () => {
    const diagnostics = createLastroNetworkDiagnostics({ log: () => { throw new Error('log failed'); }, publish: () => { throw new Error('publish failed'); } });
    const socket = { isZone: true }, error = Object.defineProperty({}, 'name', { get: () => { throw new Error('getter failed'); } });
    expect(() => diagnostics.record(socket, 179, 3, 'decode', error)).not.toThrow();
    expect(() => { diagnostics.record(socket, 179, 3, 'handler', new TypeError()); diagnostics.disconnected(socket); }).not.toThrow();
  });

  it('reports failure age so an earlier recovered packet is not presented as a fresh failure', () => {
    let time = 1000;
    const publish = vi.fn(), diagnostics = createLastroNetworkDiagnostics({ log: vi.fn(), publish, now: () => time });
    const socket = { isZone: true };
    diagnostics.record(socket, 179, 3, 'decode', new RangeError()); time = 61000; diagnostics.disconnected(socket);
    expect(publish).toHaveBeenLastCalledWith({ event: 'disconnect', atMs: 1000, ageMs: 60000,
      opcode: 179, length: 3, phase: 'map', kind: 'decode', errorName: 'RangeError' });
    time = 500; diagnostics.disconnected(socket); expect(publish.mock.calls[2]![0].ageMs).toBe(0);
  });

  it('changes only five anchored native sites and rejects missing or duplicate anchors', () => {
    const nativeRegion = region(native, 'src/Network/NetworkManager.js');
    const outputRegion = region(patched, 'src/Network/NetworkManager.js');
    expect(outputRegion).toContain('throw lastroPacketError;'); expect(outputRegion).toContain('if (state) clearReceiveState(ownerSocket);');
    expect(patched.slice(patched.indexOf('//#endregion', patched.indexOf('//#region src/Network/NetworkManager.js'))))
      .toBe(native.slice(native.indexOf('//#endregion', native.indexOf('//#region src/Network/NetworkManager.js'))));
    expect(nativeRegion).not.toContain('lastroNetworkDiagnostics');
    expect(patched.slice(0, patched.indexOf('const lastroNetworkDiagnostics =')))
      .toBe(native.slice(0, native.indexOf('//#region src/Network/NetworkManager.js')));
    const nativeAst = ts.createSourceFile('native.js', nativeRegion, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const outputAst = ts.createSourceFile('output.js', outputRegion, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of nativeAst.statements) {
      if (!ts.isFunctionDeclaration(statement) || ['receive', 'onClose$9'].includes(statement.name?.text || '')) continue;
      const name = statement.name?.text;
      const counterpart = outputAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
      expect(counterpart?.getText(outputAst), name).toBe(statement.getText(nativeAst));
    }
    expect(() => patchRuntimeNetworkDiagnostics(patched)).toThrow('anchor:network-diagnostics:already-installed');
    expect(patchRuntimeNetworkDiagnostics('const unrelated = true;')).toBe('const unrelated = true;');
    expect(() => patchRuntimeNetworkDiagnostics(native.replace('packet.instance = new packet.Struct(fp, offset);', 'packet.instance = null;')))
      .toThrow('anchor:network-diagnostics:packet-sites');
  });
});
