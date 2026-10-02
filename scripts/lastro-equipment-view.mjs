import ts from 'typescript';

function replaceExact(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error('anchor:equipment-view');
  return source.replace(needle, replacement);
}

export function patchRuntimeEquipmentCatalog(source) {
  let output = source;
  function patch(path, update) {
    const marker = '//#region ' + path;
    const start = output.indexOf(marker);
    if (start < 0) return;
    const end = output.indexOf('//#endregion', start);
    if (end < 0 || output.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:equipment-catalog:' + path);
    output = output.slice(0, start) + update(output.slice(start, end)) + output.slice(end);
  }
  // These two views must resolve to the existing two-handed rod type, including
  // when the native loader falls back from an item sprite to a weapon class.
  patch('src/DB/Items/WeaponTypeExpansion.js', region => {
    const invalid = 'WeaponType_default.WPCLASS_TWOHANDROD';
    if (region.split(invalid).length !== 3) throw new Error('anchor:equipment-catalog:twohandrod');
    return region.replaceAll(invalid, 'WeaponType_default.TWOHANDROD');
  });
  patch('src/DB/Jobs/JobConst.js', region => {
    if (/\b(?:ARCHBISHOP_2ND|SOUL_REAPER2|SOUL_REAPER2_B|PORING_LINKER_B|PECO_GUNSLINGER_B)\s*[:=]/.test(region)) throw new Error('anchor:equipment-catalog:job-aliases');
    // Older native tables use these names for IDs that already exist in the
    // current job enum. Resolve aliases before any resource tables initialize.
    return replaceExact(region, '  };', `  };
  JobConst_default.ARCHBISHOP_2ND = JobConst_default.ARCH_BISHOP_2ND;
  JobConst_default.SOUL_REAPER2 = JobConst_default.HAETAE_SOUL_REAPER;
  JobConst_default.SOUL_REAPER2_B = JobConst_default.HAETAE_SOUL_REAPER_B;
  JobConst_default.PORING_LINKER_B = JobConst_default.FROG_LINKER_B;
  JobConst_default.PECO_GUNSLINGER_B = JobConst_default.PECO_GUNNER_B;`);
  });
  patch('src/DB/Jobs/MountTable.js', region => replaceExact(region,
    '  MountTable[JobConst_default.CRUSADER_2ND] = JobConst_default.CRUSADER2_2ND;',
    '  // The native enum has no alternate Crusader IDs; do not create an undefined entry.'));
  patch('src/DB/Items/HatTable.js', region => {
    if (region.split('1462: "_À¯ÀÎ¿ø¸¶½ºÅ©",').length !== 2) throw new Error('anchor:equipment-catalog:ape-mask');
    return region;
  });
  patch('src/DB/DBManager.js', region => replaceExact(region,
    '            Object.assign(HatTable_default, json);',
    `            // Some client Lua entries have no resource name. Keep the native
            // mapping so an empty value cannot select the bare sex sprite.
            for (const [id, resource] of Object.entries(json || {})) {
              if (typeof resource === "string" && resource.trim()) {
                // The bundled Ape Mask alias is absent from both resource origins.
                // Its native name has valid SPR/ACT files for both sexes.
                HatTable_default[id] = id === "1462" && resource === "_À¯ÀÎ¿ø°¡¸é"
                  ? "_À¯ÀÎ¿ø¸¶½ºÅ©" : resource;
              }
            }`));
  return output;
}

export function patchRuntimeEquipmentView(source) {
  const marker = '//#region src/Renderer/Entity/EntityView.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('anchor:equipment-view');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('EntityView.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const changes = [];
  function body(name, parameters, update) {
    const nodes = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (nodes.length !== 1 || !nodes[0].body ||
        nodes[0].parameters.map(node => node.name.getText(file)).join(',') !== parameters) throw new Error('anchor:equipment-view');
    changes.push([nodes[0].body, update(nodes[0].body.getText(file).replace(/\r\n/g, '\n'))]);
  }
  body('UpdateBody', 'job', original => {
    let output = replaceExact(original, '  if (job < 0) return;', `  if (job < 0) return;
  const bodyRequest = this._bodyViewSeq = (this._bodyViewSeq || 0) + 1;
  const bodySex = this._sex;`);
    output = replaceExact(output, '      const isStaleCallback =',
      '      if (this._bodyViewSeq !== bodyRequest || this._sex !== bodySex) return;\n      const isStaleCallback =');
    return replaceExact(output, '        refreshHeadState.call(this);\n      }',
      '        refreshHeadState.call(this);\n        this.robe = this._robe;\n      }');
  });
  body('UpdateBodyStyle', 'look', original => {
    let output = replaceExact(original, '  if (look < 0) return;\n  setTimeout(', `  if (look < 0) return;
  const bodyRequest = this._bodyViewSeq = (this._bodyViewSeq || 0) + 1;
  const bodySex = this._sex;
  const displayJob = getEffectiveJob.call(this);
  const transformationSeq = this._transformationSeq || 0;
  const isCurrentBody = () => this._bodyViewSeq === bodyRequest && this._sex === bodySex &&
    getEffectiveJob.call(this) === displayJob && (this._transformationSeq || 0) === transformationSeq;
  this._body = look;
  setTimeout(`);
    output = replaceExact(output, '      this._body = look;\n      let job = this._job;', `      if (!isCurrentBody()) return;
      // LOOK_BODY2 zero resets the style, not the profession. In particular,
      // AllMountTable[0] is the Novice Poring and cannot reset every cash mount.
      let job = look === 0 ? this.costume || this._job : this._job;`);
    output = replaceExact(output, '      if (this.costume) {', '      if (this.costume && look > 0) {');
    output = replaceExact(output, '        function () {\n          this.files.body.spr = path + ".spr";',
      '        function () {\n          if (!isCurrentBody()) return;\n          this.files.body.spr = path + ".spr";');
    return replaceExact(output, '          this.shield = this._shield;',
      '          this.shield = this._shield;\n          this.robe = this._robe;');
  });
  body('UpdateGeneric', 'type,func,fallback', original => {
    let output = replaceExact(original, '    let _val = val;', `    let _val = val;
    // Retain the desired equipment immediately, including while its resources load.
    const requests = this._equipmentViewSeq || (this._equipmentViewSeq = Object.create(null));
    const request = requests[type] = (requests[type] || 0) + 1;
    const sex = this._sex;
    const job = this.job;
    const dependsOnJob = type === "weapon" || type === "shield" || type === "robe";
    const isCurrent = () => requests[type] === request && _this._sex === sex &&
      (!dependsOnJob || _this.job === job);
    this["_" + type] = val;
    this.files[type].spr = null;
    this.files[type].act = null;
    this.files[type].pal = null;
    if (type === "weapon") {
      this.files.weapon_trail.spr = null;
      this.files.weapon_trail.act = null;
    }`);
    output = replaceExact(output, '      Client.loadFile(filepath + ".act");', `      // The verified Ice Wing profession SPR is a successful backpack placeholder.
      // Limit its common-artwork preference to the canonical resource name,
      // including Doram, and retain every other robe's native loading order.
      const commonRobePath = type === "robe" && !final
        ? DB.getRobePathNoSex(val, _this.job, _this._sex) : null;
      const sharedIceWing = typeof commonRobePath === "string" &&
        (commonRobePath.endsWith("/C_Ice_Wing/C_Ice_Wing") ||
          commonRobePath.endsWith("/C_Ice_Wing/C_Ice_Wing_doram"));
      const spritePath = sharedIceWing ? commonRobePath : filepath;
      Client.loadFile(filepath + ".act");`);
    output = replaceExact(output, '        filepath + ".spr",\n        function () {',
      '        spritePath + ".spr",\n        function () {');
    output = replaceExact(output, '_this.files[type].spr = filepath + ".spr";',
      '_this.files[type].spr = spritePath + ".spr";');
    output = replaceExact(output, '              Client.loadFile(fallbackPath + ".spr", function () {',
      '              Client.loadFile(fallbackPath + ".spr", function () {\n                if (!isCurrent()) return;');
    output = replaceExact(output, '        function () {\n          _this["_" + type] = _val;',
      '        function () {\n          if (!isCurrent()) return;\n          _this["_" + type] = _val;');
    output = replaceExact(output, '              Client.loadFile(trail_file + ".spr", function () {',
      '              Client.loadFile(trail_file + ".spr", function () {\n                if (!isCurrent()) return;');
    output = replaceExact(output, '        function () {\n          if (fallback && !final) {',
      '        function () {\n          if (!isCurrent()) return;\n          if (type === "robe" && spritePath !== filepath) {\n            LoadView(filepath, true);\n          } else if (fallback && !final) {');
    return output;
  });
  let output = region;
  for (const [node, replacement] of changes.sort((a, b) => b[0].getStart(file) - a[0].getStart(file))) {
    output = output.slice(0, node.getStart(file)) + replacement + output.slice(node.end);
  }
  return source.slice(0, start) + output + source.slice(end);
}

export function patchRuntimeEquipmentAppearance(source) {
  const marker = '//#region src/Engine/MapEngine/Item.js';
  const start = source.indexOf(marker);
  if (start < 0) return patchRuntimeRobePreviewAppearance(source);
  const fail = label => { throw new Error('anchor:equipment-appearance:' + label); };
  const installed = '/* lastro-equipment-appearance */';
  if (source.includes(installed)) fail('already-installed');
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) fail('region');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('Item.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function one(scope, predicate, label) {
    const matches = [];
    function visit(node) {
      if (predicate(node)) matches.push(node);
      ts.forEachChild(node, visit);
    }
    visit(scope);
    if (matches.length !== 1) fail(label);
    return matches[0];
  }
  const handler = one(file, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'onEquipementTakeOff', 'take-off-handler');
  if (!handler.body || handler.parameters.length !== 1
    || handler.parameters[0].name.getText(file) !== 'pkt') fail('take-off-signature');
  const costume = one(handler.body, node => ts.isIfStatement(node)
    && ts.isBinaryExpression(node.expression)
    && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandToken
    && node.expression.left.getText(file) === 'pkt.wearLocation'
    && node.expression.right.getText(file) === 'EquipmentLocation_default.COSTUME_ROBE', 'costume-robe-branch');
  const statement = costume.thenStatement;
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)
    || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    || statement.expression.left.getText(file) !== 'SessionStorage_default.Entity.robe') fail('robe-assignment');
  const call = statement.expression.right;
  if (!ts.isCallExpression(call) || call.expression.getText(file) !== 'EquipmentController.getUI().checkEquipLoc'
    || call.arguments.length !== 1
    || call.arguments[0].getText(file) !== 'EquipmentLocation_default.COSTUME_ROBE') fail('robe-fallback');
  // The costume has already left the equipment list. Restore the ordinary
  // garment visual instead of checking the now-empty costume slot again.
  const argument = call.arguments[0];
  const helpers = String.raw`
function registerLastroCostumeRobeAppearance(item, viewid, wearLocation) {
  if (!item || !(wearLocation & EquipmentLocation_default.COSTUME_ROBE)
    || !Number.isInteger(viewid) || viewid <= 0
    || typeof RobeTable_default !== "object" || !RobeTable_default) return;
  const known = RobeTable_default[viewid];
  if (typeof known === "string" && known.trim()) return;
  const raw = DB.getItemInfo(item.ITID)?.identifiedResourceName;
  if (typeof raw !== "string") return;
  const resource = raw.trim();
  if (!resource || resource === "." || resource === ".."
    || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(resource)) return;
  RobeTable_default[viewid] = resource;
  const entity = SessionStorage_default.Entity;
  if (entity && entity._robe === viewid) entity.robe = viewid;
}
function registerLastroCostumeRobeList(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item) registerLastroCostumeRobeAppearance(item, item.wItemSpriteNumber, item.WearState);
  }
}
`;
  const edits = [
    { start: handler.getStart(file), end: handler.getStart(file), text: installed + '\n' + helpers },
    { start: argument.getStart(file), end: argument.end, text: 'EquipmentLocation_default.GARMENT' },
  ];
  const equip = one(file, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'onItemEquip', 'equip-handler');
  if (!equip.body || equip.parameters.length !== 1
    || equip.parameters[0].name.getText(file) !== 'pkt') fail('equip-signature');
  const item = one(equip.body, node => ts.isVariableDeclaration(node)
    && node.name.getText(file) === 'item'
    && node.initializer?.getText(file) === 'InventoryController.getUI().removeItem(pkt.index, 1)', 'equip-item');
  if (!ts.isVariableDeclarationList(item.parent) || !ts.isVariableStatement(item.parent.parent)) fail('equip-item-statement');
  const success = item.parent.parent.parent;
  if (!ts.isBlock(success) || !ts.isIfStatement(success.parent)
    || success.parent.thenStatement !== success || success.parent.expression.getText(file) !== 'pkt.result == 1') fail('equip-success');
  edits.push({ start: item.parent.parent.end, end: item.parent.parent.end,
    text: '\n    if (item && Number.isInteger(pkt.viewid) && pkt.viewid >= 0) item.wItemSpriteNumber = pkt.viewid;' });
  const itemInfo = one(equip.body, node => ts.isVariableDeclaration(node)
    && node.name.getText(file) === 'itemInfo'
    && node.initializer?.getText(file) === 'DB.getItemInfo(item?.ITID)', 'equip-item-info');
  if (!ts.isVariableDeclarationList(itemInfo.parent) || !ts.isVariableStatement(itemInfo.parent.parent)
    || itemInfo.parent.declarations.length !== 1) fail('equip-item-info-statement');
  edits.push({ start: itemInfo.parent.parent.getStart(file), end: itemInfo.parent.parent.end, text: '' });
  const registration = one(equip.body, node => ts.isIfStatement(node)
    && node.expression.getText(file).replace(/\s+/g, ' ') === 'pkt.wearLocation & EquipmentLocation_default.COSTUME_ROBE && itemInfo?.identifiedResourceName && typeof RobeTable_default === "object"', 'equip-robe-registration');
  if (!ts.isBlock(registration.thenStatement) || registration.thenStatement.statements.length !== 2) fail('equip-robe-registration-body');
  one(registration.thenStatement, node => ts.isVariableDeclaration(node)
    && node.name.getText(file) === 'resourceName'
    && node.initializer?.getText(file) === 'itemInfo.identifiedResourceName.trim()', 'equip-robe-resource');
  one(registration.thenStatement, node => ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && node.left.getText(file) === 'RobeTable_default[pkt.viewid]'
    && node.right.getText(file) === 'resourceName', 'equip-robe-write');
  edits.push({ start: registration.getStart(file), end: registration.end,
    text: 'registerLastroCostumeRobeAppearance(item, pkt.viewid, pkt.wearLocation);' });
  for (const name of ['onInventorySetList', 'onItemListEquip']) {
    const list = one(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name, name);
    if (!list.body || list.parameters.length !== 1 || list.parameters[0].name.getText(file) !== 'pkt') fail(name + '-signature');
    const setItems = one(list.body, node => ts.isCallExpression(node)
      && node.expression.getText(file) === 'InventoryController.getUI().setItems'
      && node.arguments.length === 1
      && node.arguments[0].getText(file) === 'pkt.itemInfo || pkt.ItemInfo', name + '-items');
    if (!ts.isExpressionStatement(setItems.parent)) fail(name + '-statement');
    if (name === 'onItemListEquip' && (!ts.isCaseClause(setItems.parent.parent)
      || setItems.parent.parent.expression.getText(file) !== '0')) fail('inventory-equip-case');
    edits.push({ start: setItems.parent.getStart(file), end: setItems.parent.getStart(file),
      text: 'registerLastroCostumeRobeList(pkt.itemInfo || pkt.ItemInfo);\n' + (name === 'onItemListEquip' ? '      ' : '  ') });
  }
  let output = region;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return patchRuntimeRobePreviewAppearance(source.slice(0, start) + output + source.slice(end));
}

function patchRuntimeRobePreviewAppearance(source) {
  const marker = '//#region src/UI/Components/ItemPreview/ItemPreview.js';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const fail = label => { throw new Error('anchor:equipment-appearance:preview-' + label); };
  const installed = '/* lastro-robe-preview-appearance */';
  if (source.includes(installed)) fail('already-installed');
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || source.indexOf(marker, start + marker.length) >= 0) fail('region');
  const region = source.slice(start, end);
  const file = ts.createSourceFile('ItemPreview.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = file.statements.filter(node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'getPreviewSpriteId$1');
  if (functions.length !== 1 || !functions[0].body
    || functions[0].parameters.map(node => node.name.getText(file)).join(',') !== 'item,it') fail('function');
  const preview = functions[0], matches = [];
  const resources = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'resourceName') resources.push(node);
    if (ts.isIfStatement(node) && ts.isExpressionStatement(node.thenStatement)
      && ts.isBinaryExpression(node.thenStatement.expression)
      && node.thenStatement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.thenStatement.expression.left.getText(file) === 'RobeTable_default[spriteId]'
      && node.thenStatement.expression.right.getText(file) === 'resourceName') matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(preview.body);
  if (resources.length !== 1 || resources[0].initializer?.getText(file).replace(/\s+/g, ' ')
    !== 'typeof it?.identifiedResourceName === "string" ? it.identifiedResourceName.trim() : ""') fail('resource');
  if (matches.length !== 1 || matches[0].expression.getText(file).replace(/\s+/g, ' ')
    !== 'spriteId > 0 && location & EquipmentLocation_default.COSTUME_ROBE && typeof RobeTable_default === "object"') fail('registration');
  const condition = matches[0].expression;
  const guard = String.raw`Number.isInteger(spriteId) && spriteId > 0
      && location & EquipmentLocation_default.COSTUME_ROBE
      && typeof RobeTable_default === "object" && RobeTable_default
      && !(typeof RobeTable_default[spriteId] === "string" && RobeTable_default[spriteId].trim())
      && resourceName !== "." && resourceName !== ".."
      && !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(resourceName)`;
  const output = region.slice(0, preview.getStart(file)) + installed + '\n'
    + region.slice(preview.getStart(file), condition.getStart(file)) + guard + region.slice(condition.end);
  return source.slice(0, start) + output + source.slice(end);
}
