# 移动端输入区 · 2026-09-16（Asia/Shanghai）

openerx、UWA v3 及 UWA legacy 任务输入框使用相同的 `ComposerInput`：空白时为一行，按 iOS／Android 原生 `onContentSizeChange` 测量自动增高，最多显示六行，超出后框内滚动。删减文字后按内容缩小，发送清空后立即恢复一行；会话切换按草稿 key 重建输入框，避免沿用其他会话的高度。计算包含字体缩放、内边距和边框，Android 禁用额外字体 padding。

UWA 工具栏的模型选择只保留图标；完整模型名留在选择面板和无障碍标签中，模型不可用时仍显示可操作的提示。任务未运行时隐藏原来的“继续”发送方式入口，箭头直接发送；运行中保留调整／排队和停止操作。

验证：

- 两版 `npm run typecheck --workspace @openerx/mobile` 通过。
- UWA `npm run test:ui --workspace @openerx/mobile`：92 项通过。包含 iOS／Android 条件下的一行起步、聚焦不扩高、换行增高、六行上限滚动、删除缩回、发送回执清空，以及模型仅图标和空闲发送方式隐藏。
- 两版 `npm run build --workspace @openerx/mobile` 均完成 iOS 与 Android Expo/Hermes 导出，使用各自固定 `apps/mobile/dist/ios` 与 `dist/android` 目录。
- 两版 `ComposerInput.tsx` 内容一致，工作区差异检查通过。

界面测试使用原生组件的 DOM 替身及测量事件，不代替真机键盘与布局验收。本轮未安装或替换手机安装包，未改动桌面／服务端实现，也未更改桌面一致性基线。
