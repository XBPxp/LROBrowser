// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLastroChatMapLinks } from '../scripts/lastro-chat-map-links.mjs';
import { setLastROInnerHTML } from '../src/runtime/lastro-trusted-dom.mjs';

type Destination = { mapname: string; x: number; y: number };
type Confirmation = { yes: () => void; no: () => void; prompt: { onRemove?: () => void } };

const activityLink = "<span class='mapname' data-map='force_map3#100#184'>点击前往</span>";
const unavailable = '[活动链接格式未识别]';

function fixture() {
  const parent = document.createElement('div');
  document.body.append(parent);
  const confirmations: Confirmation[] = [];
  const teleport = vi.fn<(destination: Destination) => void>();
  const onError = vi.fn();
  const setHtml = vi.fn(setLastROInnerHTML);
  const showPrompt = vi.fn((_message: string, yes: () => void, no: () => void) => {
    const prompt = { onRemove: vi.fn() };
    confirmations.push({ yes, no, prompt });
    return prompt;
  });
  const api = createLastroChatMapLinks({ setHtml, showPrompt, teleport, onError });
  const link = () => {
    const result = parent.querySelector('a.mapname');
    if (!result) throw new Error('Missing activity link');
    return result;
  };
  return { parent, api, link, confirmations, teleport, onError, setHtml, showPrompt };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('activity notification markup recovery', () => {
  it('recognizes the original server notice delimiters without changing packet text', () => {
    const f = fixture();
    const message = '<msg>挑战开始<msg>';
    expect(f.api.serverMessage(message)).toBe('挑战开始');
    expect(f.api.normalize(message)).toBe(message);
  });

  it.each([
    '<msg>挑战开始</msg>', '前缀 <msg>挑战开始<msg>', '<msg>挑战开始<msg> 后缀',
    '<msg><msg>', '<msg>挑战开始', '挑战开始<msg>', '<msg><msg>挑战开始<msg>',
    '<MSG>挑战开始<MSG>', '<msg class="other">挑战开始<msg>', '&lt;msg&gt;挑战开始&lt;msg&gt;',
    null, undefined, {}, 123,
  ])('preserves ordinary or damaged chat instead of treating it as a notice: %s', message => {
    const f = fixture();
    expect(f.api.serverMessage(message)).toBeNull();
    f.api.render(f.parent, message);
    expect(f.parent.textContent).toBe(f.api.normalize(message));
  });

  it('renders notice bodies as safe text without interpreting arbitrary HTML', () => {
    const f = fixture();
    const body = f.api.serverMessage('<msg><img src=x onerror="alert(1)">挑战开始<msg>');
    f.api.render(f.parent, body);
    expect(f.parent.textContent).toBe('<img src=x onerror="alert(1)">挑战开始');
    expect(f.parent.querySelector('img, msg, script, [onerror]')).toBeNull();
  });

  it('preserves message-looking labels and payloads inside existing item and nickname links', () => {
    const f = fixture();
    const payload = '<ITEML>payload<msg>raw</ITEML>';
    const item = f.api.formatItemLink(payload, () => ({ name: '<msg>纪念品</msg>' }));
    f.api.render(f.parent, `获得${item} <span class="nickname-link" data-name="<msg>角色">&lt;msg&gt;角色&lt;/msg&gt;</span>`, true);
    expect(f.parent.querySelector<HTMLElement>('.item-link')?.dataset.item).toBe(payload);
    expect(f.parent.querySelector('.item-link')?.textContent).toBe('<<msg>纪念品</msg>>');
    expect(f.parent.querySelector('.nickname-link')?.textContent).toBe('<msg>角色</msg>');
    expect(f.parent.querySelector<HTMLElement>('.nickname-link')?.dataset.name).toBe('<msg>角色');
    expect(f.parent.textContent).toBe('获得<<msg>纪念品</msg>> <msg>角色</msg>');
  });

  it('recognizes an entity-escaped server marker without changing ordinary chat entities', () => {
    const f = fixture();
    const escaped = '&lt;span class=&#39;mapname&#39; data-map=&#39;force_map3&#35;100&#35;184&#39;&gt;点击&lt;/span&gt;';
    f.api.render(f.parent, `活动开始：${escaped}，原文 A &amp; B。`);
    expect(f.parent.textContent).toBe('活动开始：传送到活动地点，原文 A &amp; B。');
    expect(f.link().getAttribute('data-map')).toBe('force_map3');
    expect(f.link().getAttribute('data-x')).toBe('100');
    expect(f.link().getAttribute('data-y')).toBe('184');
    expect(f.parent.querySelectorAll('a.mapname')).toHaveLength(1);
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('recognizes numeric hexadecimal entities in an escaped destination', () => {
    const f = fixture();
    f.api.render(f.parent, '&lt;span class=&quot;mapname&quot; data-map=&quot;force_map3&#x23;100&#x23;184&quot;&gt;点击&lt;/span&gt;');
    f.api.request(f.link());
    f.confirmations[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
  });

  it.each([
    '<b>点击前往</b>',
    '<span class="label">点击前往</span>',
    '<span class="label"><b>点击前往</b></span>',
  ])('reads a marker containing the nested label %s', label => {
    const f = fixture();
    f.api.render(f.parent, `[随机事件] <span class="mapname" data-map="force_map3#100#184">${label}</span>。`);
    expect(f.parent.textContent).toBe('[随机事件] 传送到活动地点。');
    expect(f.parent.querySelectorAll('a.mapname')).toHaveLength(1);
    expect(f.parent.querySelector('b, .label')).toBeNull();
  });

  it.each([
    '<span class="mapname" data-map="force_map3#100#184" data-x="101">点击前往</span>',
    '<span class="mapname" data-map="force_map3#100">点击前往</span>',
    '<span class="mapname" data-map="force_map3#65536#184">点击前往</span>',
    '<span class="mapname" data-map="force_map3#100#184" data-map="prontera#1#2">点击前往</span>',
    '<span class="mapname" data-map="force_map3#100#',
    '<span class="mapname" data-map="force_map3#100#184">点击前往',
    '&lt;span class=&#39;mapname&#39; data-map=&#39;force_map3&#35;100&#35;',
  ])('shows a readable disabled destination for damaged markup: %s', marker => {
    const f = fixture();
    expect(() => f.api.render(f.parent, `活动通知：${marker}`)).not.toThrow();
    expect(f.parent.textContent).toBe(`活动通知：${unavailable}`);
    expect(f.parent.querySelector('.mapname')).toBeNull();
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('preserves another valid destination beside a damaged destination', () => {
    const f = fixture();
    f.api.render(f.parent, `<span class="mapname" data-map="force_map3#100">坏链接</span>，另一处 ${activityLink}`);
    expect(f.parent.textContent).toBe(`${unavailable}，另一处 传送到活动地点`);
    expect(f.parent.querySelectorAll('a.mapname')).toHaveLength(1);
    f.api.request(f.link());
    f.confirmations[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
  });

  it('rejects nested map markers with competing destinations instead of choosing one', () => {
    const f = fixture();
    const nested = `<span class="mapname" data-map="prontera#132#66">${activityLink}</span>`;
    f.api.render(f.parent, `活动通知：${nested}。`);
    expect(f.parent.textContent).toBe(`活动通知：${unavailable}。`);
    expect(f.parent.querySelector('.mapname')).toBeNull();
    expect(f.api.plainText(nested)).toBe(unavailable);
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('keeps ordinary HTML-looking chat and entities as inert literal text', () => {
    const f = fixture();
    const ordinary = '聊天文字 &lt;b&gt;A &amp; B&lt;/b&gt;，<img src=x>，2 < 3。';
    f.api.render(f.parent, ordinary);
    expect(f.parent.textContent).toBe(ordinary);
    expect(f.parent.querySelector('b, img, script, a')).toBeNull();
  });

  it('degrades rejected override HTML into text and renders the next notification', () => {
    const f = fixture();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const invalid = `${activityLink}<script>alert(1)</script><img src=x onerror="alert(2)">`;
    expect(() => f.api.render(f.parent, invalid, true)).not.toThrow();
    expect(f.parent.textContent).toContain('传送到活动地点');
    expect(f.parent.querySelector('script, img, [onclick], [onerror]')).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
    const next = document.createElement('div');
    expect(() => f.api.render(next, `下一条活动通知：${activityLink}`)).not.toThrow();
    expect(next.textContent).toBe('下一条活动通知：传送到活动地点');
    expect(next.querySelectorAll('a.mapname')).toHaveLength(1);
  });

  it('provides clean text for the canvas announcement while retaining chat actions', () => {
    const f = fixture();
    const message = `[活动] ${activityLink} 或 <span class="mapname" data-map="force_map3#100">损坏</span>`;
    expect(f.api.plainText(message)).toBe(`[活动] 活动地点见聊天栏 或 ${unavailable}`);
    f.api.render(f.parent, message);
    expect(f.parent.querySelectorAll('a.mapname')).toHaveLength(1);
  });
});

describe('notification input normalization', () => {
  it('ignores unsafe objects without invoking their conversion hooks', () => {
    const f = fixture();
    const toString = vi.fn(() => { throw new Error('conversion failed'); });
    const toPrimitive = vi.fn(() => { throw new Error('conversion failed'); });
    const value = { toString, [Symbol.toPrimitive]: toPrimitive };
    expect(f.api.normalize(value)).toBe('');
    expect(f.api.plainText(value)).toBe('');
    expect(() => f.api.render(f.parent, value)).not.toThrow();
    expect(f.parent.textContent).toBe('');
    expect(toString).not.toHaveBeenCalled();
    expect(toPrimitive).not.toHaveBeenCalled();
  });

  it.each([null, undefined, {}, [], Symbol('activity')])('normalizes a non-text input safely: %s', value => {
    const f = fixture();
    expect(f.api.normalize(value)).toBe('');
    expect(() => f.api.render(f.parent, value)).not.toThrow();
    expect(f.parent.textContent).toBe('');
  });

  it('accepts simple scalar values as text', () => {
    const f = fixture();
    expect(f.api.normalize(123)).toBe('123');
    expect(f.api.normalize(false)).toBe('false');
    expect(f.api.normalize(123n)).toBe('123');
  });

  it('normalizes CRLF and lone surrogate characters without corrupting Chinese or emoji', () => {
    const f = fixture();
    const result = f.api.normalize('活动 🧙‍♂️\r\n下一行\r尾行\ud800损坏\udc00');
    expect(result).toContain('活动 🧙‍♂️\n下一行\n尾行');
    expect(result).not.toContain('\r');
    expect(result).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  it('removes display controls while preserving emoji, newlines, and tabs', () => {
    const f = fixture();
    const text = '活动\u0000\u001b\u007f\u202e 🧙‍♂️\n\t下一行\u2066结束\u2069';
    const expected = '活动 🧙‍♂️\n\t下一行结束';
    f.api.render(f.parent, text);
    expect(f.parent.textContent).toBe(expected);
    expect(f.api.plainText(text)).toBe(expected);
  });

  it('does not repair controls inside coordinates into a usable teleport destination', () => {
    const f = fixture();
    const damaged = '<span class="mapname" data-map="force_map3#10\u001b0#184">点击前往</span>';
    const normalized = f.api.normalize(damaged);
    expect(normalized).toContain('\u001b');
    f.api.render(f.parent, normalized);
    expect(f.parent.textContent).toBe(unavailable);
    expect(f.parent.querySelector('.mapname')).toBeNull();
    expect(f.api.plainText(normalized)).toBe(unavailable);
  });

  it('bounds very long input without creating an action from its clipped tail', () => {
    const f = fixture();
    const input = '活动通知'.repeat(25_000) + activityLink;
    const result = f.api.normalize(input);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(input.length);
    expect(() => f.api.render(f.parent, input)).not.toThrow();
    expect(f.parent.textContent!.length).toBeLessThan(input.length);
    expect(f.parent.querySelector('.mapname')).toBeNull();
  });

  it.each([
    '<span>'.repeat(12_000),
    '<span class="mapname" data-map="force_map3#100">'.repeat(2_000),
    '<span class="mapname" data-map="force_map3#100">损坏</span>'.repeat(2_000),
    '<span class="label">普通文字</span>'.repeat(4_000),
  ])('handles repeated or deeply nested notification markup within the input limit', repeated => {
    const f = fixture();
    const normalized = f.api.normalize(repeated);
    expect(normalized.length).toBeLessThanOrEqual(65_536);
    expect(() => f.api.render(f.parent, repeated)).not.toThrow();
    expect(() => f.api.plainText(repeated)).not.toThrow();
    expect(f.parent.querySelector('a.mapname, script, img')).toBeNull();
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });
});

describe('safe item links in activity notifications', () => {
  it('escapes item names and payloads while preserving their exact text and attributes', () => {
    const f = fixture();
    const payload = '<ITEMLINK>活动"奖励<img src=x><INFO>501</INFO></ITEMLINK>';
    const name = '活动奖励<img src=x><script>副本</script> & "药水"';
    const html = f.api.formatItemLink(payload, () => ({ name }));
    expect(typeof html).toBe('string');
    setLastROInnerHTML(f.parent, html!);
    const item = f.parent.querySelector('.item-link');
    expect(item?.getAttribute('data-item')).toBe(payload);
    expect(item?.textContent).toContain(name);
    expect(f.parent.querySelector('img, script, [onclick], [onerror]')).toBeNull();
    f.api.render(f.parent, `奖励 ${html}，${activityLink}`, true);
    expect(f.parent.querySelector('.item-link')?.getAttribute('data-item')).toBe(payload);
    expect(f.parent.querySelectorAll('a.mapname')).toHaveLength(1);
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('returns null for failed parsing or a missing safe item name', () => {
    const f = fixture();
    expect(f.api.formatItemLink('<ITEML>坏数据</ITEML>', () => null)).toBeNull();
    expect(f.api.formatItemLink('<ITEML>坏数据</ITEML>', () => { throw new Error('bad item'); })).toBeNull();
    expect(f.api.formatItemLink('<ITEML>坏数据</ITEML>', () => ({}))).toBeNull();
    const name = { toString: vi.fn(() => { throw new Error('unsafe name'); }) };
    expect(f.api.formatItemLink('<ITEML>坏数据</ITEML>', () => ({ name }))).toBeNull();
    expect(name.toString).not.toHaveBeenCalled();
  });

  it('keeps an escaped map marker inside an item name as item text', () => {
    const f = fixture();
    const payload = '<ITEMLINK>活动奖励<INFO>501</INFO></ITEMLINK>';
    const name = `活动奖励 ${activityLink}`;
    const html = f.api.formatItemLink(payload, () => ({ name }));
    expect(html).not.toBeNull();
    f.api.render(f.parent, html, true);
    expect(f.parent.querySelector('.item-link')?.textContent).toBe(`<${name}>`);
    expect(f.parent.querySelector('.item-link')?.getAttribute('data-item')).toBe(payload);
    expect(f.parent.querySelector('a.mapname')).toBeNull();
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('keeps an escaped map marker inside a nickname as nickname text', () => {
    const f = fixture();
    const escaped = '&lt;span class=&#39;mapname&#39; data-map=&#39;force_map3#100#184&#39;&gt;点击前往&lt;/span&gt;';
    f.api.render(f.parent, `<span class="nickname-link">玩家 ${escaped}</span>`, true);
    expect(f.parent.querySelector('.nickname-link')?.textContent).toBe(`玩家 ${activityLink}`);
    expect(f.parent.querySelector('a.mapname')).toBeNull();
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });
});

describe('activity confirmation error recovery', () => {
  it('reports prompt failures without throwing and permits a later confirmation', () => {
    const f = fixture();
    f.api.render(f.parent, activityLink);
    f.showPrompt.mockImplementationOnce(() => { throw new Error('popup unavailable'); });
    expect(f.api.request(f.link())).toBe(false);
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.teleport).not.toHaveBeenCalled();
    expect(f.api.request(f.link())).toBe(true);
    f.confirmations[0]!.yes();
    expect(f.teleport).toHaveBeenCalledOnce();
  });

  it('reports a send failure without leaving the confirmation locked or retransmitting it', () => {
    const f = fixture();
    f.api.render(f.parent, activityLink);
    f.teleport.mockImplementationOnce(() => { throw new Error('socket closed'); });
    expect(f.api.request(f.link())).toBe(true);
    expect(() => f.confirmations[0]!.yes()).not.toThrow();
    expect(f.onError).toHaveBeenCalledOnce();
    expect(() => f.confirmations[0]!.yes()).not.toThrow();
    expect(f.teleport).toHaveBeenCalledOnce();
    expect(f.api.request(f.link())).toBe(true);
    f.confirmations[1]!.yes();
    expect(f.teleport).toHaveBeenCalledTimes(2);
  });

  it('survives an error reporter that also throws', () => {
    const f = fixture();
    f.api.render(f.parent, activityLink);
    f.onError.mockImplementation(() => { throw new Error('reporter unavailable'); });
    f.showPrompt.mockImplementationOnce(() => { throw new Error('popup unavailable'); });
    expect(() => f.api.request(f.link())).not.toThrow();
    expect(f.api.request(f.link())).toBe(true);
    f.confirmations[0]!.no();
    expect(f.teleport).not.toHaveBeenCalled();
  });
});

describe('trusted activity action registration', () => {
  const rawMarker = '<span class="mapname" data-map="force_map3" data-x="100" data-y="184">原始地图入口</span>';

  it.each([
    ['protected nickname marker', `<span class="nickname-link">玩家 ${rawMarker}</span>`],
    ['unparsed raw anchor', '<a class="mapname" data-map="force_map3" data-x="100" data-y="184">原始地图入口</a>'],
    ['marker beyond the nesting limit', `${'<span>'.repeat(34)}${rawMarker}${'</span>'.repeat(34)}`],
  ])('does not leave an unregistered activity entry for %s in override HTML', (_label, html) => {
    const f = fixture();
    expect(() => f.api.render(f.parent, html, true)).not.toThrow();
    expect(f.parent.querySelector('.mapname')).toBeNull();
    expect(f.api.request(f.parent.querySelector('.mapname'))).toBe(false);
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('rejects a hand-built anchor even when it copies the expected metadata and label', () => {
    const f = fixture();
    const anchor = document.createElement('a');
    anchor.className = 'mapname';
    anchor.href = '#';
    anchor.textContent = '传送到活动地点';
    anchor.title = '传送到活动地点（force_map3 100, 184）';
    anchor.dataset.map = 'force_map3';
    anchor.dataset.x = '100';
    anchor.dataset.y = '184';
    f.parent.append(anchor);
    expect(f.api.request(anchor)).toBe(false);
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('rejects a cloned activity anchor without invalidating the registered original', () => {
    const f = fixture();
    f.api.render(f.parent, activityLink);
    const original = f.link();
    const clone = original.cloneNode(true) as Element;
    f.parent.append(clone);
    expect(f.api.request(clone)).toBe(false);
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.api.request(original)).toBe(true);
    f.confirmations[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
  });

  it('registers the actual activity anchor after mixed override HTML is parsed', () => {
    const f = fixture();
    const item = f.api.formatItemLink('<ITEMLINK>药水<INFO>501</INFO></ITEMLINK>', () => ({ name: '红色药水' }));
    const unparsedAnchor = '<a class="mapname" data-map="prontera" data-x="132" data-y="66">原始地图入口</a>';
    f.api.render(f.parent, `奖励 ${item}，${activityLink}，${unparsedAnchor}`, true);
    expect(f.parent.querySelector('.item-link')?.textContent).toBe('<红色药水>');
    expect(f.parent.textContent).toContain('原始地图入口');
    expect(f.parent.querySelectorAll('.mapname')).toHaveLength(1);
    expect(f.api.request(f.link())).toBe(true);
    expect(f.showPrompt).toHaveBeenCalledOnce();
    expect(f.teleport).not.toHaveBeenCalled();
    f.confirmations[0]!.yes();
    expect(f.teleport).toHaveBeenCalledExactlyOnceWith({ mapname: 'force_map3', x: 100, y: 184 });
  });

  it('does not create an activity entry from a span with both item-link and mapname classes', () => {
    const f = fixture();
    f.api.render(f.parent, '<span class="item-link mapname" data-map="force_map3" data-x="100" data-y="184">物品名称</span>', true);
    expect(f.parent.querySelector('.mapname')).toBeNull();
    expect(f.parent.textContent).toBe('物品名称');
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });

  it('rejects changes to otherwise valid metadata on a registered activity anchor', () => {
    const f = fixture();
    f.api.render(f.parent, activityLink);
    const anchor = f.link();
    anchor.setAttribute('data-map', 'prontera');
    anchor.setAttribute('data-x', '132');
    anchor.setAttribute('data-y', '66');
    expect(f.api.request(anchor)).toBe(false);
    expect(f.showPrompt).not.toHaveBeenCalled();
    expect(f.teleport).not.toHaveBeenCalled();
  });
});
