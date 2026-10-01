import ts from 'typescript';

// These two native buttons normally use BMPs. Keep a readable button while
// those passive assets are loading or unavailable, without changing UIButton.
function installLastroNpcDialogButtonFallback(npc) {
  let observer = null;
  const stop = () => { observer?.disconnect(); observer = null; };
  function attach() {
    stop();
    const root = npc.getRoot();
    const buttons = [['.next', '下一步'], ['.close', '关闭']].map(([selector, label]) => {
      const button = root?.querySelector(selector);
      if (button) {
        button.textContent = label;
        button.setAttribute('aria-label', label);
      }
      return button;
    }).filter(Boolean);
    const update = () => {
      for (const button of buttons) {
        const image = button.style.backgroundImage;
        button.classList.toggle('lastro-npc-button-fallback', !image || image === 'none');
      }
    };
    update();
    const win = npc._host?.ownerDocument.defaultView;
    if (win && npc.__active && npc._host.isConnected) {
      observer = new win.MutationObserver(update);
      for (const button of buttons) observer.observe(button, { attributes: true, attributeFilter: ['style'] });
    }
  }
  const append = npc.onAppend, remove = npc.onRemove;
  npc.onAppend = function (...args) {
    const result = append?.apply(this, args);
    attach();
    return result;
  };
  npc.onRemove = function (...args) {
    stop();
    return remove?.apply(this, args);
  };
}

const fallbackCss = `
#NpcBox .btn { color: transparent; }
#NpcBox .btn.lastro-npc-button-fallback {
  box-sizing: border-box;
  border: 1px solid #b0b8c4;
  border-radius: 3px;
  background-image: linear-gradient(#ffffff, #e5e9ef);
  color: #303848;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  cursor: pointer;
}
#NpcBox .btn.lastro-npc-button-fallback:hover { border-color: #7b96c1; }
#NpcBox .btn.lastro-npc-button-fallback:active { background-image: linear-gradient(#d9e1ee, #f0f3f8); }
`;

function fail(label) { throw new Error('anchor:npc-dialog-buttons:' + label); }

function parseRegion(source, name) {
  const marker = '//#region ' + name, start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) fail(name);
  const end = source.indexOf('//#endregion', start);
  if (end < start) fail(name);
  const text = source.slice(start, end);
  return { start, text, file: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) };
}

function one(region, predicate, label) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(region.file);
  if (found.length !== 1) fail(label);
  return found[0];
}

export function patchRuntimeNpcDialogButtons(source) {
  const npcMarker = '//#region src/UI/Components/NpcBox/NpcBox.js';
  if (!source.includes(npcMarker)) return source;
  if (source.includes('/* lastro-npc-dialog-buttons */')) fail('already-installed');
  const npc = parseRegion(source, 'src/UI/Components/NpcBox/NpcBox.js');
  const engine = parseRegion(source, 'src/Engine/MapEngine/NPC.js');
  const css = parseRegion(source, 'src/UI/Components/NpcBox/NpcBox.css?raw');
  const close = one(engine, node => ts.isFunctionDeclaration(node) && node.name?.text === 'onCloseAppear', 'close-handler');
  const condition = close.body?.statements[0];
  if (close.parameters.length !== 1 || close.parameters[0].name.getText(engine.file) !== 'pkt'
    || close.body?.statements.length !== 1 || !condition || !ts.isIfStatement(condition)
    || condition.elseStatement || condition.expression.getText(engine.file) !== 'NpcBox_default.ui && NpcBox_default.ui.is(":visible")'
    || condition.thenStatement.getText(engine.file) !== 'NpcBox_default.addClose(pkt.NAID);') fail('close-body');
  const register = one(npc, node => ts.isBinaryExpression(node) && node.left.getText(npc.file) === 'NpcBox_default'
    && node.right.getText(npc.file) === 'UIManager.addComponent(NpcBox)', 'register');
  for (const name of ['onRemove', 'addNext', 'addClose', 'next', 'close']) {
    one(npc, node => ts.isBinaryExpression(node) && node.left.getText(npc.file) === 'NpcBox.' + name
      && ts.isFunctionExpression(node.right), name);
  }
  const style = one(css, node => ts.isBinaryExpression(node) && node.left.getText(css.file) === 'NpcBox_default$1'
    && ts.isStringLiteral(node.right), 'css').right;
  if (!style.text.includes('#NpcBox .btn {') || !style.text.includes('display: none;')) fail('button-css');
  const edits = [
    { start: engine.start + close.body.getStart(engine.file), end: engine.start + close.body.end, text: `{
  // A terminal dialog packet is protocol state, not a layout visibility query.
  // Keep it while the current dialog is temporarily hidden, and ignore stale
  // packets after removal or when another NPC owns the window.
  if (NpcBox_default.__active && NpcBox_default._host?.isConnected && NpcBox_default.ownerID === pkt.NAID)
    NpcBox_default.addClose(pkt.NAID);
}` },
    { start: npc.start + npcMarker.length, end: npc.start + npcMarker.length,
      text: '\n/* lastro-npc-dialog-buttons */\n' + installLastroNpcDialogButtonFallback.toString() + '\n' },
    { start: npc.start + register.getStart(npc.file), end: npc.start + register.getStart(npc.file),
      text: 'installLastroNpcDialogButtonFallback(NpcBox);\n  ' },
    { start: css.start + style.getStart(css.file), end: css.start + style.end, text: JSON.stringify(style.text + fallbackCss) },
  ];
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
