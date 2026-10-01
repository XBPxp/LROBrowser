import ts from 'typescript';

/** Keep the native autoloot cache in server units and clarify its display meaning. */
export function patchRuntimeAutolootSettings(source) {
  const marker = '//#region src/UI/Components/LastROTools/LastROTools.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:autoloot-settings:component');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('LastROTools.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods = [], templates = [];
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.left.getText(file) === 'LastROTools.updateField') methods.push(node.right);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'patchLastROToolsTemplate') templates.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const method = methods[0];
  if (methods.length !== 1 || !ts.isFunctionExpression(method)
    || method.parameters.map(node => node.name.getText(file)).join(',') !== 'field,input') throw new Error('anchor:autoloot-settings:update-field');
  const cacheAssignments = [];
  function collectCache(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.left.getText(file) === 'this._settingState[field]') cacheAssignments.push(node);
    ts.forEachChild(node, collectCache);
  }
  collectCache(method.body);
  const cache = cacheAssignments[0];
  const first = method.body.statements[0]?.getText(file).replace(/\s/g, '');
  const expectedUpdates = 'constupdates=buildAutoBattleFieldUpdates(field,input.type==="checkbox"?input.checked:input.value,input.type,);';
  if (first !== expectedUpdates || cacheAssignments.length !== 1
    || cache.right.getText(file).replace(/\s/g, '') !== 'input.type==="checkbox"?Boolean(input.checked):input.value') {
    throw new Error('anchor:autoloot-settings:cache-units');
  }
  if (templates.length !== 1 || !templates[0].body) throw new Error('anchor:autoloot-settings:template-function');
  const literals = [];
  function collectTemplate(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'LastROTools_default$1'
      && ts.isNoSubstitutionTemplateLiteral(node.right)) literals.push(node.right);
    ts.forEachChild(node, collectTemplate);
  }
  collectTemplate(templates[0].body);
  if (literals.length !== 1) throw new Error('anchor:autoloot-settings:template');
  const literal = literals[0];
  const original = literal.getText(file);
  const labels = [
    ['拾取概率：<span class="lt-controls">自动拾取概率为 ', '掉落率上限：<span class="lt-controls">'],
    ['<span class="lt-unit">% 以下的物品</span>', '<span class="lt-unit">%</span>'],
    ['输入百分比，发送时自动转换为万分比，例如 0.1% = 10。', '按物品掉落率筛选，50% 表示掉落率上限，并非拾取成功率。修改后移开输入焦点即可发送设置，无需重新开关自动捡物。'],
  ];
  let updatedTemplate = original;
  for (const [before, after] of labels) {
    if (updatedTemplate.split(before).length !== 2) throw new Error('anchor:autoloot-settings:label');
    updatedTemplate = updatedTemplate.replace(before, after);
  }
  const edits = [
    { from: start + cache.right.getStart(file), to: start + cache.right.end,
      value: `field === "autoloot" ? updates[0].value : (${cache.right.getText(file)})` },
    { from: start + literal.getStart(file), to: start + literal.end, value: updatedTemplate },
  ];
  for (const edit of edits.sort((a, b) => b.from - a.from)) source = source.slice(0, edit.from) + edit.value + source.slice(edit.to);
  return source;
}
