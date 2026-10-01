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
  patch('src/DB/DBManager.js', region => replaceExact(region,
    '            Object.assign(HatTable_default, json);',
    `            // Some client Lua entries have no resource name. Keep the native
            // mapping so an empty value cannot select the bare sex sprite.
            for (const [id, resource] of Object.entries(json || {})) {
              if (typeof resource === "string" && resource.trim()) HatTable_default[id] = resource;
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
  body('UpdateBody', 'job', original => replaceExact(original,
    '        refreshHeadState.call(this);\n      }',
    '        refreshHeadState.call(this);\n        this.robe = this._robe;\n      }'));
  body('UpdateBodyStyle', 'look', original => replaceExact(original,
    '          this.shield = this._shield;',
    '          this.shield = this._shield;\n          this.robe = this._robe;'));
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
    output = replaceExact(output, '        function () {\n          _this["_" + type] = _val;',
      '        function () {\n          if (!isCurrent()) return;\n          _this["_" + type] = _val;');
    output = replaceExact(output, '              Client.loadFile(trail_file + ".spr", function () {',
      '              Client.loadFile(trail_file + ".spr", function () {\n                if (!isCurrent()) return;');
    output = replaceExact(output, '        function () {\n          if (fallback && !final) {',
      '        function () {\n          if (!isCurrent()) return;\n          if (fallback && !final) {');
    return replaceExact(output, '              Client.loadFile(fallbackPath + ".spr", function () {',
      '              Client.loadFile(fallbackPath + ".spr", function () {\n                if (!isCurrent()) return;');
  });
  let output = region;
  for (const [node, replacement] of changes.sort((a, b) => b[0].getStart(file) - a[0].getStart(file))) {
    output = output.slice(0, node.getStart(file)) + replacement + output.slice(node.end);
  }
  return source.slice(0, start) + output + source.slice(end);
}
