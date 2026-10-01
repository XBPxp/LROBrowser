// Offline RodEx fixture: actual generated templates, styles, and UI methods.
// Actions stay in this page; only allowlisted passive BMP artwork is imported.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import { build } from 'esbuild';
import ts from 'typescript';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const file = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const values = {}, functions = {}, componentMethods = [], mailFunctions = [];
const components = ['Rodex', 'WriteRodex', 'ReadRodex'];
const wanted = new Set(['Common_default$1', 'WinPopup_default$1', 'WinPopup_default$2',
  ...components.flatMap(name => [name + '_default$1', name + '_default$2'])]);
let promptMethod, dataAttrsMethod, scrollbarClass, uiMessages = {};
function visit(node) {
  if (ts.isBinaryExpression(node) && wanted.has(node.left.getText(file)) && ts.isStringLiteral(node.right)) {
    values[node.left.getText(file)] = node.right.text;
  }
  if (ts.isFunctionDeclaration(node) && ['_popupPosition', '_createButton'].includes(node.name?.text)) functions[node.name.text] = node.getText(file);
  if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'showPromptBox') promptMethod = node.getText(file).replace(/^static\s+/, '');
  if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'processDataAttrs') dataAttrsMethod = node.getText(file);
  if (ts.isClassExpression(node) && node.name?.text === 'ScrollBar') scrollbarClass = node.getText(file);
  if (ts.isVariableDeclaration(node) && node.name?.getText(file) === 'lastroUiMessages') {
    uiMessages = JSON.parse(node.initializer.getText(file));
  }
  ts.forEachChild(node, visit);
}
visit(file);
for (const component of components) {
  const region = new RegExp('//#region src/UI/Components/Rodex/' + component + '\\.js\\r?\\n[\\s\\S]*?//#endregion').exec(runtime)?.[0];
  if (!region) throw new Error('Missing native mail region: ' + component);
  const ast = ts.createSourceFile('mail.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function collect(node) {
    if (ts.isFunctionDeclaration(node)) mailFunctions.push(node.getText(ast));
    if (ts.isBinaryExpression(node) && node.left.getText(ast).startsWith(component + '.') && ts.isFunctionExpression(node.right)) {
      componentMethods.push(node.getText(ast) + ';');
    }
    ts.forEachChild(node, collect);
  }
  collect(ast);
}
for (const name of wanted) if (!values[name]) throw new Error('Missing native string: ' + name);
if (!promptMethod || !dataAttrsMethod || !scrollbarClass || !functions._popupPosition || !functions._createButton) throw new Error('Missing native GUI method');

// Message IDs match the packaged Chinese table. The native runtime's optional
// English-to-Chinese value overlay is retained rather than inventing UI labels.
const messageCsv = await readFile('generated/core/data/msgstringtable.csv', 'utf8');
const messageLines = messageCsv.split(/\r?\n/);
const messages = {};
const messageIds = new Set([356, 2611, 2612, 2643, 2907, 3575, 3590, 3594]);
for (const text of [...Object.values(values), ...mailFunctions, ...componentMethods]) {
  for (const match of text.matchAll(/data-text="(\d+)"|getMessage\((\d+)/g)) messageIds.add(Number(match[1] || match[2]));
}
for (const id of messageIds) {
  const line = messageLines[id] || '';
  const separator = line.includes('\t') ? '\t' : ',';
  const text = line.slice(line.indexOf(separator) + 1);
  messages[id] = Object.prototype.hasOwnProperty.call(uiMessages, text) ? uiMessages[text] : text;
}

const itemBytes = await readFile('generated/core/System/itemInfo_re_61.lua');
const itemTable = new globalThis.TextDecoder('euc-kr').decode(itemBytes);
const itemInfo = {};
for (const [id, name] of [[501, '红色药水'], [505, '蓝色药水']]) {
  const entry = new RegExp('\\[' + id + '\\] = \\{([\\s\\S]*?)(?=\\n\\s*\\[\\d+\\] = \\{|$)').exec(itemTable)?.[1];
  const resource = /\n\s*identifiedResourceName\s*=\s*"([^"]+)"/.exec(entry || '')?.[1];
  if (!resource) throw new Error('Missing native item resource ' + id);
  itemInfo[id] = { name, identifiedResourceName: resource, unidentifiedResourceName: resource };
}

const artwork = new Set([
  'scroll0up.bmp', 'scroll0down.bmp', 'scroll0mid.bmp', 'scroll0bar_up.bmp', 'scroll0bar_mid.bmp', 'scroll0bar_down.bmp',
  'basic_interface/dialscr_up.bmp', 'basic_interface/dialscr_down.bmp',
  'win_msgbox.bmp', 'btn_ok.bmp', 'btn_ok_a.bmp', 'btn_ok_b.bmp', 'btn_cancel.bmp', 'btn_cancel_a.bmp', 'btn_cancel_b.bmp',
  ...Object.values(itemInfo).map(item => 'item/' + item.identifiedResourceName + '.bmp'),
  ...['checkbox_off', 'checkbox_search_off', 'checkbox_search_on', 'icon_status_mail_read', 'icon_status_mail_received',
    'icon_zeny', 'icon_item', 'icon_zeny_n_item'].map(name => 'basic_interface/rodexsystem/renewal/' + name + '.bmp'),
]);
for (const text of Object.values(values)) {
  for (const match of text.matchAll(/data-(?:background|hover|down|active)="([^"]+\.bmp)"/g)) artwork.add(match[1]);
}
const assets = [...artwork];
const directory = 'generated/mail-assets';
const resolverBundle = await build({ entryPoints: ['src/resources/resource-resolver.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const resolver = await import('data:text/javascript;base64,' + Buffer.from(resolverBundle.outputFiles[0].text).toString('base64'));
const origins = new Set(['https://game.lastro.cn', 'https://rodata.ltsd.ro']);
const manifest = {}, failures = [];
await mkdir(directory, { recursive: true });
await Promise.all(assets.map(async asset => {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  try {
    let cached;
    for (const cache of [directory, 'generated/tools-panels-assets', 'generated/chat-map-links-assets']) {
      try {
        const bytes = await readFile(cache + '/' + filename);
        if (bytes[0] === 66 && bytes[1] === 77) { cached = bytes; break; }
      } catch { /* Fetch missing passive artwork below. */ }
    }
    if (cached) await writeFile(directory + '/' + filename, cached);
    else {
      const candidates = resolver.buildResourcePathCandidates('data/texture/유저인터페이스/' + asset);
      const attempts = [];
      let downloaded = false;
      for (const candidate of candidates) {
        for (const resourceRoot of resolver.DEFAULT_RESOURCE_ROOTS) {
          const url = new URL(candidate, resourceRoot);
          if (!origins.has(url.origin)) throw new Error('Unexpected passive resource origin');
          try {
            const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(10000), redirect: 'error' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes[0] !== 66 || bytes[1] !== 77) throw new Error('Invalid BMP');
            await writeFile(directory + '/' + filename, bytes); downloaded = true; break;
          } catch (error) { attempts.push(url.origin + ': ' + error.message); }
        }
        if (downloaded) break;
      }
      if (!downloaded) throw new Error(attempts.join('; '));
    }
    manifest[asset] = filename;
  } catch (error) { failures.push(asset + ': ' + error.message); }
}));
await writeFile(directory + '/index.json', JSON.stringify(manifest, null, 2) + '\n');

const artworkSource = String.raw`
let previewFontsLoaded = false;
document.body.dataset.fontReady = 'false';
const previewFontWeights = [400, 500, 700];
const previewFontsReady = Promise.all(previewFontWeights.map(weight => document.fonts.load(weight + ' 12px "MiSans"', 'LASTRO 活动传送中文字体测试'))).then(async faces => {
  await document.fonts.ready;
  previewFontsLoaded = faces.every(group => group.some(face => face.family.replace(/["']/g, '') === 'MiSans' && face.status === 'loaded')) && previewFontWeights.every(weight => document.fonts.check(weight + ' 12px "MiSans"'));
  document.body.dataset.fontReady = String(previewFontsLoaded);
  document.body.dataset.fontWeights = previewFontWeights.join(',');
  if (!previewFontsLoaded) document.body.dataset.fontFailure = 'MiSans 字体未加载';
  return previewFontsLoaded;
}).catch(error => { document.body.dataset.fontReady = 'false'; document.body.dataset.fontFailure = error.message; return false; });

const decoded = new Map();
function assetError(error) {
  document.body.dataset.assetFailure = 'true';
  document.getElementById('assets').textContent = error.message;
}
function decodeBmp(asset) {
  if (!decoded.has(asset)) decoded.set(asset, new Promise((resolve, reject) => {
    const filename = manifest[asset];
    if (!filename) { reject(new Error('Missing native BMP: ' + asset)); return; }
    const image = new Image();
    image.onerror = () => reject(new Error('Cannot load native BMP: ' + asset));
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        if (pixels.data[offset] === 255 && pixels.data[offset + 1] === 0 && pixels.data[offset + 2] === 255) pixels.data[offset + 3] = 0;
      }
      context.putImageData(pixels, 0, 0); resolve(canvas.toDataURL());
    };
    image.src = './mail-assets/' + filename;
  }));
  return decoded.get(asset);
}
const sampleMails = Array.from({ length: 12 }, (_, index) => ({
  MailID: 1001 + index, openType: index < 8 ? 0 : index < 10 ? 1 : 2,
  SenderName: ['活动管理员', '卡普拉服务员', '古城冒险队', '一起冒险的朋友'][index % 4],
  title: ['活动奖励领取通知', '欢迎来到米德加尔特大陆', '一封标题很长的中文邮件，请查收冒险奖励', '下一次冒险的约定'][index % 4],
  Isread: index % 3 === 1, type: [6, 4, 2, 0][index % 4], expireDateTime: (7 + index) * 86400,
}));
function mailData(mail) {
  return {
    Textcontent: '亲爱的冒险者：\n\n感谢你参加本次系统活动！附件中的药水和金币可以帮助你继续探索。\n\n请在邮件有效期内领取奖励。愿你的每次冒险都充满惊喜。\n\n活动管理员\n2026年9月30日',
    zeny: [2, 6].includes(mail.type) ? 20000 : 0,
    ItemList: [4, 6].includes(mail.type) ? [{ ITID: 501, count: 30 }, { ITID: 505, count: 10 }] : [],
  };
}
const previews = [];
const actions = [];
function recordAction(size, type, data = {}) {
  actions.push({ size, type, ...data });
  document.body.dataset.actions = JSON.stringify(actions);
  document.getElementById('state').textContent = '本地模拟操作：' + type;
}
`;

const guiSource = String.raw`
  const DB = {
    INTERFACE_PATH: '', getMessage: (id, fallback = '') => messages[id] || fallback,
    getItemInfo: id => itemInfo[id], getItemName: item => itemInfo[item.ITID]?.name || '未知道具',
  };
  const Client = {
    loadFile: (asset, done) => decodeBmp(asset).then(done).catch(assetError),
    loadFiles: (files, done) => Promise.all(files.map(decodeBmp)).then(values => done(...values)).catch(assetError),
  };
  const Texture = { load: (url, done) => { const image = new Image(); image.onload = () => done.call(image); image.src = url; } };
  const _Client = Client, _DB = DB;
  const Renderer = { width: 360, height: 470 };
  const SessionStorage_default = { zeny: 125000, Entity: { display: { name: '预览冒险者' } } };
  const MonsterTable_default = { 7: '骑士' }, KEYS = { ESCAPE: 27 };
  const _preferences$37 = { x: 0, y: 20, show: false, save() {} }, _preferences$1 = { show: false, save() {} };
  const ChatBox_default = { TYPE: { INFO_MAIL: 1 }, FILTER: { PUBLIC_LOG: 1 }, addText: text => recordAction(size, '系统提示', { text }) };
  const InventoryController = { reqMoveItemToWriteRodex: (index, count) => recordAction(size, '模拟添加附件', { index, count }) };
  const InputBox_default = { append() {}, remove() {}, setType() {} };
  const ItemInfo_default = { uid: 0, append() {}, remove() {}, setItem: item => recordAction(size, '查看附件', { item: item.ITID }) };
  const getItemCountUnit = () => '个';
  let topIndex = 50;
  class GUIComponent {
    constructor(name, css) { this.name = name; this.css = css; this.__active = false; }
    clone(name) { const clone = new GUIComponent(name, this.css); clone.render = this.render; return clone; }
    getRoot() { return this._shadow || this._host; }
    append() {
      this.__active = true;
      if (!this._host) {
        this._host = document.createElement('div'); this._host.id = this.name + '-' + size;
        Object.assign(this._host.style, { position: 'absolute', color: '#000', zIndex: '50', fontFamily: "Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif", fontSizeAdjust: 'none' });
        this._shadow = this._host.attachShadow({ mode: 'open' });
        const common = document.createElement('style'); common.textContent = values['Common_default$1'];
        const style = document.createElement('style'); style.textContent = this.css;
        this._container = document.createElement('div'); this._container.className = 'ui-component-root'; this._container.innerHTML = this.render();
        this._shadow.append(common, style, this._container);
        this._shadow.querySelectorAll('[data-background],[data-hover],[data-down],[data-active],[data-text],[data-preload]').forEach(GUIComponent.processDataAttrs);
        this._shadow.addEventListener('input', () => recordState());
        this._shadow.addEventListener('click', () => queueMicrotask(recordState));
        mount.append(this._host); this.init?.();
      } else mount.append(this._host);
      this.onAppend?.(); this.focus();
    }
    remove() { this.onRemove?.(); this.__active = false; this._host?.remove(); recordState(); }
    focus() { if (this._host) this._host.style.zIndex = String(++topIndex); }
    placeOnTop() { this.focus(); }
    draggable(handle) {
      if (typeof handle === 'string') handle = this._shadow.querySelector(handle);
      if (!handle) return;
      handle.addEventListener('mousedown', event => {
        if (event.button !== 0 || event.composedPath().some(node => ['BUTTON', 'INPUT', 'TEXTAREA'].includes(node.tagName))) return;
        this.focus();
        const startX = event.clientX, startY = event.clientY;
        const left = parseFloat(this._host.style.left) || 0, top = parseFloat(this._host.style.top) || 0;
        const move = next => { this._host.style.left = Math.max(0, left + (next.clientX - startX) / scale) + 'px'; this._host.style.top = Math.max(0, top + (next.clientY - startY) / scale) + 'px'; };
        const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop, { once: true }); event.preventDefault();
      });
    }
`;

const setupSource = String.raw`
  const components = new Map();
  const WinPopup = new GUIComponent('WinPopup', values['WinPopup_default$1']); WinPopup.render = () => values['WinPopup_default$2']; components.set('WinPopup', WinPopup);
  const nativeUIManager = { getComponent: name => components.get(name), NATIVE_PROMPT_METHOD };
  const UIManager = { showPromptBox(...args) {
    const prompt = nativeUIManager.showPromptBox(...args);
    if (prompt?._host) Object.assign(prompt._host.style, { left: '10px', top: '145px' });
    return prompt;
  } };
  const Rodex = new GUIComponent('Rodex', values['Rodex_default$1']); Rodex.render = () => values['Rodex_default$2'];
  const WriteRodex = new GUIComponent('WriteRodex', values['WriteRodex_default$1']); WriteRodex.render = () => values['WriteRodex_default$2'];
  const ReadRodex = new GUIComponent('ReadRodex', values['ReadRodex_default$1']); ReadRodex.render = () => values['ReadRodex_default$2'];
  const Rodex_default = Rodex;
  Rodex.list = []; Rodex.pageSize = 6; Rodex.page = 0; Rodex.openType = 0; Rodex.searchType = 1; Rodex.currentTab = 0;
  Rodex.attachmentType = { 0: '', 2: 'basic_interface/rodexsystem/renewal/icon_zeny.bmp', 4: 'basic_interface/rodexsystem/renewal/icon_item.bmp', 6: 'basic_interface/rodexsystem/renewal/icon_zeny_n_item.bmp', 12: 'basic_interface/rodexsystem/renewal/icon_zeny_n_item.bmp' };
  WriteRodex.list = []; WriteRodex.receiver = null; WriteRodex.tax = 0;
  ReadRodex.MailID = 0; ReadRodex.openType = 0;
  NATIVE_COMPONENT_METHODS
  function visible(component) { return !!(component._host?.isConnected && component._host.style.display !== 'none' && !mount.closest('[hidden]')); }
  function recordState() {
    if (!document.body || !previewFontsLoaded) return;
    const state = {
      inboxVisible: visible(Rodex), writeVisible: visible(WriteRodex), readVisible: visible(ReadRodex),
      inboxWidth: Rodex._host?.getBoundingClientRect().width, writeWidth: WriteRodex._host?.getBoundingClientRect().width,
      page: Rodex.page, searchType: Rodex.searchType,
      mailCount: Rodex.getRoot()?.querySelectorAll('.mail-item').length || 0,
      title: WriteRodex.getRoot()?.querySelector('.title-text')?.value,
      placeholder: WriteRodex.getRoot()?.querySelector('.title-text')?.placeholder,
      weight: WriteRodex.getRoot()?.querySelector('.weigth-text')?.textContent,
      tax: WriteRodex.getRoot()?.querySelector('.tax-text')?.textContent,
      currency: WriteRodex.getRoot()?.querySelector('.character-zeny')?.textContent,
      readTitle: ReadRodex.getRoot()?.querySelector('.title-text')?.textContent,
    };
    document.body.dataset[size === 'native' ? 'nativeState' : 'scaledState'] = JSON.stringify(state);
  }
  function show(component) {
    for (const window of [Rodex, WriteRodex, ReadRodex]) window._host.style.display = window === component ? '' : 'none';
    Object.assign(component._host.style, { left: '0px', top: '0px' }); component.focus(); recordState();
  }
  function fillSample() {
    const root = WriteRodex.getRoot();
    root.querySelector('.name').value = '一起冒险的朋友';
    root.querySelector('.title-text').value = '活动奖励，请及时领取';
    root.querySelector('.content-text').value = '你好！\n\n这是本地中文邮件示例，附上红色药水、蓝色药水和金币。\n\n祝你冒险顺利！';
    root.querySelector('.value').value = '10000';
    WriteRodex.receiver = '一起冒险的朋友'; WriteRodex.CharID = 42;
    if (!WriteRodex.list.length) {
      WriteRodex.addItem({ index: 1, ITID: 501, count: 3, IsIdentified: true, weight: 210 });
      WriteRodex.addItem({ index: 2, ITID: 505, count: 1, IsIdentified: true, weight: 360 });
    }
    WriteRodex.updateTax(); recordState();
  }
  Rodex.closeRodexBox = () => recordAction(size, '关闭收件箱');
  Rodex.openRodexBox = () => recordAction(size, '打开收件箱');
  Rodex.requestRefreshRodexPage = () => { Rodex.initData({ MailList: sampleMails.map(mail => ({ ...mail })), isEnd: true, openType: 0 }); recordAction(size, '刷新收件箱'); };
  Rodex.requestOpenWriteRodex = sender => { show(WriteRodex); if (sender) { WriteRodex.getRoot().querySelector('.name').value = sender; WriteRodex.receiver = sender; } recordAction(size, '写信', { sender }); };
  Rodex.requestReadRodex = (openType, id) => { const mail = Rodex.getMailByID(id); if (!mail) return; ReadRodex.initData(mailData(mail), mail); show(ReadRodex); recordAction(size, '阅读邮件', { id, openType }); };
  Rodex.requestItemsFromRodex = (openType, id) => { ReadRodex.clearItemList(); recordAction(size, '领取附件', { id, openType }); };
  Rodex.requestZenyFromRodex = (openType, id) => { ReadRodex.clearZeny(); recordAction(size, '领取金币', { id, openType }); };
  Rodex.requestDeleteRodex = (openType, id) => { Rodex.updateDeletedMailContent(openType, id); recordAction(size, '删除邮件', { id, openType }); };
  WriteRodex.validateName = name => { WriteRodex.characterInfo({ name, level: 99, Job: 7, CharID: 42 }); recordAction(size, '确认收件人', { name }); };
  WriteRodex.requestCancelWriteRodex = () => recordAction(size, '关闭写信');
  WriteRodex.requestSendRodex = (receiver, sender, zeny, titleLength, bodyLength, character, title, body) => recordAction(size, '模拟发送邮件', { receiver, sender, zeny, titleLength, bodyLength, character, title: title.replace(/\0$/, ''), body: body.replace(/\0$/, '') });
  Rodex.append(); Rodex.initData({ MailList: sampleMails.map(mail => ({ ...mail })), isEnd: true, openType: 0 });
  WriteRodex.append(); WriteRodex.initData({ receiveName: '一起冒险的朋友' }); fillSample();
  ReadRodex.append(); ReadRodex.initData(mailData(sampleMails[0]), sampleMails[0]);
  for (const component of [Rodex, WriteRodex, ReadRodex]) Object.assign(component._host.style, { left: '0px', top: '0px' });
  ScrollBar.init();
  ScrollBar.applyDOMScrollbar(ReadRodex.getRoot().querySelector('.content-text'));
  show(Rodex);
  const observer = new MutationObserver(() => recordState());
  for (const component of [Rodex, WriteRodex, ReadRodex]) observer.observe(component._host, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('pagehide', () => observer.disconnect());
  return {
    show: name => show({ inbox: Rodex, write: WriteRodex, read: ReadRodex }[name]),
    sample: fillSample,
    clearTitle: () => { WriteRodex.getRoot().querySelector('.title-text').value = ''; recordState(); },
    refresh: recordState,
  };
`;

const previewJs = [
  '// Generated from native RodEx UI; actions use explicit local mock services.',
  'import { setLastROAdjacentHTML, setLastROInnerHTML, setLastROOuterHTML } from "./mail-trusted-dom.mjs";',
  'const values = ' + JSON.stringify(values) + ';', 'const manifest = ' + JSON.stringify(manifest) + ';',
  'const messages = ' + JSON.stringify(messages) + ';', 'const itemInfo = ' + JSON.stringify(itemInfo) + ';', artworkSource,
  'function createPreview(mount, size, scale) {', guiSource, dataAttrsMethod, '}',
  'const ScrollBar = ' + scrollbarClass + ';', functions._popupPosition, functions._createButton,
  ...mailFunctions, setupSource.replace('NATIVE_PROMPT_METHOD', promptMethod).replace('NATIVE_COMPONENT_METHODS', componentMethods.join('\n')), '}',
  'previews.push(createPreview(document.getElementById("native-plane"), "native", 1));',
  'previews.push(createPreview(document.getElementById("scaled-plane"), "scaled", 1.5));',
  'for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => { for (const preview of previews) preview.show(button.dataset.view); document.body.dataset.view = button.dataset.view; });',
  'document.getElementById("fill-sample").addEventListener("click", () => { for (const preview of previews) { preview.show("write"); preview.sample(); } document.body.dataset.view = "write"; });',
  'document.getElementById("clear-title").addEventListener("click", () => { for (const preview of previews) { preview.show("write"); preview.clearTitle(); } document.body.dataset.view = "write"; });',
  'document.body.dataset.view = "inbox";',
  'for (const button of document.querySelectorAll("[data-size]")) button.addEventListener("click", () => { const size = button.dataset.size; document.getElementById("native-comparison").hidden = size === "scaled"; document.getElementById("scaled-comparison").hidden = size === "native"; document.body.dataset.previewSize = size; for (const preview of previews) preview.refresh(); });',
  'document.body.dataset.previewSize = "both";',
  'Promise.all(Object.keys(manifest).map(decodeBmp)).then(() => { document.body.dataset.assetsReady = "true"; }).catch(assetError);',
  'previewFontsReady.then(() => requestAnimationFrame(() => { for (const preview of previews) preview.refresh(); }));',
].join('\n');
await writeFile('generated/mail-preview.js', previewJs);
await writeFile('generated/mail-trusted-dom.mjs', await readFile('src/runtime/lastro-trusted-dom.mjs', 'utf8'));
await writeFile('generated/mail-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LASTRO 邮件窗口离线预览</title>
<link rel="stylesheet" href="/fonts/misans.css">
<style>body{margin:0;padding:20px;background:#27333c;color:#eef4f8;font:14px Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size-adjust:none}h1{font-size:20px;margin:0 0 8px}header p{margin:0 0 10px}.actions{display:flex;flex-wrap:wrap;gap:8px}#state,#assets{margin-top:10px;font-size:12px}#assets{color:#ffc2b0;white-space:pre-wrap}.comparisons{display:flex;flex-wrap:wrap;gap:32px;margin-top:24px}.comparison h2{font-size:16px;margin:0 0 10px}.comparison p{margin:0 0 12px;color:#bdd2e0;font-size:12px}.plane{position:relative;width:360px;height:470px;transform-origin:top left}.native-stage{width:360px;min-height:470px}.scaled-stage{width:540px;min-height:705px}#scaled-plane{transform:scale(1.5)}[hidden]{display:none!important}</style>
<header><h1>LASTRO · 邮件窗口</h1><p>本地示例邮件。使用当前客户端的真实模板、样式和界面方法，所有邮件操作仅记录在本页。</p><div class="actions"><button data-view="inbox">收件箱</button><button data-view="write">写信</button><button data-view="read">阅读示例</button><button id="fill-sample">填写中文示例</button><button id="clear-title">清空标题查看提示</button><button data-size="both">双栏对照</button><button data-size="native">原生 100%</button><button data-size="scaled">放大 150%</button></div><div id="state"></div><div id="assets">${failures.join('\n')}</div></header>
<main class="comparisons"><section class="comparison" id="native-comparison"><h2>原生尺寸 · 100%</h2><p>收件箱 309 × 416，写信与阅读 300 × 400</p><div class="native-stage"><div class="plane" id="native-plane"></div></div></section><section class="comparison" id="scaled-comparison"><h2>放大显示 · 150%</h2><p>保持相同模板、原生坐标与控件比例</p><div class="scaled-stage"><div class="plane" id="scaled-plane"></div></div></section></main>
<script type="module" src="./mail-preview.js"></script></html>`);
console.log('Native mail artwork: ' + Object.keys(manifest).length + '/' + assets.length);
if (failures.length) console.warn(failures.join('\n'));
console.log('Preview: /generated/mail-preview.html');
