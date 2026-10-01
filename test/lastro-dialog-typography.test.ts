import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { patchRuntimeDialogTypography } from '../scripts/lastro-dialog-typography.mjs';

const vendor = readFileSync(new URL('../vendor/v2/Online.js', import.meta.url), 'utf8');
const start = vendor.indexOf('//#region src/Renderer/Entity/EntityDialog.js');
const end = vendor.indexOf('//#endregion', start) + '//#endregion'.length;
const native = vendor.slice(start, end);
const patched = patchRuntimeDialogTypography(native);

interface Dialog {
  text: string;
  display: boolean;
  timeout: number | null;
  set(text: string, fontColor?: string): void;
  render(matrix: unknown): void;
  remove(): void;
}

function fixture(dpr = 1) {
  const file = ts.createSourceFile('EntityDialog.js', patched, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let classText = '';
  function visit(node: ts.Node) {
    if (ts.isClassExpression(node) && ts.isBinaryExpression(node.parent) && node.parent.left.getText(file) === 'Dialog') classText = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const fontAtMeasurement: string[] = [];
  const ctx = {
    font: '10px sans-serif',
    fillStyle: '',
    strokeStyle: '',
    setTransform: vi.fn(),
    measureText: vi.fn((text: string) => {
      fontAtMeasurement.push(ctx.font);
      return { width: Array.from(text).length * 6 };
    }),
    fillRect: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    canvas: {} as object,
  };
  let bitmapWidth = 300;
  let bitmapHeight = 150;
  const canvas = {
    className: '',
    style: { position: '', zIndex: '', width: '', height: '', top: '', left: '' },
    get width() { return bitmapWidth; },
    set width(value: number) { bitmapWidth = Math.floor(value); ctx.font = '10px sans-serif'; },
    get height() { return bitmapHeight; },
    set height(value: number) { bitmapHeight = Math.floor(value); ctx.font = '10px sans-serif'; },
    getContext: vi.fn(() => ctx),
    remove: vi.fn(),
  };
  ctx.canvas = canvas;
  const window = { devicePixelRatio: dpr, innerWidth: 800, innerHeight: 600 };
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const Events = {
    setTimeout: vi.fn((callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }),
    clearTimeout: vi.fn((id: number) => timers.delete(id)),
  };
  const roundRect = vi.fn();
  const append = vi.fn();
  const Constructor = vm.runInNewContext(`(${classText})`, {
    document: { createElement: vi.fn(() => canvas) }, window, Events, roundRect,
    EntityOverlay: { append }, _pos$2: new Float32Array(4), _size$2: new Float32Array(2),
    vec4$2: { transformMat4: (out: Float32Array) => { out.set([0, 0, 0, 1]); } },
  }) as new () => Dialog;
  return { dialog: new Constructor(), ctx, canvas, window, Events, timers, roundRect, append, fontAtMeasurement };
}

describe('native entity chat bubble typography', () => {
  it.each([1, 1.25, 1.5, 2])('keeps CSS size and position while rendering at DPR %s', dpr => {
    const f = fixture(dpr);
    f.dialog.set('你好', '#94bdf7');
    expect(f.canvas.style.width).toBe('26px');
    expect(f.canvas.style.height).toBe('25px');
    expect(f.canvas.width).toBe(Math.ceil(26 * dpr));
    expect(f.canvas.height).toBe(Math.ceil(25 * dpr));
    expect(f.ctx.setTransform).toHaveBeenCalledExactlyOnceWith(dpr, 0, 0, dpr, 0, 0);
    expect(f.fontAtMeasurement.every(font => font === '400 12px Arial, "Microsoft YaHei", MiSans, "LastRO Glyph Fallback", sans-serif')).toBe(true);
    expect(f.ctx.font).toBe('400 12px Arial, "Microsoft YaHei", MiSans, "LastRO Glyph Fallback", sans-serif');
    expect(f.ctx.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 26, 25);
    expect(f.roundRect).toHaveBeenCalledExactlyOnceWith(f.ctx, 0.5, 0.5, 25, 24, 2);
    expect(f.ctx.fillText.mock.calls).toEqual([['你好', 8, 17], ['你好', 7, 16]]);
    expect(f.ctx.fillStyle).toBe('#94bdf7');
    f.dialog.render({});
    expect(f.canvas.style.top).toBe('273px');
    expect(f.canvas.style.left).toBe('387px');
    expect(f.append).toHaveBeenCalledExactlyOnceWith(f.canvas);
  });

  it('wraps long messages in logical pixels at the same line boundaries at every DPR', () => {
    for (const dpr of [1, 1.25, 2]) {
      const f = fixture(dpr);
      f.dialog.set('A'.repeat(90));
      expect(f.canvas.style.width).toBe('260px');
      expect(f.canvas.style.height).toBe('59px');
      expect(f.ctx.fillText.mock.calls.filter((_call, index) => index % 2 === 1)).toEqual([
        ['A'.repeat(41), 7, 16], ['A'.repeat(41), 7, 33], ['A'.repeat(8), 7, 50],
      ]);
      f.dialog.render({});
      expect(f.canvas.style.left).toBe('270px');
      expect(f.canvas.style.top).toBe('239px');
    }
  });

  it('reads current DPR for a new message instead of accumulating the previous canvas scale', () => {
    const f = fixture(2);
    f.dialog.set('你好');
    f.window.devicePixelRatio = 1.25;
    f.dialog.set('你好');
    expect(f.canvas.width).toBe(33);
    expect(f.canvas.height).toBe(32);
    expect(f.ctx.setTransform.mock.calls).toEqual([[2, 0, 0, 2, 0, 0], [1.25, 0, 0, 1.25, 0, 0]]);
    f.dialog.render({});
    expect(f.canvas.style.top).toBe('273px');
    expect(f.canvas.style.left).toBe('387px');
  });

  it('rounds fractional glyph width up to avoid clipping at the bitmap edge', () => {
    const f = fixture(1.25);
    f.ctx.measureText.mockImplementation(() => ({ width: 12.4 }));
    f.dialog.set('你好');
    expect(f.canvas.style.width).toBe('27px');
    expect(f.canvas.width).toBe(34);
    expect(f.roundRect).toHaveBeenLastCalledWith(f.ctx, 0.5, 0.5, 26, 24, 2);
  });

  it('retains native replacement, timeout, and removal behavior', () => {
    const f = fixture(2);
    f.dialog.set('第一条');
    const firstTimer = f.dialog.timeout;
    f.dialog.set('第二条');
    expect(f.Events.clearTimeout).toHaveBeenCalledExactlyOnceWith(firstTimer);
    expect(f.Events.setTimeout.mock.calls.map(call => call[1])).toEqual([5000, 5000]);
    expect(f.timers.size).toBe(1);
    expect(f.dialog.text).toBe('第二条');
    expect(f.dialog.display).toBe(true);
    const timer = f.timers.get(f.dialog.timeout!);
    timer!.callback();
    expect(f.canvas.remove).toHaveBeenCalledTimes(1);
    expect(f.dialog.timeout).toBeNull();
    expect(f.dialog.text).toBe('');
    expect(f.dialog.display).toBe(false);
  });

  it('changes only the entity dialog renderer, leaving numeric and name canvas fonts intact', () => {
    const before = 'const numericCanvasFont = "12px Arial";\n';
    const after = '\nconst nameCanvasFont = "bold 24px Arial";';
    expect(patchRuntimeDialogTypography(before + native + after)).toBe(before + patched + after);
    expect(patchRuntimeDialogTypography(before + after)).toBe(before + after);
  });

  it.each([
    native.replace('ctx.font = "12px Arial";', 'ctx.font = "13px Arial";'),
    native.replace('ctx.canvas.width = 14 + width;', 'ctx.canvas.width = 20 + width;'),
    native.replace('((_pos$2[1] - canvas.height - 2) | 0)', '((_pos$2[1] - canvas.height - 3) | 0)'),
    native.replace('render(matrix) {', 'render(other) {'),
    native + '\n' + native,
    patched,
  ])('rejects renderer anchor drift or duplicate patching', input => {
    expect(() => patchRuntimeDialogTypography(input)).toThrow('anchor:dialog-typography');
  });
});
