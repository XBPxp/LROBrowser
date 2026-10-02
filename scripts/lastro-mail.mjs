import ts from 'typescript';

const buttonSkin = 'navigation_interface3/btn_';
const textById = {
  2849: '刷新', 1026: '写信', 3192: '标题', 3193: '发件人',
  3546: '公告', 3547: '一般', 3548: '返还', 3549: '搜索',
  3589: '删除全部', 3592: '领取全部',
};
const buttonLabels = {
  'validate-name': '确认名字', send: '发送', 'get-content': '领取',
  'get-zeny': '领取', delete: '删除', reply: '回复',
};
const iconLabels = {
  close: '关闭', refresh: '刷新', write: '写信',
  'search-title': '按标题搜索', 'search-sender': '按发件人搜索',
  'search-btn': '搜索', 'previous-page': '上一页', 'next-page': '下一页',
};

function localizeTemplate(html, component) {
  html = html.replace(/(<(?:span|li|button)\b[^>]*?)\s+data-text="(\d+)"([^>]*>)([^<]*)(<\/(?:span|li|button)>)/g,
    (match, start, id, end, _text, close) => textById[id] ? start + end + textById[id] + close : match);
  html = html.replace(/<button\b([^>]*)>([\s\S]*?)<\/button>/g, (match, attributes, content) => {
    const classes = /class="([^"]*)"/.exec(attributes)?.[1].split(/\s+/) || [];
    const key = classes.find(name => buttonLabels[name] || iconLabels[name]);
    if (!key) return match;
    const label = buttonLabels[key] || iconLabels[key];
    if (buttonLabels[key]) {
      attributes = attributes.replace(/\s+data-(?:background|hover|down|text)="[^"]*"/g, '')
        .replace(/class="([^"]*)"/, 'class="$1 lastro-mail-button"');
      attributes += ` data-background="${buttonSkin}normal.bmp" data-hover="${buttonSkin}over.bmp" data-down="${buttonSkin}press.bmp"`;
      content = label;
    }
    return `<button${attributes} aria-label="${label}">${content}</button>`;
  });
  html = html.replace('<input class="search" type="text" />', '<input class="search" type="text" aria-label="搜索邮件" />');
  if (component === 'WriteRodex') {
    html = html.replace('<input class="name" />', '<input class="name" aria-label="收件人" placeholder="收件人" />')
      .replace('<input class="title-text" />', '<input class="title-text" aria-label="标题" placeholder="标题" />')
      .replace('<textarea class="content-text"></textarea>', '<textarea class="content-text" aria-label="邮件正文"></textarea>')
      .replace('<span class="weigth" data-background="basic_interface/rodexsystem/renewal/bg_weight.bmp"></span>', '<span class="weigth" data-background="basic_interface/rodexsystem/renewal/bg_weight.bmp" aria-label="附件重量"></span>')
      .replace('>0 2000</span>', '>0 / 2000</span>')
      .replace('<span type="text" class="base tax" data-background="basic_interface/rodexsystem/renewal/bg_tax.bmp"></span>', '<span class="base tax">邮费</span>');
  }
  return html;
}

const commonCss = `
:host { font-size: 12px; font-size-adjust: none; line-height: 16px; }
button, input, textarea { font: inherit; box-sizing: border-box; }
button { padding: 0; white-space: nowrap; cursor: pointer; }
.lastro-mail-button { color: #212163; background-size: 100% 100%; text-align: center; line-height: 18px; }
`;

const inboxCss = `
#Rodex .body .searchbar .search-title-text,
#Rodex .body .searchbar .search-sender-text { width: auto; height: 16px; top: 10px; white-space: nowrap; }
#Rodex .body .searchbar .search-title { left: 20px; top: 13px; }
#Rodex .body .searchbar .search-title-text { left: 33px; }
#Rodex .body .searchbar .search-sender { left: 66px; top: 13px; }
#Rodex .body .searchbar .search-sender-text { left: 79px; }
#Rodex .body .searchbar .search { left: 131px; width: 132px; top: 9px; height: 18px; padding: 1px 4px; }
#Rodex .body .navbar .nav { display: flex; padding: 0 13px; box-sizing: border-box; }
#Rodex .body .navbar .nav .nav-item { float: none; height: 100%; box-sizing: border-box; white-space: nowrap; cursor: pointer; }
#Rodex .body .rodex-list .mail-list .mail-item .mail-text .text { width: 100%; }
#Rodex .body .rodex-list .mail-list .mail-item .mail-text .title .text .mail-label,
#Rodex .body .rodex-list .mail-list .mail-item .mail-text .sender .text .mail-label { position: static; display: block; width: 100%; padding: 0; background: transparent; color: inherit; text-shadow: none; font-size: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#Rodex .body .footer .delete-all,
#Rodex .body .footer .retrieve-all { color: #212163; line-height: 20px; }
`;

const writeCss = `
#WriteRodex .body .sender .name { height: 22px; width: 142px; padding: 2px 4px; }
#WriteRodex .body .sender .validate-name { line-height: 18px; }
#WriteRodex .body .title .title-text { width: 280px; height: 22px; padding: 2px 0; background: transparent; }
#WriteRodex .body .content .content-text { padding: 4px; overflow: auto; line-height: 18px; }
#WriteRodex .body .items .weigth-text { top: 19px; right: 10px; width: 62px; height: 20px; line-height: 20px; font-size: 10px; text-align: center; white-space: nowrap; background: #f3f3f3; border-radius: 0 4px 4px 0; font-variant-numeric: tabular-nums; }
#WriteRodex .body .zeny .value { height: 20px; padding: 1px 4px; }
#WriteRodex .body .zeny .character-zeny { max-width: 140px; white-space: nowrap; font-variant-numeric: tabular-nums; }
#WriteRodex .body .footer .tax { width: 184px; height: 20px; padding: 1px 6px; box-sizing: border-box; color: #626262; background: white; border: 1px solid #c3c3c3; border-radius: 3px; box-shadow: inset 0 1px 2px #ddd; }
#WriteRodex .body .footer .tax-text { top: 6px; right: auto; left: 48px; width: 139px; line-height: 18px; text-align: right; font-variant-numeric: tabular-nums; }
#WriteRodex .body .footer .tax-text::after { content: ' 金币'; }
`;

const readCss = `
#ReadRodex .body .sender .name,
#ReadRodex .body .title .title-text { max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ReadRodex .body .content .content-text { box-sizing: border-box; padding: 4px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 18px; }
#ReadRodex .body .items .get-content,
#ReadRodex .body .zeny .get-zeny { width: 36px; background-size: 100% 100%; background-color: transparent; color: #212163; line-height: 18px; }
`;

function replaceRequired(source, from, to, label) {
  if (source.split(from).length !== 2) throw new Error(`anchor:mail-${label}`);
  return source.replace(from, to);
}

function escapeMailText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function patchRuntimeMail(source) {
  if (!source.includes('src/UI/Components/Rodex/')) return source;
  if (source.match(/\/\/#region src\/UI\/Components\/Rodex\/WriteRodex\.js\r?\n/g)?.length !== 1) {
    throw new Error('anchor:mail-write-region');
  }
  const css = { Rodex: inboxCss, WriteRodex: writeCss, ReadRodex: readCss };
  let replaced = 0;
  source = source.replace(/\/\/#region src\/UI\/Components\/Rodex\/(Rodex|WriteRodex|ReadRodex)\.(html|css)\?raw\r?\n[\s\S]*?\/\/#endregion/g,
    (region, component, extension) => {
      const file = ts.createSourceFile('mail.js', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      let literal;
      function visit(node) {
        if (ts.isBinaryExpression(node) && ts.isStringLiteral(node.right)) {
          if (literal) throw new Error(`anchor:mail-${component}-${extension}`);
          literal = node.right;
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
      if (!literal) throw new Error(`anchor:mail-${component}-${extension}`);
      const value = extension === 'html' ? localizeTemplate(literal.text, component) : literal.text + commonCss + css[component];
      replaced++;
      return region.slice(0, literal.getStart(file)) + JSON.stringify(value) + region.slice(literal.end);
    });
  if (replaced !== 6) throw new Error('anchor:mail-templates');
  source = source.replace(/\/\/#region src\/UI\/Components\/Rodex\/(Rodex|WriteRodex|ReadRodex)\.js\r?\n[\s\S]*?\/\/#endregion/g,
    (region, component) => {
      if (component === 'Rodex') {
        region = replaceRequired(region, '${remaining_days} days', '${remaining_days} 天', 'expiry');
        region = replaceRequired(region, 'const mail_html = ', `const escapeMailText = ${escapeMailText.toString()};\n      const mail_html = `, 'row-text');
        region = replaceRequired(region, 'sender="${sender}"', 'sender="${escapeMailText(mail.SenderName)}"', 'reply-name');
        region = replaceRequired(region, '<span data-text="2702"></span>${title}', '<span>读取</span><span class="mail-label">${escapeMailText(title)}</span>', 'row-title');
        return replaceRequired(region, '<span data-text="2701"></span>${sender}', '<span>回复</span><span class="mail-label">${escapeMailText(sender)}</span>', 'row-sender');
      }
      if (component !== 'WriteRodex') return region;
      region = replaceRequired(region, 'root.querySelector(".title-text").value = DB.getMessage(3575);', 'root.querySelector(".title-text").value = "Mail";', 'title');
      const nativeTitleLF = String.raw`  const title =
    root
      .querySelector(".title-text")
      .value.replace(/^(\$|\%)/, "")
      .replace(/\t/g, "")
      .substring(0, 23) + String.fromCharCode(0);`;
      const titleAnchors = [nativeTitleLF, nativeTitleLF.replaceAll('\n', '\r\n')]
        .filter(anchor => region.includes(anchor));
      if (titleAnchors.length !== 1) throw new Error('anchor:mail-send-title');
      const nativeTitle = titleAnchors[0];
      const titleEol = nativeTitle === nativeTitleLF ? '\n' : '\r\n';
      region = replaceRequired(region, nativeTitle, nativeTitle + `
  if (!title.slice(0, title.indexOf("\\0")).replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, "").trim()) {
    ChatBox_default.addText(
      "邮件标题不能为空。",
      ChatBox_default.TYPE.INFO_MAIL,
      ChatBox_default.FILTER.PUBLIC_LOG,
    );
    root.querySelector(".title-text").focus();
    return;
  }`.replaceAll('\n', titleEol), 'send-title');
      region = replaceRequired(region, '${prettifyZeny$3(SessionStorage_default.zeny)} Zeny', '${prettifyZeny$3(SessionStorage_default.zeny)} 金币', 'currency');
      if (region.split('"0  2000"').length !== 3) throw new Error('anchor:mail-weight-reset');
      region = region.replaceAll('"0  2000"', '"0 / 2000"');
      region = replaceRequired(region, '`${weight}  2000`', '`${weight} / 2000`', 'weight');
      region = replaceRequired(region, 'Math.max(0, rodexTop) - 20', 'Math.max(0, rodexTop - 20)', 'write-position');
      return region;
    });
  return source;
}
