import ts from 'typescript';

export function patchRuntimeWeaponViewFallback(source) {
  const paths = ['src/DB/DBManager.js', 'src/Renderer/Entity/EntityView.js'];
  const regions = paths.map(path => {
    const marker = '//#region ' + path, start = source.indexOf(marker);
    if (start < 0) return null;
    const end = source.indexOf('//#endregion', start);
    if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:weapon-view-fallback:region');
    const text = source.slice(start, end);
    return { start, end, text, file: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) };
  });
  if (regions.every(region => !region)) return source;
  if (regions.some(region => !region)) throw new Error('anchor:weapon-view-fallback:regions');
  const marker = '/* lastro-weapon-view-fallback */';
  if (source.includes(marker)) throw new Error('anchor:weapon-view-fallback:already-installed');
  function one(file, predicate, label) {
    const found = [];
    function visit(node) {
      if (predicate(node)) found.push(node);
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (found.length !== 1) throw new Error('anchor:weapon-view-fallback:' + label);
    return found[0];
  }
  const [db, view] = regions;
  const resolver = one(db.file, node => ts.isMethodDeclaration(node)
    && node.name.getText(db.file) === 'getWeaponViewID', 'native-resolver');
  if (!resolver.body || resolver.parameters.length !== 1 || resolver.parameters[0].name.getText(db.file) !== 'id'
      || !resolver.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)
      || !ts.isClassExpression(resolver.parent) || resolver.parent.name?.text !== 'DB') throw new Error('anchor:weapon-view-fallback:resolver-signature');
  if (resolver.parent.members.some(node => node.name?.getText(db.file) === 'getWeaponFallbackViewID')) throw new Error('anchor:weapon-view-fallback:resolver-exists');
  const factory = one(view.file, node => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === 'UpdateGeneric'
    && node.arguments.length === 3 && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === 'weapon', 'weapon-factory');
  if (!ts.isStringLiteral(factory.arguments[1]) || factory.arguments[1].text !== 'getWeaponPath'
      || !ts.isStringLiteral(factory.arguments[2]) || factory.arguments[2].text !== 'getWeaponViewID') throw new Error('anchor:weapon-view-fallback:factory-signature');
  const helper = `
    ${marker}
    static getWeaponFallbackViewID(id) {
      const view = DB.getWeaponViewID(id);
      if (Object.prototype.hasOwnProperty.call(WeaponTypeExpansion, view)) {
        const base = WeaponTypeExpansion[view];
        if (Number.isInteger(base) && base >= 0 && base < WeaponType_default.MAX) return base;
      }
      return view;
    }`;
  const changes = [
    [db.start + resolver.end, db.start + resolver.end, helper],
    [view.start + factory.arguments[2].getStart(view.file), view.start + factory.arguments[2].end, '"getWeaponFallbackViewID"'],
  ];
  let output = source;
  for (const [start, end, replacement] of changes.sort((a, b) => b[0] - a[0])) output = output.slice(0, start) + replacement + output.slice(end);
  return output;
}
