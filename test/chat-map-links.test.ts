// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLastroChatMapLinks } from '../scripts/lastro-chat-map-links.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

type Destination = { mapname: string; x: number; y: number };
type Prompt = {
  onRemove: () => void;
  remove: () => void;
  focus: () => void;
  onKeyDown: (event: KeyboardEvent) => unknown;
};

function fixture() {
  const parent = document.createElement('div');
  document.body.append(parent);
  const dialogs: Array<{ message: string; yes: () => void; no: () => void; prompt: Prompt }> = [];
  const teleport = vi.fn<(destination: Destination) => void>();
  const setHtml = vi.fn(setLastROInnerHTML);
  let available = true;
  const showPrompt = vi.fn((message: string, yes: () => void, no: () => void) => {
    const prompt: Prompt = {
      onRemove: vi.fn(),
      remove: vi.fn(() => prompt.onRemove()),
      focus: vi.fn(),
      onKeyDown: vi.fn(),
    };
    // RO's native buttons remove the window before invoking their callback.
    dialogs.push({
      message,
      yes: () => { prompt.remove(); yes(); },
      no: () => { prompt.remove(); no(); },
      prompt,
    });
    return prompt;
  });
  const api = createLastroChatMapLinks({
    setHtml,
    showPrompt,
    teleport,
    canTeleport: () => available,
  });
  const render = (text: string, override = false) => api.render(parent, text, override);
  const link = () => {
    const element = parent.querySelector('a.mapname');
    if (!element) throw new Error('Missing activity teleport link');
    return element;
  };
  return { api, parent, render, link, dialogs, showPrompt, teleport, setHtml, setAvailable: (value: boolean) => { available = value; } };
}

const activityLink = "<span class='mapname' data-map='force_map3#100#184'>点击前往</span>";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('activity notification teleport links', () => {
  it('renders the screenshot notification as readable text with an activity destination link', () => {
    const f = fixture();
    f.render(`[随机事件] 10秒后召唤师将在迷宫举办魔物派对(${activityLink}).`);
    expect(f.parent.textContent).toBe('[随机事件] 10秒后召唤师将在迷宫举办魔物派对(传送到活动地点).');
    expect(f.link().getAttribute('data-map')).toBe('force_map3');
    expect(f.link().getAttribute('data-x')).toBe('100');
    expect(f.link().getAttribute('data-y')).toBe('184');
    expect(f.parent.querySelectorAll('a.mapname')).toHaveLength(1);
    expect(f.parent.querySelector('span.mapname')).toBeNull();
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('supports separate coordinates, attribute order, uppercase markup and a .gat map suffix', () => {
    const f = fixture();
    f.render('<SPAN DATA-Y="0184" DATA-X="0100" DATA-MAP="FORCE_MAP3.GAT" CLASS="mapname">活动</SPAN>');
    expect(f.link().textContent).toBe('传送到活动地点');
    expect(f.link().getAttribute('data-map')).toBe('force_map3');
    expect(f.link().getAttribute('data-x')).toBe('100');
    expect(f.link().getAttribute('data-y')).toBe('184');
    expect(f.api.request(f.link())).toBe(true);
    f.dialogs[0]!.yes();
    expect(f.teleport).toHaveBeenCalledWith({ mapname: 'force_map3', x: 100, y: 184 });
  });

  it('keeps multiple independent destinations and all surrounding message text', () => {
    const f = fixture();
    f.render(`A & B ${activityLink}，或者 <span class="mapname" data-map="prontera#132#66">第二处</span>。`);
    const links = f.parent.querySelectorAll('a.mapname');
    expect(links).toHaveLength(2);
    expect(f.parent.textContent).toBe('A & B 传送到活动地点，或者 传送到活动地点。');
    f.api.request(links[1]!);
    f.dialogs[0]!.yes();
    expect(f.teleport).toHaveBeenCalledWith({ mapname: 'prontera', x: 132, y: 66 });
  });

  it('preserves generated item links when a message also contains an activity link', () => {
    const f = fixture();
    const item = '<span class="item-link" data-item="&lt;ITEMLINK&gt;501&lt;/ITEMLINK&gt;" style="color:#FFFF63;">&lt;红色药水&gt;</span>';
    f.render(`奖励 ${item}，${activityLink}`, true);
    const itemLink = f.parent.querySelector('.item-link');
    expect(itemLink?.textContent).toBe('<红色药水>');
    expect(itemLink?.getAttribute('data-item')).toBe('<ITEMLINK>501</ITEMLINK>');
    expect(f.parent.querySelectorAll('a.mapname')).toHaveLength(1);
    expect(f.parent.textContent).toBe('奖励 <红色药水>，传送到活动地点');
  });

  it('accepts the existing coordinate bounds including zero', () => {
    const f = fixture();
    f.render('<span class="mapname" data-map="prontera#0#65535">边界</span>');
    f.api.request(f.link());
    f.dialogs[0]!.yes();
    expect(f.teleport).toHaveBeenCalledWith({ mapname: 'prontera', x: 0, y: 65535 });
  });

  it.each([
    ['missing x', '<span class="mapname" data-map="prontera" data-y="184">前往</span>'],
    ['missing y', '<span class="mapname" data-map="prontera" data-x="100">前往</span>'],
    ['empty coordinate', '<span class="mapname" data-map="prontera" data-x="" data-y="184">前往</span>'],
    ['negative coordinate', '<span class="mapname" data-map="prontera#-1#184">前往</span>'],
    ['fractional coordinate', '<span class="mapname" data-map="prontera#1.5#184">前往</span>'],
    ['overflow coordinate', '<span class="mapname" data-map="prontera#65536#184">前往</span>'],
    ['exponent coordinate', '<span class="mapname" data-map="prontera#1e2#184">前往</span>'],
    ['nonfinite coordinate', '<span class="mapname" data-map="prontera#Infinity#184">前往</span>'],
    ['invalid trailing field', '<span class="mapname" data-map="prontera#100#184#broken">前往</span>'],
    ['empty map', '<span class="mapname" data-map="#100#184">前往</span>'],
    ['map traversal', '<span class="mapname" data-map="../prontera#100#184">前往</span>'],
    ['overlong map', '<span class="mapname" data-map="abcdefghijklmnopq#100#184">前往</span>'],
    ['conflicting coordinate formats', '<span class="mapname" data-map="prontera#100#184" data-x="101" data-y="184">前往</span>'],
    ['wrong class', '<span class="not-mapname" data-map="prontera#100#184">前往</span>'],
    ['duplicate map attributes', '<span class="mapname" data-map="prontera#100#184" data-map="geffen#2#3">前往</span>'],
    ['duplicate coordinate attributes', '<span class="mapname" data-map="prontera" data-x="100" data-x="200" data-y="184">前往</span>'],
    ['duplicate unrelated attributes', '<span class="mapname" data-map="prontera#100#184" title="a" title="b">前往</span>'],
  ])('shows %s without creating a teleport action', (label, text) => {
    const f = fixture();
    f.render(text);
    expect(f.parent.textContent).toBe(label === 'wrong class' ? text : '[活动链接格式未识别]');
    expect(f.parent.querySelector('a.mapname')).toBeNull();
    expect(f.parent.querySelector('span')).toBeNull();
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('keeps ordinary HTML-looking chat text inert while recognizing a valid destination', () => {
    const f = fixture();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const prefix = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    f.render(`${prefix} ${activityLink}`);
    expect(f.parent.textContent).toBe(`${prefix} 传送到活动地点`);
    expect(f.parent.querySelector('img, script, [onerror], [onclick]')).toBeNull();
    expect(f.setHtml).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('safely degrades override markup rejected by the Trusted Types HTML policy', () => {
    const f = fixture();
    expect(() => f.render(`${activityLink}<script>alert(1)</script>`, true)).not.toThrow();
    expect(f.parent.querySelector('script')).toBeNull();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('does not turn suspicious link markup into executable DOM', () => {
    const f = fixture();
    const text = '<span class="mapname" data-map="prontera#100#184" onclick="alert(1)"><img src=x onerror="alert(2)"></span>';
    f.render(text);
    expect(f.parent.querySelector('img, script, [onerror], [onclick]')).toBeNull();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('strips extra attributes from a valid map marker before creating the safe link', () => {
    const f = fixture();
    f.render('<span class="mapname" data-map="prontera#100#184" onclick="alert(1)">前往</span>');
    expect(f.link().textContent).toBe('传送到活动地点');
    expect(f.link().getAttribute('onclick')).toBeNull();
    expect(f.parent.querySelector('[onclick]')).toBeNull();
  });
});

describe('native teleport confirmation flow', () => {
  it('requires confirmation, transmits the exact destination once, and allows a later request', () => {
    const f = fixture();
    f.render(activityLink);
    expect(f.api.request(f.link())).toBe(true);
    expect(f.showPrompt).toHaveBeenCalledOnce();
    expect(f.dialogs[0]!.message).toContain('传送');
    expect(f.teleport).not.toHaveBeenCalled();
    f.dialogs[0]!.yes();
    f.dialogs[0]!.yes();
    f.dialogs[0]!.no();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
    f.api.request(f.link());
    expect(f.showPrompt).toHaveBeenCalledTimes(2);
    f.dialogs[1]!.yes();
    expect(f.teleport).toHaveBeenCalledTimes(2);
  });

  it('cancels without teleporting and ignores a stale confirmation callback', () => {
    const f = fixture();
    f.render(activityLink);
    f.api.request(f.link());
    f.dialogs[0]!.no();
    f.dialogs[0]!.yes();
    f.dialogs[0]!.no();
    expect(f.teleport).not.toHaveBeenCalled();
    f.api.request(f.link());
    expect(f.showPrompt).toHaveBeenCalledTimes(2);
    f.dialogs[1]!.yes();
    expect(f.teleport).toHaveBeenCalledOnce();
  });

  it('opens only one confirmation during repeated clicks, including on another destination', () => {
    const f = fixture();
    f.render(`${activityLink} <span class="mapname" data-map="prontera#132#66">另一处</span>`);
    const links = f.parent.querySelectorAll('a.mapname');
    f.api.request(links[0]!);
    f.api.request(links[0]!);
    f.api.request(links[1]!);
    expect(f.showPrompt).toHaveBeenCalledOnce();
    f.dialogs[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
  });

  it('releases a removed confirmation and does not accept its stale callback', async () => {
    const f = fixture();
    f.render(activityLink);
    f.api.request(f.link());
    f.dialogs[0]!.prompt.remove();
    await Promise.resolve();
    f.dialogs[0]!.yes();
    expect(f.teleport).not.toHaveBeenCalled();
    f.api.request(f.link());
    expect(f.showPrompt).toHaveBeenCalledTimes(2);
  });

  it('does not let removal of an older completed prompt unlock the current prompt', async () => {
    const f = fixture();
    f.render(activityLink);
    f.api.request(f.link());
    f.dialogs[0]!.yes();
    f.api.request(f.link());
    f.dialogs[0]!.prompt.remove();
    await Promise.resolve();
    f.api.request(f.link());
    expect(f.showPrompt).toHaveBeenCalledTimes(2);
    expect(f.teleport).toHaveBeenCalledOnce();
  });

  it('uses the destination shown by the prompt even if the chat node changes before confirmation', () => {
    const f = fixture();
    f.render(activityLink);
    f.api.request(f.link());
    f.link().setAttribute('data-map', 'prontera');
    f.link().setAttribute('data-x', '132');
    f.link().setAttribute('data-y', '66');
    f.dialogs[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
  });

  it('recovers from a failure to create the native confirmation prompt', () => {
    const f = fixture();
    f.render(activityLink);
    f.showPrompt.mockImplementationOnce(() => { throw new Error('Prompt unavailable'); });
    expect(f.api.request(f.link())).toBe(false);
    expect(f.teleport).not.toHaveBeenCalled();
    f.api.request(f.link());
    expect(f.showPrompt).toHaveBeenCalledTimes(2);
    f.dialogs[0]!.yes();
    expect(f.teleport).toHaveBeenCalledOnce();
  });

  it('revalidates destination attributes before opening a confirmation', () => {
    const f = fixture();
    f.render(activityLink);
    const link = f.link();
    link.setAttribute('data-x', '');
    expect(f.api.request(link)).toBe(false);
    link.setAttribute('data-x', '100');
    link.setAttribute('data-y', '65536');
    expect(f.api.request(link)).toBe(false);
    link.setAttribute('data-y', '184');
    link.setAttribute('data-map', '../prontera');
    expect(f.api.request(link)).toBe(false);
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('does not open or complete teleport requests while the session is unavailable', () => {
    const f = fixture();
    f.render(activityLink);
    f.setAvailable(false);
    expect(f.api.request(f.link())).toBe(false);
    expect(f.showPrompt).not.toHaveBeenCalled();
    f.setAvailable(true);
    f.api.request(f.link());
    f.setAvailable(false);
    f.dialogs[0]!.yes();
    expect(f.teleport).not.toHaveBeenCalled();
  });
});
