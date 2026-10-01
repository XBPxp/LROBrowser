// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

const source = readFileSync('generated/runtime/Online.js', 'utf8');
const ast = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(name: string) {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing function ${name}`);
  return node.getText(ast);
}
function findNode(predicate: (node: ts.Node) => boolean) {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) { if (predicate(node)) found = node; else ts.forEachChild(node, visit); }
  visit(ast);
  if (!found) throw new Error('Missing chat integration fixture');
  return found.getText(ast);
}
const showPromptBox = findNode(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'showPromptBox');
const factory = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'LastROChatMapLinks');
const addText = findNode(node => ts.isBinaryExpression(node) && node.left.getText(ast) === 'ChatBox.addText');

function mount(immediate = true, lastro = true, currentMap = 'izlude.gat') {
  const host = document.createElement('div');
  host.innerHTML = '<div class="content" data-content="0"></div>';
  const content = host.firstElementChild as HTMLElement;
  const sent = vi.fn();
  const frames: Array<() => void> = [];
  const parseItemLink = vi.fn((): { name: string } | null => ({ name: '红色药水' }));
  const announce = { append: vi.fn(), set: vi.fn() };
  const chatRoom = { isOpen: false, message: vi.fn() };
  const playerDialog = { set: vi.fn() }, npcDialog = { set: vi.fn() };
  const recovered = vi.fn();
  let popup: { _shadow: ShadowRoot; _host: HTMLElement; init?: () => void; onRemove?: () => void; draggable: () => void; append: () => void; remove: () => void };
  const ChatBox: Record<string, unknown> = { tabs: [{}], MAX_MSG: 400, TYPE: { SELF: 1, PUBLIC: 2, ANNOUNCE: 32 }, FILTER: { PUBLIC_CHAT: 1, PUBLIC_LOG: 0 } };
  const context = {
    document, crypto: globalThis.crypto, queueMicrotask, setLastROInnerHTML, ChatBox,
    _root$18: () => host,
    _messageBuffer: [], _rafScheduled: false, MAX_MSG: 400,
    _preferences$41: { height: 2 },
    ChatBoxSettings_default: { tabOption: [[0, 1]] },
    shouldScrollDownBeforeAdd: () => true,
    getColorForType: () => 'red',
    requestAnimationFrame: (callback: () => void) => { if (immediate) callback(); else frames.push(callback); },
    DB: { parseItemLink, getItemNameFromLink: vi.fn(() => '红色药水') },
    ChatBox_default: ChatBox, Announce_default: announce,
    ChatRoom_default: chatRoom,
    SessionStorage_default: { Entity: { dialog: playerDialog } },
    EntityManager: { get: vi.fn(() => ({ dialog: npcDialog })) },
    Configs: { get: (name: string, fallback: unknown) => name === 'lastroProtocol' ? lastro : fallback },
    init_Announce: vi.fn(), init_Configs: vi.fn(),
    console: { warn: recovered },
    GUIComponent: { processDataAttrs: vi.fn() },
    _popupPosition: () => ({ top: '50%', left: '50%' }),
    PACKET: { CZ: { PRIVATE_AIRSHIP_REQUEST: class { mapname = ''; } } },
    buildPrivateAirshipRequest: (target: Record<string, unknown>) => ({ ...target, itemid: 14527 }),
    Network: { sendPacket: sent },
    MapRenderer: { currentMap, loading: false },
    normalizeLastROTeleportMap: (map: string) => map.trim().replace(/\.gat$/i, '').toLowerCase(),
  };
  const nativeUI = runInNewContext(`${declaration('_createButton')}\nclass NativeUI { ${showPromptBox} }; NativeUI;`, context);
  nativeUI.getComponent = vi.fn(() => ({ clone: (name: string) => {
    const element = document.createElement('div');
    element.dataset.component = name;
    const root = element.attachShadow({ mode: 'open' });
    root.innerHTML = '<div id="win_popup" data-background="win_msgbox.bmp"><div class="text"></div><div class="btns"></div></div>';
    popup = {
      _host: element, _shadow: root, draggable: vi.fn(),
      append() { this.init?.(); document.body.append(element); },
      remove() { this.onRemove?.(); element.remove(); },
    };
    return popup;
  } }));
  const runtime = runInNewContext(`const ${factory};\n${declaration('flushMessageBuffer')}\n${declaration('requestChatMapTeleport')}\n${declaration('onGlobalAnnounce')}\n${declaration('onPlayerMessage')}\n${declaration('onEntityTalkColor')}\n${addText};\n({ ChatBox, requestChatMapTeleport, onGlobalAnnounce, onPlayerMessage, onEntityTalkColor });`, { ...context, UIManager: nativeUI });
  const button = (name: string) => popup._shadow.querySelector<HTMLButtonElement>(`[data-background="btn_${name}.bmp"]`)!;
  return { content, runtime, sent, nativeUI, button, popup: () => popup, parseItemLink, announce, chatRoom, playerDialog, npcDialog, recovered, flush: () => { for (const frame of frames.splice(0)) frame(); } };
}

describe('packaged activity notification integration', () => {
  it('renders the actual server notification and sends its destination only after native OK', () => {
    const f = mount();
    f.runtime.ChatBox.addText("[随机事件] 10秒后召唤师将在迷宫举办魔物派对(<span class='mapname' data-map='force_map3#100#184'>点击前往</span>).", 0, 0);
    const link = f.content.querySelector('a.mapname')!;
    expect(link.textContent).toBe('传送到活动地点');
    expect(f.content.textContent).toBe('[随机事件] 10秒后召唤师将在迷宫举办魔物派对(传送到活动地点).');
    expect(f.runtime.requestChatMapTeleport(link)).toBe(true);
    expect(f.nativeUI.getComponent).toHaveBeenCalledWith('WinPopup');
    expect(f.popup()._host.dataset.component).toBe('WinPrompt');
    expect(f.popup().draggable).toHaveBeenCalledOnce();
    expect(f.popup()._shadow.querySelector('.text')?.textContent).toContain('force_map3（100, 184）');
    expect(f.sent).not.toHaveBeenCalled();
    f.button('ok').click();
    expect(f.sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mapname: 'force_map3', x: 100, y: 184, type: 1, itemid: 14527 }));
    expect(f.popup()._host.isConnected).toBe(false);
  });

  it.each(['izlude#150#150#', 'izlude#150#150#0', 'izlude'])('renders an Izlude activity broadcast and confirms its native destination for %s', dataMap => {
    const f = mount(true, true, 'prontera.gat');
    f.runtime.onGlobalAnnounce({ msg: `[随机事件] 10秒后召唤师将在依斯鲁得岛举办魔物派对(<span class="mapname" data-map="${dataMap}">点击前往</span>).` });
    expect(f.content.textContent).toBe('[随机事件] 10秒后召唤师将在依斯鲁得岛举办魔物派对(传送到活动地点).');
    expect(f.announce.set).toHaveBeenCalledExactlyOnceWith('[随机事件] 10秒后召唤师将在依斯鲁得岛举办魔物派对(活动地点见聊天栏).', '#FFFF00');
    expect(f.runtime.requestChatMapTeleport(f.content.querySelector('a.mapname'))).toBe(true);
    expect(f.sent).not.toHaveBeenCalled();
    f.button('ok').click();
    const coordinate = dataMap === 'izlude' ? 0 : 150;
    expect(f.sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mapname: 'izlude', x: coordinate, y: coordinate, type: 1, itemid: 14527 }));
  });

  it('keeps item links beside activity links and cancels without sending', () => {
    const f = mount();
    f.runtime.ChatBox.addText("获得<ITEMLINK>501</ITEMLINK> <span data-x='100' class='mapname' data-y='184' data-map='force_map3'>点击前往</span>", 0, 0);
    expect(f.content.querySelector('.item-link')?.textContent).toBe('<红色药水>');
    f.runtime.requestChatMapTeleport(f.content.querySelector('.mapname'));
    f.button('cancel').click();
    expect(f.sent).not.toHaveBeenCalled();
    f.runtime.requestChatMapTeleport(f.content.querySelector('.mapname'));
    f.button('ok').click();
    expect(f.sent).toHaveBeenCalledOnce();
  });

  it('does not turn unrelated markup into HTML when a valid activity link is present', () => {
    const f = mount();
    const text = "<img src='x' onerror='alert(1)'> <span class='mapname' data-map='force_map3#100#184'>点击前往</span>";
    f.runtime.ChatBox.addText(text, 0, 0);
    expect(f.content.querySelector('img')).toBeNull();
    expect(f.content.textContent).toContain("<img src='x' onerror='alert(1)'>");
    expect(f.content.querySelectorAll('a.mapname')).toHaveLength(1);
  });

  it('recovers malformed items and rejected HTML without dropping later messages in the same frame', () => {
    const f = mount(false);
    f.parseItemLink.mockReturnValueOnce(null);
    f.runtime.ChatBox.addText('坏道具<ITEML>bad</ITEML>', 0, 0);
    f.runtime.ChatBox.addText('异常通知<ITEMLINK>501</ITEMLINK><img src=x onerror="alert(1)">', 0, 0);
    f.runtime.ChatBox.addText("下一条活动：<span class='mapname' data-map='force_map3#100#184'>点击前往</span>", 0, 0);
    expect(() => f.flush()).not.toThrow();
    expect(f.content.children).toHaveLength(3);
    expect(f.content.children[0]!.textContent).toBe('坏道具[物品信息暂不可用]');
    expect(f.content.children[1]!.textContent).toBe('异常通知<红色药水>');
    expect(f.content.children[2]!.textContent).toBe('下一条活动：传送到活动地点');
    expect(f.content.querySelector('img, script, [onerror]')).toBeNull();
    expect(f.recovered).toHaveBeenCalledOnce();
  });

  it('uses readable canvas announcement text while keeping the chat destination clickable', () => {
    const f = mount();
    f.runtime.onGlobalAnnounce({ msg: "[活动] <span class='mapname' data-map='force_map3#100#184'>点击前往</span>" });
    expect(f.announce.set).toHaveBeenCalledExactlyOnceWith('[活动] 活动地点见聊天栏', '#FFFF00');
    expect(f.content.textContent).toBe('[活动] 传送到活动地点');
    expect(f.content.querySelectorAll('a.mapname')).toHaveLength(1);
    expect(() => f.runtime.onGlobalAnnounce({ msg: null })).not.toThrow();
    expect(() => f.runtime.ChatBox.addText(null, 0, 0)).not.toThrow();
  });

  it('unwraps a complete server-message global broadcast once through the original announcement handler', () => {
    const f = mount();
    f.runtime.onGlobalAnnounce({ msg: "<msg>[活动] 挑战开始 <span class='mapname' data-map='force_map3#100#184'>点击前往</span><msg>" });
    expect(f.announce.append).toHaveBeenCalledOnce();
    expect(f.announce.set).toHaveBeenCalledExactlyOnceWith('[活动] 挑战开始 活动地点见聊天栏', '#FFFF00');
    expect(f.content.textContent).toBe('[活动] 挑战开始 传送到活动地点');
    expect(f.content.childElementCount).toBe(1);
    expect(f.content.querySelectorAll('a.mapname')).toHaveLength(1);
  });

});

describe('packaged LastRO server-message packet routing', () => {
  const handlers = ['onPlayerMessage', 'onEntityTalkColor'] as const;
  it.each(handlers)('%s routes the official complete wrapper to the native floating announcement and chat log', handler => {
    const f = mount();
    f.chatRoom.isOpen = true;
    const result = f.runtime[handler]({ msg: '<msg>挑战开始<msg>', accountID: 123, color: 0xffffff });
    expect(result).toBe(false);
    expect(f.announce.append).toHaveBeenCalledOnce();
    expect(f.announce.set).toHaveBeenCalledExactlyOnceWith('挑战开始', '#FFFF00', { life: 5000 });
    expect(f.content.textContent).toBe('挑战开始');
    expect(f.chatRoom.message).not.toHaveBeenCalled();
    expect(f.playerDialog.set).not.toHaveBeenCalled(); expect(f.npcDialog.set).not.toHaveBeenCalled();
    expect(f.sent).not.toHaveBeenCalled();
  });

  it.each(handlers)('%s preserves the original packet as ordinary chat outside LastRO', handler => {
    const f = mount(true, false), text = '<msg>挑战开始<msg>';
    f.runtime[handler]({ msg: text, accountID: 123, color: 0xffffff });
    expect(f.content.textContent).toBe(text);
    expect(f.announce.set).not.toHaveBeenCalled(); expect(f.announce.append).not.toHaveBeenCalled();
    expect(handler === 'onPlayerMessage' ? f.playerDialog.set : f.npcDialog.set).toHaveBeenCalledExactlyOnceWith(text);
  });

  it.each(handlers)('%s leaves incomplete, quoted and prefixed marker text on the ordinary chat path', handler => {
    const f = mount();
    const texts = ['<msg>未结束', '玩家 : <msg>原文<msg>', '&lt;msg&gt;原文&lt;msg&gt;', '<msg><msg>重复标记<msg>'];
    for (const msg of texts) f.runtime[handler]({ msg, accountID: 123, color: 0xffffff });
    expect([...f.content.children].map(row => row.textContent)).toEqual(texts);
    expect(f.announce.set).not.toHaveBeenCalled();
  });

  it('keeps item payloads and native activity confirmation inside a wrapped message, followed by both packet types in the same frame', () => {
    const f = mount(false), item = '<ITEMLINK>501</ITEMLINK>';
    f.runtime.onPlayerMessage({ msg: '<msg>获得' + item + " <span class='mapname' data-map='force_map3#100#184'>点击前往</span><msg>" });
    f.runtime.onEntityTalkColor({ msg: '<msg>挑战开始<msg>', accountID: 123, color: 0xffffff });
    f.runtime.onPlayerMessage({ msg: '下一条普通消息' });
    expect(() => f.flush()).not.toThrow();
    expect([...f.content.children].map(row => row.textContent)).toEqual(['获得<红色药水> 传送到活动地点', '挑战开始', '下一条普通消息']);
    expect(f.parseItemLink).toHaveBeenCalledExactlyOnceWith(item);
    expect(f.content.querySelector('.item-link')?.getAttribute('data-item')).toBe(item);
    expect(f.runtime.requestChatMapTeleport(f.content.querySelector('a.mapname'))).toBe(true);
    expect(f.sent).not.toHaveBeenCalled();
    f.button('ok').click();
    expect(f.sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mapname: 'force_map3', x: 100, y: 184, type: 1, itemid: 14527 }));
    expect(f.recovered).not.toHaveBeenCalled();
    expect(f.playerDialog.set).toHaveBeenCalledExactlyOnceWith('下一条普通消息');
    expect(f.npcDialog.set).not.toHaveBeenCalled();
  });
});
