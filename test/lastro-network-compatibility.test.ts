import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { patchRuntimeLastROItemLayouts } from '../scripts/lastro-network-security.mjs';
import { patchRuntimeNetworkFramingRecovery } from '../scripts/lastro-network-receive-recovery.mjs';
// @ts-expect-error The reviewed vendored protocol module has no declaration file.
import * as nativeFraming from '../vendor/v2/lastro-packet-framing.mjs';
// @ts-expect-error The reviewed vendored card module has no declaration file.
import * as nativeCards from '../vendor/v2/lastro-card-collection.mjs';
// @ts-expect-error The reviewed vendored observer module has no declaration file.
import { isObserverMode, runObserverPacketHandler } from '../vendor/v2/lastro-observer-mode.mjs';
const {
  getLastROPacketLengthOverrides,
  LASTRO_PACKET_BATCH_MARKER, LASTRO_PACKET_CONTROL_MARKER,
  LASTRO_PACKET_STREAM_MARKER, LASTRO_PACKET_STREAM_MARKER_ALT, LASTRO_PACKET_STREAM_MARKER_VARIANTS,
  parseLastROFrameHeader,
} = nativeFraming;
const {
  CARD_CONNECTION_PACKET_IDS,
  getCardConnectionRechargeListFrameDisposition,
  getCardConnectionRechargeListValueSize,
} = nativeCards;

const native = readFileSync('vendor/v2/Online.js', 'utf8');
const patched = patchRuntimeLastROItemLayouts(native);
function region(source: string, name: string): string {
  const marker = '//#region ' + name;
  const start = source.indexOf(marker), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error('missing native module: ' + name);
  return source.slice(start, end);
}

function runtime(source = patched, packetver = 20211103, lastro = true) {
  const errors = vi.fn();
  const context = vm.createContext({
    ArrayBuffer, Uint8Array, DataView, Int8Array, Int32Array, Float32Array, Math, Number,
    RangeError, TypeError, Error, SEEK_SET: 2, SEEK_CUR: 1,
    window: {}, console: { log: vi.fn(), warn: vi.fn(), error: errors },
    CodepageManager: { decode: (bytes: Uint8Array) => new TextDecoder().decode(bytes) },
    __esmMin: (callback: () => void) => {
      let initialized = false;
      return () => { if (!initialized) { initialized = true; callback(); } };
    },
    __exportAll: (entries: Record<string, () => unknown>) => Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value()])),
    init_CodepageManager() {}, init_BinaryWriter() {}, init_PacketVerManager() {}, init_Configs() {},
    PacketVerManager_default: { value: packetver },
    Configs: { get: (key: string) => key === 'renewal' || (lastro && (key === 'lastroProtocol' || key === 'lastroCustomPackets')) },
    getLastROPacketLengthOverrides, CARD_CONNECTION_PACKET_IDS, getCardConnectionRechargeListFrameDisposition,
    getCardConnectionRechargeListValueSize, parseLastROFrameHeader, isObserverMode, runObserverPacketHandler,
  });
  for (const name of [
    'src/Utils/Struct.js', 'src/Utils/BinaryReader.js', 'src/Network/PacketStructure.js',
    'src/Network/PacketRegister.js', 'src/Network/Packets/packets2021_len_main.js', 'src/Network/PacketLength.js',
  ]) vm.runInContext(region(source, name), context);
  context.init_BinaryReader(); context.init_PacketRegister(); context.init_packets2021_len_main();
  context.packetModules = { './Packets/packets2021_len_main.js': { init: context.init$19 } };
  // Use the actual date-selected length table and actual LastRO overrides.
  context.init$14(20211103);
  const decoded: Array<{ id: number; packet: Record<string, unknown> }> = [];
  const scheduled: Array<() => void> = [];
  const socket = { close: vi.fn() };
  const packetList: Record<number, { Struct: unknown; callback: (packet: Record<string, unknown>) => void }> = {};
  for (const [key, Struct] of Object.entries(context.PacketRegister)) {
    const id = Number(key);
    packetList[id] = { Struct, callback: packet => decoded.push({ id, packet }) };
  }
  Object.assign(context, {
    _receiveStates: new WeakMap(), _socket: socket, _save_buffer: null, _receive_yield_pending: false,
    read$1: {}, packetDump: false, Packets: { list: packetList },
    PacketLength_default: { getPacketLength: context.getPacketLength }, setTimeout: (callback: () => void) => scheduled.push(callback),
  });
  const file = ts.createSourceFile('NetworkManager.js', region(source, 'src/Network/NetworkManager.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Set(['createReceiveState', 'getReceiveState', 'clearReceiveState', 'receive']);
  vm.runInContext(file.statements.filter(node => ts.isFunctionDeclaration(node) && functions.has(node.name?.text ?? '')).map(node => node.getText(file)).join('\n'), context);
  const state = context.getReceiveState(socket);
  return { context, socket, state, decoded, errors, scheduled, send: (bytes: Uint8Array) => context.receive.call(socket, bytes) };
}

function frame(id: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  new DataView(bytes.buffer).setUint16(0, id, true);
  return bytes;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function decode(h: ReturnType<typeof runtime>, id: number, bytes: Uint8Array) {
  const reader = new h.context.BinaryReader(bytes.buffer);
  reader.seek(2);
  const packet = new h.context.PacketRegister[id](reader, bytes.length);
  return { packet: JSON.parse(JSON.stringify(packet)), offset: reader.tell() };
}

const legacyItemLayouts = [
  [0x084b, 19, 21], [0x09f7, 75, 77], [0x0a05, 53, 63],
  [0x0a0a, 47, 57], [0x0a0b, 47, 57], [0x0a37, 59, 69],
] as const;

describe('real native LastRO network compatibility', () => {
  it.each(legacyItemLayouts)('decodes the published legacy layout for opcode %s under the configured newer client date', (id, legacyLength) => {
    const bytes = frame(id, legacyLength);
    for (let index = 2; index < bytes.length; index++) bytes[index] = (index * 13 + 7) & 255;
    // The unmodified older-date native constructor is the protocol reference.
    const reference = decode(runtime(native, 20180101), id, bytes);
    expect(reference.offset).toBe(legacyLength);
    expect(() => decode(runtime(native), id, bytes)).toThrow(RangeError);
    const h = runtime();
    expect(h.context.getPacketLength(id)).toBe(legacyLength);
    expect(decode(h, id, bytes)).toEqual(reference);
    h.send(join(frame(0x0073, 11), bytes, frame(0x0073, 11)));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0073, id, 0x0073]);
    expect(JSON.parse(JSON.stringify(h.decoded[1]!.packet))).toEqual(reference.packet);
    expect(h.socket.close).not.toHaveBeenCalled();
  });

  it.each(legacyItemLayouts)('retains the native newer-width constructor layout for opcode %s', (id, _legacyLength, modernLength) => {
    const bytes = frame(id, modernLength);
    for (let index = 2; index < bytes.length; index++) bytes[index] = (index * 11 + 3) & 255;
    const reference = decode(runtime(native), id, bytes);
    expect(reference.offset).toBe(modernLength);
    expect(decode(runtime(), id, bytes)).toEqual(reference);
    expect(decode(runtime(patched, 20211103, false), id, bytes)).toEqual(reference);
  });

  it('preserves the existing captured 17-byte ground-item fields and reads no bytes from the following marker', () => {
    const h = runtime();
    const captured = new Uint8Array([
      0x9d, 0x00, 0x40, 0x47, 0x00, 0x00, 0x82, 0x64, 0x00, 0x00, 0x01,
      0xeb, 0x00, 0xfb, 0x00, 0x01, 0x00,
    ]);
    h.send(join(captured, new Uint8Array([0x09, 0x09]), frame(0x0073, 11)));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x009d, 0x0073]);
    expect(h.decoded[0]!.packet).toEqual({ ITAID: 18240, ITID: 25730, IsIdentified: 1, xPos: 235, yPos: 251, count: 1, subX: 0, subY: 0 });
    expect(h.socket.close).not.toHaveBeenCalled();
  });

  it.each([0x09fd, 0x09fe, 0x09ff])('preserves native variable entity decoding for opcode %s across fragmented markers', id => {
    const h = runtime(), entity = frame(id, 114);
    new DataView(entity.buffer).setUint16(2, entity.length, true);
    h.send(new Uint8Array([0x03]));
    h.send(join(new Uint8Array([0x03]), entity.subarray(0, 2)));
    h.send(join(entity.subarray(2), frame(0x0073, 11)));
    expect(h.decoded.map(packet => packet.id)).toEqual([id, 0x0073]);
    expect(h.socket.close).not.toHaveBeenCalled(); expect(h.errors).not.toHaveBeenCalled();
  });

  it.each([
    { levels: [1, 10, 15, 23, 30, 30, 30, 26], width: 2 },
    { levels: [1, 11, 16, 22, 7, 9, 7, 12], width: 4 },
  ])('decodes the existing 2826-byte card-list fixture with $width-byte values alongside another packet', ({ levels, width }) => {
    // These level counts reproduce the two established card fixture layouts.
    const h = runtime(), card = frame(0x0ad6, 2826), view = new DataView(card.buffer);
    view.setUint16(2, card.length, true); card[4] = levels.length;
    let offset = 5;
    for (const count of levels) {
      card[offset++] = count; card[offset++] = 0;
      for (let level = 0; level < count; level++) {
        card[offset++] = 0;
        for (let slot = 0; slot < 8; slot++) {
          const value = slot === 0 && level === 0 ? 4040 : 0;
          if (width === 4) view.setUint32(offset, value, true);
          else view.setUint16(offset, value, true);
          offset += width;
        }
      }
    }
    expect(offset).toBe(card.length);
    h.send(join(frame(0x0073, 11), card.subarray(0, 264)));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0073]);
    h.send(join(card.subarray(264), frame(0x0ad5, 10)));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0073, 0x0ad6, 0x0ad5]);
    expect(h.decoded[1]!.packet.classNum).toBe(8);
    const classes = h.decoded[1]!.packet.classInfos as Array<{ level: number; data: Array<{ recharge0: number }> }>;
    expect(classes.map(info => info.level)).toEqual(levels);
    expect(classes.map(info => info.data[0]!.recharge0)).toEqual(Array.from({ length: 8 }, () => 4040));
    expect(h.socket.close).not.toHaveBeenCalled(); expect(h.errors).not.toHaveBeenCalled();
  });

  it('audits every registered fixed game decoder against the actual date-selected LastRO frame bounds', () => {
    const h = runtime(), failures: number[] = [];
    let checked = 0;
    for (const key of Object.keys(h.context.PacketRegister)) {
      const id = Number(key), length = h.context.getPacketLength(id);
      // Character creation parses a separate nested character-info schema.
      // The current audit covers each fixed game packet's own field decoder.
      if (id === 0x006d || id === 0x0b6f || !Number.isInteger(length) || length < 2 || length > 65535) continue;
      checked++;
      try { if (decode(h, id, frame(id, length)).offset > length) failures.push(id); }
      catch { failures.push(id); }
    }
    expect(checked).toBeGreaterThan(700);
    // Keep the unresolved baseline definition contradiction visible.
    expect(failures).toEqual([0x009e]);
  });

  it.each([
    0x0303, LASTRO_PACKET_BATCH_MARKER, LASTRO_PACKET_CONTROL_MARKER,
    LASTRO_PACKET_STREAM_MARKER, LASTRO_PACKET_STREAM_MARKER_ALT, ...LASTRO_PACKET_STREAM_MARKER_VARIANTS,
  ])('retains the defined LastRO marker %s even across one-byte TCP reads', marker => {
    const h = runtime();
    const bytes = join(new Uint8Array([marker & 255, marker >> 8]), frame(0x0073, 11), frame(0x0ad5, 10));
    for (const byte of bytes) h.send(new Uint8Array([byte]));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0073, 0x0ad5]);
    expect(h.socket.close).not.toHaveBeenCalled(); expect(h.errors).not.toHaveBeenCalled();
  });

  it('retains the native discard-current-chunk behavior for unconfirmed 0x0c0c and unknown opcodes', () => {
    for (const id of [0x0c0c, 0xffff]) {
      const h = runtime();
      h.send(join(new Uint8Array([id & 255, id >> 8]), frame(0x0073, 11)));
      expect(h.decoded).toEqual([]); expect(h.state.saveBuffer).toBeNull();
      h.send(frame(0x0073, 11));
      expect(h.decoded.map(packet => packet.id)).toEqual([0x0073]);
      expect(h.socket.close).not.toHaveBeenCalled(); expect(h.state.closed).toBe(false);
    }
  });

  it('discards a malformed variable frame without permanently disabling later TCP reads', () => {
    // NOTIFY_PLAYERCHAT is registered and variable-length; a declared length below four is invalid.
    const bad = frame(0x008e, 4);
    new DataView(bad.buffer).setUint16(2, 3, true);
    const baseline = runtime();
    baseline.send(join(bad, frame(0x0073, 11)));
    baseline.send(frame(0x0073, 11));
    expect(baseline.decoded).toEqual([]);
    expect(baseline.state.closed).toBe(true);

    const h = runtime(patchRuntimeNetworkFramingRecovery(patched));
    h.send(join(bad, frame(0x0073, 11)));
    expect(h.decoded).toEqual([]); // Never guess a packet boundary inside the bad chunk.
    expect(h.state.saveBuffer).toBeNull();
    expect(h.state.closed).toBe(false);
    h.send(frame(0x0073, 11));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0073]);
    expect(h.socket.close).not.toHaveBeenCalled();
    h.context.clearReceiveState(h.socket);
    h.send(frame(0x0073, 11));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0073]);
    expect(h.state.closed).toBe(true);
  });

  it('can receive subsequent valid frames after a registered opcode has no known frame length', () => {
    const h = runtime(patchRuntimeNetworkFramingRecovery(patched));
    // The fixture adds only the missing length contract; it still uses the real receiver.
    h.context.Packets.list[0x7ffe] = { Struct: vi.fn(), callback: vi.fn() };
    h.send(join(frame(0x7ffe, 2), frame(0x0073, 11)));
    expect(h.decoded).toEqual([]);
    expect(h.state.closed).toBe(false);
    h.send(frame(0x0073, 11));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0073]);
    expect(h.socket.close).not.toHaveBeenCalled();
  });

  it('keeps receive recovery restricted to the reviewed framing discard branch', () => {
    const source = patchRuntimeNetworkFramingRecovery(native);
    expect(source.replace(/\r\n/g, '\n').replace('if (state) state.saveBuffer = null;\n    else _save_buffer = null;',
      'if (state) clearReceiveState(ownerSocket);\n    else _save_buffer = null;')).toBe(native.replace(/\r\n/g, '\n'));
    expect(patchRuntimeNetworkFramingRecovery('const unrelated = true;')).toBe('const unrelated = true;');
    expect(() => patchRuntimeNetworkFramingRecovery(source)).toThrow('anchor:network-framing-recovery:receive-state');
  });

  it('decodes the actual character-to-map handoff and map-accept structures in one TCP chunk', () => {
    const h = runtime();
    const handoff = frame(0x0071, 28), view = new DataView(handoff.buffer);
    view.setUint32(2, 42, true); handoff.set(new TextEncoder().encode('prontera.gat'), 6);
    view.setUint32(22, 0x0100007f, true); view.setUint16(26, 26571, true);
    h.send(join(handoff, frame(0x0073, 11), frame(0x0ad5, 10)));
    expect(h.decoded.map(packet => packet.id)).toEqual([0x0071, 0x0073, 0x0ad5]);
    expect(h.decoded[0]!.packet).toEqual({ GID: 42, mapName: 'prontera.gat', addr: { ip: 0x0100007f, port: 26571 } });
    expect(h.socket.close).not.toHaveBeenCalled();
  });

  it('keeps the unresolved 0x009e protocol definition unchanged without inventing a layout', () => {
    // 0x009e has conflicting 17-byte length and 19-byte field definitions in
    // the baseline. No captured layout establishes which field must change.
    const baseline = runtime(native), h = runtime();
    expect(h.context.getPacketLength(0x009e)).toBe(baseline.context.getPacketLength(0x009e));
    expect(h.context.PacketRegister[0x009e].toString()).toBe(baseline.context.PacketRegister[0x009e].toString());
    expect(() => decode(h, 0x009e, frame(0x009e, 17))).toThrow(RangeError);
  });

  it('fails the patch if a reviewed item-width branch changes upstream', () => {
    expect(() => patchRuntimeLastROItemLayouts(native.replace('PACKET.ZC.ITEM_FALL_ENTRY2 = function PACKET_ZC_ITEM_FALL_ENTRY2', 'PACKET.ZC.ITEM_FALL_ENTRY2 = function PACKET_ZC_CHANGED_ITEM_FALL_ENTRY2'))).toThrow('anchor:network-security:item-layout');
  });
});
