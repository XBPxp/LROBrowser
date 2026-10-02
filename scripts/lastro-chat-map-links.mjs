// Serialized into Online.js by the runtime patcher; keep dependencies explicit.
export function createLastroChatMapLinks({ setHtml, showPrompt, shouldConfirmTeleport = () => true, teleport, canTeleport = () => true, getMap, navigate, onError }) {
  let promptOpen = false;
  const trustedLinks = new WeakMap();

  function report(error) {
    try { onError?.(error); } catch { /* Reporting must not interrupt other notifications. */ }
  }

  function normalize(value) {
    if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)) return '';
    let text = String(value).replace(/\r\n?/g, '\n');
    if (text.length > 65535) text = text.slice(0, 65535) + '…';
    return text.toWellFormed();
  }

  function visibleText(text) {
    // Keep newlines, tabs and emoji joiners; hide non-printing and direction-override controls.
    // eslint-disable-next-line no-control-regex -- Display filtering intentionally matches packet control bytes.
    return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  }

  function decodeEntities(value) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return value.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi, (match, entity) => {
      const name = entity.toLowerCase();
      if (name[0] !== '#') return named[name];
      const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match;
    });
  }

  function coordinate(value) {
    if (typeof value !== 'string') return null;
    value = value.trim();
    if (!/^\d{1,16}$/.test(value)) return null;
    const number = Number(value);
    return Number.isInteger(number) && number <= 65535 ? number : null;
  }

  function destination(mapValue, xValue, yValue) {
    if (typeof mapValue !== 'string') return null;
    const parts = mapValue.trim().split('#');
    let map = parts.shift();
    // Instance IDs use a three-digit prefix and a physical map name. Consume
    // that prefix before the coordinate tuple, without confusing numeric X/Y.
    if (/^\d{3}$/.test(map) && /^[a-z0-9_@-]+(?:\.(?:gat|rsw))?$/i.test(parts[0] ?? '')
      && /[a-z_@-]/i.test(parts[0])) map += '#' + parts.shift();
    const mapname = map.replace(/\.(gat|rsw)$/i, '').toLowerCase();
    if (!/^[a-z0-9_@#-]{1,16}$/.test(mapname)) return null;
    if (parts.length) {
      // The official activity handler reads map#x#y and ignores tail fields.
      // Accept empty/numeric metadata while retaining strict coordinate checks.
      if (parts.length < 2 || parts.slice(2).some(value => !/^\d*$/.test(value.trim()))) return null;
      // Do not silently choose between two conflicting coordinate formats.
      if ((xValue != null && coordinate(xValue) !== coordinate(parts[0]))
        || (yValue != null && coordinate(yValue) !== coordinate(parts[1]))) return null;
      [xValue, yValue] = parts;
    }
    // A map-only activity uses the native packet's default 0/0 destination.
    // Mark it explicitly so a current-map notice still requests the server warp.
    if (xValue == null && yValue == null) return { mapname, x: 0, y: 0, mapOnly: true };
    const x = coordinate(xValue), y = coordinate(yValue);
    if (x == null || y == null) return null;
    return { mapname, x, y };
  }

  function attributes(source) {
    const values = Object.create(null);
    let valid = true, count = 0;
    while (source.length) {
      const match = /^\s+([a-z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/i.exec(source);
      if (!match) { valid = valid && /^\s*$/.test(source); break; }
      const name = match[1].toLowerCase();
      if (++count > 64) { valid = false; break; }
      if (Object.hasOwn(values, name)) valid = false;
      else values[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
      source = source.slice(match[0].length);
    }
    return { values, valid };
  }

  function serverMessage(value) {
    if (typeof value !== 'string') return null;
    const parts = value.split('<msg>');
    return parts.length === 3 && parts[0] === '' && parts[1] !== '' && parts[2] === '' ? parts[1] : null;
  }

  function findLinks(text) {
    const links = [], stack = [];
    const tokens = /<\/?span\b(?:"[^"]*"|'[^']*'|[^"'<>])*>|&lt;\/?span\b(?:(?!&gt;)[\s\S])*?&gt;/gi;
    let processedEnd = 0;
    for (const match of text.matchAll(tokens)) {
      const token = match[0].startsWith('&') ? decodeEntities(match[0]) : match[0];
      const end = match.index + match[0].length;
      processedEnd = end;
      if (/^<\/span\s*>$/i.test(token)) {
        const entry = stack.pop();
        if (entry?.known) links.push({ start: entry.start, end, target: entry.ambiguous ? null : entry.target });
        continue;
      }
      const parsed = attributes(token.slice(5, -1));
      const attrs = parsed.values;
      const classes = attrs.class?.toLowerCase().split(/\s+/) ?? [];
      const protectedContext = stack.some(parent => parent.protected);
      const protectedEntry = protectedContext || classes.includes('item-link') || classes.includes('nickname-link');
      const known = !protectedEntry && classes.includes('mapname');
      const entry = { start: match.index, known, protected: protectedEntry, target: known && parsed.valid ? destination(attrs['data-map'], attrs['data-x'], attrs['data-y']) : null };
      if (known && stack.some(parent => parent.known)) {
        entry.ambiguous = true;
        for (const parent of stack) if (parent.known) parent.ambiguous = true;
      }
      if (stack.length >= 32) {
        if (known) links.push({ start: match.index, end: text.length, target: null });
        break;
      }
      stack.push(entry);
    }
    // Incomplete markers are visible but never become teleport actions.
    for (const entry of stack) if (entry.known) links.push({ start: entry.start, end: text.length, target: null });
    const tail = /(?:<span\b|&lt;span\b)[\s\S]*$/i.exec(text.slice(processedEnd));
    if (tail) {
      const token = tail[0].startsWith('&') ? decodeEntities(tail[0]) : tail[0];
      const parsed = attributes(token.slice(5));
      if (parsed.values.class?.split(/\s+/).some(name => name.toLowerCase() === 'mapname')) {
        links.push({ start: processedEnd + tail.index, end: text.length, target: null });
      }
    }
    links.sort((a, b) => a.start - b.start || b.end - a.end);
    const nonOverlapping = [];
    let coveredEnd = -1;
    for (const entry of links) {
      if (entry.start < coveredEnd) continue;
      nonOverlapping.push(entry);
      coveredEnd = entry.end;
    }
    return nonOverlapping;
  }

  function linkTitle(target) {
    return target.mapOnly ? `传送到活动地点（${target.mapname}）` : `传送到活动地点（${target.mapname} ${target.x}, ${target.y}）`;
  }

  function createLink(doc, target) {
    const link = doc.createElement('a');
    link.className = 'mapname';
    link.href = '#';
    link.textContent = '传送到活动地点';
    link.title = linkTitle(target);
    link.dataset.map = target.mapname;
    link.dataset.x = String(target.x);
    link.dataset.y = String(target.y);
    if (target.mapOnly) link.dataset.mapOnly = 'true';
    trustedLinks.set(link, target);
    return link;
  }

  function readableHtml(text) {
    return visibleText(decodeEntities(text.replace(/<(?:"[^"]*"|'[^']*'|[^"'<>])*>/g, '')));
  }

  function renderPlain(parent, text, links, stripHtml = false) {
    const doc = parent.ownerDocument;
    const fragment = doc.createDocumentFragment();
    const readable = stripHtml ? readableHtml : visibleText;
    let offset = 0;
    for (const { start, end, target } of links) {
      fragment.append(doc.createTextNode(readable(text.slice(offset, start))));
      fragment.append(target ? createLink(doc, target) : doc.createTextNode('[活动链接格式未识别]'));
      offset = end;
    }
    fragment.append(doc.createTextNode(readable(text.slice(offset))));
    parent.replaceChildren(fragment);
  }

  function plainText(value) {
    const text = normalize(value);
    let output = '', offset = 0;
    for (const { start, end, target } of findLinks(text)) {
      output += visibleText(text.slice(offset, start)) + (target ? '活动地点见聊天栏' : '[活动链接格式未识别]');
      offset = end;
    }
    return output + visibleText(text.slice(offset));
  }

  function formatItemLink(match, parse) {
    try {
      const info = parse();
      if (typeof info?.name !== 'string' || !info.name) return null;
      const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      return `<span data-item="${escape(match)}" class="item-link" style="color:#FFFF63;">&lt;${escape(visibleText(normalize(info.name)))}&gt;</span>`;
    } catch (error) { report(error); return null; }
  }

  function render(parent, value, override = false) {
    const text = normalize(value);
    const links = findLinks(text);
    let offset = 0;
    if (override) {
      // Keep existing item/nickname links on their established Trusted Types path.
      let html = '';
      try {
        const token = globalThis.crypto.randomUUID();
        const targets = [];
        for (const { start, end, target } of links) {
          html += visibleText(text.slice(offset, start));
          html += target ? `<span data-lastro-activity="${token}-${targets.push(target) - 1}"></span>` : '[活动链接格式未识别]';
          offset = end;
        }
        setHtml(parent, html + visibleText(text.slice(offset)));
        // Replace only this render's placeholders with registered DOM nodes.
        // Raw markup retained by the HTML path must never become an action.
        targets.forEach((target, index) => {
          const placeholder = parent.querySelector(`span[data-lastro-activity="${token}-${index}"]`);
          placeholder?.replaceWith(createLink(parent.ownerDocument, target));
        });
        for (const node of parent.querySelectorAll('.mapname')) {
          if (!trustedLinks.has(node)) node.replaceWith(parent.ownerDocument.createTextNode(node.textContent ?? ''));
        }
      }
      catch (error) {
        report(error);
        renderPlain(parent, text, links, true);
      }
      return;
    }
    renderPlain(parent, text, links);
  }

  function onCurrentMap(target) {
    const map = getMap?.();
    return !target.mapOnly && typeof map === 'string' && map.trim().toLowerCase().replace(/\.(gat|rsw)$/i, '') === target.mapname;
  }

  function travel(target) {
    if (onCurrentMap(target)) {
      if (typeof navigate !== 'function') throw new Error('当前客户端不支持寻路。');
      navigate(target);
    } else if (canTeleport()) teleport(target);
  }

  function request(link) {
    try {
      if (!link || !trustedLinks.has(link)) return false;
      const target = destination(link.getAttribute('data-map'), link.getAttribute('data-x'), link.getAttribute('data-y'));
      const registered = trustedLinks.get(link);
      if (!target || target.mapname !== registered.mapname || target.x !== registered.x || target.y !== registered.y) return false;
      if ((link.getAttribute('data-map-only') === 'true') !== (registered.mapOnly === true)) return false;
      if (registered.mapOnly) target.mapOnly = true;
      if (promptOpen) return true;
      if (onCurrentMap(target)) {
        travel(target);
        return true;
      }
      if (!canTeleport()) return false;
      if (shouldConfirmTeleport() === false) {
        travel(target);
        return true;
      }
      promptOpen = true;
      let settled = false;
      const finish = confirmed => {
        if (settled) return;
        settled = true;
        promptOpen = false;
        try { if (confirmed) travel(target); }
        catch (error) { report(error); }
      };
      const prompt = showPrompt(
        `是否传送到活动地点？\n${target.mapname}${target.mapOnly ? '' : `（${target.x}, ${target.y}）`}`,
        () => finish(true), () => finish(false),
      );
      if (prompt) {
        const previousRemove = prompt.onRemove;
        prompt.onRemove = function (...args) {
          // Native OK/Cancel removes the popup before calling its callback.
          // Allow that synchronous callback; expire callbacks after external removal.
          globalThis.queueMicrotask(() => finish(false));
          try { return previousRemove?.apply(this, args); }
          catch (error) { report(error); }
        };
      } else if (!settled) {
        finish(false);
        return false;
      }
    } catch (error) {
      promptOpen = false;
      report(error);
      return false;
    }
    return true;
  }

  return { render, request, normalize, plainText, formatItemLink, serverMessage };
}
