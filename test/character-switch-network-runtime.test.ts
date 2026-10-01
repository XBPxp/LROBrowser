import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectTcpSocket } from '../src/network/direct-tcp-socket';
import { patchRuntimeCharacterSwitch, patchRuntimeNetworkHandoffCleanup } from '../scripts/lastro-character-switch.mjs';
import { patchRuntimeNetworkCloseDrain } from '../scripts/lastro-network-receive-recovery.mjs';

const vendor = readFileSync(new URL('../vendor/v2/Online.js', import.meta.url), 'utf8');
function region(name: string, source = vendor) {
  const start = source.indexOf(`//#region ${name}`);
  const end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error(`Missing native region: ${name}`);
  return source.slice(start, end + '//#endregion'.length);
}
const native = [
  'src/Network/NetworkManager.js', 'src/Engine/MapEngine.js',
].map(name => region(name)).join('\n');
const switchPatched = patchRuntimeNetworkHandoffCleanup(patchRuntimeCharacterSwitch(native));
const patched = patchRuntimeNetworkCloseDrain(switchPatched);
function declarations(source: string, names: string[]) {
  const file = ts.createSourceFile('native.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return names.map(name => {
    const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1) throw new Error(`Missing native function: ${name}`);
    return matches[0]!.getText(file);
  }).join('\n');
}
function reloadMethod() {
  const file = ts.createSourceFile('CharEngine.js', region('src/Engine/CharEngine.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let method: ts.MethodDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isClassExpression(node) && node.name?.text === 'CharEngine') {
      method = node.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(file) === 'reload') as ts.MethodDeclaration | undefined;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!method) throw new Error('Missing native CharEngine.reload');
  return method.getText(file);
}
const nativeReload = reloadMethod();
const restartDecoderStart = vendor.indexOf('  PACKET.ZC.RESTART_ACK = function ');
const restartDecoderEnd = vendor.indexOf('  PACKET.ZC.RESTART_ACK.size = 3;', restartDecoderStart);
if (restartDecoderStart < 0 || restartDecoderEnd < 0) throw new Error('Missing native RESTART_ACK decoder');
const restartDecoder = vendor.slice(restartDecoderStart, restartDecoderEnd);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function microtasks() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
const fixtures: Array<ReturnType<typeof runtime>> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
  await microtasks();
});

function runtime(source = patched) {
  const timeline: string[] = [], reported: unknown[] = [], messages: string[] = [];
  const transports: FakeTcpSocket[] = [], sockets: DirectTcpSocket[] = [];
  const receiveTimers: Array<() => void> = [], timerErrors: unknown[] = [];
  const decoded: Array<{ source: string; value: number }> = [];
  const charInit = vi.fn(() => timeline.push('character.init'));
  const background = vi.fn((callback: () => void) => { timeline.push('background'); callback(); });
  const packetCrypt = { init: vi.fn(), reset: vi.fn() };
  class FakeTcpSocket {
    readonly openGate = deferred<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }>();
    readonly closeGate = deferred<void>();
    readonly opened = this.openGate.promise;
    readonly closed = this.closeGate.promise;
    controller!: ReadableStreamDefaultController<Uint8Array>;
    cancelled = false;
    ended = false;
    readonly readable = new ReadableStream<Uint8Array>({
      start: controller => { this.controller = controller; },
      cancel: () => { this.cancelled = true; },
    });
    readonly writable = new WritableStream<Uint8Array>({
      write: () => { throw new Error('Character-switch fixture must never send a packet'); },
    });
    readonly close = vi.fn(async () => {
      timeline.push('transport.close');
      expect(this.readable.locked).toBe(false);
      expect(this.writable.locked).toBe(false);
    });
    constructor() { transports.push(this); }
    open() { this.openGate.resolve({ readable: this.readable, writable: this.writable }); }
    push(bytes: Uint8Array) { this.controller.enqueue(bytes); }
    eof() { this.ended = true; this.controller.close(); }
  }
  const context = vm.createContext({
    ArrayBuffer, Uint8Array, DataView, Int8Array, Int32Array, Float32Array, Math, Number,
    window: {}, SEEK_SET: 2, SEEK_CUR: 1,
    console: {
      log: vi.fn(), error: vi.fn(),
      warn: vi.fn(() => timeline.push('network.disconnect')),
    },
    __esmMin: (initialize: () => void) => initialize,
    init_Struct() {}, init_CodepageManager() {},
    CodepageManager: { decode: (bytes: Uint8Array) => new TextDecoder().decode(bytes) },
    Configs: { get: (_name: string, fallback: unknown) => fallback },
    isObserverMode: () => false,
    runObserverPacketHandler: (callback: () => void) => { callback(); return true; },
    parseLastROFrameHeader: () => null,
    PacketVerManager_default: { value: 20211103 },
    PacketCrypt_default: packetCrypt,
    PacketLength_default: { getPacketLength: (id: number) => id === 0x00b3 ? 3 : 4 },
    PACKET: { ZC: {} }, Packets: { list: {} }, packetDump: false,
    _socket: null, _sockets: [], _receiveStates: new WeakMap(), _onDisconnect: undefined,
    _save_buffer: null, _receive_yield_pending: false,
    setTimeout: (callback: () => void) => receiveTimers.push(callback),
    setInterval: () => 1, clearInterval: vi.fn(),
    GuildEngine: { guild_id: 7 }, SessionStorage_default: { Achievement: {} }, Mouse: { intersect: true },
    cleanGameUI: vi.fn(() => timeline.push('game.cleanup')),
    MapRenderer: { free: vi.fn(() => timeline.push('map.free')) },
    Renderer: { stop: vi.fn(() => timeline.push('renderer.stop')) },
    ChatBox_default: { addText: vi.fn(), TYPE: { ERROR: 1 }, FILTER: { PUBLIC_LOG: 2 } },
    DB: { getMessage: () => 'Return to character selection refused' },
    init_CharEngine: () => timeline.push('character.module'), init_UIManager() {},
    UIManager_exports: { default: { showErrorBox: (message: string) => messages.push(message) } },
    UIManager: { removeComponents: vi.fn() }, Background: { setLoginBackground: background },
    _server$1: { name: 'fixture' }, fixtureCharacterInit: charInit,
    __vitePreload: (loader: () => Promise<unknown>) => loader(),
    _socketFactory: () => {
      const socket = new DirectTcpSocket('fixture.invalid', 1, {
        TCPSocket: FakeTcpSocket, now: () => 0, reportError: error => reported.push(error),
      });
      sockets.push(socket);
      return socket;
    },
  });
  vm.runInContext(region('src/Utils/BinaryReader.js'), context);
  context.init_BinaryReader();
  vm.runInContext([
    declarations(region('src/Network/NetworkManager.js', source), [
      'connect', 'createReceiveState', 'getReceiveState', 'clearReceiveState',
      'receive', 'read$1', 'onClose$9', 'close', 'setPing',
    ]),
    declarations(region('src/Engine/MapEngine.js', source), ['onRestartAnswer', 'onRestart']),
    `class CharEngine { static init() { fixtureCharacterInit(); } ${nativeReload} }
      var CharEngine_exports = { default: CharEngine };
      var Network = { connect, close, read: read$1 };`,
    restartDecoder,
  ].join('\n').replaceAll('import.meta.url', '"file:///native.js"'), context);
  vm.runInContext(`Packets.list[0x00b3] = { Struct: PACKET.ZC.RESTART_ACK, callback: onRestartAnswer };`, context);
  for (const [id, sourceName] of [[0x7ffe, 'character'], [0x7fff, 'map']] as const) {
    context.Packets.list[id] = {
      Struct: class FixturePacket { value: number; constructor(reader: { readUShort(): number }) { this.value = reader.readUShort(); } },
      callback: (packet: { value: number }) => decoded.push({ source: sourceName, value: packet.value }),
    };
  }
  async function connect(isZone = true) {
    const complete = vi.fn();
    context.connect('fixture.invalid', 1, complete, isZone);
    await microtasks();
    const socket = sockets.at(-1)!, transport = transports.at(-1)!;
    transport.open();
    await microtasks();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
    return { socket, transport, state: context.getReceiveState(socket) };
  }
  async function flushReceiveTimers(limit = 30) {
    let count = 0;
    while (receiveTimers.length) {
      if (++count > limit) throw new Error('Receive continuation did not finish within the fixture timer limit');
      const callback = receiveTimers.shift()!;
      try { callback(); } catch (error) { timerErrors.push(error); }
      await microtasks();
    }
    return count;
  }
  return {
    context, timeline, transports, sockets, reported, messages, decoded, charInit, background, packetCrypt,
    receiveTimers, timerErrors, connect, flushReceiveTimers,
    cleanup() { for (const socket of sockets) socket.close(); },
  };
}
function fixture(source = patched) {
  const value = runtime(source);
  fixtures.push(value);
  return value;
}
function dataFrame(id: number, value: number) {
  const bytes = new Uint8Array(4), view = new DataView(bytes.buffer);
  view.setUint16(0, id, true); view.setUint16(2, value, true);
  return bytes;
}
function batchFrames(count: number, tail = new Uint8Array(0)) {
  const bytes = new Uint8Array(count * 4 + tail.length);
  for (let index = 0; index < count; index++) bytes.set(dataFrame(0x7fff, index), index * 4);
  bytes.set(tail, count * 4);
  return bytes;
}
const accepted = new Uint8Array([0xb3, 0, 1]);
const refused = new Uint8Array([0xb3, 0, 0]);

describe('character switch with the real native network lifecycle', () => {
  it('reproduces EOF reporting a disconnect before the native asynchronous character reload', async () => {
    const h = fixture(native), old = await h.connect();
    old.transport.push(accepted); old.transport.eof();
    await microtasks();
    expect(h.messages).toEqual(['Disconnected from Server.']);
    expect(h.timeline.indexOf('network.disconnect')).toBeLessThan(h.timeline.indexOf('background'));
    expect(h.charInit).toHaveBeenCalledOnce();
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(h.reported).toEqual([]);
  });

  it('detaches the accepted map connection before EOF without changing the character reload', async () => {
    const h = fixture(), old = await h.connect();
    old.transport.push(accepted); old.transport.eof();
    await microtasks();
    expect(h.messages).toEqual([]);
    expect(h.context.console.warn).not.toHaveBeenCalled();
    expect(h.timeline.indexOf('transport.close')).toBeLessThan(h.timeline.indexOf('game.cleanup'));
    expect(h.charInit).toHaveBeenCalledOnce();
    expect(h.background).toHaveBeenCalledOnce();
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(old.state.closed).toBe(true);
    expect(h.context._socket).toBeNull();
    expect(h.context._sockets).toEqual([]);
    expect(h.packetCrypt.reset).toHaveBeenCalledOnce();
    expect(h.reported).toEqual([]);
  });

  it('keeps the map connection open when the server refuses returning to character selection', async () => {
    const h = fixture(), old = await h.connect();
    old.transport.push(refused);
    await microtasks();
    expect(old.socket.connected).toBe(true);
    expect(h.context._socket).toBe(old.socket);
    expect(old.transport.close).not.toHaveBeenCalled();
    expect(h.context.ChatBox_default.addText).toHaveBeenCalledOnce();
    expect(h.charInit).not.toHaveBeenCalled();
    old.transport.eof();
    await microtasks();
    expect(h.messages).toEqual(['Disconnected from Server.']);
  });

  it.each(['map', 'character'] as const)('still reports an unexpected disconnect from the new %s connection', async kind => {
    const h = fixture(), old = await h.connect();
    old.transport.push(accepted); old.transport.eof();
    await microtasks();
    const next = await h.connect(kind === 'map');
    next.transport.eof();
    await microtasks();
    expect(h.messages).toEqual(['Disconnected from Server.']);
    expect(next.transport.close).toHaveBeenCalledOnce();
    expect(old.transport.close).toHaveBeenCalledOnce();
  });

  it('makes repeated intentional closes harmless after a successful switch', async () => {
    const h = fixture(), old = await h.connect();
    old.transport.push(accepted);
    await microtasks();
    h.context.close(); h.context.close(); old.socket.close();
    old.transport.closeGate.resolve();
    await microtasks();
    expect(h.messages).toEqual([]);
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(h.charInit).toHaveBeenCalledOnce();
    expect(h.packetCrypt.reset).toHaveBeenCalledOnce();
  });

  it('handles repeated switches and late old-socket close events without disconnecting the replacement', async () => {
    const h = fixture();
    let current = await h.connect();
    for (let index = 0; index < 4; index++) {
      const old = current;
      old.transport.push(accepted); old.transport.eof();
      await microtasks();
      current = await h.connect();
      old.transport.closeGate.resolve();
      await microtasks();
      expect(h.context._socket).toBe(current.socket);
      expect(current.socket.connected).toBe(true);
      expect(h.context._sockets).toEqual([current.socket]);
      expect(old.transport.close).toHaveBeenCalledOnce();
      expect(h.messages).toEqual([]);
    }
    expect(h.charInit).toHaveBeenCalledTimes(4);
    expect(h.packetCrypt.reset).toHaveBeenCalledTimes(4);
    expect(h.reported).toEqual([]);
  });

  it('reproduces native ping cleanup removing the new socket after a synchronous old close callback', async () => {
    const h = fixture(native), old = await h.connect(false), next = await h.connect();
    expect(h.context._sockets).toEqual([old.socket, next.socket]);
    h.context.setPing(() => {});
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(next.transport.close).not.toHaveBeenCalled();
    expect(h.context._socket).toBe(next.socket);
    expect(h.context._sockets).toEqual([]);
    expect(h.messages).toEqual([]);
  });

  it.each([1, 3])('closes all %s superseded connections during ping setup while retaining the current map socket', async count => {
    const h = fixture(), old = [];
    for (let index = 0; index < count; index++) old.push(await h.connect(index % 2 === 0));
    const next = await h.connect();
    h.context.setPing(() => {});
    expect(h.context._sockets).toEqual([next.socket]);
    expect(h.context._socket).toBe(next.socket);
    expect(next.transport.close).not.toHaveBeenCalled();
    for (const previous of old) {
      expect(previous.transport.close).toHaveBeenCalledOnce();
      expect(previous.socket.connected).toBe(false);
      expect(previous.state.closed).toBe(true);
      previous.transport.closeGate.resolve();
      h.context.onClose$9.call(previous.socket, new Error('Late old close'));
    }
    await microtasks();
    expect(h.context._sockets).toEqual([next.socket]);
    expect(next.socket.connected).toBe(true);
    expect(h.messages).toEqual([]);
    expect(h.reported).toEqual([]);
  });

  it('retains the current connection when obsolete sockets deliver close callbacks asynchronously', async () => {
    const h = fixture(), old = [await h.connect(false), await h.connect()], next = await h.connect();
    const delayed: Array<() => void> = [];
    for (const previous of old) {
      const close = previous.socket.close.bind(previous.socket);
      previous.socket.close = vi.fn(() => { delayed.push(close); });
    }
    h.context.setPing(() => {});
    expect(h.context._sockets).toEqual([next.socket]);
    expect(delayed).toHaveLength(2);
    for (const previous of old) expect(previous.state.closed).toBe(true);
    for (const callback of delayed) callback();
    await microtasks();
    for (const previous of old) expect(previous.transport.close).toHaveBeenCalledOnce();
    expect(h.context._sockets).toEqual([next.socket]);
    expect(next.socket.connected).toBe(true);
    expect(h.messages).toEqual([]);
  });

  it('isolates partial frames and native one-shot readers between old map, character and replacement map sockets', async () => {
    const h = fixture(), old = await h.connect();
    const oldReader = vi.fn();
    old.transport.push(dataFrame(0x7fff, 11).subarray(0, 3));
    await microtasks();
    expect(new Uint8Array(old.state.saveBuffer)).toEqual(dataFrame(0x7fff, 11).subarray(0, 3));
    h.context.read$1(oldReader);
    h.context.onRestartAnswer({ type: 1 });
    await microtasks();
    expect(old.state.saveBuffer).toBeNull();
    expect(old.state.readCallback).toBeNull();
    const character = await h.connect(false);
    const characterReader = vi.fn((reader: { readULong(): number }) => expect(reader.readULong()).toBe(42));
    h.context.read$1(characterReader);
    character.transport.push(new Uint8Array([42, 0, 0, 0, ...dataFrame(0x7ffe, 22)]));
    await microtasks();
    expect(characterReader).toHaveBeenCalledOnce();
    expect(oldReader).not.toHaveBeenCalled();
    expect(h.decoded).toEqual([{ source: 'character', value: 22 }]);
    const replacement = await h.connect();
    h.context.setPing(() => {});
    expect(character.state.closed).toBe(true);
    const mapReader = vi.fn((reader: { readULong(): number }) => expect(reader.readULong()).toBe(99));
    h.context.read$1(mapReader);
    h.context.receive.call(old.socket, dataFrame(0x7fff, 88));
    h.context.receive.call(character.socket, dataFrame(0x7ffe, 33));
    old.transport.closeGate.resolve(); character.transport.closeGate.resolve();
    replacement.transport.push(new Uint8Array([99, 0, 0, 0, ...dataFrame(0x7fff, 44)]));
    await microtasks();
    expect(mapReader).toHaveBeenCalledOnce();
    expect(characterReader).toHaveBeenCalledOnce();
    expect(oldReader).not.toHaveBeenCalled();
    expect(h.decoded).toEqual([
      { source: 'character', value: 22 }, { source: 'map', value: 44 },
    ]);
    expect(h.messages).toEqual([]);
    expect(h.context._socket).toBe(replacement.socket);
    expect(replacement.state.closed).toBe(false);
    expect(h.reported).toEqual([]);
  });
});

describe('character-switch patch anchors', () => {
  it('preserves unrelated sources and the native disconnect callback', () => {
    const unrelated = 'export const unchanged = true;';
    expect(patchRuntimeCharacterSwitch(unrelated)).toBe(unrelated);
    expect(patchRuntimeNetworkHandoffCleanup(unrelated)).toBe(unrelated);
    expect(patchRuntimeNetworkCloseDrain(unrelated)).toBe(unrelated);
    expect(declarations(region('src/Network/NetworkManager.js', switchPatched), ['onClose$9']))
      .toBe(declarations(region('src/Network/NetworkManager.js', native), ['onClose$9']));
  });

  it('refuses an upstream ACK condition change and reordered native cleanup', () => {
    const answer = declarations(region('src/Engine/MapEngine.js', native), ['onRestartAnswer']);
    expect(patchRuntimeCharacterSwitch.bind(null, native.replace(answer, answer.replace('!pkt.type', 'pkt.type === 0'))))
      .toThrow('anchor:character-switch:');
    const reordered = answer.replace(/MapRenderer\.free\(\);\s+Renderer\.stop\(\);/, 'Renderer.stop();\n    MapRenderer.free();');
    expect(reordered).not.toBe(answer);
    expect(patchRuntimeCharacterSwitch.bind(null, native.replace(answer, reordered)))
      .toThrow('anchor:character-switch:');
  });

  it('refuses duplicate application, ambiguous regions and changed handoff conditions', () => {
    expect(() => patchRuntimeCharacterSwitch(patched)).toThrow('anchor:character-switch:');
    expect(() => patchRuntimeNetworkHandoffCleanup(patched)).toThrow('anchor:character-switch:');
    expect(() => patchRuntimeCharacterSwitch(native + region('src/Engine/MapEngine.js'))).toThrow('anchor:character-switch:');
    expect(() => patchRuntimeNetworkHandoffCleanup(native + region('src/Network/NetworkManager.js'))).toThrow('anchor:character-switch:');
    const ping = declarations(region('src/Network/NetworkManager.js', native), ['setPing']);
    const changed = ping.replace('_socket !== _sockets[0]', '_socket === _sockets[0]');
    expect(changed).not.toBe(ping);
    expect(() => patchRuntimeNetworkHandoffCleanup(native.replace(ping, changed))).toThrow('anchor:character-switch:');
  });

  it('refuses ambiguous close regions, changed native disconnect conditions and repeated drain patches', () => {
    expect(() => patchRuntimeNetworkCloseDrain(patched)).toThrow('anchor:network-close-drain:');
    expect(() => patchRuntimeNetworkCloseDrain(native + region('src/Network/NetworkManager.js'))).toThrow('anchor:network-close-drain:');
    const close = declarations(region('src/Network/NetworkManager.js', native), ['onClose$9']);
    const changed = close.replace('this === _socket && !this.handoffPending', 'this === _socket || !this.handoffPending');
    expect(changed).not.toBe(close);
    expect(() => patchRuntimeNetworkCloseDrain(native.replace(close, changed))).toThrow('anchor:network-close-drain:');
    expect(() => patchRuntimeNetworkCloseDrain(native.replace('function onClose$9(event)', 'function onClose$9(event, ignored)')))
      .toThrow('anchor:network-close-drain:');
  });
});

describe('EOF draining the actual native receive continuations', () => {
  it.each([32, 96])('finishes all %s frames and the accepted restart ACK before the final close callback', async count => {
    const h = fixture(), old = await h.connect();
    old.transport.push(batchFrames(count, accepted)); old.transport.eof();
    await microtasks();
    expect(h.decoded).toHaveLength(32);
    expect(old.state.yieldPending).toBe(true);
    expect(old.state.closed).toBe(false);
    expect(h.charInit).not.toHaveBeenCalled();
    expect(h.messages).toEqual([]);
    const timerCount = await h.flushReceiveTimers();
    expect(timerCount).toBeGreaterThan(0);
    expect(timerCount).toBeLessThan(10);
    expect(h.decoded.map(packet => packet.value)).toEqual(Array.from({ length: count }, (_, index) => index));
    expect(h.charInit).toHaveBeenCalledOnce();
    expect(h.background).toHaveBeenCalledOnce();
    expect(h.messages).toEqual([]);
    expect(h.context.console.warn).not.toHaveBeenCalled();
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(old.state.closed).toBe(true);
    expect(old.state.saveBuffer).toBeNull();
    expect(h.context._socket).toBeNull();
    expect(h.context._sockets).toEqual([]);
    expect(h.timerErrors).toEqual([]);
    expect(h.reported).toEqual([]);
  });

  it('still reports one real EOF after draining a batch without a restart ACK', async () => {
    const h = fixture(), old = await h.connect();
    old.transport.push(batchFrames(96)); old.transport.eof();
    await microtasks();
    expect(h.messages).toEqual([]);
    await h.flushReceiveTimers();
    expect(h.decoded).toHaveLength(96);
    expect(h.messages).toEqual(['Disconnected from Server.']);
    expect(h.context.console.warn).toHaveBeenCalledOnce();
    expect(h.charInit).not.toHaveBeenCalled();
    expect(old.state.closed).toBe(true);
    expect(old.state.saveBuffer).toBeNull();
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(h.timerErrors).toEqual([]);
    expect(h.reported).toEqual([]);
  });

  it.each(['unknown', 'decoder-throw'] as const)('reports real EOF once even when the pending batch contains an %s frame', async mode => {
    const h = fixture(), old = await h.connect();
    const id = mode === 'unknown' ? 0x7ffd : 0x7ffc;
    if (mode === 'decoder-throw') {
      h.context.Packets.list[id] = {
        Struct: class BrokenFixtureDecoder { constructor() { throw new Error('Fixture decoder failed'); } },
        callback: vi.fn(),
      };
    }
    old.transport.push(batchFrames(32, dataFrame(id, 42))); old.transport.eof();
    await microtasks();
    await h.flushReceiveTimers();
    expect(h.decoded).toHaveLength(32);
    expect(h.messages).toEqual(['Disconnected from Server.']);
    expect(h.context.console.warn).toHaveBeenCalledOnce();
    expect(h.charInit).not.toHaveBeenCalled();
    expect(old.state.closed).toBe(true);
    expect(old.state.saveBuffer).toBeNull();
    expect(old.transport.close).toHaveBeenCalledOnce();
    if (mode === 'decoder-throw') expect(h.timerErrors).toHaveLength(1);
    else expect(h.timerErrors).toEqual([]);
    expect(h.reported).toEqual([]);
  });

  it.each([0, 32])('discards a final half packet after %s complete frames without attempting its decoder', async count => {
    const h = fixture(), old = await h.connect();
    const partialDecoder = vi.fn();
    h.context.Packets.list[0x7ffd] = { Struct: partialDecoder, callback: vi.fn() };
    old.transport.push(batchFrames(count, dataFrame(0x7ffd, 42).subarray(0, 3))); old.transport.eof();
    await microtasks();
    await h.flushReceiveTimers();
    expect(h.decoded).toHaveLength(count);
    expect(partialDecoder).not.toHaveBeenCalled();
    expect(h.messages).toEqual(['Disconnected from Server.']);
    expect(h.charInit).not.toHaveBeenCalled();
    expect(old.state.closed).toBe(true);
    expect(old.state.saveBuffer).toBeNull();
    expect(h.timerErrors).toEqual([]);
    expect(h.reported).toEqual([]);
  });

  it('deduplicates pending EOF callbacks and permits an intentional cancel before the next receive continuation', async () => {
    const h = fixture(), old = await h.connect();
    const clear = vi.fn(h.context.clearReceiveState);
    h.context.clearReceiveState = clear;
    old.transport.push(batchFrames(96, accepted)); old.transport.eof();
    await microtasks();
    expect(h.decoded).toHaveLength(32);
    expect(h.receiveTimers).toHaveLength(2);
    h.context.onClose$9.call(old.socket, new Error('Repeated EOF notification'));
    expect(h.receiveTimers).toHaveLength(2);
    expect(clear).not.toHaveBeenCalled();
    h.context.close(); h.context.close();
    expect(clear).toHaveBeenCalledOnce();
    await h.flushReceiveTimers();
    old.transport.closeGate.resolve();
    await microtasks();
    expect(clear).toHaveBeenCalledOnce();
    expect(h.decoded).toHaveLength(32);
    expect(h.charInit).not.toHaveBeenCalled();
    expect(h.messages).toEqual([]);
    expect(old.state.closed).toBe(true);
    expect(old.state.saveBuffer).toBeNull();
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(h.context._socket).toBeNull();
    expect(h.context._sockets).toEqual([]);
    expect(h.timerErrors).toEqual([]);
    expect(h.reported).toEqual([]);
  });

  it.each(['before', 'after'] as const)('immediately discards the old pending batch when it closes %s the replacement opens', async timing => {
    const h = fixture(), old = await h.connect();
    old.transport.push(batchFrames(96, accepted));
    await microtasks();
    expect(h.decoded).toHaveLength(32);
    expect(old.state.yieldPending).toBe(true);
    const complete = vi.fn();
    h.context.connect('fixture.invalid', 1, complete, true);
    await microtasks();
    const nextSocket = h.sockets.at(-1)!, nextTransport = h.transports.at(-1)!;
    if (timing === 'after') { nextTransport.open(); await microtasks(); }
    old.transport.eof();
    await microtasks();
    expect(old.state.closed).toBe(true);
    expect(old.state.saveBuffer).toBeNull();
    expect(h.receiveTimers).toHaveLength(1);
    if (timing === 'before') { nextTransport.open(); await microtasks(); }
    await h.flushReceiveTimers();
    nextTransport.push(dataFrame(0x7fff, 444));
    await microtasks();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.charInit).not.toHaveBeenCalled();
    expect(h.decoded).toHaveLength(33);
    expect(h.decoded.at(-1)).toEqual({ source: 'map', value: 444 });
    expect(h.context._socket).toBe(nextSocket);
    expect(h.context._sockets).toEqual([nextSocket]);
    expect(nextSocket.connected).toBe(true);
    expect(nextTransport.close).not.toHaveBeenCalled();
    expect(old.transport.close).toHaveBeenCalledOnce();
    expect(h.messages).toEqual([]);
    expect(h.timerErrors).toEqual([]);
    expect(h.reported).toEqual([]);
  });
});
