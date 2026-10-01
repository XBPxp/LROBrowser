// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLastroChatMapLinks } from '../scripts/lastro-chat-map-links.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

function fixture(map = 'prontera.gat') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const teleport = vi.fn(), navigate = vi.fn();
  const prompts: Array<{ message: string; yes: () => void }> = [];
  const api = createLastroChatMapLinks({
    setHtml: setLastROInnerHTML, teleport, navigate, getMap: () => map,
    showPrompt: (message, yes) => { prompts.push({ message, yes }); return {}; },
  });
  const render = (value: string, override = false) => {
    api.render(parent, value, override);
    return parent.querySelector('a.mapname');
  };
  return { api, parent, render, teleport, navigate, prompts };
}

afterEach(() => document.body.replaceChildren());

describe('official activity destination format compatibility', () => {
  it.each(['izlude#150#150', 'izlude#150#150#', 'izlude#150#150#0', 'izlude#150#150#2#'])('retains the first coordinates in the activity tuple %s', destination => {
    const f = fixture();
    const link = f.render(`[随机事件] 10秒后召唤师将在依斯鲁得岛举办魔物派对(<span class='mapname' data-map='${destination}'>点击前往</span>).`);
    expect(f.parent.textContent).toBe('[随机事件] 10秒后召唤师将在依斯鲁得岛举办魔物派对(传送到活动地点).');
    expect(f.api.request(link)).toBe(true);
    expect(f.teleport).not.toHaveBeenCalled();
    f.prompts[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'izlude', x: 150, y: 150 });
  });

  it.each(['001#izlude#150#150#0', '001#izlude.gat#150#150', '001#izlude'])('preserves the server instance ID in %s', destination => {
    const f = fixture();
    const link = f.render(`<span class='mapname' data-map='${destination}'>前往</span>`);
    expect(link?.getAttribute('data-map')).toBe('001#izlude');
    f.api.request(link); f.prompts[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith(destination === '001#izlude'
      ? { mapname: '001#izlude', x: 0, y: 0, mapOnly: true }
      : { mapname: '001#izlude', x: 150, y: 150 });
  });

  it.each(['1@tower#25#41', '1@tower.gat#25#41', 'event-map#25#41'])('accepts native map-name characters in %s', destination => {
    const f = fixture();
    const link = f.render(`<span class='mapname' data-map='${destination}'>前往</span>`);
    expect(f.api.request(link)).toBe(true); f.prompts[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({
      mapname: destination.startsWith('1@') ? '1@tower' : 'event-map', x: 25, y: 41,
    });
  });

  it('keeps separate coordinates with a hash-prefixed instance map', () => {
    const f = fixture();
    const link = f.render('<span class="mapname" data-map="001#izlude" data-x="150" data-y="150">前往</span>');
    f.api.request(link); f.prompts[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: '001#izlude', x: 150, y: 150 });
  });

  it.each([false, true])('uses the map-only server destination with override=%s even on the current map', override => {
    const f = fixture('izlude.gat');
    const link = f.render('<span class="mapname" data-map="izlude">前往</span>', override);
    expect(link?.getAttribute('data-map-only')).toBe('true');
    expect(link?.getAttribute('title')).toBe('传送到活动地点（izlude）');
    expect(f.api.plainText('<span class="mapname" data-map="izlude">前往</span>')).toBe('活动地点见聊天栏');
    expect(f.api.request(link)).toBe(true);
    expect(f.navigate).not.toHaveBeenCalled(); expect(f.teleport).not.toHaveBeenCalled();
    expect(f.prompts[0]!.message).toBe('是否传送到活动地点？\nizlude');
    f.prompts[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'izlude', x: 0, y: 0, mapOnly: true });
  });

  it('retains navigation to an explicit point on the current map', () => {
    const f = fixture('izlude.gat');
    const link = f.render('<span class="mapname" data-map="izlude#150#150#0">前往</span>');
    expect(f.api.request(link)).toBe(true);
    expect(f.navigate).toHaveBeenCalledExactlyOnceWith({ mapname: 'izlude', x: 150, y: 150 });
    expect(f.prompts).toHaveLength(0); expect(f.teleport).not.toHaveBeenCalled();
  });

  it('rejects changing a registered map-only destination into a navigation action', () => {
    const f = fixture('izlude.gat');
    const link = f.render('<span class="mapname" data-map="izlude">前往</span>')!;
    link.removeAttribute('data-map-only');
    expect(f.api.request(link)).toBe(false);
    expect(f.prompts).toHaveLength(0); expect(f.navigate).not.toHaveBeenCalled(); expect(f.teleport).not.toHaveBeenCalled();
  });

  it.each(['izlude#150', 'izlude#150#', 'izlude#150#150#broken', '001#izlude#150', '001#../izlude#150#150', '001#izlude#-1#150'])('keeps ambiguous or invalid destination %s inactive', destination => {
    const f = fixture();
    expect(f.render(`<span class="mapname" data-map="${destination}">前往</span>`)).toBeNull();
    expect(f.parent.textContent).toBe('[活动链接格式未识别]');
    expect(f.prompts).toHaveLength(0); expect(f.teleport).not.toHaveBeenCalled();
  });
});
