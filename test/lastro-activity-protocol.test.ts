// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

type Packet = { mapname: string; x?: string | number; y?: string | number; type: number; itemid: number; build(): { buffer: ArrayBuffer } };
type Prompt = { yes: () => void; no: () => void };
type ChatLinks = { render(parent: HTMLElement, value: string): void; request(link: Element | null): boolean };

const runtimeSource = readFileSync('generated/runtime/Online.js', 'utf8');
const runtimeAst = ts.createSourceFile('Online.js', runtimeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const officialFixture = ts.createSourceFile('official-activity-chat.mjs', readFileSync('test/fixtures/lastro-official-activity-chat.mjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function fixtureSource(name: string) {
  for (const statement of officialFixture.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(officialFixture) === name && declaration.initializer && ts.isStringLiteral(declaration.initializer)) return declaration.initializer.text;
    }
  }
  throw new Error(`Missing inert official source ${name}`);
}
const officialActivityChatSource = fixtureSource('officialActivityChatSource');
const officialPrivateAirshipBuildSource = fixtureSource('officialPrivateAirshipBuildSource');
const migrationAst = ts.createSourceFile('lastro-v1-migration.mjs', readFileSync('vendor/v2/lastro-v1-migration.mjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const migrationNode = migrationAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildPrivateAirshipRequest');
if (!migrationNode || !ts.isFunctionDeclaration(migrationNode)) throw new Error('Missing native airship request helper');
const migrationBuilder = migrationNode.getText(migrationAst).replace(/^export\s+/, '');
let chatFactory = '', packetConstructor = '', packetBuilder = '';
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(runtimeAst) === 'LastROChatMapLinks') chatFactory = `const ${node.getText(runtimeAst)};`;
  if (ts.isBinaryExpression(node) && node.left.getText(runtimeAst) === 'PACKET.CZ.PRIVATE_AIRSHIP_REQUEST') packetConstructor = node.getText(runtimeAst) + ';';
  if (ts.isBinaryExpression(node) && node.left.getText(runtimeAst) === 'PACKET.CZ.PRIVATE_AIRSHIP_REQUEST.prototype.build') packetBuilder = node.getText(runtimeAst) + ';';
  ts.forEachChild(node, collect);
}
collect(runtimeAst);
if (!chatFactory || !packetConstructor || !packetBuilder || !migrationBuilder) throw new Error('Missing prepared activity protocol fixture');
const writerStart = runtimeSource.indexOf('//#region src/Utils/BinaryWriter.js');
const writerEnd = runtimeSource.indexOf('//#endregion', writerStart);
if (writerStart < 0 || writerEnd < 0) throw new Error('Missing native BinaryWriter fixture');
const packetRuntime = `
  const PACKET = { CZ: {} };
  function __esmMin(initialize) { return initialize; }
  function init_CodepageManager() {}
  ${runtimeSource.slice(writerStart, writerEnd)}
  init_BinaryWriter();
  ${packetConstructor}
  ${packetBuilder}
`;

afterEach(() => document.body.replaceChildren());

function officialActivity(dataMap: string) {
  const prompts: Prompt[] = [], packets: Packet[] = [], wires: Uint8Array[] = [];
  let click: (() => void) | undefined;
  const spans = {
    data: () => dataMap,
    on: (_event: string, callback: () => void) => { click = callback; return spans; },
    mousedown: () => spans,
  };
  const row = { css: () => row, html: () => row, find: () => spans };
  const content = { 0: { scrollHeight: 0 }, append: () => content, find: () => ({ length: 0 }) };
  const addText = runInNewContext(`${packetRuntime}
    const a = BinaryWriter, b = { value: 20211103 };
    PACKET.CZ.PRIVATE_AIRSHIP_REQUEST.prototype.build = (${officialPrivateAirshipBuildSource});
    const r = PACKET, x = { TYPE: {} };
    (${officialActivityChatSource});`, {
    h: () => row,
    u: { showPromptBox: (_text: string, _ok: string, _cancel: string, yes: () => void, no: () => void) => prompts.push({ yes, no }) },
    q: { sendPacket: (packet: Packet) => { packets.push(packet); wires.push(new Uint8Array(packet.build().buffer)); } },
  }) as (this: { ui: { find: () => typeof content } }, message: string, type: number, color: string) => void;
  addText.call({ ui: { find: () => content } }, '<span class="mapname">点击前往</span>', 0, 'red');
  if (!click) throw new Error('Official activity did not attach its click handler');
  click();
  return { prompts, packets, wires };
}

function patchedActivity(dataMap: string, currentMap = 'prontera.gat') {
  const prompts: Prompt[] = [], packets: Packet[] = [], wires: Uint8Array[] = [];
  const navigate = vi.fn();
  const links = runInNewContext(`${packetRuntime}
    ${migrationBuilder}
    ${chatFactory}
    LastROChatMapLinks;`, {
    document, crypto: globalThis.crypto, queueMicrotask, setLastROInnerHTML,
    MapRenderer: { currentMap, loading: false },
    normalizeLastROTeleportMap: (map: string) => map.trim().replace(/\.gat$/i, '').toLowerCase(),
    UIManager: { showPromptBox: (_message: string, _ok: string, _cancel: string, yes: () => void, no: () => void) => { prompts.push({ yes, no }); return {}; } },
    Network: { sendPacket: (packet: Packet) => { packets.push(packet); wires.push(new Uint8Array(packet.build().buffer)); } },
    init_Navigation: vi.fn(), Navigation_default: { navigateTo: navigate },
    init_SessionStorage: vi.fn(), init_Altitude: vi.fn(),
    SessionStorage_default: { Entity: { position: [100, 100] } }, Altitude: { width: 300, height: 300 },
    console: { warn: vi.fn() },
  }) as ChatLinks;
  const parent = document.createElement('div');
  document.body.append(parent);
  links.render(parent, `[随机事件] 10秒后召唤师将在依斯鲁得岛举办魔物派对(<span class="mapname" data-map="${dataMap}">点击前往</span>).`);
  return { links, parent, link: parent.querySelector('a.mapname'), prompts, packets, wires, navigate };
}

describe('official LastRO activity teleport protocol', () => {
  it.each(['izlude#150#150', 'izlude#150#150#', 'izlude#150#150#0', 'izlude#150#150#2#'])('matches the original activity packet for %s', dataMap => {
    const official = officialActivity(dataMap), patched = patchedActivity(dataMap);
    expect(patched.parent.textContent).toBe('[随机事件] 10秒后召唤师将在依斯鲁得岛举办魔物派对(传送到活动地点).');
    expect(patched.link).not.toBeNull();
    expect(patched.links.request(patched.link)).toBe(true);
    expect(official.prompts).toHaveLength(1); expect(patched.prompts).toHaveLength(1);
    expect(official.packets).toHaveLength(0); expect(patched.packets).toHaveLength(0);
    official.prompts[0]!.yes(); patched.prompts[0]!.yes();
    expect(patched.packets).toHaveLength(1);
    expect(patched.packets[0]).toMatchObject({ mapname: 'izlude', x: 150, y: 150, type: 1, itemid: 14527 });
    expect([...patched.wires[0]!]).toEqual([...official.wires[0]!]);
    const view = new DataView(patched.wires[0]!.buffer);
    expect(patched.wires[0]).toHaveLength(34);
    expect(view.getUint16(0, true)).toBe(2633);
    expect(view.getUint32(26, true)).toBe(1);
    expect(view.getUint32(30, true)).toBe(14527);
  });

  it.each(['prontera.gat', 'izlude.gat'])('uses the native map-only zero coordinates and confirms even on %s', currentMap => {
    const official = officialActivity('izlude'), patched = patchedActivity('izlude', currentMap);
    expect(patched.link).not.toBeNull();
    expect(patched.links.request(patched.link)).toBe(true);
    expect(patched.prompts).toHaveLength(1); expect(patched.packets).toHaveLength(0);
    official.prompts[0]!.yes(); patched.prompts[0]!.yes();
    expect(official.packets[0]!.x).toBeUndefined(); expect(official.packets[0]!.y).toBeUndefined();
    expect(patched.packets[0]).toMatchObject({ mapname: 'izlude', x: 0, y: 0, type: 1, itemid: 14527 });
    expect([...patched.wires[0]!]).toEqual([...official.wires[0]!]);
    expect(patched.navigate).not.toHaveBeenCalled();
  });

  it('keeps an explicit same-map zero coordinate destination on native walking', () => {
    const patched = patchedActivity('izlude#0#0', 'izlude.gat');
    expect(patched.links.request(patched.link)).toBe(true);
    expect(patched.navigate).toHaveBeenCalledWith(expect.objectContaining({ endMap: 'izlude', endX: 0, endY: 0 }));
    expect(patched.prompts).toHaveLength(0); expect(patched.packets).toHaveLength(0);
  });

  it.each(['izlude#150', 'izlude#150#', 'izlude#150#150#bad', 'izlude#-1#150', 'izlude#65536#150'])('continues to reject damaged destinations: %s', dataMap => {
    const patched = patchedActivity(dataMap);
    expect(patched.parent.textContent).toContain('[活动链接格式未识别]');
    expect(patched.link).toBeNull();
    expect(patched.links.request(patched.link)).toBe(false);
    expect(patched.prompts).toHaveLength(0); expect(patched.packets).toHaveLength(0);
  });
});
