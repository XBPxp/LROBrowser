# 第三方许可证门禁

核查日期：2026-09-25。状态：**本机私有测试不阻塞；再分发许可尚未确认**。

仓库内当前纳入 Git 管理的运行资源位于 `vendor/v2` 和 `vendor/core`。它们历史上来自外部 `ROWeb` 项目，但外部目录已经不属于本项目的开发、测试、构建或发布输入。当前仓库递归查找 LICENSE、LICENCE、COPYING、COPYRIGHT、NOTICE、AUTHORS 及其常见后缀文件，仍需要补充完整的再分发核验材料。

这不等于断言这些文件没有许可，而是当前提供的基线中没有足以完成发布门禁的可核验材料。`Online.js` 内检测到 MIT 与 GPL 文字标记，但尚未验证对应组件、版本、版权声明、完整许可条款以及组合产物的源码提供义务，不能据此批准完整 bundle。

| 类别 | 来源 | 当前证据与状态 |
| --- | --- | --- |
| V2 主 bundle 与 Worker | `vendor/v2/Online.js`、三个 Worker 文件 | 上游版本、完整许可与再分发条件待核验 |
| LastRO 定制模块及资源路径工具 | `vendor/v2/lastro-*.mjs`、`lastro-resource-path.js` | 作者、授权范围与继承许可待核验 |
| 世界地图和怪物数据 | `vendor/core/data/world/*.json` | 数据来源与独立再分发证据待核验 |
| 世界地图图片 | `public/worldmap/` | 220 张图片的下载来源及 SHA-256 记录于 `public/worldmap/sources.json`；独立再分发证据待核验 |
| 游戏 Lua/LUB | `vendor/core/System` 和 `vendor/core/data/luafiles514/lua files` | 覆盖脚本的独立再分发证据待核验 |
| Lua/WASM 运行时 | 尚未进入 Task 7 定位步骤 | 组件、版本、许可证与打包方式均待核验 |
| LastRO Glyph Fallback Medium、Bold | `public/fonts/LastROGlyphFallback-{Medium,Bold}.woff2` | SIL Open Font License 1.1；许可证副本为 `public/fonts/OFL.txt` |
| MiSans VF | `public/fonts/MiSans-VF.woff2` | 版权和许可文件为 `public/fonts/NOTICE.txt`、`public/fonts/MiSans-LICENSE.pdf` |

用户在后续指令中明确允许暂不处理分发许可，继续本机运行和调用。因此 Phase A 的本机私有构建和测试签名不再因许可证据缺失而阻塞。源文件固定保存在仓库的 `vendor/` 目录；`generated`、`dist`、`release` 和本地测试密钥仍是被 Git 忽略的构建或测试产物。此授权不包含公开源码、上传 bundle 或部署。

将来分发前再为上述类别提供或定位可核验的许可证/授权材料，明确覆盖的文件或版本，以及源码提交和签名 bundle 再分发的条件。不得把“可以公开下载”“本地已能运行”或局部库的许可标记视为完整授权。
