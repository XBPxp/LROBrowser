// Isolated layout fixture using the generated game's actual templates/CSS.
// No connection, account, or live game state is needed.
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync('generated/runtime/Online.js', 'utf8');
const ast = ts.createSourceFile('Online.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const values = {};
let lootInstaller;
const wanted = new Set(['Common_default$1', 'ShortCut_default$1', 'ShortCut_default$2', 'ItemObtain_default$1', 'ItemObtain_default$2']);
function visit(node) {
  if (ts.isBinaryExpression(node) && wanted.has(node.left.getText(ast)) && ts.isStringLiteral(node.right)) values[node.left.getText(ast)] = node.right.text;
  if (ts.isFunctionExpression(node) && node.name?.text === 'installLastroLootList') lootInstaller = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of wanted) if (!values[name]) throw new Error(`Missing ${name}`);
if (!lootInstaller) throw new Error('Missing pickup list installer');
writeFileSync('generated/localization-preview.js', `
const values = ${JSON.stringify(values)};
function mount(id, css, html) {
  const host = document.getElementById(id);
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = '<style>:host{position:absolute;display:block}' + values['Common_default$1'] + css + '</style>' + html;
  return root;
}
const shortcut = mount('shortcut', values['ShortCut_default$1'], values['ShortCut_default$2']);
document.getElementById('shortcut').style.cssText = 'top:185px;left:40px;height:136px';
shortcut.querySelectorAll('.container').forEach((cell,i)=>{
  cell.innerHTML = '<div class="icon"><div class="img" style="background:#d9e6ed;outline:1px solid #84939c"></div><div class="amount">' + [10,1,5,10,1,258,1,10,1][i%9] + '</div></div>';
});
const notice = mount('notice', values['ItemObtain_default$1'], values['ItemObtain_default$2']);
const noticeHost = document.getElementById('notice');
const motionEvents = [];
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const updateMotionPreference = () => { noticeHost.dataset.reducedMotion = String(motionPreference.matches); };
updateMotionPreference();
motionPreference.addEventListener('change', updateMotionPreference);
for (const type of ['animationstart', 'animationend', 'animationcancel', 'transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']) {
  notice.addEventListener(type, event => {
    motionEvents.push({ type, target: event.target.className, name: event.animationName || event.propertyName, elapsed: event.elapsedTime, at: Math.round(performance.now()) });
    if (motionEvents.length > 100) motionEvents.shift();
    noticeHost.dataset.motionEvents = JSON.stringify(motionEvents);
  });
}
const sampleNames = ['红色药水', '漂亮旧娃娃', '杰勒比结晶', '蓝色药水', '古老冒险者的华丽纪念徽章与祝福结晶', '天地树叶子', '蝴蝶翅膀', '白色药水'];
const DB = { INTERFACE_PATH: '', getItemInfo: () => ({identifiedResourceName:'preview'}), getItemName: item => (item.RefiningLevel ? '+' + item.RefiningLevel + ' ' : '') + sampleNames[item.ITID - 1] };
const previewIcon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ebdca9" d="M9 1h6v5l4 6v9H5v-9l4-6z"/><path fill="#ad655b" d="M7 13h10v6H7z"/><path fill="#f7eacf" d="M9 2h6v3H9z"/><path fill="#fff" opacity=".5" d="M8 10h2v7H8z"/></svg>');
const Client = {loadFile: (_path, done) => done(previewIcon)};
let now = 0, nextTimer = 0;
let playback;
const stopPlayback = () => { clearInterval(playback); playback = undefined; };
const timers = new Map();
const Events = {
  now: () => now,
  clearTimeout: id => timers.delete(id),
  setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, {callback, at:now + ms}); return id; },
};
const pickup = {getRoot: () => notice, _host: document.getElementById('notice'), placeOnTop: () => {}, remove: () => pickup.onRemove()};
(${lootInstaller})(pickup, {DB, Client, Events}, 5000);
const show = (id, count = 1, extra = {}) => pickup.set({ITID:id, IsIdentified:true, count, ...extra});
const advance = ms => {
  const target = now + ms;
  while (true) {
    const due = [...timers].filter(([,timer]) => timer.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
    if (!due) break;
    now = due[1].at;
    timers.delete(due[0]);
    due[1].callback();
  }
  now = target;
  document.getElementById('clock').textContent = '演示时间：' + (now / 1000).toFixed(1) + ' 秒';
};
const burst = () => { stopPlayback(); pickup.onRemove(); now = 0; advance(0); for (let id=1; id<=8; id++) show(id,id===5?9999:id); };
document.getElementById('burst').onclick = burst;
document.getElementById('play').onclick = () => {
  burst();
  let last = performance.now();
  playback = setInterval(() => {
    const current = performance.now();
    advance(current - last);
    last = current;
    if (!timers.size) stopPlayback();
  }, 16);
};
document.getElementById('merge').onclick = () => show(1,3);
document.getElementById('variant').onclick = () => show(2,1,{RefiningLevel:5});
document.getElementById('step').onclick = () => { stopPlayback(); advance(1000); };
document.getElementById('fine').onclick = () => { stopPlayback(); advance(200); };
document.getElementById('expire').onclick = () => { stopPlayback(); advance(5000); };
document.getElementById('clear').onclick = () => { stopPlayback(); pickup.onRemove(); };
burst();
`);
writeFileSync('generated/localization-preview.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>LASTRO 字体与布局复核</title>
<link rel="stylesheet" href="/fonts/misans.css"><style>body{margin:0;background:#18202b;color:#e7edf4;font:14px Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif}header{padding:20px 40px}h1{font-size:20px;margin:0 0 8px}#shortcut{background:white;color:#222}#notice{color:#222}</style>
<header><h1>LASTRO · 连续拾取提示</h1><div>实际列表逻辑、示例图标。沿用游戏动效与系统的减少动画设置。</div><div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px"><button id="play">实时播放动画</button><button id="burst">连续获得 8 种物品</button><button id="merge">再获得红色药水 ×3</button><button id="variant">获得同名 +5 物品</button><button id="step">推进 1 秒</button><button id="fine">推进 0.2 秒</button><button id="expire">推进 5 秒</button><button id="clear">清空</button></div><p id="clock">演示时间：0 秒</p></header><div id="shortcut"></div><div id="notice"></div>
<script type="module" src="./localization-preview.js"></script></html>`);
