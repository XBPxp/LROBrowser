// Offline visual fixture: extract the real popup implementation and render sample chat.
// Only passive BMP artwork is imported; this preview never connects to a game server.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import { build } from 'esbuild';
import ts from 'typescript';
import { createLastroChatMapLinks } from './lastro-chat-map-links.mjs';

const runtime = await readFile('generated/runtime/Online.js', 'utf8');
const file = ts.createSourceFile('Online.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const values = {};
const wanted = new Set(['Common_default$1', 'WinPopup_default$1', 'WinPopup_default$2']);
const functions = {};
let promptMethod;
function visit(node) {
  if (ts.isBinaryExpression(node) && wanted.has(node.left.getText(file)) && ts.isStringLiteral(node.right)) {
    values[node.left.getText(file)] = node.right.text;
  }
  if (ts.isFunctionDeclaration(node) && ['_popupPosition', '_createButton'].includes(node.name?.text)) {
    functions[node.name.text] = node.getText(file);
  }
  if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'showPromptBox') {
    promptMethod = node.getText(file).replace(/^static\s+/, '');
  }
  ts.forEachChild(node, visit);
}
visit(file);
for (const name of wanted) if (!values[name]) throw new Error('Missing native popup string: ' + name);
for (const name of ['_popupPosition', '_createButton']) if (!functions[name]) throw new Error('Missing native popup function: ' + name);
if (!promptMethod) throw new Error('Missing native UIManager.showPromptBox');

const resolverBundle = await build({ entryPoints: ['src/resources/resource-resolver.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const resolver = await import('data:text/javascript;base64,' + Buffer.from(resolverBundle.outputFiles[0].text).toString('base64'));
const origins = new Set(['https://game.lastro.cn', 'https://rodata.ltsd.ro']);
const assets = ['win_msgbox.bmp', 'btn_ok.bmp', 'btn_ok_a.bmp', 'btn_ok_b.bmp', 'btn_cancel.bmp', 'btn_cancel_a.bmp', 'btn_cancel_b.bmp'];
const directory = 'generated/chat-map-links-assets';
await mkdir(directory, { recursive: true });
let manifest = {};
try { manifest = JSON.parse(await readFile(directory + '/index.json', 'utf8')); } catch { /* first run */ }
const failures = [];
await Promise.all(assets.map(async asset => {
  const filename = createHash('sha256').update(asset).digest('hex').slice(0, 24) + '.bmp';
  try {
    let cached = false;
    try {
      const bytes = await readFile(directory + '/' + filename);
      cached = bytes[0] === 66 && bytes[1] === 77;
    } catch { /* import the passive artwork below */ }
    if (!cached) {
      const candidate = resolver.buildResourcePathCandidates('data/texture/유저인터페이스/' + asset)[0];
      const attempts = [];
      let downloaded = false;
      for (const root of resolver.DEFAULT_RESOURCE_ROOTS) {
        const url = new URL(candidate, root);
        if (!origins.has(url.origin)) throw new Error('Unexpected passive resource origin');
        try {
          const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(10000), redirect: 'error' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes[0] !== 66 || bytes[1] !== 77) throw new Error('Invalid BMP');
          await writeFile(directory + '/' + filename, bytes);
          downloaded = true;
          break;
        } catch (error) { attempts.push(url.origin + ': ' + error.message); }
      }
      if (!downloaded) throw new Error(attempts.join('; '));
    }
    manifest[asset] = filename;
  } catch (error) {
    delete manifest[asset];
    failures.push(asset + ': ' + error.message);
  }
}));
await writeFile(directory + '/index.json', JSON.stringify(manifest, null, 2) + '\n');

const stubSource = String.raw`
const decoded = new Map();
function decodeBmp(asset) {
  if (!decoded.has(asset)) decoded.set(asset, new Promise((resolve, reject) => {
    const filename = manifest[asset];
    if (!filename) { reject(new Error('Missing native BMP: ' + asset)); return; }
    const image = new Image();
    image.onerror = () => reject(new Error('Cannot load native BMP: ' + asset));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        if (pixels.data[offset] === 255 && pixels.data[offset + 1] === 0 && pixels.data[offset + 2] === 255) pixels.data[offset + 3] = 0;
      }
      context.putImageData(pixels, 0, 0);
      resolve(canvas.toDataURL());
    };
    image.src = './chat-map-links-assets/' + filename;
  }));
  return decoded.get(asset);
}
function setBackground(element, asset) {
  if (!asset) return;
  element.dataset.previewAsset = asset;
  decodeBmp(asset).then(url => {
    if (element.dataset.previewAsset === asset) element.style.backgroundImage = 'url("' + url + '")';
  }).catch(error => {
    document.getElementById('assets').textContent = error.message;
    document.body.dataset.assetFailure = 'true';
  });
}
class GUIComponent {
  constructor(name, css) { this.name = name; this.css = css; }
  clone(name) {
    const clone = new GUIComponent(name, this.css);
    clone.render = this.render;
    return clone;
  }
  static processDataAttrs(element) {
    const normal = element.dataset.background;
    setBackground(element, normal);
    if (element.tagName === 'BUTTON') {
      element.type = 'button';
      element.setAttribute('aria-label', normal.startsWith('btn_ok') ? '确定' : '取消');
    }
    element.addEventListener('mouseenter', () => setBackground(element, element.dataset.hover || normal));
    element.addEventListener('mouseleave', () => setBackground(element, normal));
    element.addEventListener('mousedown', () => setBackground(element, element.dataset.down || normal));
    element.addEventListener('mouseup', () => setBackground(element, element.dataset.hover || normal));
  }
  append() {
    if (!this._host) {
      this._host = document.createElement('div');
      this._host.id = this.name;
      this._host.style.position = 'absolute';
      // The fixture page has light text; native popup text uses the dark document default.
      this._host.style.color = '#000';
      this._shadow = this._host.attachShadow({ mode: 'open' });
      this._shadow.innerHTML = '<style>' + values['Common_default$1'] + this.css + '</style>' + this.render();
      this._shadow.querySelectorAll('[data-background]').forEach(GUIComponent.processDataAttrs);
      document.body.append(this._host);
      this.init?.();
    } else document.body.append(this._host);
    this.__active = true;
  }
  remove() {
    this.__active = false;
    if (this._host?.isConnected) {
      this.onRemove?.();
      this._host.remove();
    }
  }
  draggable() {
    this._host.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.composedPath().some(node => node.tagName === 'BUTTON')) return;
      const startX = event.clientX, startY = event.clientY;
      const left = this._host.offsetLeft, top = this._host.offsetTop;
      const move = next => {
        this._host.style.left = left + next.clientX - startX + 'px';
        this._host.style.top = top + next.clientY - startY + 'px';
      };
      const stop = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', stop);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', stop, { once: true });
      event.preventDefault();
    });
  }
}
`;
const setupSource = String.raw`
const WinPopup = new GUIComponent('WinPopup', values['WinPopup_default$1']);
WinPopup.render = () => values['WinPopup_default$2'];
let confirmations = 0;
const status = (state, message) => {
  document.body.dataset.previewState = state;
  document.getElementById('state').textContent = message;
};
const api = createLastroChatMapLinks({
  setHtml: (parent, html) => { parent.innerHTML = html; },
  showPrompt: (message, yes, no) => {
    status('pending', '等待确认传送。');
    return UIManager.showPromptBox(message, 'ok', 'cancel', yes, () => {
      status('cancelled', '已取消传送。');
      no();
    });
  },
  canTeleport: () => true,
  teleport: target => {
    confirmations++;
    document.body.dataset.confirmations = String(confirmations);
    status('confirmed', '预览已确认：' + target.mapname + '（' + target.x + ', ' + target.y + '），确认次数 ' + confirmations + '。');
  },
});
const chat = document.getElementById('chat');
api.render(document.getElementById('challenge'), api.serverMessage('<msg>挑战开始<msg>'));
api.render(document.getElementById('message'), api.serverMessage('<msg>挑战结束，请领取奖励。<msg>'));
api.render(chat, api.serverMessage("<msg>[随机事件] 10秒后召唤师将在迷宫举办魔物派对(<span class='mapname' data-map='force_map3#100#184'>点击前往</span>).<msg>"));
chat.addEventListener('click', event => {
  const link = event.target.closest('a.mapname');
  if (!link) return;
  event.preventDefault(); event.stopImmediatePropagation();
  api.request(link);
});
status('idle', '点击聊天消息中的“传送到活动地点”。');
document.body.dataset.confirmations = '0';
Promise.all(Object.keys(manifest).map(decodeBmp)).then(() => { document.body.dataset.assetsReady = 'true'; });
`;
const previewJs = [
  '// Native templates, popup method, and button function extracted from the generated runtime.',
  'const values = ' + JSON.stringify(values) + ';',
  'const manifest = ' + JSON.stringify(manifest) + ';',
  stubSource,
  functions._popupPosition,
  functions._createButton,
  'const UIManager = { getComponent: name => { if (name !== "WinPopup") throw new Error("Unexpected preview component"); return WinPopup; }, ' + promptMethod + ' };',
  createLastroChatMapLinks.toString(),
  setupSource,
].join('\n');
await writeFile('generated/chat-map-links-preview.js', previewJs);
await writeFile('generated/chat-map-links-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LASTRO 活动通知传送预览</title>
<link rel="stylesheet" href="/fonts/misans.css"><style>body{margin:0;padding:28px;background:#1e2925;color:#e9ede8;font:14px Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif}header{max-width:860px;margin:auto}h1{font-size:20px;margin:0 0 8px}p{line-height:1.7}.chatbox{max-width:860px;margin:32px auto;background:rgba(0,0,0,.6);border:1px solid #d1c3ad;border-radius:4px;text-shadow:1px 1px #000}.tabs{display:flex;border-bottom:1px solid #d1c3ad}.tab{padding:7px 22px;border-right:1px solid #d1c3ad;font-size:18px}.messages{padding:10px 12px;line-height:1.6;font-size:18px;min-height:94px}.green{color:#49ef48}#chat{color:#ff3838}a.mapname{color:#ffd76b;text-decoration:underline;cursor:pointer}a.mapname:focus-visible{outline:2px solid #ffd76b;outline-offset:2px}#state{color:#ffd76b;min-height:24px}#assets{color:#ffb49f;font-size:12px;white-space:pre-wrap}</style>
<header><h1>LASTRO · 活动通知传送</h1><p>离线预览：活动链接与 RO 原生确认窗口。确认只更新本页状态。</p><div id="state"></div><div id="assets">${failures.length ? failures.join('\n') : ''}</div></header>
<section class="chatbox"><div class="tabs"><div class="tab">一般信息</div><div class="tab">战役信息</div></div><div class="messages"><div class="green">锁定坐标 132 269</div><div class="green" id="challenge"></div><div class="green" id="message"></div><div id="chat"></div></div></section>
<script type="module" src="./chat-map-links-preview.js"></script></html>`);
console.log('Native popup artwork: ' + assets.filter(asset => manifest[asset]).length + '/' + assets.length);
if (failures.length) console.warn(failures.join('\n'));
console.log('Preview: /generated/chat-map-links-preview.html');
