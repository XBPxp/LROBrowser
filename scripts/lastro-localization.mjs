import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import worldData from '../vendor/core/data/world/world-data.json' with { type: 'json' };

/**
 * LASTRO's localization overlay.
 *
 * Keep this data outside the imported V2 bundle so an upstream runtime refresh
 * only requires updating this small, reviewable overlay when an anchor moves.
 */

export const JOB_NAME_OVERRIDES = {
  NOVICE: '初心者',
  SWORDMAN: '剑士',
  MAGICIAN: '魔法师',
  ARCHER: '弓箭手',
  ACOLYTE: '服事',
  MERCHANT: '商人',
  THIEF: '盗贼',
  KNIGHT: '骑士',
  PRIEST: '牧师',
  WIZARD: '巫师',
  BLACKSMITH: '铁匠',
  HUNTER: '猎人',
  ASSASSIN: '刺客',
  KNIGHT2: '骑士',
  CRUSADER: '十字军',
  MONK: '武僧',
  SAGE: '贤者',
  ROGUE: '流氓',
  ALCHEMIST: '炼金术师',
  BARD: '吟游诗人',
  DANCER: '舞娘',
  CRUSADER2: '十字军',
  NOVICE_H: '进阶初心者',
  SWORDMAN_H: '进阶剑士',
  MAGICIAN_H: '进阶魔法师',
  ARCHER_H: '进阶弓箭手',
  ACOLYTE_H: '进阶服事',
  MERCHANT_H: '进阶商人',
  THIEF_H: '进阶盗贼',
  KNIGHT_H: '骑士领主',
  PRIEST_H: '神官',
  WIZARD_H: '超魔导师',
  BLACKSMITH_H: '神工匠',
  HUNTER_H: '神射手',
  ASSASSIN_H: '十字刺客',
  KNIGHT2_H: '骑士领主',
  CRUSADER_H: '圣殿十字军',
  MONK_H: '武术宗师',
  SAGE_H: '智者',
  ROGUE_H: '神行太保',
  ALCHEMIST_H: '创造者',
  BARD_H: '搞笑艺人',
  DANCER_H: '冷艳舞姬',
  CRUSADER2_H: '圣殿十字军',
  SUPERNOVICE: '超级初心者',
  GUNSLINGER: '神枪手',
  NINJA: '忍者',
  TAEKWON: '跆拳少年',
  STAR: '拳圣',
  STAR2: '拳圣',
  LINKER: '灵媒师',
  MARRIED: '已婚',
  XMAS: '圣诞服装',
  SUMMER: '夏日服装',
  RUNE_KNIGHT: '符文骑士',
  WARLOCK: '咒术师',
  RANGER: '游侠',
  ARCHBISHOP: '大主教',
  MECHANIC: '机械工匠',
  GUILLOTINE_CROSS: '十字斩首者',
  ROYAL_GUARD: '皇家卫士',
  SORCERER: '妖术师',
  MINSTREL: '宫廷乐师',
  WANDERER: '漫游舞者',
  SURA: '修罗',
  GENETIC: '基因学者',
  SHADOW_CHASER: '影子追踪者',
  RUNE_KNIGHT2: '符文骑士',
  ROYAL_GUARD2: '皇家卫士',
  RANGER2: '游侠',
  MECHANIC2: '机械工匠',
  SUPERNOVICE2: '超级初心者',
  KAGEROU: '影狼',
  OBORO: '胧',
  REBELLION: '叛乱者',
  STAR_EMPEROR: '星帝',
  SOUL_REAPER: '灵魂收割者',
  DRAGON_KNIGHT: '龙骑士',
  MEISTER: '机匠大师',
  SHADOW_CROSS: '暗影十字',
  ARCH_MAGE: '大法师',
  CARDINAL: '红衣主教',
  WINDHAWK: '风鹰',
  IMPERIAL_GUARD: '帝国卫士',
  BIOLO: '生物学者',
  ABYSS_CHASER: '深渊追踪者',
  ELEMENTAL_MASTER: '元素大师',
  INQUISITOR: '审判者',
  TROUBADOUR: '吟游诗人',
  TROUVERE: '漫游诗人',
  WINDHAWK2: '风鹰',
  MEISTER2: '机匠大师',
  DRAGON_KNIGHT2: '龙骑士',
  IMPERIAL_GUARD2: '帝国卫士',
  SKY_EMPEROR: '天帝',
  SOUL_ASCETIC: '灵魂修行者',
  SHINKIRO: '真影',
  SHIRANUI: '不知火',
  NIGHT_WATCH: '夜行者',
  HYPER_NOVICE: '超级初心者',
  SPIRIT_HANDLER: '灵兽使',
  SKY_EMPEROR2: '天帝',
  DO_SUMMONER: '召唤师',
  DRUID: '德鲁伊',
  ALITEA: '阿利忒亚',
  KARNOS: '卡诺斯',
  WEREWOLF: '狼人',
  WERERAPTOR: '狼蜥人',
};

/** Static fallback text in templates that is not replaced by DB.getMessage. */
export const RUNTIME_TEXT_REPLACEMENTS = [
  ['>Make a Room<', '>创建聊天室<'],
  ['>Title :<', '>标题：<'],
  ['>Limit :<', '>人数上限：<'],
  ['>Type :<', '>类型：<'],
  ['>Chat Room<', '>聊天室<'],
  ['>Restrict :<', '>限制：<'],
  ['>Sign :<', '>密码：<'],
  ['>Roulette<', '>抽奖转盘<'],
  ['>Points:<', '>点数：<'],
  ['>Spin<', '>开始<'],
  ['>Info<', '>说明<'],
  ['>Get Prize<', '>领取奖励<'],
  ['>Result:<', '>结果：<'],
  ['>Pet Info<', '>宠物信息<'],
  ['>Homunculus Info<', '>使魔信息<'],
  ['>Mercenary Info<', '>佣兵信息<'],
  ['>Name<', '>名称<'],
  ['>Level<', '>等级<'],
  ['>Hunger<', '>饥饿度<'],
  ['>Intimacy<', '>亲密度<'],
  ['>Accessory<', '>饰品<'],
  ['>Equipped<', '>已装备<'],
  ['>Auto Feeding<', '>自动喂食<'],
  ['>Feed Pet<', '>喂食宠物<'],
  ['>Performance<', '>动作<'],
  ['>Return to Egg Shell<', '>收回宠物<'],
  ['>Unequip Accessory<', '>卸下饰品<'],
  ['>Time Left<', '>剩余时间<'],
  ['>Kills<', '>击杀数<'],
  ['>Faith<', '>信仰<'],
  ['>Show Equip<', '>显示装备<'],
  ['>Show Costume<', '>显示时装<'],
  ['>Show Monsters<', '>显示魔物<'],
  ['>Show Quest<', '>显示任务<'],
  ['>Skill List<', '>技能列表<'],
  ['>Skill Tree<', '>技能树<'],
  ['>Character Info<', '>角色信息<'],
  ['>Guild Info<', '>公会信息<'],
  ['>Party Window<', '>队伍窗口<'],
  ['>Bank<', '>银行<'],
  ['>Storage<', '>仓库<'],
  ['>Status<', '>状态<'],
  ['>Mail<', '>邮件<'],
  ['>Description<', '>说明<'],
  ['>Position<', '>位置<'],
  ['>Next<', '>下一页<'],
  ['>Previous<', '>上一页<'],
  ['>Close<', '>关闭<'],
  ['>Delete<', '>删除<'],
  ['>Reset<', '>重置<'],
  ['>Read<', '>阅读<'],
  ['>OK<', '>确定<'],
  ['>cancel<', '>取消<'],
  ['>Default<', '>默认<'],
  ['>Left<', '>左侧<'],
  ['>Top<', '>顶部<'],
  ['>Right<', '>右侧<'],
  ['>Color<', '>彩色<'],
  ['>Han<', '>汉化<'],
  ['>Hidden<', '>隐藏<'],
  ['>All on<', '>全部开启<'],
  ['>Public Log<', '>公共记录<'],
  ['>Public Chat<', '>公共聊天<'],
  ['>Whisper<', '>私聊<'],
  ['>Party<', '>队伍<'],
  ['>Guild<', '>公会<'],
  ['>Item<', '>物品<'],
  ['>Equipment on/off<', '>装备开关<'],
  ['>Abnormal Status<', '>异常状态<'],
  ['>Party Item<', '>队伍物品<'],
  ['>Party Status<', '>队伍状态<'],
  ['>Skill Fail<', '>技能失败<'],
  ['>Party Setup<', '>队伍设置<'],
  ['>Equip Damage<', '>装备损坏<'],
  ['>Party Search<', '>队伍搜索<'],
  ['>Battle<', '>战斗<'],
  ['>Party Battle<', '>队伍战斗<'],
  ['>Party EXP<', '>队伍经验<'],
  ['>Quest<', '>任务<'],
  ['>Battlefield<', '>战场<'],
  ['>Clan<', '>氏族<'],
  ['>Achievement Challenges<', '>成就挑战<'],
  ['>Achievement<', '>成就<'],
  ['>Attendance Check<', '>签到<'],
  ['>Available Items<', '>可用物品<'],
  ['>Available Items for Buying<', '>可购买物品<'],
  ['>Available Items for selling<', '>可出售物品<'],
  ['>Available Items for Vending<', '>可摆摊物品<'],
  ['>Basic Info<', '>基本信息<'],
  ['>Basic Information<', '>基本信息<'],
  ['>Battleground<', '>战场<'],
  ['>Cash Point<', '>现金点<'],
  ['>Cart Decoration<', '>手推车装饰<'],
  ['>Cart Window<', '>手推车窗口<'],
  ['>Chat History<', '>聊天记录<'],
  ['>Check Reward<', '>查看奖励<'],
  ['>Clan Info<', '>氏族信息<'],
  ['>Clan level<', '>氏族等级<'],
  ['>Clan mark<', '>氏族标志<'],
  ['>Clan Name<', '>氏族名称<'],
  ['>Clean cache<', '>清理缓存<'],
  ['>Cleaning cache...<', '>正在清理缓存……<'],
  ['>Click anywhere to close<', '>点击任意位置关闭<'],
  ['>Complete<', '>完成<'],
  ['>Contents<', '>内容<'],
  ['>Costume<', '>时装<'],
  ['>Create Party<', '>创建队伍<'],
  ['>Cursor<', '>鼠标指针<'],
  ['>Damage Font<', '>伤害字体<'],
  ['>Day<', '>天<'],
  ['>Details<', '>详情<'],
  ['>Devotion<', '>贡献度<'],
  ['>Disable Virtual Mouse<', '>禁用虚拟鼠标<'],
  ['>Disband<', '>解散<'],
  ['>Display Name<', '>显示名称<'],
  ['>Effect<', '>效果<'],
  ['>Emblem<', '>徽章<'],
  ['>Emotion icon List<', '>表情图标列表<'],
  ['>Emotion List<', '>表情列表<'],
  ['>Enchant<', '>附魔<'],
  ['>Equipment<', '>装备<'],
  ['>Even Share<', '>平均分配<'],
  ['>Expel History<', '>驱逐记录<'],
  ['>FPS Display<', '>显示 FPS<'],
  ['>FPS Limit<', '>FPS 上限<'],
  ['>Free Points<', '>自由点数<'],
  ['>Friend Setup<', '>好友设置<'],
  ['>Friends List<', '>好友列表<'],
  ['>Friends<', '>好友<'],
  ['>General<', '>通用<'],
  ['>Guild Companion<', '>公会助手<'],
  ['>Guild lvl<', '>公会等级<'],
  ['>Guild Master<', '>公会会长<'],
  ['>Guild Name<', '>公会名称<'],
  ['>Guild Notice<', '>公会公告<'],
  ['>Guild Skill<', '>公会技能<'],
  ['>Guildsmen Info<', '>公会成员信息<'],
  ['>Guildsmen<', '>公会成员<'],
  ['>Homunculus State<', '>生命体状态<'],
  ['>Hostile Clan<', '>敌对氏族<'],
  ['>How to share EXP<', '>如何分配 EXP<'],
  ['>How to share Items<', '>如何分配物品<'],
  ['>Incomplete<', '>未完成<'],
  ['>Individual<', '>个人<'],
  ['>Input number<', '>输入数字<'],
  ['>Instant Mode<', '>即时模式<'],
  ['>Interface<', '>界面<'],
  ['>Inventory (Alt + E)<', '>物品栏（Alt + E）<'],
  ['>Inventory<', '>物品栏<'],
  ['>Invitation<', '>邀请<'],
  ['>Item Filter<', '>物品筛选<'],
  ['>Item Sharing type<', '>物品分配方式<'],
  ['>Item Window<', '>物品窗口<'],
  ['>Items wanted<', '>需求物品<'],
  ['>Job Lv. <', '>职业等级：<'],
  ['>Join a guild or start your own!<', '>加入公会，或创建属于自己的公会！<'],
  ['>Leave Party<', '>离开队伍<'],
  ['>Lowest HP<', '>最低 HP<'],
  ['>Mail List<', '>邮件列表<'],
  ['>Master Name<', '>会长名称<'],
  ['>Mercenary State<', '>佣兵状态<'],
  ['>Merchant Shop<', '>商人商店<'],
  ['>Message<', '>消息<'],
  ['>Mouse Move<', '>鼠标移动<'],
  ['>Navigation<', '>导航<'],
  ['>No results found<', '>未找到结果<'],
  ['>Note<', '>备注<'],
  ['>Open 1:1 Chat between Friends<', '>打开好友私聊<'],
  ['>Open 1:1 Chat between Strangers<', '>打开陌生人私聊<'],
  ['>Option (Esc)<', '>选项（Esc）<'],
  ['>Party (Alt + Z)<', '>队伍（Alt + Z）<'],
  ['>Party Invitation<', '>队伍邀请<'],
  ['>Party Name:<', '>队伍名称：<'],
  ['>Party Share<', '>队伍分配<'],
  ['>Point(s)<', '>点数<'],
  ['>Position Title<', '>职位名称<'],
  ['>Price limit: %s Zeny<', '>价格上限：%s Zeny<'],
  ['>Purchase Zeny Limit<', '>购买 Zeny 上限<'],
  ['>Purchase<', '>购买<'],
  ['>Quest Information<', '>任务信息<'],
  ['>Quest List (Alt + U)<', '>任务列表（Alt + U）<'],
  ['>Rank<', '>排名<'],
  ['>Read Mail<', '>阅读邮件<'],
  ['>Reward<', '>奖励<'],
  ['>Screen Resolution<', '>屏幕分辨率<'],
  ['>Select Option<', '>选择选项<'],
  ['>Send Message<', '>发送消息<'],
  ['>Server List<', '>服务器列表<'],
  ['>Short Cuts<', '>快捷栏<'],
  ['>ShortCuts<', '>快捷栏<'],
  ['>Sit/Stand<', '>坐下／站立<'],
  ['>Skill Points: <', '>技能点数：<'],
  ['>SkillTree (Alt + S)<', '>技能树（Alt + S）<'],
  ['>Sound<', '>声音<'],
  ['>Activate lock function<', '>启用锁定<'],
  ['>Deactivate lock function<', '>解除锁定<'],
  ['>Advanced<', '>高级<'],
  ['>Alliance<', '>同盟<'],
  ['>Ally Clan<', '>同盟氏族<'],
  ['>Antagonist<', '>敌对公会<'],
  ['>Attack Target Mode<', '>攻击目标模式<'],
  ['>Auto Hide UI<', '>自动隐藏界面<'],
  ['>Auto Read<', '>自动阅读<'],
  ['>Avg.lvl of Guildsmen<', '>成员平均等级<'],
  ['>Axis Threshold<', '>摇杆阈值<'],
  ['>Bank (Ctrl + B)<', '>银行（Ctrl + B）<'],
  ['>Basic<', '>基本<'],
  ['>Bloom<', '>泛光<'],
  ['>Blur<', '>模糊<'],
  ['>Bookmark<', '>书签<'],
  ['>Buy List<', '>购买列表<'],
  ['>Buying Items<', '>购买物品<'],
  ['>Buying<', '>购买<'],
  ['>CartItems<', '>手推车物品<'],
  ['>ChangeCart<', '>更换手推车<'],
  ['>Chat Bar Size<', '>聊天栏大小<'],
  ['>Closest<', '>最近<'],
  ['>Consumption items are used in the synthesis. Are you sure?<', '>合成将消耗所需物品，确定继续吗？<'],
  ['>create guild<', '>创建公会<'],
  ['>Downgrade<', '>降级<'],
  ['>Each Take<', '>各自取得<'],
  ['>Equip (Alt + Q)<', '>装备（Alt + Q）<'],
  ['>Etc<', '>其他<'],
  ['>Expel from party<', '>移出队伍<'],
  ['>Full Client<', '>完整客户端<'],
  ['>Gamepad<', '>手柄<'],
  ['>Guild (Alt + G)<', '>公会（Alt + G）<'],
  ['>Managed Territory<', '>管理领地<'],
  ['>Normal<', '>普通<'],
  ['>Off<', '>关闭<'],
  ['>Passive<', '>被动<'],
  ['>Perfect<', '>完美<'],
  ['>Pet Evolution<', '>宠物进化<'],
  ['>Player Name:<', '>角色名称：<'],
  ['>Point<', '>点数<'],
  ['>Prev<', '>上一页<'],
  ['>Punish<', '>惩罚<'],
  ['>Quick-Cast Mode<', '>快速施法模式<'],
  ['>Release Mode<', '>松开施放模式<'],
  ['>Replay<', '>回放<'],
  ['>Reputation Status<', '>声望状态<'],
  ['>Resets all enchant slots.<', '>重置所有附魔栏位。<'],
  ['>Resolution Details<', '>分辨率详情<'],
  ['>Resolution<', '>分辨率<'],
  ['>Sell List<', '>出售列表<'],
  ['>Selling Items<', '>出售物品<'],
  ['>Shared<', '>共享<'],
  ['>Shop Items<', '>商店物品<'],
  ['>ShortCut Description<', '>快捷键说明<'],
  ['>Shortcut key setting window<', '>快捷键设置窗口<'],
  ['>Skill Bar Size<', '>技能栏大小<'],
  ['>Skill Bar<', '>技能栏<'],
  ['>Sort Mini Party Window<', '>迷你队伍窗口排序<'],
  ['>Status (Alt + A)<', '>状态（Alt + A）<'],
  ['>Swap L3-R3 Sticks<', '>交换 L3/R3 摇杆<'],
  ['>Target:<', '>目标：<'],
  ['>Tax Point<', '>税率<'],
  ['>Tendency<', '>倾向<'],
  ['>Territory<', '>领地<'],
  ['>The number of members<', '>成员数量<'],
  ['>The Reason of Expulsion<', '>驱逐原因<'],
  ['>Tipbox (Alt + D)<', '>提示（Alt + D）<'],
  ['>Title<', '>标题<'],
  ['>Toggle<', '>切换<'],
  ['>Total : <', '>合计：<'],
  ['>Unknown<', '>未知<'],
  ['>Upgrade<', '>升级<'],
  ['>Use Free Points<', '>使用自由点数<'],
  ['>Uses the next available slot.<', '>使用下一个可用栏位。<'],
  ['>Vending<', '>摆摊<'],
  ['>Version<', '>版本<'],
  ['>Vibrance<', '>自然饱和度<'],
  ['>Weight : <', '>负重：<'],
  ['>Weight:<', '>负重：<'],
  ['>Weigth:<', '>负重：<'],
  ['>Window<', '>窗口<'],
  ['>World Map<', '>世界地图<'],
  ...Array.from({ length: 36 }, (_, index) => {
    const slot = `${Math.floor(index / 9) + 1}-${index % 9 + 1}`;
    return [`>Skill bar ${slot}<`, `>技能栏 ${slot}<`];
  }),
  ['message log settings', '聊天记录设置'],
  ['Sound Settings', '声音设置'],
  ['Graphics Settings', '图像设置'],
  ['>Reset to Default Values<', '>恢复默认设置<'],
  ['>Full Screen</option>', '>全屏</option>'],
  ['>Unlimited</option>', '>无限制</option>'],
  ['&lt; Command &gt;', '&lt; 指令 &gt;'],
  ['>Select slot for <', '>选择技能栏位：<'],
  ['Use L2/R2 to change tab, D-pad to navigate slot, A to select, Select to cancel', '使用 L2/R2 切换页签，方向键选择栏位，A 确定，Select 取消'],
  ['Graphics Context Lost', '图形上下文已丢失'],
  ['The browser lost connection to the GPU.', '浏览器与 GPU 的连接已断开。'],
  ['Attempting to restore automatically...', '正在尝试自动恢复……'],
  ['>Settings<', '>设置<'],
  ['> Save Files</label>', '> 保存文件</label>'],
  ['/> Services </label>', '/> 服务 </label>'],
  ['Show official cursor', '显示系统鼠标指针'],
  ['placeholder="Item Search"', 'placeholder="物品搜索"'],
  ['placeholder="Search..."', 'placeholder="搜索……"'],
  ['placeholder="No file selected"', 'placeholder="未选择文件"'],
  ['data-title="Account Limited"', 'data-title="账号限制"'],
  ['data-title="Permanent Equipment"', 'data-title="永久装备"'],
  ['data-title="Rental Equipment"', 'data-title="租赁装备"'],
  ['data-title="Popular"', 'data-title="热门"'],
  ['data-title="Consumables"', 'data-title="消耗品"'],
  ['data-title="Scrolls"', 'data-title="卷轴"'],
  ['data-title="Armor"', 'data-title="防具"'],
  ['data-title="Weapon"', 'data-title="武器"'],
  ['data-title="Cash"', 'data-title="现金点"'],
  ['data-title="Card"', 'data-title="卡片"'],
  ['data-title="Other"', 'data-title="其他"'],
  ['data-title="Limited Sale"', 'data-title="限时特卖"'],
  ['data-title="New"', 'data-title="新品"'],
  ['>Use<', '>使用<'],
  ['START NOW', '立即开始'],
  ['SAVE SETTINGS', '保存设置'],
  ['Trade : <span', '交易：<span'],
  ['Hello, illegal software is being monitored.', '正在监测非法软件。'],
  ['Please enter the text below within the specified time.', '请在规定时间内输入下方文字。'],
  ['If you enter the text wrong three times, you will get banned', '连续三次输入错误将被封禁。'],
  ['Remaining chance: 3', '剩余次数：3'],
  ['placeholder="Captcha Answer"', 'placeholder="请输入验证码"'],
  ['Saves current chat tab to txt file.', '将当前聊天页签保存为文本文件。'],
];

/** English fallbacks used only when a message-table entry is unavailable. */
export const MESSAGE_FALLBACKS = {
  126: '更改房间设置',
  127: '踢出成员',
  128: '转让队长',
  358: '加为好友',
  375: '你已经加入公会。',
  376: '该公会名称已存在。',
  401: '解散公会失败。',
  402: '公会仍有成员。',
  405: '创建公会需要必要道具。',
  1360: '查看信息 %s',
  1807: '分钟',
  1808: '秒',
  2059: '已收到加入队伍的邀请。',
  2686: '删除称号',
};

// Use the same packaged display names as the world map. This is synchronous at
// runtime, so an arrival banner cannot race a JSON fetch or a later Lua load.
export const MAP_NAME_OVERRIDES = Object.fromEntries(Object.entries(worldData)
  .filter(([, value]) => typeof value.name === 'string' && /[\u3400-\u9fff]/u.test(value.name))
  .map(([id, value]) => [id, value.name]));

// Exact display text only. These never apply to map filenames or bitmap names.
export const MAP_TITLE_OVERRIDES = {
  'Prontera': '普隆德拉',
  'Prontera Field': '普隆德拉区域',
  'Prontera Castle': '普隆德拉城堡',
  'Prontera Royal Palace': '普隆德拉王宫',
  'Prontera East Library': '普隆德拉东部图书馆',
  'Rune-Midgarts': '卢恩米德加兹',
  'Rune-Midgarts Kingdom': '卢恩米德加兹王国',
  'Geffen': '吉芬',
  'Geffen Field': '吉芬区域',
  'Payon': '斐扬',
  'Payon Archer Village': '斐扬弓箭手村',
  'Morroc': '梦罗克',
  'Sograt Desert': '苏克拉特沙漠',
  'Alberta': '艾尔贝塔',
  'Izlude': '依斯鲁得',
  'Baylan Island': '海底洞穴',
  'Aldebaran': '艾尔帕兰',
  'Clock Tower': '钟楼',
  'Glastheim': '克雷斯特汉姆',
  'Glastheim Castle': '克雷斯特汉姆城堡',
  'Old Glastheim': '旧克雷斯特汉姆',
  'Comodo': '克魔岛',
  'Umbala': '汶巴拉',
  'Niflheim': '尼夫海姆',
  'Yuno': '朱诺',
  'Lutie': '姜饼城',
  'Rachel': '拉赫',
  'Rachel Temple': '拉赫神殿',
  'Gonryun': '昆仑',
  'Moscovia': '莫斯科',
  'Brasilis': '巴西利斯',
  'Dewata': '德瓦塔',
  'Port Malaya': '马来港',
  'Malangdo': '猫岛',
  'Lasagna': '拉萨纳',
  'Port Town Lasagne': '拉萨纳港口',
  'Nameless Island': '无名岛',
  'Thanatos Tower': '达纳托斯塔',
  'Thanatos Tower Upper Level': '达纳托斯塔上层',
  'Thanatos Memory': '达纳托斯的记忆',
  'Orc Village': '兽人村',
  'Battleground': '战场',
  'Illusion': '幻影',
};

/** Self-contained because the build embeds this resolver into the native DB. */
export function createLastroMapLocalization(names = MAP_NAME_OVERRIDES, titles = MAP_TITLE_OVERRIDES) {
  const remembered = Object.create(null);
  const normalize = value => String(value ?? '').trim().toLowerCase().replace(/\.(gat|rsw)$/i, '');
  const isChinese = value => typeof value === 'string' && /[\u3400-\u9fff]/u.test(value);
  const title = value => typeof value === 'string' && Object.prototype.hasOwnProperty.call(titles, value.trim())
    ? titles[value.trim()] : value;

  function rememberName(mapname, value) {
    const id = normalize(mapname);
    if (id && isChinese(value)) remembered[id] = value;
    return resolveName(mapname, value);
  }

  function resolveName(mapname, fallback) {
    if (isChinese(fallback)) return fallback;
    const id = normalize(mapname);
    if (id && Object.prototype.hasOwnProperty.call(remembered, id)) return remembered[id];
    if (id && Object.prototype.hasOwnProperty.call(names, id)) return names[id];
    return title(fallback);
  }

  function localizeInfo(mapname, info, tableName) {
    if (!info || typeof info !== 'object') return info;
    const fallback = isChinese(info.displayName) ? info.displayName : isChinese(tableName) ? tableName : info.displayName;
    const displayName = resolveName(mapname, fallback);
    const signName = { ...info.signName };
    if (!isChinese(signName.mainTitle)) signName.mainTitle = resolveName(mapname, isChinese(displayName) ? displayName : signName.mainTitle || displayName);
    signName.subTitle = title(signName.subTitle);
    return { ...info, displayName, signName };
  }

  return { normalize, rememberName, resolveName, localizeInfo };
}

function localizationRegion(source, path) {
  const marker = `//#region ${path}`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const end = source.indexOf('//#endregion', start);
  if (end === -1 || source.lastIndexOf(marker) !== start) throw new Error('anchor:map-localization-region');
  return { start, end, text: source.slice(start, end) };
}

/** Keep RO formatting at the status-tooltip display boundary, not in shared DB data. */
export function setLastroStatusTooltip(node, value) {
  if (node.matches('#WinStats .desc > .hover[data-text]')) {
    value = String(value ?? '')
      .replace(/\\r\\n|\\[rn]|\r\n?/g, '\n')
      .replace(/\^[0-9a-f]{6}/gi, '');
    node.style.whiteSpace = 'pre-line';
    node.style.width = 'max-content';
    node.style.height = 'auto';
    node.style.maxWidth = 'min(420px, calc(100vw - 24px))';
  }
  node.textContent = value;
}

export function patchRuntimeStatusTooltips(source) {
  const region = localizationRegion(source, 'src/UI/GUIComponent.js');
  if (!region) return source;
  if (source.includes('const LastROStatusTooltipText =')) throw new Error('anchor:status-tooltip-duplicate');
  const anchor = 'node.textContent = _DB?.getMessage(msgId, "");';
  const file = ts.createSourceFile('GUIComponent.js', region.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods = [];
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'processDataAttrs') methods.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (methods.length !== 1 || methods[0].parameters.map(node => node.name.getText(file)).join(',') !== 'node'
      || !methods[0].modifiers?.some(node => node.kind === ts.SyntaxKind.StaticKeyword)
      || methods[0].getText(file).split(anchor).length !== 2) throw new Error('anchor:status-tooltip-text');
  const patched = region.text.replace(anchor, 'LastROStatusTooltipText(node, _DB?.getMessage(msgId, ""));');
  return `const LastROStatusTooltipText = (${setLastroStatusTooltip.toString()});\n`
    + source.slice(0, region.start) + patched + source.slice(region.end);
}

function replaceLocalizationAnchor(source, anchor, replacement, label) {
  if (source.split(anchor).length !== 2) throw new Error('anchor:map-localization-' + label);
  return source.replace(anchor, replacement);
}

/** Reapply display translations at each DB lifecycle boundary, never resources. */
export function patchRuntimeMapLocalization(source) {
  const region = localizationRegion(source, 'src/DB/DBManager.js');
  if (!region) return source;
  if (source.includes('const LastROMapLocalization =')) throw new Error('anchor:map-localization-duplicate');
  const file = ts.createSourceFile('DBManager.js', region.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = new Map();
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      const name = node.name.getText(file);
      if (['loadMapTbl', 'updateMapTable', 'getMapName', 'getMapInfo', 'init'].includes(name)) {
        const rows = declarations.get(name) || [];
        rows.push(node);
        declarations.set(name, rows);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const edits = [];
  function replaceBody(name, transform) {
    const matches = declarations.get(name) || [];
    if (matches.length !== 1 || !matches[0].body) throw new Error('anchor:map-localization-' + name);
    const node = matches[0];
    edits.push({ start: node.body.getStart(file), end: node.body.end, text: transform(node.body.getText(file)) });
  }
  replaceBody('init', body => replaceLocalizationAnchor(body,
    '(MapTable[key] || (MapTable[key] = {})).name = val;',
    '(MapTable[key] || (MapTable[key] = {})).name = LastROMapLocalization.rememberName(key, val);', 'mapname-loader'));
  replaceBody('loadMapTbl', body => replaceLocalizationAnchor(body,
    'lua.doStringSync("main()");',
    'lua.doStringSync("main()");\n        if (typeof callback === "function") callback(MapInfo);', 'mapinfo-callback'));
  replaceBody('updateMapTable', body => {
    if (!body.includes('MapTable[key].name = MapInfo[key].displayName')) throw new Error('anchor:map-localization-update');
    return `{
  for (const key of Object.keys(MapInfo)) {
    const previous = MapTable[key] || (MapTable[key] = {});
    const info = LastROMapLocalization.localizeInfo(key, MapInfo[key], previous.name);
    if (info && info.displayName) previous.name = info.displayName;
  }
}`;
  });
  replaceBody('getMapName', body => {
    if (!body.includes('return MapTable[map].name;')) throw new Error('anchor:map-localization-get-name');
    return `{
      if (!mapname) return typeof defaultName === "undefined" ? DB.getMessage(187) : defaultName;
      const map = LastROMapLocalization.normalize(mapname) + ".rsw";
      const name = LastROMapLocalization.resolveName(mapname, MapTable[map]?.name);
      return name || (typeof defaultName === "undefined" ? DB.getMessage(187) : defaultName);
    }`;
  });
  replaceBody('getMapInfo', body => {
    if (!body.includes('return MapInfo[mapname] || null;')) throw new Error('anchor:map-localization-get-info');
    return `{
      const map = LastROMapLocalization.normalize(mapname) + ".rsw";
      return LastROMapLocalization.localizeInfo(map, MapInfo[map] || null, MapTable[map]?.name);
    }`;
  });
  let patched = region.text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) patched = patched.slice(0, edit.start) + edit.text + patched.slice(edit.end);
  return `/* LASTRO Chinese map-name overlay: arrival banners and DB display only. */
const LastROMapLocalization = (${createLastroMapLocalization.toString()})(${JSON.stringify(MAP_NAME_OVERRIDES)}, ${JSON.stringify(MAP_TITLE_OVERRIDES)});
` + source.slice(0, region.start) + patched + source.slice(region.end);
}

/** Fail the build when a later overlay drops a required localization mount. */
export function assertRuntimeLocalizationMount(source, baseline = source) {
  assertRuntimeItemOptionLocalization(source, baseline);
  const hooks = [
    ['src/DB/DBManager.js', 'LastROMapLocalization.rememberName(key, val)', 'map-text-loader'],
    ['src/DB/DBManager.js', 'LastROMapLocalization.localizeInfo(map, MapInfo[map] || null, MapTable[map]?.name)', 'map-info-display'],
    ['src/DB/DBManager.js', 'LastROMapLocalization.resolveName(mapname, MapTable[map]?.name)', 'map-name-display'],
    ['src/DB/DBManager.js', 'if (typeof callback === "function") callback(MapInfo);', 'map-info-loader'],
    ['src/DB/DBManager.js', 'LastROUiMessages.resolveMessage(id, MsgStringTable[id], defaultText)', 'message-display'],
    ['src/DB/DBManager.js', 'LastROUiMessages.loadCsv(data, targetTable', 'message-loader'],
    ['src/DB/DBManager.js', 'LASTRO Chinese skill-name overlay', 'skill-name-loader'],
    ['src/DB/DBManager.js', 'SkillDescription = _json;', 'skill-description-loader'],
    ['src/UI/Components/MapName/MapName.js', '_mapinfo = DB.getMapInfo(mapname.replace(".gat", ".rsw"))', 'arrival-map-info'],
  ];
  for (const [path, hook, label] of hooks) {
    if (!localizationRegion(baseline, path)) continue;
    const region = localizationRegion(source, path);
    if (!region || region.text.split(hook).length !== 2) throw new Error('localization-mount:' + label);
  }
  if (baseline.includes('JobNameTable')) {
    if (source.split('function lastroJobDisplayName(id)').length !== 2
        || !source.includes('lastroJobDisplayName(info.job)')) throw new Error('localization-mount:job-display');
    for (const path of ['src/DB/Jobs/JobNameTable.js', 'src/DB/Jobs/PalNameTable.js', 'src/DB/Jobs/WeaponJobTable.js']) {
      const original = localizationRegion(baseline, path), current = localizationRegion(source, path);
      if (original && (!current || current.text.replaceAll('\r\n', '\n') !== original.text.replaceAll('\r\n', '\n')))
        throw new Error('localization-mount:resource-identifiers');
    }
  }
  const nativeUi = localizationUiText(baseline), patchedUi = localizationUiText(source);
  for (const [from, to] of RUNTIME_TEXT_REPLACEMENTS) {
    if (!nativeUi.includes(from)) continue;
    // Storage's reviewed sort-label overlay replaces the old generic wording.
    const alternative = from === '>Downgrade<' ? '>名称降序<' : '';
    if (patchedUi.includes(from) || (!patchedUi.includes(to) && (!alternative || !patchedUi.includes(alternative))))
      throw new Error('localization-mount:ui-text:' + from);
  }
}

/** Check the actual item-name getter after every overlay, including import/build. */
function assertRuntimeItemOptionLocalization(source, baseline) {
  function itemNameMethod(text) {
    const region = localizationRegion(text, 'src/DB/DBManager.js');
    if (!region) return null;
    const file = ts.createSourceFile('DBManager.js', region.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const matches = [];
    function visit(node) {
      if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'getItemName') matches.push(node);
      ts.forEachChild(node, visit);
    }
    visit(file);
    return matches.length === 1 ? matches[0].getText(file) : null;
  }
  if (!itemNameMethod(baseline)) return;
  const method = itemNameMethod(source);
  try {
    if (!method) throw new Error('missing item-name method');
    // No slot records: only exercise option display, with fixed synthetic data.
    // Running the getter detects an overwritten method even if translated text
    // remains in a comment, unused table or unrelated part of the bundle.
    const checks = runInNewContext(`
      const getPreferredItemDisplayName = info => info.identifiedDisplayName;
      class DB { ${method} }
      DB.getItemInfo = () => ({ identifiedDisplayName: '测试装备', slotCount: 0 });
      const item = { ITID: 1, IsIdentified: true };
      const names = [0, 1, 5].map(count => DB.getItemName({ ...item, Options: Array.from({length: count}, (_, index) => ({index: index + 1})) }));
      const hidden = DB.getItemName({ ...item, Options: [{index: 1}] }, {showItemOptions: false});
      const empty = DB.getItemName({ ...item, Options: [{index: 0}] });
      const unknown = DB.getItemName({ ...item, IsIdentified: false, Options: [{index: 1}] });
      JSON.stringify([...names, hidden, empty, unknown]);
    `, {}, { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } });
    const expected = ['测试装备', '测试装备 [1词条]', '测试装备 [5词条]', '测试装备', '测试装备', '测试装备'];
    if (checks !== JSON.stringify(expected)) throw new Error('incorrect item option display');
  } catch {
    throw new Error('localization-mount:item-options-display');
  }
}

function localizationUiText(source) {
  const strings = [];
  // Decode JS literals: serialization may change quote/backslash spelling even
  // when the rendered attribute or label has not changed. Limit the audit to UI
  // regions so localized display words cannot change a data/resource key.
  for (const match of source.matchAll(/\/\/#region src\/UI\/[^\r\n]+\r?\n([\s\S]*?)\/\/#endregion/g)) {
    const file = ts.createSourceFile('localization-ui.js', match[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if (ts.isStringLiteralLike(node) || [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind)) strings.push(node.text);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return strings.join('\n');
}
