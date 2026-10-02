import ts from 'typescript';

const nativeHandlers = `
function onSelectEmoticon(canvas) {
  const idx = canvas.getAttribute("data-index");
  const cmd = Emotions_default.names[idx];
  if (cmd && ShortCuts_default.ui.is(":visible")) {
    if (ShortCuts_default.ui.find(".input_macro_focus").length) {
      ShortCuts_default.ui.find(".input_macro_focus").val("/" + cmd).select();
      return;
    }
  }
  if (cmd) ChatBox_default.ui.find(".input .message").html("/" + cmd).focus();
}
function onPlayEmoticon(canvas) {
  const idx = canvas.getAttribute("data-index");
  const cmd = Emotions_default.names[idx];
  ChatBox_default.ui.find(".input .message").html("/" + cmd);
  ChatBox_default.submit();
}
`;

const repairedHandlers = `
function onSelectEmoticon(canvas) {
  const idx = canvas?.getAttribute?.("data-index");
  if (typeof idx !== "string" || !/^\\d+$/.test(idx) || !Object.hasOwn(Emotions_default.names, idx)) return;
  const cmd = Emotions_default.names[idx];
  if (typeof cmd !== "string" || !cmd) return;
  const shortcuts = typeof ShortCuts_default === "undefined" ? null : ShortCuts_default;
  if (shortcuts?._host?.isConnected && !shortcuts._host.hidden && shortcuts.ui?.is?.(":visible")) {
    const macro = shortcuts.getRoot?.()?.querySelector("input.input_macro_focus");
    if (macro) {
      macro.value = "/" + cmd;
      macro.select();
      return;
    }
  }
  const chat = typeof ChatBox_default === "undefined" ? null : ChatBox_default;
  const input = chat?.getRoot?.()?.querySelector(".input .message");
  if (!input) return;
  input.textContent = "/" + cmd;
  input.focus();
}
function onPlayEmoticon(canvas) {
  const idx = canvas?.getAttribute?.("data-index");
  if (typeof idx !== "string" || !/^\\d+$/.test(idx) || !Object.hasOwn(Emotions_default.names, idx)) return;
  const cmd = Emotions_default.names[idx];
  if (typeof cmd !== "string" || !cmd) return;
  const chat = typeof ChatBox_default === "undefined" ? null : ChatBox_default;
  const input = chat?.getRoot?.()?.querySelector(".input .message");
  if (!input || typeof chat.submit !== "function") return;
  input.textContent = "/" + cmd;
  chat.submit();
}
`;

const parse = source => ts.createSourceFile('Emoticons.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function bodyText(node, file) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, node.body.getText(file));
  const tokens = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) tokens.push([token, scanner.getTokenText()]);
  return JSON.stringify(tokens);
}
const nativeFile = parse(nativeHandlers), repairedFile = parse(repairedHandlers);
const expected = new Map(nativeFile.statements.map(node => [node.name.text, bodyText(node, nativeFile)]));
const replacements = new Map(repairedFile.statements.map(node => [node.name.text, node]));
const fail = reason => { throw new Error('anchor:emoticons:' + reason); };

/** Repair only the two legacy input operations; keep the native event and packet paths. */
export function patchRuntimeEmoticons(source) {
  const marker = '//#region src/UI/Components/Emoticons/Emoticons.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  if (source.indexOf(marker, start + marker.length) >= 0) fail('duplicate-region');
  const end = source.indexOf('//#endregion', start);
  if (end < 0) fail('missing-region-end');
  const region = source.slice(start, end), file = parse(region);
  if (file.parseDiagnostics.length) fail('invalid-source');
  const edits = [];
  for (const [name, replacement] of replacements) {
    const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const fn = matches[0];
    if (matches.length !== 1 || !fn.body || fn.parameters.length !== 1 || fn.parameters[0].name.getText(file) !== 'canvas') fail(name);
    const body = bodyText(fn, file);
    if (body === bodyText(replacement, repairedFile)) continue;
    if (body !== expected.get(name)) fail(name + ':body');
    edits.push({ start: fn.body.getStart(file), end: fn.body.end, text: replacement.body.getText(repairedFile) });
  }
  let output = region;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return source.slice(0, start) + output + source.slice(end);
}
