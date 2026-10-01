import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { brotliDecompressSync } from 'node:zlib';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchRuntimeTypography } from '../scripts/lastro-typography.mjs';
import { loadClientFonts } from '../src/runtime/client-fonts';
import { installDebugAccessGuard } from '../src/runtime/debug-access';

const original = readFileSync('vendor/v2/Online.js', 'utf8');
const output = patchRuntimeTypography(original);
const originalAst = ts.createSourceFile('original.js', original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const patchedAst = ts.createSourceFile('patched.js', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const stylesheet = readFileSync('src/styles.css', 'utf8');
const fontCss = readFileSync('public/fonts/misans.css', 'utf8');
const regularFamily = "Arial, 'Microsoft YaHei', 'MiSans', 'LastRO Glyph Fallback', sans-serif";
const partsCache = new WeakMap<ts.SourceFile, { common: string; init: string; scale: string; clamp: string; loader?: ts.FunctionDeclaration }>();
function nativeParts(file: ts.SourceFile) {
  const cached = partsCache.get(file); if (cached) return cached;
  const common: ts.BinaryExpression[] = [], init: ts.MethodDeclaration[] = [], loaders: ts.FunctionDeclaration[] = [];
  const scale: ts.FunctionExpression[] = [], clamp: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && node.left.text === 'Common_default$1') common.push(node);
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'init' &&
      ts.isClassExpression(node.parent) && node.parent.name?.text === 'DB') init.push(node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadFontFromClient') loaders.push(node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'clampChatFontScale') clamp.push(node);
    if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'applyFontScale' &&
      ts.isIdentifier(node.left.expression) && node.left.expression.text === 'ChatBox' && ts.isFunctionExpression(node.right)) scale.push(node.right);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (common.length !== 1 || init.length !== 1 || scale.length !== 1 || clamp.length !== 1 || loaders.length > 1 || !ts.isStringLiteral(common[0]!.right)) throw new Error('Changed native typography fixture');
  const parts = { common: common[0]!.right.text, init: init[0]!.getText(file), scale: scale[0]!.getText(file), clamp: clamp[0]!.getText(file), loader: loaders[0] };
  partsCache.set(file, parts); return parts;
}
const commonCss = (file: ts.SourceFile) => nativeParts(file).common;
const dbInit = (file: ts.SourceFile) => nativeParts(file).init;
// Extract immutable real-source fixtures once; each behavior test builds fresh state.
nativeParts(originalAst);
nativeParts(patchedAst);
function declarations(css: string, skipTypography = false) {
  const selectors = new Map<string, Record<string, string>>();
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\b[^;]+;/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    const values = selectors.get(selector) ?? {};
    for (const declaration of match[2]!.split(';')) {
      const colon = declaration.indexOf(':'); if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim();
      if (skipTypography && ['font-family', 'font-weight', 'font-size-adjust', 'font-synthesis'].includes(name)) continue;
      values[name] = value;
    }
    if (Object.keys(values).length) selectors.set(selector, values);
  }
  return selectors;
}
function componentStyles(source: string) {
  const styles = new Map<string, { region: string; css: string }>();
  for (const match of source.matchAll(/\/\/#region src\/UI\/Components\/([^\r\n]+)\.css\?raw\r?\n[\s\S]*?\/\/#endregion/g)) {
    const file = ts.createSourceFile('component-css.js', match[0], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const literals: ts.StringLiteral[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isBinaryExpression(node) && ts.isStringLiteral(node.right)) literals.push(node.right);
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (literals.length !== 1 && bodyComponents.includes(match[1]!)) throw new Error('Changed stylesheet fixture: ' + match[1]);
    styles.set(match[1]!, { region: match[0], css: literals[0]?.text ?? '' });
  }
  return styles;
}
const bodyComponents = [
  ...[0, 1, 3, 4, 5].map(version => `BasicInfo/BasicInfoV${version}/BasicInfoV${version}`),
  ...[0, 1, 2, 3].map(version => `Inventory/InventoryV${version}/InventoryV${version}`),
  'ChatBox/ChatBox', 'ItemInfo/ItemInfo',
];
const originalComponents = componentStyles(original), patchedComponents = componentStyles(output);
function toolsCss() {
  const file = ts.createSourceFile('tools-style.mjs', readFileSync('scripts/lastro-tools-style.mjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = file.statements.filter(ts.isVariableStatement)[0]?.declarationList.declarations[0];
  if (!declaration?.initializer || !ts.isNoSubstitutionTemplateLiteral(declaration.initializer)) throw new Error('Changed tools stylesheet fixture');
  return declaration.initializer.text;
}
function faces(css: string) {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(match => {
    const props: Record<string, string> = {};
    for (const entry of match[1]!.split(';')) {
      const colon = entry.indexOf(':'); if (colon >= 0) props[entry.slice(0, colon).trim()] = entry.slice(colon + 1).trim();
    }
    return props;
  });
}

// Golden output hashes retain the full official MiSans character set and the
// original Source Han characters absent from MiSans, rather than source-text subsets.
const bundledFonts = [
  { filename: 'MiSans-VF.woff2', family: 'MiSans VF', bytes: 11909340, glyphs: 29773, codePoints: 29571,
    hash: 'eddd9e31a39261880aa91f0f0267325e755aaf4549bff0b6ab3cf675fef0d5c8' },
  { filename: 'LastROGlyphFallback-Medium.woff2', family: 'LastRO Glyph Fallback', bytes: 226536, glyphs: 1916, codePoints: 1848,
    hash: '54a61ccc7738bd94af2cf7e25ef2f83666e688abb2751b08c31b2d37341d25d7' },
  { filename: 'LastROGlyphFallback-Bold.woff2', family: 'LastRO Glyph Fallback', bytes: 228688, glyphs: 1916, codePoints: 1848,
    hash: '64be7dcddc4477d05cb4edf276b0f6247ec04bbaf0c3429c6904fedba5929595' },
];
function fontTables(bytes: Buffer) {
  expect(bytes.toString('ascii', 0, 4)).toBe('wOF2');
  expect([0x00010000, 0x4f54544f]).toContain(bytes.readUInt32BE(4));
  expect(bytes.readUInt32BE(8)).toBe(bytes.length);
  expect(bytes.readUInt16BE(14)).toBe(0);
  const tables = new Map<number, { start: number; length: number; transformed: boolean }>();
  let cursor = 48, total = 0;
  function length128() {
    let value = 0;
    for (let index = 0; index < 5; index++) {
      const byte = bytes[cursor++]!; value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid WOFF2 table length');
  }
  for (let index = 0; index < bytes.readUInt16BE(12); index++) {
    const flags = bytes[cursor++]!, tag = flags & 63;
    // The table stream stores transformed glyf bytes and an empty loca table.
    // Metadata tables tested below remain readable without reconstructing outlines.
    if (tag === 63) cursor += 4;
    const version = flags >>> 6;
    const transformed = [10, 11].includes(tag) ? version !== 3 : version !== 0;
    const originalLength = length128(), length = transformed ? length128() : originalLength;
    if (tag === 11 && transformed) expect(length).toBe(0);
    tables.set(tag, { start: total, length, transformed }); total += length;
  }
  const compressed = bytes.readUInt32BE(20);
  expect(cursor + compressed).toBeLessThanOrEqual(bytes.length);
  const data = brotliDecompressSync(bytes.subarray(cursor, cursor + compressed));
  expect(data.length).toBe(total);
  return (tag: number) => {
    const table = tables.get(tag); if (!table) throw new Error('Missing font table ' + tag);
    expect(table.transformed).toBe(false);
    return data.subarray(table.start, table.start + table.length);
  };
}
function fontNames(name: Buffer, ids = [1, 2, 16, 17]) {
  const values: string[] = [];
  for (let index = 0; index < name.readUInt16BE(2); index++) {
    const record = 6 + 12 * index, id = name.readUInt16BE(record + 6);
    if (name.readUInt16BE(record) !== 3 || !ids.includes(id)) continue;
    const start = name.readUInt16BE(4) + name.readUInt16BE(record + 10), length = name.readUInt16BE(record + 8);
    values.push(new TextDecoder('utf-16be').decode(name.subarray(start, start + length)));
  }
  return values;
}
function glyphFor(cmap: Buffer, codePoint: number) {
  for (let index = 0; index < cmap.readUInt16BE(2); index++) {
    const table = cmap.readUInt32BE(4 + 8 * index + 4), format = cmap.readUInt16BE(table);
    if (format === 12) {
      for (let group = 0; group < cmap.readUInt32BE(table + 12); group++) {
        const start = table + 16 + group * 12, first = cmap.readUInt32BE(start), last = cmap.readUInt32BE(start + 4);
        if (codePoint >= first && codePoint <= last) return cmap.readUInt32BE(start + 8) + codePoint - first;
      }
    } else if (format === 4 && codePoint <= 65535) {
      const segments = cmap.readUInt16BE(table + 6) / 2;
      for (let segment = 0; segment < segments; segment++) {
        const end = cmap.readUInt16BE(table + 14 + 2 * segment), start = cmap.readUInt16BE(table + 16 + 2 * segments + 2 * segment);
        if (codePoint < start || codePoint > end) continue;
        const delta = cmap.readInt16BE(table + 16 + 4 * segments + 2 * segment);
        const rangePos = table + 16 + 6 * segments + 2 * segment, offset = cmap.readUInt16BE(rangePos);
        if (!offset) return (codePoint + delta) & 65535;
        const glyph = cmap.readUInt16BE(rangePos + offset + 2 * (codePoint - start));
        return glyph ? (glyph + delta) & 65535 : 0;
      }
    }
  }
  return 0;
}

function fontCodePoints(cmap: Buffer) {
  const values = new Set<number>();
  for (let index = 0; index < cmap.readUInt16BE(2); index++) {
    const table = cmap.readUInt32BE(4 + 8 * index + 4), format = cmap.readUInt16BE(table);
    if (format === 12) {
      for (let group = 0; group < cmap.readUInt32BE(table + 12); group++) {
        const record = table + 16 + group * 12, first = cmap.readUInt32BE(record), last = cmap.readUInt32BE(record + 4);
        const firstGlyph = cmap.readUInt32BE(record + 8);
        for (let point = first; point <= last; point++) if (firstGlyph + point - first) values.add(point);
      }
    } else if (format === 4) {
      const segments = cmap.readUInt16BE(table + 6) / 2;
      for (let segment = 0; segment < segments; segment++) {
        const end = cmap.readUInt16BE(table + 14 + 2 * segment), start = cmap.readUInt16BE(table + 16 + 2 * segments + 2 * segment);
        const delta = cmap.readInt16BE(table + 16 + 4 * segments + 2 * segment);
        const rangePos = table + 16 + 6 * segments + 2 * segment, offset = cmap.readUInt16BE(rangePos);
        for (let point = start; point <= end; point++) {
          let glyph = offset ? cmap.readUInt16BE(rangePos + offset + 2 * (point - start)) : (point + delta) & 65535;
          if (offset && glyph) glyph = (glyph + delta) & 65535;
          if (glyph) values.add(point);
        }
      }
    }
  }
  return values;
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
afterEach(() => vi.unstubAllGlobals());
function fontFixture() {
  const pending = [deferred<FontFace[]>(), deferred<FontFace[]>(), deferred<FontFace[]>()];
  let index = 0;
  const load = vi.fn<(query: string, sample: string) => Promise<FontFace[]>>(() => pending[index++]!.promise);
  vi.stubGlobal('document', { baseURI: 'https://iwa.invalid/', fonts: { load } });
  return { pending, load };
}
const bootstrapSource = readFileSync('src/runtime/client-bootstrap.ts', 'utf8');
const bootstrapCode = ts.transpileModule(bootstrapSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  transformers: { before: [context => file => {
    function visit(node: ts.Node): ts.Node {
      // Preserve the real startup body; only replace its external runtime import
      // with a local observation so the tests never execute the game or network.
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('recordRuntimeImport'), undefined, node.arguments);
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(file, visit) as ts.SourceFile;
  }] },
}).outputText;
function bootstrapFixture(manifest = deferred<Response>()) {
  const imported = vi.fn(async () => undefined), fetched = vi.fn(() => manifest.promise);
  const runtimeWindow = Object.assign(new EventTarget(), { location: new URL('isolated-app://fixture/') });
  const listeners = vi.spyOn(runtimeWindow, 'addEventListener');
  const context = vm.createContext({
    exports: {}, document: globalThis.document, window: runtimeWindow,
    URL, TextDecoder, AbortSignal, fetch: fetched, recordRuntimeImport: imported,
    require(path: string) {
      if (path.endsWith('/client-fonts')) return { loadClientFonts };
      if (path.endsWith('/socket-factory')) return { isDirectSocketsSupported: () => true, createDirectSocket: vi.fn() };
      if (path.endsWith('/lastro-login-http')) return { prepareLastROLoginSession: async () => undefined, sendLastROLoginPost: vi.fn() };
      if (path.endsWith('/client-config')) return { buildClientConfig: () => ({}) };
      if (path.endsWith('/debug-access')) return { installDebugAccessGuard };
      throw new Error('Unexpected startup dependency: ' + path);
    },
  });
  vm.runInContext(bootstrapCode, context);
  const exports = context.exports as { bootstrapV2Client(options: unknown): Promise<void> };
  const start = () => exports.bootstrapV2Client({ mount: {}, profile: {}, credentials: { username: '', password: '' } });
  return { imported, fetched, manifest, listeners, start };
}
const manifestResponse = () => new Response(JSON.stringify({ files: [
  { path: 'runtime/Online.js', kind: 'runtime', bytes: 0, sha256: createHash('sha256').update('').digest('hex') },
] }), { headers: { 'content-type': 'application/json' } });

describe('native typography without changing RO layout', () => {
  const minimalCommon = 'var Common_default$1 = ' + JSON.stringify("body { font-size: 12px; font-family: 'SCDream', Arial, sans-serif; font-size-adjust: 0.5186; }") + ';';
  const chatRegion = '//#region src/UI/Components/ChatBox/ChatBox.js\nel.style.fontFamily = "Arial";\n//#endregion';
  it('supports minimal runtimes without a ChatBox region while retaining the other font changes', () => {
    const unrelated = '\nfunction drawLabel(ctx) { ctx.font = "10px Arial"; }';
    const patched = patchRuntimeTypography(minimalCommon + unrelated);
    expect(patched).toContain('font-family: ' + regularFamily);
    expect(patched).toContain("font-family: 'MiSans', Arial, sans-serif");
    expect(patched).toContain('font-size-adjust: none');
    expect(patched).toContain('font-weight: 400');
    expect(patched).toContain(unrelated);
  });

  it('changes exactly the native chat input assignment when the chat component is present', () => {
    const unrelated = '\nel.style.fontFamily = "Arial";';
    const patched = patchRuntimeTypography(minimalCommon + '\n' + chatRegion + unrelated);
    expect(patched).toContain('el.style.fontFamily = ' + JSON.stringify(regularFamily) + ';');
    expect(patched.endsWith(unrelated)).toBe(true);
  });

  it.each([
    chatRegion.replace('"Arial"', '"changed upstream font"'),
    chatRegion.replace('//#endregion', 'el.style.fontFamily = "Arial";\n//#endregion'),
    chatRegion + '\n' + chatRegion,
    chatRegion.replace('//#endregion', ''),
  ])('rejects missing, ambiguous or truncated chat font anchors in a present chat component', chat => {
    expect(() => patchRuntimeTypography(minimalCommon + '\n' + chat)).toThrow('anchor:chat-font-family');
  });

  it('uses regular Arial/system Chinese with bundled fallback and retains native sizes', () => {
    const css = commonCss(patchedAst), rules = declarations(css);
    expect(rules.get(':host, body')?.['font-family']).toBe(regularFamily);
    expect(rules.get(':host, body')?.['font-weight']).toBe('400');
    expect(rules.get(':host, body')?.['font-size-adjust']).toBe('none');
    expect(rules.get('body')?.['font-size']).toBe('12px');
    expect(rules.get('.title')?.['font-size']).toBe('12px');
    expect(declarations(css, true)).toEqual(declarations(commonCss(originalAst), true));
  });

  it('preserves component dimensions, sprite paths, and explicit Arial digit faces', () => {
    expect(patchedComponents.size).toBe(originalComponents.size);
    for (const [component, before] of originalComponents) {
      const after = patchedComponents.get(component)!;
      if (bodyComponents.includes(component)) {
        expect(after.css.startsWith(before.css.replaceAll('SCDream', 'MiSans'))).toBe(true);
        expect(declarations(after.css, true)).toEqual(declarations(before.css, true));
      } else expect(after.region).toBe(before.region.replaceAll('SCDream', 'MiSans'));
    }
    expect(commonCss(patchedAst)).toContain('Arial');
  });

  it('keeps every BasicInfo profile and inventory body regular while only softening their titles', () => {
    for (const version of [0, 1, 3, 4, 5]) {
      const rules = declarations(patchedComponents.get(`BasicInfo/BasicInfoV${version}/BasicInfoV${version}`)!.css);
      expect(rules.get(`#BasicInfoV${version}`)?.['font-weight']).toBe('400');
      expect(rules.get(`#BasicInfoV${version}`)?.['font-size']).toBe('11px');
      expect(rules.get(`#BasicInfoV${version} .title`)?.['font-weight']).toBe('500');
    }
    for (const version of [0, 1, 2, 3]) {
      const rules = declarations(patchedComponents.get(`Inventory/InventoryV${version}/InventoryV${version}`)!.css);
      expect(rules.get(`#InventoryV${version}`)?.['font-weight']).toBe('400');
      expect(rules.get(`#InventoryV${version} .titlebar .text`)?.['font-weight']).toBe('500');
      expect(rules.get(`#InventoryV${version} .titlebar .text`)?.['font-size']).toBe('11px');
    }
    const item = declarations(patchedComponents.get('ItemInfo/ItemInfo')!.css);
    expect(item.get('.ItemInfo')?.['font-weight']).toBe('400');
    expect(item.get('.ItemInfo .title')?.['font-weight']).toBe('500');
  });

  it('retains native chat zoom and line heights when its inputs use the same regular font stack', () => {
    const parts = nativeParts(patchedAst);
    const rules = declarations(patchedComponents.get('ChatBox/ChatBox')!.css);
    expect(rules.get('#chatbox, #chatbox .input input, #chatbox .input .message')?.['font-weight']).toBe('400');
    for (const [scale, normalized, size, line, inputLine] of [[1, 1, 12, 14, 18], [1.2, 1.2, 14, 17, 22], [1.4, 1.4, 17, 20, 25], [0, 1, 12, 14, 18]]) {
      const content = [{ style: {} as Record<string, string> }], inputs = [{ style: {} as Record<string, string> }, { style: {} as Record<string, string> }];
      const preferences = { fontScale: scale };
      const root = { querySelectorAll: (selector: string) => selector === '.content' ? content : inputs, querySelector: () => inputs[1] };
      vm.runInNewContext(`${parts.clamp}\n(${parts.scale})();`, { _root$18: () => root, _preferences$41: preferences });
      expect(preferences.fontScale).toBe(normalized);
      expect(content[0]!.style).toEqual({ fontSize: `${size}px`, lineHeight: `${line}px` });
      expect(inputs[0]!.style).toEqual({ fontFamily: regularFamily, fontSize: `${size}px` });
      expect(inputs[1]!.style).toEqual({ fontFamily: regularFamily, fontSize: `${size}px`, lineHeight: `${inputLine}px` });
    }
  });

  it('uses regular tools body and route names with limited medium title emphasis', () => {
    const rules = declarations(toolsCss());
    expect(rules.get(':host')?.font).toBe("400 14px/1.5 Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif");
    expect(rules.get('.lastro-route-name')?.['font-weight']).toBe('400');
    expect(rules.get('.lastro-ro-titlebar strong')?.['font-weight']).toBe('500');
    expect(rules.get('.lastro-group-title')?.['font-weight']).toBe('500');
  });

  it('removes the old download/face registration while keeping other DB resources and completion', () => {
    expect(output).not.toMatch(/\bfunction loadFontFromClient\s*\(/);
    expect(output).not.toContain('loadFontFromClient("System/Font/")');
    const before = dbInit(originalAst), after = dbInit(patchedAst);
    expect(after).toBe(before.replace('loadFontFromClient("System/Font/");', ''));
    expect(output).toContain('function arrayBufferToBase64(buffer)');
    const completed: Array<() => void> = [], paths: string[] = [], ready = vi.fn(), progress = vi.fn();
    const context = vm.createContext({
      MapTable: {}, MsgStringTable: {},
      loadTable: (path: string, _delimiter: string, _columns: number, _row: unknown, done: () => void) => { paths.push(path); completed.push(done); },
      loadCSV: (path: string, _table: unknown, _key: number, _value: number, done: () => void) => { paths.push(path); done(); },
    });
    vm.runInContext(`class DB { ${after} }; DB.onReady = ready; DB.onProgress = progress; DB.init();`, Object.assign(context, { ready, progress }));
    expect(paths).toEqual(['data/mp3nametable.txt', 'data/mapnametable.txt', 'data/msgstringtable.txt', 'data/resnametable.txt']);
    completed.forEach(done => done());
    expect(paths.at(-1)).toBe('data/msgstringtable.csv');
    expect(ready).toHaveBeenCalledOnce();
    expect(progress.mock.calls).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  it('keeps all unrelated executable statements unchanged and the patched source syntactically valid', () => {
    const removed = nativeParts(originalAst).loader!;
    const withoutLoader = original.slice(0, removed.getStart(originalAst)) + original.slice(removed.end);
    const commonPattern = /Common_default\$1\s*=\s*"(?:\\.|[^"\\])*"/;
    const normalize = (text: string) => text.replace(commonPattern, 'COMMON_CSS')
      .replace(/\/\/#region src\/UI\/Components\/([^\r\n]+)\.css\?raw\r?\n[\s\S]*?\/\/#endregion/g, (_region, component) => `COMPONENT_CSS:${component}`)
      .replace('el.style.fontFamily = ' + JSON.stringify(regularFamily) + ';', 'el.style.fontFamily = "Arial";')
      .replace('loadFontFromClient("System/Font/");', '').replaceAll('SCDream', 'MiSans');
    expect(normalize(output)).toBe(normalize(withoutLoader));
    expect((patchedAst as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics).toEqual([]);
    expect(() => patchRuntimeTypography(original.replace('loadFontFromClient("System/Font/");', 'loadFontFromClient("different-path/");'))).toThrow('anchor:client-font-call');
    expect(() => patchRuntimeTypography('const missingCommon = true;')).toThrow('anchor:common-css');
  });
});

describe('compact Chinese fonts without reducing character coverage', () => {
  const parsed = bundledFonts.map(font => fontTables(readFileSync(`public/fonts/${font.filename}`)));

  it.each(bundledFonts)('ships stable $filename bytes with complete expected character coverage', font => {
    const bytes = readFileSync(`public/fonts/${font.filename}`);
    expect(bytes.length).toBe(font.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(font.hash);
    const table = fontTables(bytes), names = fontNames(table(5));
    expect(names).toContain(font.family);
    expect(table(4).readUInt16BE(4)).toBe(font.glyphs);
    expect(fontCodePoints(table(0)).size).toBe(font.codePoints);
  });

  it('retains the full Chinese block, supplementary characters and both missing-glyph weights', () => {
    const [miSans, medium, bold] = parsed.map(table => fontCodePoints(table(0)));
    expect(bold).toEqual(medium);
    const combined = new Set([...miSans!, ...medium!]);
    expect(combined.size).toBe(31417);
    expect([...miSans!].filter(point => point >= 0x4e00 && point <= 0x9fff)).toHaveLength(20976);
    for (let point = 0x4e00; point <= 0x9fef; point++) if (!miSans!.has(point)) throw new Error('Missing Chinese character U+' + point.toString(16));
    for (const character of '聊天设置确定取消传送金币 ABC 0123456789，。！？「」') {
      expect(glyphFor(parsed[0]!(0), character.codePointAt(0)!)).toBeGreaterThan(0);
    }
    for (const point of [0x21d4, 0x2200, 0x3106c]) {
      expect(miSans!.has(point)).toBe(false);
      expect(medium!.has(point)).toBe(true);
      expect(bold!.has(point)).toBe(true);
    }
    expect(miSans!.has(0x2ce93)).toBe(true);
  });

  it('maps CSS weights to the real Regular, Medium and Bold variable font instances', () => {
    const fvar = parsed[0]!(47), names = parsed[0]!(5);
    expect(fvar.readUInt32BE(0)).toBe(0x00010000);
    const axisOffset = fvar.readUInt16BE(4), axisCount = fvar.readUInt16BE(8), axisSize = fvar.readUInt16BE(10);
    expect(axisCount).toBe(1);
    expect(fvar.toString('ascii', axisOffset, axisOffset + 4)).toBe('wght');
    expect([4, 8, 12].map(offset => fvar.readInt32BE(axisOffset + offset) / 65536)).toEqual([150, 330, 700]);
    const instanceSize = fvar.readUInt16BE(14), instances = new Map<string, number>();
    for (let index = 0; index < fvar.readUInt16BE(12); index++) {
      const record = axisOffset + axisCount * axisSize + index * instanceSize;
      for (const name of fontNames(names, [fvar.readUInt16BE(record)])) instances.set(name, fvar.readInt32BE(record + 4) / 65536);
    }
    const bundled = faces(fontCss), primary = bundled.filter(face => face['font-family'] === "'MiSans'");
    expect(bundled).toHaveLength(5); expect(primary).toHaveLength(3);
    for (const [weight, variant, coordinate] of [[400, 'Regular', 330], [500, 'Medium', 380], [700, 'Bold', 630]] as const) {
      expect(instances.get(variant)).toBe(coordinate);
      const face = primary.find(item => item['font-weight'] === String(weight));
      const url = face?.src?.match(/url\(['"]?([^)'"\s]+)/)?.[1];
      expect(url).toBe('/fonts/MiSans-VF.woff2');
      expect(readFileSync(resolve('public', url!.slice(1))).length).toBe(bundledFonts[0]!.bytes);
      expect(face?.src).toContain("format('woff2')");
      expect(face?.['font-variation-settings']).toBe(`'wght' ${coordinate}`);
    }
    const fallback = bundled.filter(face => face['font-family'] === "'LastRO Glyph Fallback'");
    expect(fallback.map(face => face['font-weight'])).toEqual(['500', '700']);
    expect(fallback.map(face => face.src)).toEqual([
      "url('/fonts/LastROGlyphFallback-Medium.woff2') format('woff2')",
      "url('/fonts/LastROGlyphFallback-Bold.woff2') format('woff2')",
    ]);
    expect(stylesheet.trimStart()).toMatch(/^@import url\('\/fonts\/misans\.css'\);/);
    expect(faces(stylesheet)).toEqual([]);
    expect(declarations(stylesheet).get(':root')?.['font-family']).toBe(regularFamily);
    expect(declarations(stylesheet).get(':root')?.['font-weight']).toBe('400');
    expect(declarations(stylesheet).get(':root')?.['font-synthesis']).toBe('none');
  });
});

describe('font readiness before native runtime startup', () => {
  it('awaits all three real FontFaceSet requests using Chinese and numeral samples', async () => {
    const f = fontFixture(); let done = false;
    const loading = loadClientFonts().then(() => { done = true; });
    expect(f.load.mock.calls.map(call => call[0])).toEqual(['400 12px "MiSans"', '500 12px "MiSans"', '700 12px "MiSans"']);
    for (const call of f.load.mock.calls) expect(call[1]).toMatch(/聊天.*0123456789/);
    f.pending[0]!.resolve([]); f.pending[2]!.resolve([]); await Promise.resolve(); expect(done).toBe(false);
    f.pending[1]!.resolve([]); await loading; expect(done).toBe(true);
  });

  it('starts the runtime only after both the font promises and executable manifest complete', async () => {
    const f = fontFixture(), boot = bootstrapFixture(); const startup = boot.start();
    expect(boot.listeners.mock.calls.map(call => call[0])).toEqual(['keydown', 'contextmenu']);
    expect(boot.listeners.mock.invocationCallOrder[1]!).toBeLessThan(f.load.mock.invocationCallOrder[0]!);
    boot.manifest.resolve(manifestResponse()); await Promise.resolve(); expect(boot.imported).not.toHaveBeenCalled();
    f.pending[0]!.resolve([]); f.pending[2]!.resolve([]); await Promise.resolve(); expect(boot.imported).not.toHaveBeenCalled();
    f.pending[1]!.resolve([]); await startup;
    expect(boot.imported).toHaveBeenCalledExactlyOnceWith('/runtime/Online.js');
    expect(boot.fetched).toHaveBeenCalledOnce();
  });

  it('also waits for the manifest when fonts finish first', async () => {
    const f = fontFixture(), boot = bootstrapFixture(); const startup = boot.start();
    f.pending.forEach(pending => pending.resolve([])); await Promise.resolve(); expect(boot.imported).not.toHaveBeenCalled();
    boot.manifest.resolve(manifestResponse()); await startup; expect(boot.imported).toHaveBeenCalledOnce();
  });

  it('allows a font rejection to use fallback but still waits for the remaining font requests', async () => {
    const f = fontFixture(), boot = bootstrapFixture(); const startup = boot.start();
    boot.manifest.resolve(manifestResponse()); f.pending[0]!.reject(new Error('Local font unavailable'));
    f.pending[2]!.resolve([]); await Promise.resolve(); expect(boot.imported).not.toHaveBeenCalled();
    f.pending[1]!.resolve([]); await expect(startup).resolves.toBeUndefined(); expect(boot.imported).toHaveBeenCalledOnce();
  });

  it('keeps startup available when FontFaceSet is absent', async () => {
    vi.stubGlobal('document', { baseURI: 'https://iwa.invalid/' });
    await expect(loadClientFonts()).resolves.toBeUndefined();
    const boot = bootstrapFixture(); const startup = boot.start(); boot.manifest.resolve(manifestResponse());
    await startup; expect(boot.imported).toHaveBeenCalledOnce();
  });
});
