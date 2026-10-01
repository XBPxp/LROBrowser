// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { patchRuntimeAutolootSettings } from '../scripts/lastro-autoloot-settings.mjs';
// @ts-expect-error The native migration helpers have no declaration file.
import * as migration from '../vendor/v2/lastro-v1-migration.mjs';

const vendor = readFileSync('vendor/v2/Online.js', 'utf8');
const native = patchRuntimeAutolootSettings(vendor);
const marker = '//#region src/UI/Components/LastROTools/LastROTools.js';
const from = native.indexOf(marker), to = native.indexOf('//#endregion', from);
const file = ts.createSourceFile('LastROTools.js', native.slice(from, to), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const assignments = new Map<string, string>();
function collect(node: ts.Node) {
  if (ts.isBinaryExpression(node) && !assignments.has(node.left.getText(file))) assignments.set(node.left.getText(file), node.right.getText(file));
  ts.forEachChild(node, collect);
}
collect(file);
function assigned(name: string) {
  const value = assignments.get(name);
  if (!value) throw new Error('Missing native assignment: ' + name);
  return value;
}
const template = runInNewContext(assigned('LastROTools_default$1')) as string;

class PacketWriter {
  bytes: Uint8Array;
  private offset = 0;
  private view: DataView;
  constructor(length: number) { this.bytes = new Uint8Array(length); this.view = new DataView(this.bytes.buffer); }
  writeShort(value: number) { this.view.setUint16(this.offset, value, true); this.offset += 2; }
  writeUChar(value: number) { this.view.setUint8(this.offset++, value); }
  writeLong(value: number) { this.view.setInt32(this.offset, value, true); this.offset += 4; }
}
interface Packet { id: number; value: number; build(): PacketWriter; }
interface Tools {
  _settingState: Record<string, unknown>;
  init(): void;
  applyState(state: Record<string, unknown>): void;
  setReloadInfo(packet: { id: number; value: number }): void;
  setLoadInfo(packet: Record<string, unknown>): void;
  updateField(field: string, input: HTMLInputElement): void;
}
afterEach(() => document.body.replaceChildren());
function fixture() {
  const sent: Packet[] = [];
  const packetStart = vendor.indexOf('  PACKET.CZ.NOTIFY_UPDATEINFO = function');
  const packetEnd = vendor.indexOf('  PACKET.CZ.NOTIFY_ONLYTARGET =', packetStart);
  const PACKET = runInNewContext(vendor.slice(packetStart, packetEnd) + '\nPACKET;', { PACKET: { CZ: {} }, BinaryWriter: PacketWriter });
  const host = document.createElement('div'), root = host.attachShadow({ mode: 'open' });
  function render() {
    const container = document.createElement('div'); container.innerHTML = template; root.replaceChildren(container);
  }
  render(); document.body.append(host);
  const tools = {
    _host: host, getRoot: () => root, populateSkillSelects() {}, populateItemSelects() {},
    loadQuickRoutes() {}, ensurePanelOpener: () => null, setStatus() {}, renderCompactStatus() {},
  } as unknown as Tools;
  const context = {
    ...migration, document, PACKET, Network: { sendPacket: (packet: Packet) => sent.push(packet) },
    Configs: { get: (key: string, fallback?: unknown) => key === 'lastroNid' ? 5 : fallback },
    OPTION_TO_PACKET_ID: runInNewContext(assigned('OPTION_TO_PACKET_ID')),
    SCALAR_FIELD_BY_ID: Object.fromEntries(Object.entries(migration.AUTO_BATTLE_SCALAR_IDS).map(([key, value]) => [String(value), key])),
    installLastRORandomTeleportShortcut() {}, showLastROSettingsView() {}, showLastROMainView() {}, activateLastROSettingsTab() {},
  };
  for (const name of ['init', 'updateField', 'setReloadInfo', 'setLoadInfo', 'applyState', 'setAutomationOption', 'getOptionLabel']) {
    Object.assign(tools, { [name]: runInNewContext(`(${assigned('LastROTools.' + name)})`, context) });
  }
  tools.init();
  const field = (name: string) => root.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!;
  const option = (name: string) => root.querySelector<HTMLInputElement>(`[data-option="${name}"]`)!;
  return { tools, sent, field, option, root, render };
}
function commit(input: HTMLInputElement, value: string) {
  input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('native autoloot drop-rate setting', () => {
  it('sends 50% once on native change and preserves it across unrelated server pushes', () => {
    const f = fixture(), input = f.field('autoloot');
    input.value = '50'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(f.sent).toEqual([]);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ id: 20, value: 5000 });
    expect([...f.sent[0]!.build().bytes]).toEqual([0xfe, 0x0a, 20, 0x88, 0x13, 0, 0]);
    expect(f.tools._settingState.autoloot).toBe(5000);
    f.tools.setReloadInfo({ id: 35, value: 0 });
    expect(input.value).toBe('50'); expect(f.option('autoLoot').checked).toBe(true);
    expect(f.sent).toHaveLength(1);
    f.tools.setReloadInfo({ id: 20, value: 4000 });
    expect(input.value).toBe('40'); expect(f.tools._settingState.autoloot).toBe(4000);
    expect(f.sent).toHaveLength(1);
  });

  it.each([['0', 0], ['0.1', 10], ['100', 10000]])('retains native conversion and display for %s%%', (percent, wire) => {
    const f = fixture(); commit(f.field('autoloot'), percent);
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ id: 20, value: wire });
    expect(f.tools._settingState.autoloot).toBe(wire);
    f.tools.applyState({}); expect(f.field('autoloot').value).toBe(percent);
    f.tools.setReloadInfo({ id: 20, value: wire }); expect(f.field('autoloot').value).toBe(percent);
    const bytes = new DataView(f.sent[0]!.build().bytes.buffer);
    expect(bytes.getUint16(0, true)).toBe(0x0afe); expect(bytes.getUint8(2)).toBe(20); expect(bytes.getInt32(3, true)).toBe(wire);
  });

  it('keeps unrelated field units and the native auto-loot toggle packet unchanged', () => {
    const f = fixture(); commit(f.field('autoloot'), '50'); commit(f.field('pmdis'), '7');
    expect(f.tools._settingState.pmdis).toBe('7'); expect(f.sent[1]).toMatchObject({ id: 1, value: 7 });
    f.field('AutoSeeBoss').click();
    expect(f.tools._settingState.AutoSeeBoss).toBe(true); expect(f.sent[2]).toMatchObject({ id: 5, value: 1 });
    f.option('autoLoot').click();
    expect(f.sent).toHaveLength(4); expect(f.sent[3]).toMatchObject({ id: 35, value: 1 });
    expect([...f.sent[3]!.build().bytes]).toEqual([0xfe, 0x0a, 35, 1, 0, 0, 0]);
    f.tools.setReloadInfo({ id: 35, value: 0 });
    expect(f.field('autoloot').value).toBe('50'); expect(f.field('pmdis').value).toBe('7');
    expect(f.field('AutoSeeBoss').checked).toBe(true); expect(f.sent).toHaveLength(4);
  });

  it('keeps the drop-rate cache and passive server units when the window is rebuilt', () => {
    const f = fixture(); commit(f.field('autoloot'), '50');
    const state = { ...f.tools._settingState };
    f.render(); f.tools.init(); f.tools.applyState(state);
    expect(f.field('autoloot').value).toBe('50'); expect(f.tools._settingState.autoloot).toBe(5000);
    expect(f.sent).toHaveLength(1);
    f.tools.setLoadInfo({ autoloot: 10, startAutoLoot: 0 });
    expect(f.field('autoloot').value).toBe('0.1'); expect(f.option('autoLoot').checked).toBe(true);
    expect(f.sent).toHaveLength(1);
  });

  it('renders the requested compact pickup wording without changing the input range', () => {
    const f = fixture(), panel = f.root.querySelector('[data-tab-panel="pick"]')!;
    expect(panel.querySelector('label')!.textContent).toBe('拾取概率：自动拾取概率为 %以下的物品。');
    expect(panel.querySelector('.lastro-group-title,.lastro-help')).toBeNull();
    expect(f.root.querySelectorAll('[data-option="autoLoot"]')).toHaveLength(1);
    expect(f.field('autoloot').min).toBe('0'); expect(f.field('autoloot').max).toBe('100'); expect(f.field('autoloot').step).toBe('0.1');
  });

  it('preserves unrelated minimal fixtures and rejects changed component anchors', () => {
    expect(patchRuntimeAutolootSettings('var LastROTools = {};')).toBe('var LastROTools = {};');
    expect(() => patchRuntimeAutolootSettings(vendor.replace('Boolean(input.checked) : input.value', 'input.checked : input.value'))).toThrow('anchor:autoloot-settings:cache-units');
    expect(() => patchRuntimeAutolootSettings(vendor.replace('输入百分比，发送时自动转换为万分比，例如 0.1% = 10。', 'New upstream help'))).toThrow('anchor:autoloot-settings:label');
  });
});
