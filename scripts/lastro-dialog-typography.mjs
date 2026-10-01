import ts from 'typescript';

function replaceExact(source, needle, replacement, expected = 1) {
  if (source.split(needle).length - 1 !== expected) throw new Error('anchor:dialog-typography');
  return source.replaceAll(needle, replacement);
}

export function patchRuntimeDialogTypography(source) {
  const marker = '//#region src/Renderer/Entity/EntityDialog.js';
  const start = source.indexOf(marker);
  // Small patch fixtures may omit this independent renderer component.
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:dialog-typography');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('EntityDialog.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const classes = [];
  function visit(node) {
    if (ts.isClassExpression(node) && ts.isBinaryExpression(node.parent)
      && node.parent.left.getText(file) === 'Dialog') classes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (classes.length !== 1) throw new Error('anchor:dialog-typography');
  const methods = name => classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
  const setters = methods('set');
  const renderers = methods('render');
  if (setters.length !== 1 || renderers.length !== 1 || !setters[0].body || !renderers[0].body
    || setters[0].parameters.map(node => node.name.getText(file)).join(',') !== 'text,fontColor'
    || renderers[0].parameters.map(node => node.name.getText(file)).join(',') !== 'matrix') {
    throw new Error('anchor:dialog-typography');
  }
  const set = setters[0];
  const render = renderers[0];
  let setBody = set.body.getText(file);
  setBody = replaceExact(setBody, 'const ctx = this.ctx;', 'const ctx = this.ctx;\n      const dialogDpr = window.devicePixelRatio || 1;');
  setBody = replaceExact(setBody, 'ctx.font = "12px Arial";', 'ctx.font = \'400 12px Arial, "Microsoft YaHei", MiSans, "LastRO Glyph Fallback", sans-serif\';', 2);
  // Measure and wrap in CSS pixels. Only the bitmap gets the higher resolution.
  setBody = replaceExact(setBody, 'ctx.canvas.width = 14 + width;', [
    'const dialogWidth = Math.ceil(14 + width);',
    '      const dialogHeight = 8 + 17 * lines.length;',
    '      ctx.canvas.width = Math.ceil(dialogWidth * dialogDpr);',
    '      ctx.canvas.style.width = dialogWidth + "px";',
  ].join('\n'));
  setBody = replaceExact(setBody, 'ctx.canvas.height = 8 + 17 * lines.length;', [
    'ctx.canvas.height = Math.ceil(dialogHeight * dialogDpr);',
    '      ctx.canvas.style.height = dialogHeight + "px";',
    '      ctx.setTransform(dialogDpr, 0, 0, dialogDpr, 0, 0);',
  ].join('\n'));
  setBody = replaceExact(setBody, 'ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);', 'ctx.fillRect(0, 0, dialogWidth, dialogHeight);');
  setBody = replaceExact(setBody, 'roundRect(ctx, 0.5, 0.5, ctx.canvas.width - 1, ctx.canvas.height - 1, 2);', 'roundRect(ctx, 0.5, 0.5, dialogWidth - 1, dialogHeight - 1, 2);');
  let renderBody = render.body.getText(file);
  renderBody = replaceExact(renderBody, 'const canvas = this.canvas;', [
    'const canvas = this.canvas;',
    '      const dialogWidth = parseFloat(canvas.style.width) || canvas.width;',
    '      const dialogHeight = parseFloat(canvas.style.height) || canvas.height;',
  ].join('\n'));
  renderBody = replaceExact(renderBody, '((_pos$2[1] - canvas.height - 2) | 0)', '((_pos$2[1] - dialogHeight - 2) | 0)');
  renderBody = replaceExact(renderBody, '((_pos$2[0] - canvas.width / 2) | 0)', '((_pos$2[0] - dialogWidth / 2) | 0)');
  let output = region;
  for (const [node, body] of [[set.body, setBody], [render.body, renderBody]].sort((a, b) => b[0].getStart(file) - a[0].getStart(file))) {
    output = output.slice(0, node.getStart(file)) + body + output.slice(node.end);
  }
  return source.slice(0, start) + output + source.slice(end);
}
