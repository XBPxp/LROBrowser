// Kept outside the vendor snapshot so an upstream refresh can reapply this feature.
export function createWorldMapIndex(worldData, mobData, itemTable, getItemInfo) {
  const normalize = value => String(value ?? '').trim().toLowerCase().replace(/\.(gat|rsw)$/i, '');
  const clean = value => (Array.isArray(value) ? value.join('\n') : String(value ?? '')).replace(/\^[0-9a-f]{6}/gi, '');
  const maps = new Map(Object.entries(worldData).map(([id, data]) => [normalize(id), { ...data, id: normalize(id), name: data.name || id }]));
  const monsters = new Map();
  const items = new Map();
  const item = id => {
    id = Number(id);
    if (!items.has(id)) {
      const data = itemTable[id] || getItemInfo(id) || {};
      const name = clean(data.identifiedDisplayName);
      items.set(id, { id, name: name && !/^unknown item$/i.test(name) ? name : `物品 #${id}`, description: data.identifiedDescriptionName, resource: data.identifiedResourceName, slots: data.slotCount, sources: [] });
    }
    return items.get(id);
  };
  for (const id of Object.keys(itemTable)) if (Number(id) > 0) item(id);
  for (const [key, data] of Object.entries(mobData)) {
    const monster = { id: Number(key), name: data.kName || `怪物 #${key}`, level: data.LV, maps: [], drops: [] };
    monsters.set(monster.id, monster);
    for (const [prefix, count, kind] of [['Drop', data.DropsNum, '普通掉落'], ['MVP', data.MvpDropsNum, 'MVP 奖励']]) {
      for (let i = 0; i < Number(count || 0); i++) {
        const id = Number(data[`${prefix}${i}id`]);
        const rate = Number(data[`${prefix}${i}per`]);
        if (!(id > 0) || !(rate > 0)) continue;
        const drop = { item: item(id), rate, kind };
        monster.drops.push(drop);
        drop.item.sources.push({ monster, rate, kind });
      }
    }
  }
  for (const map of maps.values()) {
    map.monsters = [...new Set(Array.isArray(map.mobs) ? map.mobs.map(Number) : [])].map(id => {
      if (!monsters.has(id)) monsters.set(id, { id, name: `怪物 #${id}`, maps: [], drops: [] });
      const monster = monsters.get(id);
      monster.maps.push(map);
      return monster;
    });
  }
  function floors(id) {
    const map = maps.get(normalize(id));
    if (!map) return [];
    const parent = maps.get(normalize(map.belong)) || [...maps.values()].find(m => Array.isArray(m.branch) && m.branch.includes(map.id)) || map;
    return [...new Set([parent.id, ...(Array.isArray(parent.branch) ? parent.branch : []), map.id])].map(id => maps.get(id)).filter(Boolean);
  }
  function search(query, type = 'all') {
    const term = normalize(query);
    if (!term) return [];
    const results = [];
    for (const [kind, records] of [['monster', monsters], ['item', items], ['map', maps]]) {
      if (type !== 'all' && kind !== type) continue;
      for (const record of records.values()) {
        const name = clean(record.name).toLowerCase();
        const id = String(record.id);
        if (name.includes(term) || id.includes(term)) results.push({ kind, record, rank: id === term || name === term ? 0 : name.startsWith(term) ? 1 : 2 });
      }
    }
    return results.sort((a, b) => a.rank - b.rank || a.record.name.localeCompare(b.record.name, 'zh-CN') || String(a.record.id).localeCompare(String(b.record.id)));
  }
  return { maps, monsters, items, floors, search, normalize };
}

export const WORLD_MAP_HTML = '<div id="WorldMap"><div class="wm-canvas" aria-label="世界地图"><div class="wm-grid"></div></div><nav class="wm-toolbar" aria-label="世界地图工具"><select aria-label="大陆" class="wm-region"></select><div><button type="button" class="wm-search">搜索</button></div></nav><button type="button" class="wm-close" aria-label="关闭世界地图" title="关闭世界地图">关闭</button><div class="wm-message" role="status" hidden></div><section class="wm-panel" role="dialog" aria-label="地图资料查询" hidden><header><button type="button" class="wm-back">返回</button><h2 class="wm-title"></h2></header><div class="wm-body"></div></section></div>';

export const WORLD_MAP_CSS = `
:host{position:fixed!important;inset:0;width:100vw;height:100vh;display:block;overflow:hidden}
.ui-component-root{position:absolute;inset:0;min-width:0;min-height:0;overflow:hidden}
#WorldMap{--wm-gutter:clamp(12px,2.4vw,32px);position:absolute;inset:0;overflow:hidden;background:#1b2423;color:#f1f0e9;font:13px/1.5 Arial,'Microsoft YaHei','MiSans','LastRO Glyph Fallback',sans-serif;font-size-adjust:none;isolation:isolate}
#WorldMap *{box-sizing:border-box}#WorldMap [hidden]{display:none!important}
#WorldMap button,#WorldMap select,#WorldMap input{font:inherit;color:inherit}
#WorldMap button{cursor:pointer}#WorldMap button:focus-visible,#WorldMap select:focus-visible,#WorldMap input:focus-visible{outline:2px solid #e1cf8f;outline-offset:2px}
.wm-canvas{position:absolute;inset:0;overflow:hidden}
.wm-grid{position:absolute;background-size:100% 100%;background-repeat:no-repeat}
.wm-tile{position:absolute;padding:0;border:1px solid #090909;border-radius:4px;background:#282d29;overflow:hidden}
.wm-tile img{display:block;width:100%;height:100%;object-fit:fill}.wm-tile:hover{outline:2px solid #ddcb90;z-index:1}.wm-tile.selected{outline:2px dashed #f6de92;z-index:2}.wm-tile.current{box-shadow:0 0 0 2px #e9ca6d;z-index:1}
.wm-tile .wm-boss{position:absolute;left:4px;top:4px;width:14px;height:14px;object-fit:contain;filter:drop-shadow(0 1px 1px #000)}
.wm-tile.party:not(.current){box-shadow:inset 0 0 0 2px #8bb85f}.wm-tile.party:not(.current)::after{content:'';position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%;background:#9fdb73}
.wm-toolbar{position:absolute;left:var(--wm-gutter);right:var(--wm-gutter);top:12px;display:flex;justify-content:space-between;gap:8px;pointer-events:none;z-index:3}.wm-toolbar>div{display:flex;gap:8px;padding-right:68px}
.wm-toolbar button,.wm-toolbar select{pointer-events:auto;border:1px solid #ffffff26;border-radius:4px;background:#202b27;font-size:12px!important;font-weight:500!important;height:32px;min-height:32px;padding:0 10px}.wm-toolbar button{width:60px}.wm-toolbar select{min-width:0;max-width:calc(100% - 136px)}.wm-toolbar option{background:#202723}.wm-toolbar button:hover{background:#303e37}
#WorldMap .wm-close{position:absolute;top:12px;right:var(--wm-gutter);z-index:11}
#WorldMap .wm-close,#WorldMap .wm-panel .wm-back{width:60px;height:32px;min-height:32px;padding:0;border:1px solid #ffffff26;border-radius:4px;background:#202b27;font-size:12px!important;font-weight:500!important;line-height:30px;text-align:center}#WorldMap .wm-close:hover,#WorldMap .wm-panel .wm-back:hover{background:#303e37;border-color:#a99561}
.wm-message{position:absolute;left:50%;top:66px;transform:translateX(-50%);padding:12px 18px;background:#172021ed;border:1px solid #93866a;z-index:4;max-width:90%}
.wm-message button{margin-left:12px;background:#384449;border:1px solid #9a9682;border-radius:3px}
.wm-panel{position:absolute;inset:0;z-index:5;overflow:auto;background:rgba(8,12,12,.94);padding:0 var(--wm-gutter) 14px;font-size:12px;overscroll-behavior:contain}
.wm-panel header{display:flex;align-items:center;gap:10px;position:sticky;top:0;margin:0 calc(-1 * var(--wm-gutter));background:#111919f5;padding:12px calc(var(--wm-gutter) + 70px) 12px var(--wm-gutter);z-index:1;border-bottom:1px solid #a9956138}.wm-panel header>button{flex:none}.wm-panel h2{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:1.35;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wm-panel h3{font-size:14px;margin:18px 0 10px}.wm-panel p{margin:10px 0}.wm-panel button{border:1px solid #ffffff26;border-radius:4px;color:#f2f0e6;background:#ffffff0d;padding:6px 10px;min-height:32px}.wm-panel button:hover{background:#ffffff1a;border-color:#a99561}
.wm-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}.wm-card{display:flex;align-items:center;gap:10px;text-align:left;min-height:48px;overflow-wrap:anywhere}.wm-card span{flex:1}.wm-card small{display:block;color:#a4b1ac;font-size:10px;line-height:1.6}.wm-card img{width:26px;height:26px;object-fit:contain;flex:none}.wm-card img.wm-map-thumb{width:48px;height:48px;border-radius:3px}.wm-muted{color:#aebbb5}.wm-form{display:grid;grid-template-columns:90px minmax(120px,1fr) 64px;align-items:center;gap:8px;margin:12px 0 18px;padding:12px;border:1px solid #ffffff14;border-radius:6px;background:#17201fee;box-shadow:inset 0 1px 0 #ffffff05}.wm-form input,.wm-form select{width:100%;min-width:0;min-height:36px;border:1px solid #ffffff29;border-radius:4px;background:#23302e;padding:7px 10px;line-height:20px}.wm-form input::placeholder{color:#8c9995}.wm-form>button{min-height:36px;border-color:#b8a67070;background:#56634b40}.wm-form>button:hover{background:#56634b70}.wm-description{white-space:pre-wrap;overflow-wrap:anywhere;background:#ffffff08;padding:16px;border-left:2px solid #a99561;line-height:1.8}.wm-description .wm-item-icon{width:48px;height:48px;object-fit:contain;float:right;margin:0 0 12px 16px}.wm-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.wm-page{display:flex;gap:12px;justify-content:center;align-items:center;margin:18px 0}.wm-selected{border-color:#d4c390!important}
.wm-card .wm-item-thumbnail,.wm-item-thumbnail{display:inline-grid;place-items:center;width:40px;height:40px;flex:none;border-radius:4px;background:#ffffff0a;vertical-align:middle}.wm-item-thumbnail img.wm-item-icon{width:32px;height:32px;object-fit:contain;image-rendering:pixelated;margin:0;float:none}.wm-item-thumbnail .wm-icon-fallback{font-size:10px;line-height:1.3;color:#a3afab;text-align:center}.wm-description>.wm-item-thumbnail{float:right;width:64px;height:64px;margin:0 0 12px 16px}.wm-description>.wm-item-thumbnail img{width:48px;height:48px}
.wm-workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;padding-top:12px}.wm-context,.wm-inspectors{min-width:0;max-height:none;overflow:visible;padding:0 0 12px}.wm-inspectors{border-top:1px solid #ffffff26;padding-top:14px}.wm-inspectors:empty{display:none}.wm-inspector{scroll-margin-top:88px}.wm-inspector+.wm-inspector{border-top:1px solid #ffffff30;margin-top:20px;padding-top:12px}.wm-inspector h3.wm-detail-title{margin-top:0;font-size:15px}.wm-map-image{margin:0;background:#050a09;border:1px solid #ffffff20;border-radius:4px;text-align:center;padding:12px}.wm-map-image img.wm-map-thumb{display:block;width:100%;height:clamp(180px,35vh,380px);object-fit:contain;image-rendering:pixelated}.wm-map-image figcaption{color:#b4bfbc;margin-top:8px}.wm-portrait{width:64px;height:64px;flex:none;display:grid;place-items:center;background:radial-gradient(ellipse,#ffffff12,transparent);border-radius:4px}.wm-portrait img{width:64px;height:64px;object-fit:contain;image-rendering:pixelated}.wm-portrait small{font-size:10px;text-align:center;color:#a3afab}.wm-monster-heading{display:flex;align-items:center;gap:12px}.wm-monster-heading .wm-portrait,.wm-monster-heading .wm-portrait img{width:88px;height:88px}.wm-card[aria-pressed=true]{border-color:#d4c390;background:#d4c39019}.wm-workspace .wm-cards{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}
@media(max-width:760px){#WorldMap{--wm-gutter:10px}.wm-toolbar,#WorldMap .wm-close{top:10px}.wm-panel header{gap:8px;padding-top:10px;padding-bottom:10px}.wm-panel h2{font-size:14px}.wm-form{grid-template-columns:72px minmax(0,1fr) 56px;gap:6px;padding:8px}.wm-form input,.wm-form select{padding:7px 8px}.wm-workspace .wm-cards{grid-template-columns:repeat(auto-fill,minmax(145px,1fr))}.wm-card{padding:6px!important}}
@media(max-width:420px){.wm-panel h2{display:none}.wm-form{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.wm-form input{grid-column:1/-1;grid-row:1}.wm-form>button{justify-self:stretch;width:100%;min-width:0}}
#WorldMap .wm-search-results .wm-card{min-height:44px;padding:6px 8px;font-size:12px;line-height:1.4}#WorldMap .wm-search-results .wm-cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,160px),1fr))}.wm-card small{font-size:11px}.wm-search-results .wm-card small{font-size:10px}.wm-search-results .wm-portrait,.wm-search-results .wm-portrait img{width:32px;height:32px}.wm-search-results .wm-card img.wm-map-thumb{width:36px;height:36px}.wm-search-results .wm-item-thumbnail{width:32px;height:32px}.wm-search-results .wm-item-thumbnail img.wm-item-icon{width:26px;height:26px}
.wm-item-window{position:absolute;z-index:10;width:280px;max-width:calc(100% - 12px);max-height:calc(100% - 12px);display:flex;flex-direction:column;color:#000;background-color:#fff;background-repeat:no-repeat;border:0;border-radius:5px;box-shadow:inset 0 0 0 3px #fff,inset 0 0 0 4px #c0c0c0,0 2px 5px #0005;font-size:12px;line-height:18px;overflow:hidden;padding:3px}
.wm-item-window-header{position:relative;z-index:1;display:flex;align-items:center;flex:none;height:27px;padding:0 16px 0 86px;cursor:grab;touch-action:none;user-select:none;background:linear-gradient(#fff 4px,#e5eaf2 5px,#f7f9fc 6px,#d5deeb 7px,#f8faff 8px,#e2e7f0 9px,#fff 20px);border-radius:3px 3px 0 0}.wm-item-window[data-skinned] .wm-item-window-header{background:transparent}.wm-item-window[data-dragging] .wm-item-window-header{cursor:grabbing}
.wm-item-window-title{font-size:11px;font-weight:bold;min-width:0;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:1px 1px #fff}
#WorldMap .wm-item-window-close{position:absolute;top:0;right:0;width:11px;height:11px;padding:0;border:0;border-radius:0;background-color:#e5e9f3;background-image:var(--wm-close-off,none);background-repeat:no-repeat;color:#415b82;font:bold 11px/11px Arial;cursor:pointer}#WorldMap .wm-item-window-close[data-skinned]{font-size:0}#WorldMap .wm-item-window-close:hover{background-image:var(--wm-close-on,var(--wm-close-off,none))}
.wm-item-window .wm-item-detail{margin-top:-24px;padding:5px 7px 7px;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#abbad0 #edf0f5}
.wm-item-window p{margin:5px 0}.wm-item-window .wm-muted,.wm-item-window .wm-card small,.wm-item-window .wm-icon-fallback{color:#667184}
.wm-item-window .wm-item-meta{margin:4px 0 0 90px;font-size:10px;line-height:15px;color:#666}
.wm-item-window .wm-description{display:grid;grid-template-columns:75px minmax(0,1fr);align-items:start;gap:15px;min-height:100px;padding:0;border:0;background:transparent;font-size:12px;line-height:18px;color:#000;white-space:normal}
.wm-item-window .wm-description-text{padding-top:24px;white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
.wm-item-window .wm-description>.wm-item-thumbnail{float:none;width:75px;height:100px;margin:0;background:transparent;border:0;align-self:start;position:relative}.wm-item-window .wm-description>.wm-item-thumbnail img{width:24px;height:24px}.wm-item-window .wm-description>.wm-item-thumbnail .wm-item-collection{width:75px;height:100px;object-fit:contain;image-rendering:pixelated}
.wm-item-window .wm-item-thumbnail[data-collection]>*:not(.wm-item-collection){display:none!important}
.wm-item-window .wm-item-sources{margin-top:12px;padding-top:8px;border-top:1px solid #cdd5e0}.wm-item-window summary{cursor:pointer;color:#3c557d}.wm-item-window .wm-cards{grid-template-columns:minmax(0,1fr);gap:6px;margin-top:8px}
.wm-item-window .wm-card{background:#f3f6fb;border:1px solid #c4cede;border-radius:3px;padding:5px 8px;min-height:44px}.wm-item-window .wm-card:hover{background:#e6edf8}.wm-item-window .wm-portrait,.wm-item-window .wm-portrait img{width:40px;height:40px}
#WorldMap .wm-item-window button:focus-visible,#WorldMap .wm-item-window summary:focus-visible{outline:2px solid #4a73ae;outline-offset:-2px}
`;

// All dependencies are explicit; the same installer is exercised by the preview and tests.
export function installLastroWorldMap(component, deps, regions, makeIndex) {
  const { DB, Client } = deps;
  let root, grid, canvas, panel, body, title, regionSelect, message;
  let index, loading, alive = false, generation = 0, currentRegion = 0;
  let route = null, fromSearch = false, selectedMap = '', searchTerm = '', searchType = 'all', searchPage = 0;
  let resumeView = null;
  let activeMonsterTarget = null;
  let searchMonsterId = null;
  let context, inspectors, monsterPane, itemPopup, itemOpener;
  let itemPosition = null, itemDrag = null, itemResizeObserver;
  let partyMaps = new Set();
  const document = deps.document || globalThis.document;
  const window = document.defaultView;
  function visible() {
    const host = component._host;
    return alive && component.__active !== false && !!host?.isConnected && !host.hidden
      && host.style.display !== 'none' && window.getComputedStyle(host).display !== 'none';
  }
  function scaleOf(element) {
    const rect = element.getBoundingClientRect(), style = window.getComputedStyle(element);
    const size = (axis, sides, fallback) => {
      const value = parseFloat(style[axis]);
      if (!(value > 0)) return fallback;
      return style.boxSizing === 'border-box' ? value : value + sides.reduce((sum, side) => sum + (parseFloat(style[side]) || 0), 0);
    };
    // offsetWidth/Height round to integers. Computed dimensions avoid repeated
    // fit operations shrinking a fractional 150% layout by that rounding error.
    const width = size('width', ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'], element.offsetWidth);
    const height = size('height', ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'], element.offsetHeight);
    return { x: width && rect.width ? rect.width / width : 1, y: height && rect.height ? rect.height / height : 1 };
  }
  function fitViewport() {
    if (!visible()) return;
    const host = component._host, scale = scaleOf(host);
    // vw/vh are viewport units before ancestor zoom. Convert the visual viewport
    // back to this host's layout units rather than scaling the full-screen UI twice.
    const rect = host.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    if (!(width > 0 && height > 0)) return;
    for (const [name, value] of Object.entries({ position: 'fixed', right: 'auto', bottom: 'auto',
      width: `${width / scale.x}px`, height: `${height / scale.y}px`,
      left: `${(parseFloat(host.style.left) || 0) - rect.left / scale.x}px`,
      top: `${(parseFloat(host.style.top) || 0) - rect.top / scale.y}px` })) host.style.setProperty(name, value, 'important');
    fitRegion(); placeItem();
  }
  function fitRegion() {
    if (!grid || !visible()) return;
    const region = regions[currentRegion], bounds = canvas.getBoundingClientRect(), scale = scaleOf(canvas);
    const width = canvas.clientWidth || bounds.width / scale.x;
    const height = canvas.clientHeight || bounds.height / scale.y;
    if (!(width > 0 && height > 0)) return;
    const edge = Math.min(12, width / 4, height / 4);
    const toolbar = root.querySelector('.wm-toolbar').getBoundingClientRect();
    const top = Math.min(height - edge - 1, Math.max(edge, (toolbar.bottom - bounds.top) / scale.y + edge));
    const availableWidth = Math.max(1, width - edge * 2), availableHeight = Math.max(1, height - top - edge);
    const ratio = region.columns * 50 / (region.rows * 48);
    const mapWidth = Math.min(availableWidth, availableHeight * ratio), mapHeight = mapWidth / ratio;
    Object.assign(grid.style, { width: `${mapWidth}px`, height: `${mapHeight}px`,
      left: `${edge + (availableWidth - mapWidth) / 2}px`, top: `${top + (availableHeight - mapHeight) / 2}px` });
    canvas.scrollTop = canvas.scrollLeft = 0;
  }
  function showWindow() {
    if (!root) component.prepare();
    if (!component._host.isConnected) component.append();
    alive = true; component._host.style.display = '';
    fitViewport(); component.focus?.(); drawRegion();
  }
  // Client's raw resources already persist in IndexedDB for 30 days. Reuse
  // decoded image URLs here too, including in-flight work shared by repeated cards.
  const imageCache = new Map();
  function loadImageFile(path, done, failed = () => {}) {
    let entry = imageCache.get(path);
    if (!entry || entry.expires <= Date.now()) {
      entry = { expires: Infinity };
      entry.promise = new Promise((resolve, reject) => {
        const timer = document.defaultView.setTimeout(() => reject(new Error('Image timeout')), 15000);
        const fail = () => { document.defaultView.clearTimeout(timer); reject(new Error('Image unavailable')); };
        try {
          Client.loadFile(path, url => {
            document.defaultView.clearTimeout(timer);
            if (typeof url === 'string' && url) resolve(url); else fail();
          }, fail);
        } catch { fail(); }
      });
      entry.promise.then(() => { entry.expires = Date.now() + 30 * 60 * 1000; }, () => { entry.expires = Date.now() + 60 * 1000; });
    }
    imageCache.delete(path); imageCache.set(path, entry);
    if (imageCache.size > 256) imageCache.delete(imageCache.keys().next().value);
    entry.promise.then(done, failed);
  }
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const button = (text, action, className) => {
    const el = node('button', text, className);
    el.type = 'button'; el.addEventListener('click', action); return el;
  };
  const image = (url, label, className) => {
    const el = node('img', undefined, className); el.alt = label; el.loading = 'lazy'; el.src = url;
    el.addEventListener('error', () => { el.hidden = true; }, { once: true });
    return el;
  };
  const bundledMaps = new Set(regions.flatMap(region => region.cells.map(cell => cell.image)));
  const mapImage = (id, failed = () => {}, large = false) => {
    if (!large && bundledMaps.has(id + '.png')) {
      const el = image(`/worldmap/${encodeURIComponent(id)}.png`, '', 'wm-map-thumb'); el.addEventListener('error', failed); return el;
    }
    const el = node('img', undefined, 'wm-map-thumb'); el.alt = ''; el.hidden = true;
    let fallback = false;
    const fail = () => {
      if (large && !fallback && bundledMaps.has(id + '.png')) {
        fallback = true; el.src = `/worldmap/${encodeURIComponent(id)}.png`; el.hidden = false;
      } else { el.hidden = true; failed(); }
    };
    loadImageFile(`${DB.INTERFACE_PATH}map/${id}.bmp`, url => { el.src = url; el.hidden = false; }, fail);
    el.addEventListener('error', fail);
    return el;
  };
  const itemIcon = item => {
    const frame = node('span', undefined, 'wm-item-thumbnail');
    const fallback = node('small', '', 'wm-icon-fallback');
    const el = node('img', undefined, 'wm-item-icon'); el.alt = `${item.name}缩略图`; el.hidden = true; el.loading = 'lazy';
    const failed = () => { el.hidden = true; fallback.textContent = '图标暂缺'; fallback.hidden = false; };
    frame.append(el, fallback);
    if (item.resource) loadImageFile(`${DB.INTERFACE_PATH}item/${item.resource}.bmp`, data => {
      if (typeof data === 'string' && data) { el.src = data; el.hidden = false; fallback.hidden = true; } else failed();
    }, failed);
    else failed();
    el.addEventListener('error', failed);
    return frame;
  };
  function portrait(monster) {
    const frame = node('span', undefined, 'wm-portrait'); frame.setAttribute('role', 'img'); frame.setAttribute('aria-label', `${monster.name}外貌`);
    const fallback = node('small', '外貌加载中'); frame.append(fallback);
    if (!deps.monsterPortrait) { fallback.textContent = '暂无外貌'; return frame; }
    Promise.resolve().then(() => alive && frame.isConnected ? deps.monsterPortrait(monster.id) : null).then(url => {
      if (!alive || !frame.isConnected || !url) return;
      const img = image(url, '', ''); img.addEventListener('error', () => { fallback.textContent = '外貌暂缺'; frame.replaceChildren(fallback); });
      frame.replaceChildren(img);
    }).catch(() => { fallback.textContent = '外貌暂缺'; });
    return frame;
  }
  function card(record, kind, subtitle = '') {
    const el = button('', () => open({ kind, id: record.id }, el), 'wm-card');
    el.dataset.kind = kind; el.dataset.id = String(record.id);
    if (kind === 'map') el.append(mapImage(record.id));
    if (kind === 'item') el.append(itemIcon(record));
    if (kind === 'monster') el.append(portrait(record));
    const label = node('span', record.name);
    label.append(node('small', subtitle || `${kind === 'monster' ? `Lv.${record.level ?? '未知'} · ` : ''}ID ${record.id}`));
    el.append(label); return el;
  }
  function section(label, target = context) { target.append(node('h3', label)); const list = node('div', undefined, 'wm-cards'); target.append(list); return list; }
  function notice(text) { message.replaceChildren(node('span', text)); message.hidden = false; }
  function drawRegion() {
    if (!root) return;
    const region = regions[currentRegion];
    regionSelect.value = String(currentRegion);
    grid.replaceChildren();
    grid.style.aspectRatio = `${region.columns * 50} / ${region.rows * 48}`;
    grid.style.backgroundImage = `url("/worldmap/${region.background}")`;
    const current = String(deps.currentMap?.() || '').replace(/\.(gat|rsw)$/i, '');
    for (const cell of region.cells) {
      const name = index?.maps.get(cell.id)?.name || cell.id;
      const el = cell.id ? button('', () => open({ kind: 'map', id: cell.id }), 'wm-tile') : node('div', undefined, 'wm-tile');
      el.dataset.mapId = cell.id || '';
      if (cell.id) { el.title = `${name} (${cell.id})`; el.setAttribute('aria-label', el.title); }
      el.classList.toggle('current', !!cell.id && cell.id === current);
      el.classList.toggle('party', partyMaps.has(cell.id));
      el.classList.toggle('selected', !!cell.id && cell.id === selectedMap);
      el.style.cssText = `left:${cell.x / region.columns * 100}%;top:${cell.y / region.rows * 100}%;width:${cell.span / region.columns * 100}%;height:${100 / region.rows}%`;
      el.append(image(`/worldmap/${cell.image}`, ''));
      if (cell.boss || index?.maps.get(cell.id)?.hasBoss) {
        const badge = node('img', undefined, 'wm-boss'); badge.alt = 'BOSS'; badge.hidden = true;
        loadImageFile(`${DB.INTERFACE_PATH}minimap/boss_1.bmp`, url => { badge.src = url; badge.hidden = false; });
        el.append(badge);
      }
      grid.append(el);
    }
    fitRegion();
  }
  async function ensureData() {
    if (index) return index;
    if (!loading) {
      loading = deps.loadData().then(({ worldData, mobData }) => {
        index = makeIndex(worldData, mobData, deps.itemTable(), id => DB.getItemInfo(id));
        return index;
      }).finally(() => { loading = null; });
    }
    return loading;
  }
  function closeItem(restoreFocus = true) {
    if (!itemPopup) return;
    itemDrag = null; itemResizeObserver?.disconnect(); itemResizeObserver = null;
    document.defaultView.removeEventListener('resize', placeItem);
    itemPopup.remove(); itemPopup = null;
    for (const card of body.querySelectorAll('.wm-card[data-kind="item"]')) card.setAttribute('aria-pressed', 'false');
    if (restoreFocus) (itemOpener?.isConnected ? itemOpener : root.querySelector('.wm-back')).focus({ preventScroll: true });
    itemOpener = null;
  }
  function rememberView() {
    if (route && !panel.hidden) resumeView = { route: { ...route }, fromSearch,
      monsterTarget: monsterPane?.isConnected ? { id: Number(monsterPane.dataset.id) }
        : activeMonsterTarget ? { ...activeMonsterTarget } : null, scrollTop: panel.scrollTop };
  }
  function closePanel() { deps.cancelTeleport?.(); generation++; closeItem(false); panel.hidden = true; route = null; fromSearch = false; resumeView = null; activeMonsterTarget = null; body.replaceChildren(); root.querySelector('.wm-search').focus(); }
  function hide(preserveView = false) {
    if (preserveView) rememberView();
    const saved = preserveView ? resumeView : null;
    closePanel(); resumeView = saved; component._host.style.display = 'none';
  }
  function closeWorldMap() {
    // Explicit close starts on the map next time; native remove owns cancellation,
    // popup disposal and keyboard cleanup, without focusing the covered toolbar.
    resumeView = null; activeMonsterTarget = null; route = null; fromSearch = false; panel.hidden = true;
    component._host.style.display = 'none'; component.remove();
  }
  async function open(next, opener, monsterTarget, restoredView) {
    if (!visible()) showWindow();
    resumeView = null;
    deps.cancelTeleport?.();
    const inline = next.kind === 'monster' || next.kind === 'item';
    if (next.kind !== 'item') activeMonsterTarget = next.kind === 'monster' ? { id: Number(next.id) } : monsterTarget || null;
    if (next.kind !== 'item') closeItem(false);
    if (next.kind === 'search') fromSearch = false;
    else if (next.kind === 'map' && route?.kind === 'search') fromSearch = true;
    if (!inline || !route) route = inline ? { kind: 'search' } : next;
    if (restoredView) fromSearch = restoredView.fromSearch;
    panel.hidden = false; message.hidden = true;
    if (!inline || !body.children.length) { title.textContent = '正在读取资料…'; body.replaceChildren(); }
    const back = root.querySelector('.wm-back'); back.hidden = false; back.textContent = '返回';
    const ticket = ++generation;
    try {
      await ensureData();
      if (!alive || ticket !== generation) return;
      if (!inline || !body.querySelector('.wm-workspace')) { render(); panel.scrollTop = 0; }
      if (inline) inspect(next, opener);
      else {
        const match = monsterTarget?.id !== null && monsterTarget?.id !== undefined
          ? index.monsters.get(monsterTarget.id)
          : monsterTarget?.name ? index.search(monsterTarget.name, 'monster').filter(hit => hit.rank === 0 && String(hit.record.name).replace(/\^[0-9a-f]{6}/gi, '').trim().toLowerCase() === monsterTarget.name.toLowerCase()) : [];
        const monster = Array.isArray(match) ? match.length === 1 ? match[0].record : null : match;
        if (monster) inspect({ kind: 'monster', id: monster.id }, context.querySelector(`.wm-card[data-kind="monster"][data-id="${monster.id}"]`));
        else if (next.kind === 'search') context.querySelector('input')?.focus();
        else back.focus({ preventScroll: true });
      }
      if (restoredView) panel.scrollTop = restoredView.scrollTop;
    } catch {
      if (!alive || ticket !== generation) return;
      title.textContent = '资料加载失败'; body.replaceChildren(node('p', '未能读取本地地图资料，请重试。'), button('重试', () => open(next, opener, monsterTarget, restoredView)));
    }
  }
  async function searchMonster(target) {
    // The caller supplies a real mobGID, never a quest's huntID. Do not infer IDs
    // from other target fields or fall back to a different monster when it is absent.
    const id = typeof target?.id === 'number' && Number.isInteger(target.id) && target.id > 0 && target.id <= 0xffffffff ? target.id : null;
    const name = typeof target?.name === 'string' ? target.name.replace(/\^[0-9a-f]{6}/gi, '').trim() : '';
    showWindow();
    searchTerm = id === null ? name : String(id); searchType = 'monster'; searchPage = 0; searchMonsterId = id;
    return open({ kind: 'search' }, undefined, { id, name });
  }
  function mapDetails(map) {
    title.textContent = `${map.name} · ${map.id}`;
    const figure = node('figure', undefined, 'wm-map-image');
    const caption = node('figcaption', `${map.name} · ${map.id}`);
    const large = mapImage(map.id, () => { caption.textContent = `${map.name} · ${map.id}（地图图像暂缺）`; }, true);
    large.alt = `${map.name}地图大图`; large.loading = 'eager'; figure.append(large, caption); context.append(figure);
    const actions = node('div', undefined, 'wm-actions');
    if (deps.navigate) actions.append(button('前往此地图', () => { deps.navigate(map.id); hide(); }));
    if (deps.teleport) {
      const teleport = button('传送到此地图', async () => {
        if (teleport.disabled) return;
        const ticket = generation;
        teleport.disabled = true;
        try {
          const result = await deps.teleport(map.id, map.name);
          // Older synchronous adapters return void after sending successfully.
          if (result !== false && alive && ticket === generation) hide(true);
        } catch { /* The adapter reports failures; keep the selected map for retry. */ }
        finally { teleport.disabled = false; }
      });
      actions.append(teleport);
    }
    context.append(actions);
    const floors = index.floors(map.id);
    if (floors.length > 1) {
      const list = section('区域／地下城楼层');
      for (const floor of floors) { const el = card(floor, 'map'); el.classList.toggle('wm-selected', floor.id === map.id); list.append(el); }
    }
    if (map.monsters.length) {
      const list = section(`地图怪物 · ${map.monsters.length} 种`);
      for (const monster of map.monsters) list.append(card(monster, 'monster'));
    }
  }
  function monsterDetails(monster, target) {
    const heading = node('div', undefined, 'wm-monster-heading'); heading.append(portrait(monster), node('h3', `${monster.name} · Lv.${monster.level ?? '未知'}`, 'wm-detail-title')); target.append(heading);
    target.append(node('p', `怪物 ID ${monster.id}`, 'wm-muted'));
    for (const kind of ['普通掉落', 'MVP 奖励']) {
      const drops = monster.drops.filter(d => d.kind === kind);
      if (!drops.length) continue;
      const list = section(`${kind} · ${drops.length}`, target);
      for (const drop of drops) list.append(card(drop.item, 'item', `${(drop.rate / 100).toFixed(2)}% · ID ${drop.item.id}`));
    }
    if (!monster.maps.length) return;
    const locations = node('details', undefined, 'wm-locations');
    locations.open = true;
    locations.append(node('summary', `出没地图 · ${monster.maps.length}`));
    const maps = node('div', undefined, 'wm-cards'); locations.append(maps);
    for (const map of monster.maps) maps.append(card(map, 'map'));
    target.append(locations);
  }
  function itemDetails(item, target) {
    const description = node('div', undefined, 'wm-description');
    const thumbnail = itemIcon(item); description.append(thumbnail);
    if (item.resource) loadImageFile(`${DB.INTERFACE_PATH}collection/${item.resource}.bmp`, url => {
      if (!thumbnail.isConnected) return;
      const collection = node('img', undefined, 'wm-item-collection'); collection.alt = `${item.name}立绘`;
      collection.addEventListener('load', () => { thumbnail.dataset.collection = ''; collection.hidden = false; });
      collection.addEventListener('error', () => collection.remove()); collection.hidden = true; collection.src = url; thumbnail.append(collection);
    });
    const prose = node('div', undefined, 'wm-description-text'); description.append(prose);
    const text = Array.isArray(item.description) ? item.description.join('\n') : String(item.description || '');
    // Render RO color codes as spans, never insert item descriptions as HTML.
    let color = '', offset = 0;
    for (const match of text.matchAll(/\^([0-9a-f]{6})/gi)) {
      const span = node('span', text.slice(offset, match.index)); if (color) span.style.color = color; prose.append(span);
      // Use the original RO colors on the classic white item window.
      color = `#${match[1]}`;
      offset = match.index + 7;
    }
    const tail = node('span', text.slice(offset)); if (color) tail.style.color = color; prose.append(tail); target.append(description);
    target.append(node('p', `ID ${item.id}${item.slots !== undefined ? ` · 插槽：${item.slots}` : ''}`, 'wm-item-meta'));
    if (!item.sources.length) return;
    const sources = node('details', undefined, 'wm-item-sources');
    sources.append(node('summary', `掉落来源 · ${item.sources.length}`));
    const list = node('div', undefined, 'wm-cards'); sources.append(list); target.append(sources);
    for (const source of item.sources) list.append(card(source.monster, 'monster', `${source.kind} ${(source.rate / 100).toFixed(2)}% · ${source.monster.maps.length} 张地图`));
  }
  function searchView() {
    title.textContent = '搜索怪物、物品与地图';
    const form = node('form', undefined, 'wm-form');
    const type = node('select'); type.setAttribute('aria-label', '搜索类型');
    for (const [value, label] of [['all', '全部'], ['monster', '怪物'], ['item', '物品'], ['map', '地图']]) {
      const option = node('option', label); option.value = value; type.append(option);
    }
    type.value = searchType;
    const input = node('input'); input.type = 'search'; input.placeholder = '输入名称或 ID'; input.setAttribute('aria-label', '搜索关键词'); input.value = searchTerm;
    const submit = node('button', '搜索'); submit.type = 'submit';
    form.append(type, input, submit); context.append(form);
    const results = node('div', undefined, 'wm-search-results'); context.append(results);
    const run = () => {
      closeItem(false);
      searchTerm = input.value; searchType = type.value; results.replaceChildren();
      const hits = index.search(searchTerm, searchType).filter(hit => searchMonsterId === null || searchType !== 'monster' || hit.record.id === searchMonsterId);
      if (!searchTerm.trim()) return;
      results.append(node('p', hits.length ? `找到 ${hits.length} 条结果` : '没有匹配结果', 'wm-muted'));
      const list = node('div', undefined, 'wm-cards'); results.append(list);
      searchPage = Math.min(searchPage, Math.max(0, Math.ceil(hits.length / 60) - 1));
      for (const hit of hits.slice(searchPage * 60, (searchPage + 1) * 60)) list.append(card(hit.record, hit.kind, `${{ map: '地图', monster: '怪物', item: '物品' }[hit.kind]} · ID ${hit.record.id}`));
      if (hits.length > 60) {
        const pager = node('div', undefined, 'wm-page');
        const prev = button('上一页', () => { searchPage--; run(); }); prev.disabled = searchPage === 0;
        const next = button('下一页', () => { searchPage++; run(); }); next.disabled = (searchPage + 1) * 60 >= hits.length;
        pager.append(prev, node('span', `${searchPage + 1} / ${Math.ceil(hits.length / 60)}`), next); results.append(pager);
      }
    };
    form.addEventListener('submit', event => { event.preventDefault(); searchPage = 0; searchMonsterId = null; activeMonsterTarget = null; run(); });
    input.addEventListener('input', () => { searchPage = 0; searchMonsterId = null; activeMonsterTarget = null; run(); });
    type.addEventListener('change', () => { searchPage = 0; searchMonsterId = null; activeMonsterTarget = null; run(); });
    run();
  }
  function render() {
    body.replaceChildren();
    const workspace = node('div', undefined, 'wm-workspace');
    context = node('div', undefined, 'wm-context'); inspectors = node('div', undefined, 'wm-inspectors');
    monsterPane = null; workspace.append(context, inspectors); body.append(workspace);
    if (route.kind === 'search') { searchView(); return; }
    const records = { map: index.maps, monster: index.monsters, item: index.items }[route.kind];
    const record = records?.get(route.kind === 'map' ? index.normalize(route.id) : Number(route.id));
    if (!record) { title.textContent = '暂无资料'; context.append(node('p', `本地资料未收录 ${route.id}。`)); return; }
    if (route.kind === 'map') { selectedMap = record.id; mapDetails(record); }
  }
  function inspect(next, opener) {
    const monster = next.kind === 'monster', records = monster ? index.monsters : index.items;
    const record = records.get(Number(next.id));
    if (!monster) {
      showItem(record, next.id, opener);
      return;
    }
    let pane = monsterPane;
    if (!pane) {
      pane = node('section', undefined, `wm-inspector wm-${next.kind}-detail`); pane.tabIndex = -1; pane.setAttribute('aria-label', monster ? '怪物掉落详情' : '物品详情');
      monsterPane = pane; inspectors.prepend(pane);
    }
    pane.replaceChildren(); pane.dataset.id = String(next.id);
    if (!record) pane.append(node('p', `本地资料未收录 ${next.id}。`));
    else monsterDetails(record, pane);
    for (const card of body.querySelectorAll(`.wm-card[data-kind="${next.kind}"]`)) card.setAttribute('aria-pressed', String(card.dataset.id === String(next.id)));
    pane.focus({ preventScroll: true });
    // scrollIntoView also scrolls the game's body/ancestors under browser zoom.
    // Only the details page owns this scroll position.
    const scale = scaleOf(panel), heading = panel.querySelector('header').getBoundingClientRect();
    panel.scrollTop = Math.max(0, panel.scrollTop + (pane.getBoundingClientRect().top - panel.getBoundingClientRect().top - heading.height) / scale.y);
  }
  function showItem(item, id, opener) {
    if (!itemPopup) {
      itemPopup = node('section', undefined, 'wm-item-window');
      itemPopup.setAttribute('role', 'dialog'); itemPopup.setAttribute('aria-labelledby', 'wm-item-window-title');
      const header = node('header', undefined, 'wm-item-window-header');
      header.tabIndex = 0; header.title = '拖动移动窗口；方向键微调位置'; header.setAttribute('aria-label', '移动物品介绍窗口');
      const heading = node('h3', undefined, 'wm-item-window-title'); heading.id = 'wm-item-window-title';
      const close = button('×', () => closeItem(), 'wm-item-window-close'); close.setAttribute('aria-label', '关闭物品介绍'); close.title = '关闭物品介绍 (Esc)';
      header.append(heading, close); itemPopup.append(header, node('div', undefined, 'wm-item-detail'));
      root.querySelector('#WorldMap').append(itemPopup);
      enableItemDrag(header);
      const window = itemPopup;
      loadImageFile(`${DB.INTERFACE_PATH}basic_interface/collection_bg.bmp`, url => { window.style.backgroundImage = `url(${JSON.stringify(url)})`; window.dataset.skinned = ''; });
      for (const state of ['off', 'on']) loadImageFile(`${DB.INTERFACE_PATH}basic_interface/sys_close_${state}.bmp`, url => { close.style.setProperty(`--wm-close-${state}`, `url(${JSON.stringify(url)})`); if (state === 'off') close.dataset.skinned = ''; });
      document.defaultView.addEventListener('resize', placeItem);
      if (document.defaultView.ResizeObserver) { itemResizeObserver = new document.defaultView.ResizeObserver(placeItem); itemResizeObserver.observe(itemPopup); }
    }
    if (opener) itemOpener = opener;
    itemPopup.querySelector('.wm-item-window-title').textContent = item?.name || `物品 #${id}`;
    const content = itemPopup.querySelector('.wm-item-detail'); content.replaceChildren(); content.dataset.id = String(id);
    if (item) itemDetails(item, content); else content.append(node('p', `本地资料未收录 ${id}。`));
    content.scrollTop = 0;
    placeItem();
    for (const card of body.querySelectorAll('.wm-card[data-kind="item"]')) card.setAttribute('aria-pressed', String(card.dataset.id === String(id)));
    // Never focus/scroll an inline section: the map and its drop list stay put.
    itemPopup.querySelector('.wm-item-window-close').focus({ preventScroll: true });
  }
  function placeItem() {
    if (!itemPopup) return;
    const surface = root.querySelector('#WorldMap'), scale = scaleOf(surface);
    const bounds = surface.getBoundingClientRect();
    const area = { width: bounds.width / scale.x, height: bounds.height / scale.y };
    const size = itemPopup.getBoundingClientRect();
    const width = size.width / scale.x, height = size.height / scale.y;
    const position = itemPosition || { x: (area.width - width) / 2, y: (area.height - height) / 2 };
    const x = Math.max(6, Math.min(position.x, area.width - width - 6));
    const y = Math.max(6, Math.min(position.y, area.height - height - 6));
    itemPosition = { x, y }; itemPopup.style.left = `${x}px`; itemPopup.style.top = `${y}px`;
  }
  function enableItemDrag(header) {
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || itemDrag || event.target.closest('button')) return;
      placeItem(); itemDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: itemPosition.x, top: itemPosition.y };
      header.setPointerCapture(event.pointerId); itemPopup.dataset.dragging = '';
      event.preventDefault(); event.stopPropagation();
    });
    header.addEventListener('pointermove', event => {
      if (!itemDrag || itemDrag.id !== event.pointerId) return;
      const scale = scaleOf(root.querySelector('#WorldMap'));
      itemPosition = { x: itemDrag.left + (event.clientX - itemDrag.x) / scale.x, y: itemDrag.top + (event.clientY - itemDrag.y) / scale.y };
      placeItem(); event.preventDefault(); event.stopPropagation();
    });
    const end = event => {
      if (!itemDrag || itemDrag.id !== event.pointerId) return;
      itemDrag = null; if (itemPopup) delete itemPopup.dataset.dragging;
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      event.stopPropagation();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) header.addEventListener(type, end);
    header.addEventListener('keydown', event => {
      if (event.target !== header) return;
      const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
      if (!delta) return;
      placeItem(); itemPosition.x += delta[0]; itemPosition.y += delta[1]; placeItem(); event.preventDefault();
    });
  }
  function escape() { if (itemPopup) closeItem(); else if (panel.hidden) hide(); else closePanel(); }
  component.init = function () {
    root = this.getRoot(); alive = true;
    grid = root.querySelector('.wm-grid'); canvas = root.querySelector('.wm-canvas'); panel = root.querySelector('.wm-panel');
    body = root.querySelector('.wm-body'); title = root.querySelector('.wm-title'); regionSelect = root.querySelector('.wm-region'); message = root.querySelector('.wm-message');
    regions.forEach((region, i) => { const option = node('option', region.name); option.value = String(i); regionSelect.append(option); });
    regionSelect.addEventListener('change', () => { currentRegion = Number(regionSelect.value); drawRegion(); canvas.scrollTop = canvas.scrollLeft = 0; });
    root.querySelector('.wm-search').addEventListener('click', () => open({ kind: 'search' }));
    root.querySelector('.wm-close').addEventListener('click', closeWorldMap);
    root.querySelector('.wm-back').addEventListener('click', () => { if (fromSearch) open({ kind: 'search' }); else { drawRegion(); closePanel(); } });
    // Native inputs must not propagate keyboard shortcuts to the live game.
    root.addEventListener('keydown', event => {
      if (!visible()) return;
      if ((event.key === 'Escape' || event.which === 27) && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!event.repeat) escape(); }
      event.stopPropagation();
    });
    drawRegion();
  };
  component.onAppend = function () { alive = true; this._host.style.display = 'none'; window.addEventListener('resize', fitViewport); };
  component.toggle = function () {
    if (visible()) { hide(); return; }
    showWindow();
    if (resumeView) {
      const saved = resumeView; resumeView = null;
      open(saved.route, undefined, saved.monsterTarget, saved);
      return;
    }
    root.querySelector('.wm-search').focus({ preventScroll: true });
    const ticket = ++generation;
    notice('正在读取地图资料…');
    ensureData().then(() => { if (alive && ticket === generation) { message.hidden = true; drawRegion(); } }).catch(() => {
      if (!alive || ticket !== generation) return;
      notice('地图资料加载失败。'); message.append(button('重试', () => { this._host.style.display = 'none'; this.toggle(); }));
    });
  };
  component.onRemove = function () {
    // Map teardown (including same-map random teleports) keeps the loaded GUI.
    // Save query context before disposing its DOM, and never leave a blank overlay.
    if (root) rememberView();
    deps.cancelTeleport?.(); alive = false; generation++; closeItem(false);
    route = null; fromSearch = false; activeMonsterTarget = null; body?.replaceChildren();
    if (panel) panel.hidden = true;
    if (message) message.hidden = true;
    window.removeEventListener('resize', fitViewport);
  };
  component.onResize = function () { fitViewport(); placeItem(); };
  component.updatePartyMembers = function (packet) {
    partyMaps = new Set((packet.groupInfo || []).filter(member => member.state === 0 && member.AID !== deps.accountId?.()).map(member => String(member.mapName || '').replace(/\.gat$/i, '')));
    if (root) for (const tile of grid.children) tile.classList.toggle('party', partyMaps.has(tile.dataset.mapId));
  };
  component.captureKeyEvents = true;
  component.onKeyDown = function (event) {
    if (!visible()) return true;
    const path = event.composedPath?.() || [], inside = path.includes(component._host) || path.includes(root);
    // A prompt, another native window, or its text input may be above the map.
    if (!inside) {
      const z = Number(component._host.style.zIndex || 50);
      if (Object.values(component.manager?.components || {}).some(other => other !== component && other.__active && other.needFocus !== false
        && other._host?.isConnected && other._host.style.display !== 'none' && Number(other._host.style.zIndex || 50) > z)) return true;
      const target = path[0] || event.target;
      if (target?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return true;
    }
    const composing = event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.key === 'Dead';
    if (!composing && (event.key === 'Escape' || event.which === 27)) {
      event.preventDefault(); if (!event.repeat) escape(); event.stopImmediatePropagation();
    } else if (!inside) event.stopImmediatePropagation();
    // Events inside the map must reach form, select and drag-title handlers.
    // The shadow-root bubble listener stops them before game bubble shortcuts.
    return true;
  };
  component.onShortCut = function (key) { if (key.cmd === 'TOGGLE') this.toggle(); };
  component.searchMonster = searchMonster;
  return { open, ensureData, searchMonster };
}
