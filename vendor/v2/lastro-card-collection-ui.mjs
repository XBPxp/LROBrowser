// LastRO card collection UI, kept outside the packed Online.js bundle so the
// panel can evolve like the other lastro-*.mjs modules. The bundle injects all
// engine-side dependencies (GUIComponent, UIManager, packet builders, ...) when
// creating the component; this file never reaches into bundle internals.

export const CARD_COLLECTION_UI_BUILD = "20260924-v2-card-page-copy-1";

const cardCss = `
:host { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 120 !important; pointer-events: none; font-family: Arial, 'Microsoft YaHei', 'MiSans', 'LastRO Glyph Fallback', sans-serif; }
.cc-backdrop { position: absolute; inset: 0; background: rgba(4,7,12,.62); pointer-events: auto; }
.cc { position: absolute; inset: 0; margin: auto; pointer-events: auto; box-sizing: border-box; width: min(1120px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); display: flex; overflow: hidden; background: #1a212d; color: #e6ecf4; border: 1px solid rgba(148,168,196,.22); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.55); font-size: 13px; }
.cc-rail { flex: 0 0 132px; display: flex; flex-direction: column; background: #161d28; border-right: 1px solid rgba(148,168,196,.12); }
.cc-brand { padding: 14px 14px 12px; font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #e8b84b; border-bottom: 1px solid rgba(148,168,196,.12); }
.cc-brand small { display: block; margin-top: 3px; font-size: 10px; font-weight: 400; color: #7d8ea3; letter-spacing: 1px; }
.cc-nav { flex: 1; padding: 8px 0; overflow-y: auto; }
.cc-nav button { position: relative; display: block; width: 100%; min-height: 38px; padding: 0 16px; border: none; border-left: 2px solid transparent; background: transparent; color: #9db0c5; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.cc-nav button:hover { color: #e6ecf4; background: rgba(255,255,255,.03); }
.cc-nav button.active { color: #fff; background: #2c3a4e; border-left-color: #e8b84b; font-weight: 600; }
.cc-nav button .cnt { float: right; font-size: 10.5px; color: #7d8ea3; }
.cc-nav button.active .cnt { color: #e8b84b; }
.cc-rail-foot { padding: 10px 12px; border-top: 1px solid rgba(148,168,196,.12); font-size: 10.5px; color: #7d8ea3; line-height: 1.6; }
.cc-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.cc-top { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid rgba(148,168,196,.12); }
.cc-top h1 { font-size: 17px; font-weight: 700; white-space: nowrap; }
.cc-top .sub { margin-top: 2px; font-size: 11px; color: #7d8ea3; }
.cc-search { margin-left: auto; display: flex; width: 260px; height: 30px; border: 1px solid #3a4a60; border-radius: 6px; background: #10161f; overflow: hidden; }
.cc-search input { flex: 1; min-width: 0; padding: 0 10px; border: none; outline: none; background: transparent; color: #e6ecf4; font: inherit; font-size: 12px; }
.cc-search input::placeholder { color: #7d8ea3; }
.cc-search input:focus { box-shadow: inset 0 0 0 1px #e8b84b; }
.cc-search button { width: 52px; border: none; border-left: 1px solid #3a4a60; background: transparent; color: #9db0c5; font: inherit; font-size: 12px; cursor: pointer; }
.cc-search button:hover { color: #e8b84b; }
.cc-close { flex: 0 0 auto; width: 30px; height: 30px; border: 1px solid rgba(148,168,196,.22); border-radius: 6px; background: #26313f; color: #9db0c5; font-size: 14px; cursor: pointer; }
.cc-close:hover { background: #432624; border-color: rgba(226,106,90,.6); color: #ffb4a8; }
button:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(232,184,75,.45); }
.cc-body { flex: 1; overflow-y: auto; padding: 14px 16px 8px; }
.cc-body::-webkit-scrollbar { width: 9px; }
.cc-body::-webkit-scrollbar-thumb { background: #33445c; border-radius: 99px; border: 2px solid #1a212d; }
.cc-body::-webkit-scrollbar-track { background: transparent; }
.deck-banner { display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 12px; padding: 11px 13px; border: 1px solid rgba(148,168,196,.12); border-radius: 8px; background: #202a38; }
.deck-rules { font-size: 11.5px; line-height: 1.75; color: #9db0c5; }
.deck-rules b { color: #e8b84b; font-weight: 600; }
.deck-rules .slots { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.deck-rules .slots span { padding: 1px 8px; border: 1px solid rgba(148,168,196,.22); border-radius: 99px; font-size: 10.5px; color: #7d8ea3; }
.deck-meta { display: flex; flex-direction: column; gap: 7px; padding-left: 12px; border-left: 1px solid rgba(148,168,196,.12); }
.meta-chip { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 9px; border: 1px solid rgba(148,168,196,.22); border-radius: 6px; background: #18202c; font-size: 11.5px; color: #9db0c5; }
.meta-chip .dot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #7d8ea3; }
.meta-chip b { font-weight: 600; color: #e6ecf4; }
.meta-chip.on .dot { background: #63d68e; }
.meta-chip.on b { color: #63d68e; }
.cap-row { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px; }
.cap-bar { height: 5px; border: 1px solid rgba(148,168,196,.12); border-radius: 99px; background: #10161f; overflow: hidden; }
.cap-bar i { display: block; height: 100%; background: #e8b84b; border-radius: 99px; }
.sec-h { display: flex; align-items: baseline; gap: 9px; margin: 16px 2px 9px; }
.sec-h h2 { font-size: 13.5px; }
.sec-h .n { font-size: 11px; color: #e8b84b; }
.sec-h .hint { margin-left: auto; font-size: 10.5px; color: #7d8ea3; }
.slot-grid { display: grid; grid-template-columns: repeat(8, minmax(0,1fr)); gap: 8px; }
.card-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
.card { display: flex; flex-direction: column; padding: 8px; border: 1px solid rgba(148,168,196,.22); border-radius: 8px; background: #202a38; }
.card:hover { border-color: rgba(232,184,75,.4); }
.card .art { position: relative; display: grid; place-items: center; aspect-ratio: 16/10; border: 1px solid rgba(148,168,196,.12); border-radius: 6px; background-color: #10161f; background-repeat: no-repeat; background-position: center; background-size: contain; overflow: hidden; }
.card .art .mono { font-family: Georgia, 'SimSun', serif; font-size: 26px; color: rgba(232,184,75,.55); }
.card .art.is-art .mono { display: none; }
.card .art .badge { position: absolute; top: 5px; left: 5px; padding: 1px 7px; border: 1px solid rgba(148,168,196,.22); border-radius: 99px; background: rgba(14,20,29,.85); color: #9db0c5; font-size: 10px; line-height: 16px; }
.card .art .badge.charged { color: #e8b84b; border-color: rgba(232,184,75,.45); }
.card .art .badge.indeck { color: #63d68e; border-color: rgba(99,214,142,.45); }
.card .nm { margin-top: 7px; font-size: 12.5px; font-weight: 600; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .meta { margin-top: 2px; font-size: 10.5px; color: #7d8ea3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .acts { display: flex; gap: 5px; margin-top: 8px; }
.slot-empty { min-height: 164px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 1px dashed #3a4a60; border-radius: 8px; background: rgba(255,255,255,.015); color: #7d8ea3; font-size: 10.5px; }
.slot-empty i { font-style: normal; font-size: 17px; color: #54657c; }
.btn { height: 26px; padding: 0 10px; border: 1px solid rgba(148,168,196,.22); border-radius: 6px; background: #26313f; color: #e6ecf4; font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
.btn:hover { border-color: rgba(232,184,75,.45); background: #304050; }
.btn-gold { background: #e8b84b; border-color: #c99a26; color: #241a06; font-weight: 700; }
.btn-gold:hover { background: #f2c457; border-color: #c99a26; }
.btn-ghost-danger { color: #ffb4a8; border-color: rgba(226,106,90,.35); background: transparent; }
.btn-ghost-danger:hover { background: #432624; border-color: rgba(226,106,90,.6); }
.btn-block { flex: 1; }
.btn:disabled { opacity: .55; cursor: not-allowed; color: #63d68e; border-color: rgba(99,214,142,.35); background: rgba(99,214,142,.08); }
.empty-box { padding: 26px; border: 1px dashed #3a4a60; border-radius: 8px; background: rgba(255,255,255,.015); text-align: center; color: #7d8ea3; font-size: 12px; line-height: 1.9; }
.empty-box b { color: #9db0c5; }
.cat-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(148,168,196,.12); border-radius: 8px; background: #202a38; }
.level-step { display: flex; align-items: center; gap: 2px; }
.level-step button { width: 28px; height: 28px; border: 1px solid rgba(148,168,196,.22); border-radius: 6px; background: #26313f; color: #9db0c5; font-size: 13px; cursor: pointer; }
.level-step button:hover { color: #e8b84b; border-color: rgba(232,184,75,.45); }
.level-step .lvl { min-width: 86px; text-align: center; font-size: 12.5px; font-weight: 600; }
.lvl-state { padding: 2px 9px; border: 1px solid rgba(148,168,196,.22); border-radius: 99px; color: #7d8ea3; font-size: 10.5px; }
.lvl-state.on { color: #63d68e; border-color: rgba(99,214,142,.4); }
.seg { margin-left: auto; display: flex; border: 1px solid rgba(148,168,196,.22); border-radius: 6px; overflow: hidden; }
.seg button { padding: 5px 13px; border: none; background: #18202c; color: #7d8ea3; font: inherit; font-size: 11.5px; cursor: pointer; }
.seg button.active { background: #2c3a4e; color: #fff; box-shadow: inset 0 -2px 0 #e8b84b; }
.cat-tip { margin: 8px 2px 0; font-size: 11px; color: #7d8ea3; }
.cat-tip b { color: #e8b84b; font-weight: 600; }
.cc-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 16px; border-top: 1px solid rgba(148,168,196,.12); font-size: 11px; color: #7d8ea3; }
.cc-foot .pages { display: flex; align-items: center; gap: 8px; }
.cc-foot .pages button { min-width: 24px; height: 22px; padding: 0 7px; border: 1px solid rgba(148,168,196,.22); border-radius: 5px; background: #26313f; color: #9db0c5; font: inherit; font-size: 11px; cursor: pointer; }
.cc-foot .pages button:hover { color: #e8b84b; border-color: rgba(232,184,75,.45); }
.cc-foot .pages button:disabled { opacity: .45; cursor: default; color: #7d8ea3; border-color: rgba(148,168,196,.22); background: #26313f; }
@media (max-width: 960px) { .slot-grid { grid-template-columns: repeat(4, 1fr); } .deck-banner { grid-template-columns: 1fr; } .deck-meta { padding-left: 0; border-left: none; padding-top: 10px; border-top: 1px solid rgba(148,168,196,.12); } }
@media (max-width: 640px) { .cc-rail { flex-basis: 96px; } .card-grid { grid-template-columns: repeat(2, 1fr); } .cc-search { width: 150px; } }
`;

const cardHtml = `<div class="cc-backdrop"></div>
<div class="cc" role="dialog" aria-modal="true" aria-label="卡片典藏">
	<aside class="cc-rail">
		<div class="cc-brand">卡片典藏<small>CARD COLLECTION</small></div>
		<nav class="cc-nav" data-tabs></nav>
		<div class="cc-rail-foot">卡组上限 8 张<br>同类装备仅 1 张生效</div>
	</aside>
	<section class="cc-main">
		<header class="cc-top">
			<div><h1 data-view-title>我的卡组</h1><div class="sub" data-view-sub>已加入的卡片与已充能待加入卡片</div></div>
			<div class="cc-search"><input type="search" data-search placeholder="搜索卡片名称或 ID" aria-label="搜索卡片名称或 ID"><button type="button" data-action="search">搜索</button></div>
			<button type="button" class="cc-close" data-action="close" aria-label="关闭">✕</button>
		</header>
		<div class="cc-body" data-body></div>
		<footer class="cc-foot"><span data-status>就绪</span><span class="pages" data-pages></span></footer>
	</section>
</div>`;

const CARD_FILTERS = [
	{ id: "all", label: "全部" },
	{ id: "charged", label: "已充能" },
	{ id: "can-charge", label: "可充能" }
];

// --- Pure helpers (unit tested) ---------------------------------------------

// Badge + action mapping for cards shown inside an equipment category tab.
export function resolveCategoryCardAction(entry) {
	if (entry.state > 1) {
		return { badgeText: "已加入卡组", badgeKind: "indeck", action: { label: "已在卡组", kind: "", tab: entry.tab, level: entry.level, disabled: true } };
	}
	if (entry.state > 0) {
		return { badgeText: "已充能", badgeKind: "charged", action: { action: "add-deck", label: "加入卡组", kind: "btn-gold", tab: entry.tab, level: entry.level } };
	}
	return { badgeText: "未充能", badgeKind: "", action: { action: "recharge", label: "充能", tab: entry.tab, level: entry.level } };
}

// Badge + action mapping for cross-category search results. Deck cards (tab 0)
// can be removed directly; everything else follows the category rules.
export function resolveSearchCardAction(entry) {
	if (entry.tab === 0) {
		return { badgeText: "卡组生效", badgeKind: "indeck", action: { action: "cancel", label: "移除", kind: "btn-ghost-danger", tab: 0, level: 1 } };
	}
	return resolveCategoryCardAction(entry);
}

// Pick the tag the skin's own menu buttons use. A substring check on the
// selector is wrong: ".buttons > div[id]" contains "button" via ".buttons",
// which previously produced a native <button> in div-based V5/V3 skins.
export function resolveMenuButtonTagName(menu, buttonsSelector) {
	const sample = menu?.querySelector?.(buttonsSelector) || menu?.querySelector?.("[id]");
	return sample?.tagName?.toLowerCase() || "div";
}

// Install the "卡片典藏" entry into a BasicInfo skin's .buttons menu. The
// created element matches the skin's buttonsSelector, so the skin's own init
// pass binds its click handler and applies its icon styles.
export function installLastROCardMenuButton({ root, buttonsSelector = ".buttons button", buttonKeyBy = "class", GUIComponent, doc = globalThis.document }) {
	const menu = root?.querySelector?.(".buttons");
	if (!menu || menu.querySelector("#card")) return false;
	const button = doc.createElement(resolveMenuButtonTagName(menu, buttonsSelector));
	if (button.tagName === "BUTTON") button.type = "button";
	button.id = "card";
	// "card" must stay first: class-based skins dispatch on the first class name.
	button.className = "card event_add_cursor";
	button.title = "卡片典藏";
	button.setAttribute("data-background", "menu_icon/bt_card.bmp");
	button.setAttribute("data-down", "menu_icon/bt_card_press.bmp");
	if (buttonKeyBy === "id") {
		const label = doc.createElement("span");
		label.className = "name";
		label.textContent = "卡片典藏";
		button.appendChild(label);
	}
	menu.appendChild(button);
	// The button is added after the component's one-time data-* scan, so wire
	// its BMP backgrounds and pressed state explicitly.
	GUIComponent?.processDataAttrs?.(button);
	return true;
}

// --- Component factory -------------------------------------------------------

export function createCardCollectionComponent(deps) {
	const {
		GUIComponent,
		Network,
		PACKET,
		DB,
		Client,
		Configs,
		CARD_CONNECTION_TABS,
		getCardConnectionData,
		listCardEntries,
		getCardDeckOverview,
		getCardLevelCount,
		buildCardConnectionAction,
		applyCardConnectionUpdate,
		applyCardConnectionCancelUpdate,
		applyCardConnectionActivateUpdate,
		applyCardConnectionEnableUpdate
	} = deps;

	const component = new GUIComponent("CardConnection2", cardCss);
	component.render = () => cardHtml;
	component.needFocus = true;
	component.mouseMode = GUIComponent.MouseMode.STOP;
	component._data = null;
	component._tab = 0;
	component._level = 1;
	component._page = 1;
	component._totalPages = 1;
	component._filter = "all";
	component._search = "";
	component._searchPageSize = 16;
	component.init = function init() {
		const root = this.getRoot();
		root.querySelector('[data-action="close"]')?.addEventListener("click", () => this.remove());
		root.querySelector('[data-action="search"]')?.addEventListener("click", () => this.commitSearch());
		root.querySelector("[data-search]")?.addEventListener("keydown", (event) => { if (event.key === "Enter") this.commitSearch(); });
		root.querySelector("[data-search]")?.addEventListener("input", (event) => { if (!event.currentTarget.value && this._search) this.clearSearch(); });
		root.querySelector("[data-tabs]")?.addEventListener("click", (event) => { const tab = event.target.closest("[data-tab]"); if (tab) this.switchTab(Number(tab.dataset.tab)); });
		root.querySelector("[data-body]")?.addEventListener("click", (event) => this.handleBodyClick(event));
		root.querySelector("[data-pages]")?.addEventListener("click", (event) => {
			const button = event.target.closest("[data-page-action]");
			if (!button || button.disabled) return;
			if (button.dataset.pageAction === "prev" && this._page > 1) { this._page--; this.renderCards(); }
			if (button.dataset.pageAction === "next" && this._page < this._totalPages) { this._page++; this.renderCards(); }
		});
		this._data = getCardConnectionData(Number(Configs.get("lastroNid", 5)));
		this.renderCards();
	};
	component.onAppend = function onAppend() { this.renderCards(); };
	component.onRemove = function onRemove() { this._page = 1; this._search = ""; this._filter = "all"; this._tab = 0; this._level = 1; };
	component.toggle = function toggle() { if (this._host?.parentNode) this.remove(); else { this.append(); this.focus(); this.renderCards(); } };
	component.setStatus = function setStatus(message) { const el = this.getRoot()?.querySelector("[data-status]"); if (el) el.textContent = String(message || "就绪"); };
	component.cardName = function cardName(id) {
		try {
			const info = DB.getItemInfo(Number(id));
			return info?.identifiedDiSPlayName || info?.identifiedDisplayName || info?.displayName || info?.name || DB.getItemName?.(info) || String(id);
		} catch { return String(id); }
	};
	component.commitSearch = function commitSearch() {
		const input = this.getRoot()?.querySelector("[data-search]");
		this._search = input?.value?.trim() || "";
		this._page = 1;
		this.renderCards();
	};
	component.clearSearch = function clearSearch() {
		this._search = "";
		this._page = 1;
		this.renderCards();
	};
	component.switchTab = function switchTab(tab) {
		this._tab = Number(tab) || 0;
		this._level = 1;
		this._page = 1;
		this._filter = "all";
		this._search = "";
		const input = this.getRoot()?.querySelector("[data-search]");
		if (input) input.value = "";
		this.renderCards();
	};
	component.levelKeys = function levelKeys() {
		const source = this._data?.data?.[this._tab]?.data;
		return source ? Object.keys(source).map(Number).sort((a, b) => a - b) : [1];
	};
	component.loadCardArt = function loadCardArt(artEl, id) {
		try {
			const info = DB.getItemInfo(Number(id));
			const resource = info?.illustResourcesName;
			if (!resource || !Client?.loadFile) return;
			Client.loadFile(`${DB.INTERFACE_PATH}cardbmp/${resource}.bmp`, (url) => {
				if (url && artEl.isConnected) { artEl.style.backgroundImage = `url("${url}")`; artEl.classList.add("is-art"); }
			});
		} catch { /* Keep the monogram fallback when the artwork is unavailable. */ }
	};
	component.createCardNode = function createCardNode(entry, { badgeText = "", badgeKind = "", meta = "", action = null } = {}) {
		const card = document.createElement("div");
		card.className = "card";
		const art = document.createElement("div");
		art.className = "art";
		if (badgeText) {
			const badge = document.createElement("span");
			badge.className = `badge${badgeKind ? ` ${badgeKind}` : ""}`;
			badge.textContent = badgeText;
			art.appendChild(badge);
		}
		const mono = document.createElement("span");
		mono.className = "mono";
		mono.textContent = String(entry.name || "卡").trim().charAt(0) || "卡";
		art.appendChild(mono);
		this.loadCardArt(art, entry.id);
		const name = document.createElement("div");
		name.className = "nm";
		name.textContent = entry.name;
		const metaEl = document.createElement("div");
		metaEl.className = "meta";
		metaEl.textContent = `ID: ${entry.id}${meta ? ` · ${meta}` : ""}`;
		const actions = document.createElement("div");
		actions.className = "acts";
		if (action) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = `btn btn-block${action.kind ? ` ${action.kind}` : ""}`;
			button.textContent = action.label;
			if (action.disabled) {
				button.disabled = true;
			} else {
				button.dataset.cardAction = action.action;
				button.dataset.tab = action.tab;
				button.dataset.level = action.level;
				button.dataset.cardid = entry.id;
			}
			actions.appendChild(button);
		}
		card.append(art, name, metaEl, actions);
		return card;
	};
	component.renderTabs = function renderTabs() {
		const tabs = this.getRoot()?.querySelector("[data-tabs]");
		if (!tabs) return;
		tabs.textContent = "";
		const overview = getCardDeckOverview(this._data);
		for (const tab of CARD_CONNECTION_TABS) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = tab.id === this._tab ? "active" : "";
			button.dataset.tab = tab.id;
			button.textContent = tab.label;
			if (tab.id === 0) {
				const count = document.createElement("span");
				count.className = "cnt";
				count.textContent = `${overview.deckCount}/8`;
				button.appendChild(count);
			}
			tabs.appendChild(button);
		}
	};
	component.renderDeck = function renderDeck() {
		const fragment = document.createDocumentFragment();
		const overview = getCardDeckOverview(this._data, { itemNames: (id) => this.cardName(id) });

		const banner = document.createElement("div");
		banner.className = "deck-banner";
		const rules = document.createElement("div");
		rules.className = "deck-rules";
		rules.innerHTML = "卡片加入卡组后，<b>自动绑定指定类型装备并激活效果</b>，无需手动激活。卡组最多添加 <b>8</b> 张卡片，与装备上相同的卡片仅有一张生效，支持精炼与套卡效果。<div class=\"slots\"><span>头饰 ×1</span><span>武器 / 盾牌 ×2</span><span>铠甲 ×1</span><span>披肩 ×1</span><span>鞋类 ×1</span><span>饰品 ×2</span></div>";
		const metaWrap = document.createElement("div");
		metaWrap.className = "deck-meta";
		const activateChip = document.createElement("div");
		activateChip.className = `meta-chip${overview.activate ? " on" : ""}`;
		activateChip.innerHTML = `<span><span class="dot"></span>效果状态</span><b>${overview.activate ? "已激活" : "未激活"}（服务器）</b>`;
		const enableChip = document.createElement("div");
		enableChip.className = `meta-chip${overview.enable ? " on" : ""}`;
		enableChip.innerHTML = `<span><span class="dot"></span>卡组状态</span><b>${overview.enable ? "已启用" : "未启用"}（服务器）</b>`;
		const capChip = document.createElement("div");
		capChip.className = "meta-chip cap-row";
		capChip.innerHTML = `<span>卡组容量</span><b>${overview.deckCount} / 8</b>`;
		const capBar = document.createElement("div");
		capBar.className = "cap-bar";
		const capFill = document.createElement("i");
		capFill.style.width = `${(overview.deckCount / overview.capacity) * 100}%`;
		capBar.appendChild(capFill);
		capChip.appendChild(capBar);
		metaWrap.append(activateChip, enableChip, capChip);
		banner.append(rules, metaWrap);
		fragment.appendChild(banner);

		const slotHead = document.createElement("div");
		slotHead.className = "sec-h";
		slotHead.innerHTML = `<h2>卡组槽位</h2><span class="n">${overview.deckCount} / 8</span>`;
		const slotHint = document.createElement("span");
		slotHint.className = "hint";
		slotHint.textContent = "移除后卡片回到“已充能 · 待加入”列表";
		slotHead.appendChild(slotHint);
		fragment.appendChild(slotHead);

		const slotGrid = document.createElement("div");
		slotGrid.className = "slot-grid";
		for (let slot = 0; slot < overview.capacity; slot++) {
			const entry = overview.deck.find((item) => item.slot === slot);
			if (entry) {
				const tabLabel = CARD_CONNECTION_TABS[entry.tab]?.label || "我的卡组";
				slotGrid.appendChild(this.createCardNode(entry, {
					badgeText: "卡组生效",
					badgeKind: "indeck",
					meta: `${tabLabel} · 第${entry.level}页`,
					action: { action: "cancel", label: "移除", kind: "btn-ghost-danger", tab: 0, level: 1 }
				}));
			} else {
				const empty = document.createElement("div");
				empty.className = "slot-empty";
				empty.innerHTML = `<i>＋</i>空卡槽 ${slot + 1}`;
				slotGrid.appendChild(empty);
			}
		}
		fragment.appendChild(slotGrid);

		const waitHead = document.createElement("div");
		waitHead.className = "sec-h";
		waitHead.innerHTML = `<h2>已充能 · 待加入卡组</h2><span class="n">${overview.awaiting.length} 张</span>`;
		const waitHint = document.createElement("span");
		waitHint.className = "hint";
		waitHint.textContent = "汇总自所有装备分类 · 点击“加入卡组”放入空槽位";
		waitHead.appendChild(waitHint);
		fragment.appendChild(waitHead);

		if (overview.awaiting.length) {
			const grid = document.createElement("div");
			grid.className = "card-grid";
			for (const entry of overview.awaiting) {
				const tabLabel = CARD_CONNECTION_TABS[entry.tab]?.label || "";
				grid.appendChild(this.createCardNode(entry, {
					badgeText: "已充能 · 未激活",
					badgeKind: "charged",
					meta: `${tabLabel} · 第${entry.level}页`,
					action: { action: "add-deck", label: "加入卡组", kind: "btn-gold", tab: entry.tab, level: entry.level }
				}));
			}
			fragment.appendChild(grid);
		} else {
			const empty = document.createElement("div");
			empty.className = "empty-box";
			empty.innerHTML = "当前没有已充能但未加入卡组的卡片。<br>可在各 <b>装备分类</b> 页中对卡片进行 <b>充能</b>，充能后将在此处显示并可一键加入卡组。";
			fragment.appendChild(empty);
		}
		return fragment;
	};
	component.renderCategory = function renderCategory() {
		const fragment = document.createDocumentFragment();
		const tabLabel = CARD_CONNECTION_TABS.find((tab) => tab.id === this._tab)?.label || "";
		const levelInfo = this._data?.data?.[this._tab]?.data?.[this._level];
		const result = listCardEntries(this._data, {
			tab: this._tab,
			level: this._level,
			filter: this._filter,
			pageSize: 8,
			itemNames: (id) => this.cardName(id)
		});

		const toolbar = document.createElement("div");
		toolbar.className = "cat-toolbar";
		const step = document.createElement("div");
		step.className = "level-step";
		const keys = this.levelKeys();
		const levelIndex = Math.max(0, keys.indexOf(this._level));
		step.innerHTML = `<button type="button" data-step="-1" ${levelIndex <= 0 ? "disabled" : ""} aria-label="上一页">‹</button><div class="lvl">第 ${this._level} 页</div><button type="button" data-step="1" ${levelIndex >= keys.length - 1 ? "disabled" : ""} aria-label="下一页">›</button>`;
		const levelState = document.createElement("span");
		levelState.className = `lvl-state${levelInfo?.activate ? " on" : ""}`;
		levelState.textContent = `本页效果：${levelInfo?.activate ? "已激活" : "未激活"}`;
		const seg = document.createElement("div");
		seg.className = "seg";
		for (const filter of CARD_FILTERS) {
			const button = document.createElement("button");
			button.type = "button";
			button.dataset.filter = filter.id;
			button.className = this._filter === filter.id ? "active" : "";
			button.textContent = filter.label;
			seg.appendChild(button);
		}
		toolbar.append(step, levelState, seg);
		fragment.appendChild(toolbar);

		const tip = document.createElement("div");
		tip.className = "cat-tip";
		tip.innerHTML = `本页 <b>8 张卡片全部充能</b>后，服务器将 <b>自动激活本页效果</b>（共 ${getCardLevelCount(this._data, this._tab)} 页，可用左上角箭头翻页）。`;
		fragment.appendChild(tip);

		if (result.entries.length) {
			const grid = document.createElement("div");
			grid.className = "card-grid";
			grid.style.marginTop = "10px";
			for (const entry of result.entries) {
				const { badgeText, badgeKind, action } = resolveCategoryCardAction(entry);
				grid.appendChild(this.createCardNode(entry, {
					badgeText,
					badgeKind,
					meta: `第${entry.level}页`,
					action
				}));
			}
			fragment.appendChild(grid);
		} else {
			const empty = document.createElement("div");
			empty.className = "empty-box";
			empty.style.marginTop = "10px";
			empty.textContent = "本页没有符合筛选条件的卡片。";
			fragment.appendChild(empty);
		}
		return fragment;
	};
	component.renderSearch = function renderSearch() {
		const fragment = document.createDocumentFragment();
		const result = listCardEntries(this._data, {
			tab: this._tab,
			page: this._page,
			pageSize: this._searchPageSize,
			search: this._search,
			searchAllTabs: true,
			itemNames: (id) => this.cardName(id)
		});
		this._page = result.page;
		this._totalPages = result.totalPages;
		const head = document.createElement("div");
		head.className = "sec-h";
		head.innerHTML = `<h2>搜索结果</h2><span class="n">${result.total} 张</span>`;
		const hint = document.createElement("span");
		hint.className = "hint";
		hint.textContent = `关键词：${this._search}`;
		head.appendChild(hint);
		fragment.appendChild(head);
		if (result.entries.length) {
			const grid = document.createElement("div");
			grid.className = "card-grid";
			for (const entry of result.entries) {
				const tabLabel = CARD_CONNECTION_TABS[entry.tab]?.label || "";
				const { badgeText, badgeKind, action } = resolveSearchCardAction(entry);
				grid.appendChild(this.createCardNode(entry, {
					badgeText,
					badgeKind,
					meta: entry.tab === 0 ? "我的卡组" : `${tabLabel} · 第${entry.level}页`,
					action
				}));
			}
			fragment.appendChild(grid);
		} else {
			const empty = document.createElement("div");
			empty.className = "empty-box";
			empty.innerHTML = `没有找到与 “<b>${this._search}</b>” 相关的卡片。<br>可输入卡片名称或 ID，搜索范围覆盖全部装备分类。`;
			fragment.appendChild(empty);
		}
		return fragment;
	};
	component.renderCards = function renderCards() {
		if (!this._data) this._data = getCardConnectionData(Number(Configs.get("lastroNid", 5)));
		const root = this.getRoot();
		if (!root || !this._data) return;
		this.renderTabs();
		const body = root.querySelector("[data-body]");
		if (body) {
			body.textContent = "";
			if (this._search) body.appendChild(this.renderSearch());
			else if (this._tab === 0) body.appendChild(this.renderDeck());
			else body.appendChild(this.renderCategory());
			body.scrollTop = 0;
		}
		const title = root.querySelector("[data-view-title]");
		const sub = root.querySelector("[data-view-sub]");
		if (title) title.textContent = this._search ? "搜索结果" : (CARD_CONNECTION_TABS.find((tab) => tab.id === this._tab)?.label || "卡片典藏");
		if (sub) sub.textContent = this._search ? "跨全部装备分类搜索" : (this._tab === 0 ? "已加入的卡片与已充能待加入卡片" : `${CARD_CONNECTION_TABS.find((tab) => tab.id === this._tab)?.label || ""}分类 · 按页浏览（每页 8 张）`);
		const pages = root.querySelector("[data-pages]");
		if (pages) {
			if (this._search) {
				pages.innerHTML = `<button type="button" data-page-action="prev" ${this._page <= 1 ? "disabled" : ""}>‹</button><span>${this._page} / ${this._totalPages}</span><button type="button" data-page-action="next" ${this._page >= this._totalPages ? "disabled" : ""}>›</button>`;
			} else if (this._tab !== 0) {
				pages.innerHTML = `<span>第 <b>${this._level}</b> / ${getCardLevelCount(this._data, this._tab)} 页</span>`;
			} else {
				pages.textContent = "";
			}
		}
	};
	component.handleBodyClick = function handleBodyClick(event) {
		const stepButton = event.target.closest("[data-step]");
		if (stepButton && !stepButton.disabled) {
			const keys = this.levelKeys();
			const index = Math.max(0, keys.indexOf(this._level));
			const next = keys[Math.min(keys.length - 1, Math.max(0, index + Number(stepButton.dataset.step)))];
			if (Number.isFinite(next) && next !== this._level) { this._level = next; this.renderCards(); }
			return;
		}
		const filterButton = event.target.closest("[data-filter]");
		if (filterButton) {
			this._filter = filterButton.dataset.filter || "all";
			this.renderCards();
			return;
		}
		const actionButton = event.target.closest("[data-card-action]");
		if (actionButton && !actionButton.disabled) {
			// No game-side confirm box: UIManager.showPromptBox renders in the
			// game layer, which this fullscreen panel covers, so the prompt
			// would be invisible until the panel closes. Execute immediately.
			this.sendAction(actionButton.dataset.cardAction, {
				tab: Number(actionButton.dataset.tab),
				level: Number(actionButton.dataset.level),
				cardid: Number(actionButton.dataset.cardid)
			});
		}
	};
	component.sendAction = function sendAction(action, values) {
		if (action === "activate" || action === "enable") {
			this.setStatus("激活效果和启用卡组由服务器根据已加入的卡片自动处理");
			return false;
		}
		const constructors = { recharge: PACKET.CZ.REQUEST_CARDCONNECTION_RECHARGE, "add-deck": PACKET.CZ.REQUEST_CARDCONNECTION_ADDMYDECK, cancel: PACKET.CZ.REQUEST_CARDCONNECTION_CANCEL };
		const Ctor = constructors[action];
		if (!Ctor || !Network?.sendPacket) { this.setStatus("当前服务器未启用卡片典藏"); return false; }
		const fields = buildCardConnectionAction(action, values);
		const pkt = new Ctor(); Object.assign(pkt, fields); Network.sendPacket(pkt);
		this.setStatus(`已发送${action === "recharge" ? "充能" : action === "add-deck" ? "加入卡组" : "移除"}请求，等待服务器响应`);
		return true;
	};
	component.rechargeList = function rechargeList(pkt) {
		if (!this._data || !Array.isArray(pkt?.classInfos)) return false;
		for (let tab = 0; tab < pkt.classInfos.length; tab++) {
			const incoming = pkt.classInfos[tab]; const target = this._data.data?.[tab];
			if (!target || !incoming) continue;
			target.enable = Number(incoming.enable) || 0;
			const rows = Array.isArray(incoming.data) ? incoming.data : [];
			if (tab === 0) {
				const deck = target.data?.[1]; if (!deck) continue;
				for (let slot = 0; slot < 8; slot++) deck.cards[slot] = Number(rows[0]?.[`recharge${slot}`]) || 0;
				deck.activate = Number(rows[0]?.activate) || 0;
			} else for (let row = 0; row < rows.length; row++) {
				const level = target.data?.[row + 1]; if (!level) continue;
				level.activate = Number(rows[row].activate) || 0;
				for (let slot = 0; slot < 8; slot++) level.recharge[slot] = Number(rows[row][`recharge${slot}`]) || 0;
			}
		}
		this.renderCards(); return true;
	};
	component.updateList = function updateList(pkt) { const changed = applyCardConnectionUpdate(this._data, pkt); if (changed) this.renderCards(); return changed; };
	component.cancelUpdate = function cancelUpdate(pkt) { const changed = applyCardConnectionCancelUpdate(this._data, pkt); if (changed) this.renderCards(); return changed; };
	component.setActivate = function setActivate(pkt) { const changed = applyCardConnectionActivateUpdate(this._data, pkt); if (changed) this.renderCards(); return changed; };
	component.setEnable = function setEnable(pkt) { const changed = applyCardConnectionEnableUpdate(this._data, pkt); if (changed) this.renderCards(); return changed; };

	return component;
}
