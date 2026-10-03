import ts from 'typescript';

/* global Map_default, EntityManager, Room */

function lastroSetShopTitleVisibility(text) {
  const parts = text.trim().split(/\s+/);
  let visible;
  if (parts.length === 1) visible = Map_default.showshop === false;
  else if (parts.length === 2 && /^(on|off|1|0)$/i.test(parts[1])) {
    visible = /^(on|1)$/i.test(parts[1]);
  } else {
    this.addText('用法：/showshop [on|off|1|0]', this.TYPE.INFO, this.FILTER.PUBLIC_LOG);
    return;
  }
  Map_default.showshop = visible;
  Map_default.save();
  EntityManager.forEach(function (entity) {
    const room = entity.room;
    if (room && (room.type === Room.Type.BUY_SHOP || room.type === Room.Type.SELL_SHOP)) {
      room.refreshShopTitleVisibility();
    }
    return true;
  });
  this.addText('商店标题：' + (visible ? '显示' : '隐藏'), this.TYPE.INFO, this.FILTER.PUBLIC_LOG);
}

function refreshShopTitleVisibility() {
  const host = this.node?._host;
  if (!host) return true;
  if (this._lastroShopTitleHost !== host) {
    this._lastroShopTitleHost = host;
    this._lastroShopTitleHidden = false;
    this._lastroShopTitleDisplay = undefined;
  }
  const shop = this.type === Room.Type.BUY_SHOP || this.type === Room.Type.SELL_SHOP;
  const hidden = shop && Map_default.showshop === false;
  if (hidden) {
    if (!this._lastroShopTitleHidden) {
      this._lastroShopTitleDisplay = host.style.display;
      this._lastroShopTitleHidden = true;
    }
    if (host.style.display !== 'none') host.style.display = 'none';
  } else if (this._lastroShopTitleHidden) {
    const display = this._lastroShopTitleDisplay;
    if (host.style.display !== display) host.style.display = display;
    this._lastroShopTitleHidden = false;
    this._lastroShopTitleDisplay = undefined;
  }
  return hidden;
}

function fail(label) { throw new Error('anchor:shop-titles:' + label); }
function compact(text) { return text.replace(/\s/g, ''); }

function patchRegion(source, path, mutate) {
  const marker = '//#region ' + path, start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start), next = source.indexOf('//#region ', start + marker.length);
  if (end < 0 || (next >= 0 && next < end) || source.indexOf(marker, start + marker.length) >= 0
      || !/^\r?\n/.test(source.slice(start + marker.length))) fail(path);
  const region = source.slice(start, end), eol = region.includes('\r\n') ? '\r\n' : '\n';
  if (region.includes('lastro-shop-titles-installed')) fail('already-installed');
  const file = ts.createSourceFile(path, region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  if (file.parseDiagnostics.length) fail(path + ':syntax');
  const find = predicate => {
    const matches = [];
    function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
    visit(file); return matches;
  };
  const one = (predicate, label) => {
    const matches = find(predicate);
    if (matches.length !== 1) fail(label);
    return matches[0];
  };
  mutate({ file, edits, one, find });
  edits.push({ start: region.indexOf('\n') + 1, text: '// lastro-shop-titles-installed\n' });
  let output = region;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text.replace(/\r?\n/g, eol) + output.slice(edit.end ?? edit.start);
  }
  return source.slice(0, start) + output + source.slice(end);
}

/** Toggle only native overhead store titles; retain room and store packet data. */
export function patchRuntimeShopTitles(source) {
  source = patchRegion(source, 'src/Preferences/Map.js', ({ file, edits, one }) => {
    const preference = one(node => ts.isCallExpression(node) && node.expression.getText(file) === 'Preferences.get'
      && !!node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'Map', 'map-preference');
    const defaults = preference.arguments[1];
    if (preference.arguments.length !== 3 || !ts.isObjectLiteralExpression(defaults)
      || !ts.isBinaryExpression(preference.parent) || preference.parent.left.getText(file) !== 'Map_default'
      || defaults.properties.some(node => node.name?.getText(file) === 'showshop')) fail('map-defaults');
    const showname = defaults.properties.filter(node => node.name?.getText(file) === 'showname');
    if (showname.length !== 1 || !ts.isPropertyAssignment(showname[0])
      || showname[0].initializer.kind !== ts.SyntaxKind.TrueKeyword) fail('map-showname');
    edits.push({ start: defaults.properties.pos, text: '\n      showshop: true,' });
  });
  source = patchRegion(source, 'src/Controls/ProcessCommand.js', ({ file, edits, one }) => {
    const store = one(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'CommandStore'
      && ts.isObjectLiteralExpression(node.right), 'command-store');
    if (store.right.properties.some(node => node.name?.getText(file) === 'showshop')) fail('command-existing');
    const showname = store.right.properties.filter(node => node.name?.getText(file) === 'showname');
    if (showname.length !== 1 || !ts.isPropertyAssignment(showname[0])
      || !ts.isObjectLiteralExpression(showname[0].initializer)
      || !compact(showname[0].getText(file)).includes('Map_default.showname=!Map_default.showname;')) fail('command-showname');
    one(node => ts.isCallExpression(node) && node.expression.getText(file) === 'init_Map'
      && node.arguments.length === 0, 'command-map-init');
    edits.push({ start: store.right.properties.pos, text: `
    showshop: {
      description: "Shows or hides native store titles",
      callback: ${lastroSetShopTitleVisibility.toString()},
    },` });
  });
  return patchRegion(source, 'src/Renderer/Entity/EntityRoom.js', ({ file, edits, one, find }) => {
    const room = one(node => ts.isClassExpression(node) && node.name?.text === 'Room', 'room-class');
    if (!ts.isBinaryExpression(room.parent) || room.parent.left.getText(file) !== 'Room'
      || !ts.isExpressionStatement(room.parent.parent)) fail('room-class-assignment');
    const method = name => {
      const matches = room.members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
      if (matches.length !== 1 || !matches[0].body) fail('room-' + name);
      return matches[0];
    };
    const create = method('create'), render = method('render');
    if (create.parameters.map(node => node.name.getText(file)).join(',') !== 'title,id,type,clickable'
      || render.parameters.map(node => node.name.getText(file)).join(',') !== 'matrix'
      || room.members.some(node => node.name?.getText(file) === 'refreshShopTitleVisibility')
      || compact(render.body.statements[0]?.getText(file) ?? '') !== 'constui=this.node.ui[0];') fail('room-contract');
    const types = room.members.filter(node => ts.isPropertyDeclaration(node) && node.name.getText(file) === 'Type');
    if (types.length !== 1 || !types[0].modifiers?.some(node => node.kind === ts.SyntaxKind.StaticKeyword)
      || !types[0].initializer || !ts.isObjectLiteralExpression(types[0].initializer)
      || compact(types[0].initializer.getText(file)) !== '{SELL_SHOP:0,BUY_SHOP:1,PUBLIC_CHAT:2,PRIVATE_CHAT:3,}') fail('room-types');
    const init = one(node => ts.isFunctionDeclaration(node) && node.name?.text === 'init'
      && node.parent === create.body && node.parameters.length === 0, 'room-create-init');
    const type = one(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'self.type'
      && node.right.getText(file) === 'type', 'room-type');
    if (type.parent.parent !== init.body || !ts.isExpressionStatement(type.parent)) fail('room-type-context');
    const load = one(node => ts.isCallExpression(node) && node.expression.getText(file) === 'Client.loadFile', 'room-icon-load');
    const callback = load.arguments[1];
    if (load.arguments.length !== 2 || compact(load.arguments[0].getText(file)) !== 'DB.INTERFACE_PATH+filename+".bmp"'
      || !ts.isFunctionExpression(callback) || !callback.body || callback.parameters.length !== 1
      || callback.parameters[0].name.getText(file) !== 'url'
      || compact(callback.body.getText(file)) !== '{self.display=true;if(self.node)self.node.setTitle(title,url);}') fail('room-icon-callback');
    const clone = one(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'this.node'
      && compact(node.right.getText(file)) === 'EntityRoom_default.clone("EntityRoom",true)', 'room-clone');
    if (!ts.isExpressionStatement(clone.parent) || clone.parent.parent !== create.body
      || find(node => ts.isCallExpression(node) && node.expression.getText(file) === 'this.node.append').length !== 2
      || !compact(create.body.getText(file)).includes('constself=this;')) fail('room-clone-context');
    const dependency = one(node => ts.isCallExpression(node) && node.expression.getText(file) === 'init_EntityRoom$1'
      && node.arguments.length === 0, 'room-ui-init');
    if (!ts.isExpressionStatement(dependency.parent)
      || dependency.parent.parent !== room.parent.parent.parent
      || find(node => ts.isCallExpression(node) && node.expression.getText(file) === 'init_Map').length) fail('room-map-init');
    edits.push({ start: dependency.parent.getStart(file), text: 'init_Map();\n  ' });
    edits.push({ start: type.parent.end, text: '\n        self.refreshShopTitleVisibility();' });
    edits.push({ start: callback.body.end - 1, text: '\n          self.refreshShopTitleVisibility();\n        ' });
    edits.push({ start: clone.parent.end, text: `
      const onAppend = this.node.onAppend;
      this.node.onAppend = function (...args) {
        if (typeof onAppend === "function") onAppend.apply(this, args);
        self.refreshShopTitleVisibility();
      };` });
    edits.push({ start: render.body.getStart(file) + 1, text: '\n      if (this.refreshShopTitleVisibility()) return;' });
    edits.push({ start: room.members.end, text: '\n    ' + refreshShopTitleVisibility.toString().replace(/^function /, '') + '\n  ' });
  });
}
