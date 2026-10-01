// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { patchRuntimeStatusTooltips } from '../scripts/lastro-localization.mjs';
import { createLastroUiMessages } from '../scripts/lastro-ui-messages.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

const native = readFileSync('vendor/v2/Online.js', 'utf8');
function region(source: string, path: string) {
  const marker = '//#region ' + path;
  const start = source.indexOf(marker), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < start) throw new Error('Missing native status tooltip fixture: ' + path);
  return source.slice(start, end + '//#endregion'.length);
}
const gui = region(native, 'src/UI/GUIComponent.js');
const templateSource = region(native, 'src/UI/Components/WinStats/WinStatsV2/WinStatsV2.html?raw');
const templateAst = ts.createSourceFile('WinStatsV2.html.js', templateSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const templates: string[] = [];
function findTemplate(node: ts.Node) {
  if (ts.isBinaryExpression(node) && node.left.getText(templateAst) === 'WinStatsV2_default$2' && ts.isStringLiteral(node.right)) templates.push(node.right.text);
  ts.forEachChild(node, findTemplate);
}
findTemplate(templateAst);
if (templates.length !== 1) throw new Error('Changed native WinStatsV2 template');

function harness(source = patchRuntimeStatusTooltips(gui)) {
  const table: Record<number, string> = {};
  const csv = new Uint8Array(readFileSync('vendor/core/data/msgstringtable.csv'));
  expect(createLastroUiMessages().loadCsv(csv, table, bytes => new TextDecoder().decode(bytes))).toBe(true);
  const ast = ts.createSourceFile('GUIComponent.js', region(source, 'src/UI/GUIComponent.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods: ts.MethodDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'processDataAttrs') methods.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (methods.length !== 1) throw new Error('Changed native data-text method');
  const prefix = source.slice(0, source.indexOf('//#region'));
  const processDataAttrs = runInNewContext(prefix + '\n({' + methods[0]!.getText(ast).replace(/^static\s+/, '') + '}).processDataAttrs;', {
    _Client: {}, _DB: { getMessage: (id: number) => table[id] ?? '' },
  }) as (node: HTMLElement) => void;
  const container = document.createElement('div');
  setLastROInnerHTML(container, templates[0]!);
  const tooltip = () => container.querySelector<HTMLElement>('.hover[data-text="3116"]')!;
  const render = () => container.querySelectorAll<HTMLElement>('.hover[data-text]').forEach(processDataAttrs);
  return { table, container, tooltip, render, processDataAttrs };
}

describe('native status descriptions keep RO formatting out of plain-text tooltips', () => {
  it('reproduces the literal newline and RO color codes in the screenshot using the actual CSV and native GUI sink', () => {
    const f = harness(gui); f.render();
    expect(f.tooltip().textContent).toBe('灵巧\\n^cc0000远距离物理攻击力^ffffff, 命中率, 咏唱时间, 魔法攻击力');
  });

  it('renders every native status and trait tooltip with line breaks and plain text without rewriting the shared message table', () => {
    const f = harness(), original = { ...f.table }; f.render();
    expect(f.tooltip().textContent).toBe('灵巧\n远距离物理攻击力, 命中率, 咏唱时间, 魔法攻击力');
    const tooltips = [...f.container.querySelectorAll<HTMLElement>('.hover[data-text]')];
    expect(tooltips).toHaveLength(29);
    for (const node of tooltips) {
      expect(node.textContent).not.toMatch(/\\[rn]|\^[0-9a-f]{6}/i);
      expect(node.style.whiteSpace).toBe('pre-line');
      expect(node.style.width).toBe('max-content');
      expect(node.style.height).toBe('auto');
      expect(node.style.maxWidth).toBe('min(420px, calc(100vw - 24px))');
      expect(node.children).toHaveLength(0);
    }
    expect(f.table).toEqual(original);
  });

  it('also fixes a retained Chinese TXT description and safely displays angle brackets as text on repeated native binding', () => {
    const f = harness();
    f.table[3116] = '灵巧参数\\r\\n^CC0000远程物理攻击力^FFFFFF, 命中率\r\n<装备说明>\\n^12345保留';
    f.render(); f.render();
    expect(f.tooltip().textContent).toBe('灵巧参数\n远程物理攻击力, 命中率\n<装备说明>\n^12345保留');
    expect(f.tooltip().children).toHaveLength(0);
    expect(f.table[3116]).toContain('\\r\\n^CC0000');
  });

  it('preserves ordinary labels, resource identifiers and other hover descriptions with identical text', () => {
    const f = harness();
    const raw = 'Resource\\name.bmp\\n^cc0000<item description>';
    f.table[9999] = raw;
    for (const html of [
      '<span data-text="9999"></span>',
      '<div id="ItemInfo"><div class="desc"><span class="hover" data-text="9999"></span></div></div>',
      '<div id="WinStats"><span class="hover" data-text="9999"></span></div>',
    ]) {
      const root = document.createElement('div'); setLastROInnerHTML(root, html);
      const label = root.querySelector<HTMLElement>('[data-text]')!;
      f.processDataAttrs(label);
      expect(label.textContent).toBe(raw); expect(label.children).toHaveLength(0); expect(label.getAttribute('style')).toBeNull();
    }
  });

  it('changes only the scoped native message assignment and rejects duplicate or moved anchors', () => {
    const patched = patchRuntimeStatusTooltips(gui);
    expect(region(patched, 'src/UI/GUIComponent.js')).toBe(gui.replace(
      'node.textContent = _DB?.getMessage(msgId, "");', 'LastROStatusTooltipText(node, _DB?.getMessage(msgId, ""));',
    ));
    expect(() => patchRuntimeStatusTooltips(patched)).toThrow('anchor:status-tooltip-duplicate');
    expect(() => patchRuntimeStatusTooltips(gui.replace('static processDataAttrs(node)', 'static processDataAttrs(element)'))).toThrow('anchor:status-tooltip-text');
    expect(patchRuntimeStatusTooltips('const resource = "^cc0000\\n.bmp";')).toBe('const resource = "^cc0000\\n.bmp";');
  });
});
