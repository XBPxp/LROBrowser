import ts from 'typescript';

const regularFamily = "Arial, 'Microsoft YaHei', 'MiSans', 'LastRO Glyph Fallback', sans-serif";
const componentTypography = {
  ...Object.fromEntries([0, 1, 3, 4, 5].map(version => [
    `BasicInfo/BasicInfoV${version}/BasicInfoV${version}`,
    `#BasicInfoV${version} { font-weight: 400; }\n#BasicInfoV${version} .title { font-weight: 500; }`,
  ])),
  ...Object.fromEntries([0, 1, 2, 3].map(version => [
    `Inventory/InventoryV${version}/InventoryV${version}`,
    `#InventoryV${version} { font-weight: 400; }\n#InventoryV${version} .titlebar .text { font-weight: 500; }`,
  ])),
  'ChatBox/ChatBox': '#chatbox, #chatbox .input input, #chatbox .input .message { font-weight: 400; }',
  'ItemInfo/ItemInfo': '.ItemInfo { font-weight: 400; }\n.ItemInfo .title { font-weight: 500; }',
};

function patchComponentTypography(source) {
  return source.replace(/\/\/#region src\/UI\/Components\/([^\r\n]+)\.css\?raw\r?\n[\s\S]*?\/\/#endregion/g, (region, component) => {
    const extra = componentTypography[component];
    if (!extra || region.includes('LASTRO regular typography: ' + component)) return region;
    const file = ts.createSourceFile('typography-css.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let literal;
    function visit(node) {
      if (ts.isBinaryExpression(node) && ts.isStringLiteral(node.right)) {
        if (literal) throw new Error('anchor:typography-' + component);
        literal = node.right;
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (!literal) throw new Error('anchor:typography-' + component);
    const css = literal.text + '\n/* LASTRO regular typography: ' + component + ' */\n' + extra + '\n';
    return region.slice(0, literal.getStart(file)) + JSON.stringify(css) + region.slice(literal.end);
  });
}

export function patchRuntimeTypography(source) {
  const commonPattern = /(Common_default\$1\s*=\s*)("(?:\\.|[^"\\])*")/;
  const match = source.match(commonPattern);
  if (!match) throw new Error('anchor:common-css');
  const escapeMap = { '\\r': '\r', '\\n': '\n', '\\t': '\t', '\\b': '\b', '\\f': '\f', '\\v': '\v', '\\\\': '\\', '\\"': '"' };
  let css = match[2].slice(1, -1).replace(/\\(?:r|n|t|b|f|v|\\|")/g, escape => escapeMap[escape]);
  css = css.replaceAll('SCDream', 'MiSans').replace(/\/\*[\s\S]*?\*\/|\bfont-size-adjust\s*:\s*(?:none|from-font|[0-9.]+)\s*;/g,
    declaration => declaration.startsWith('/*') ? declaration : 'font-size-adjust: none;');
  css += `\r\n:host, body { font-family: ${regularFamily}; font-weight: 400; font-size-adjust: none; font-synthesis: none; }\r\nbody { font-size: 12px; }\r\n`;
  let output = source.replace(match[0], `${match[1]}${JSON.stringify(css)}`);
  if (output.includes('function loadFontFromClient(')) {
    const file = ts.createSourceFile('Online.js', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const functions = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadFontFromClient');
    if (functions.length !== 1) throw new Error('anchor:client-font-loader');
    const loader = functions[0];
    output = output.slice(0, loader.getStart(file)) + output.slice(loader.end);
    const call = /loadFontFromClient\("System\/Font\/"\);/g;
    if ([...output.matchAll(call)].length !== 1) throw new Error('anchor:client-font-call');
    output = output.replace(call, '');
  }
  output = patchComponentTypography(output);
  const marker = '//#region src/UI/Components/ChatBox/ChatBox.js';
  const start = output.indexOf(marker);
  // Small patch fixtures may omit this independent chat component.
  if (start >= 0) {
    const end = output.indexOf('//#endregion', start);
    if (end < 0 || output.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:chat-font-family');
    const chat = output.slice(start, end);
    const assignment = 'el.style.fontFamily = "Arial";';
    if (chat.split(assignment).length - 1 !== 1) throw new Error('anchor:chat-font-family');
    const patched = chat.replace(assignment, `el.style.fontFamily = ${JSON.stringify(regularFamily)};`);
    output = output.slice(0, start) + patched + output.slice(end);
  }
  return output.replaceAll('SCDream', 'MiSans');
}
