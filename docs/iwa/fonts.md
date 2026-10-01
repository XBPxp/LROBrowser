# 默认字体

客户端仍优先使用系统 Arial 和 Windows 微软雅黑，跨平台中文后备统一为 MiSans。字体顺序为 `Arial, 'Microsoft YaHei', 'MiSans', 'LastRO Glyph Fallback', sans-serif`，保留现有字号、窗口尺寸、聊天字号调节和高 DPI 对话绘制。正文为常规 400，窗口标题为 500，强调文字为 700；不使用伪粗体或 `font-size-adjust` 缩放。

## 一份可变主字体

`public/fonts/MiSans-VF.woff2` 合并承载正文、窗口标题和强调文字的字重，保留完整字符和字重轴，共 29,571 个码点和 29,773 个字形。

MiSans 的原生 Regular、Medium、Bold 坐标分别是 330、380、630，并非现有 CSS 使用的 400、500、700。`misans.css` 的三个 `@font-face` 共享同一个 URL，并用 `font-variation-settings` 描述符映射原始坐标，保持原有字重。浏览器只下载一份主字体。启动仍等待三个真实字重可用，失败时使用系统后备字体。

## 保留罕字和符号

原思源字体比 MiSans 多覆盖 1,846 个码点。它们保留在两个小型 `LastRO Glyph Fallback` 补集中，分别对应原有 500、700 字重；GSUB 闭包额外保留两个码点。没有按当前界面固定文案裁剪字体，因此动态玩家名、聊天和服务器数据不受源码文案集合限制。完整字体并集仍为 31,417 个码点，基础中文 U+4E00–U+9FFF 的 20,976 个字全部保留。

补集保留原字形、水平度量和 hint 程序。卡片收藏等原先明确使用思源的窗口也改用统一字体顺序。

所有字体只通过 `/fonts/` 公开资源路径加载，避免 Vite 重复导出。停用的 `core/System/Font` 副本和五个旧的完整字体文件已删除。字体总大小由 **31,771,380 B（30.30 MiB）** 降至 **12,364,564 B（11.79 MiB）**，节省 **19,406,816 B（18.51 MiB，61.1%）**；许可及说明文件另计。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| MiSans-VF.woff2 | 11,909,340 | eddd9e31a39261880aa91f0f0267325e755aaf4549bff0b6ab3cf675fef0d5c8 |
| LastROGlyphFallback-Medium.woff2 | 226,536 | 54a61ccc7738bd94af2cf7e25ef2f83666e688abb2751b08c31b2d37341d25d7 |
| LastROGlyphFallback-Bold.woff2 | 228,688 | 64be7dcddc4477d05cb4edf276b0f6247ec04bbaf0c3429c6904fedba5929595 |

字体附带的许可文件为 `NOTICE.txt`、`MiSans-LICENSE.pdf` 和 `OFL.txt`。常规构建直接使用这些已提交的字体资源，无需重新转换。

## 手动重新生成

`scripts/prepare-client-fonts.py` 是离线字体转换工具，不参与日常 `prepare:runtime`。需要 Python、`fonttools==4.66.1` 和 `brotli==1.2.0`，输入为 MiSans ZIP 及 Medium、Bold OTF：

```text
python scripts/prepare-client-fonts.py --misans-zip MiSans.zip --source-han-medium SourceHanSansCN-Medium.otf --source-han-bold SourceHanSansCN-Bold.otf --output generated/client-fonts
```

输出包括三份 WOFF2 和补集字体的许可文件。它不访问网络，也不创建安装包。转换工具固定原始字体时间戳；重新生成后应核对字形和覆盖、更新实际文件哈希，再替换公开资源。
