# 移动端输入区 · 2026-09-16（Asia/Shanghai）

openerx、UWA v3 及 UWA legacy 任务输入框使用相同的 `ComposerInput`：空白时为一行，按 iOS／Android 原生 `onContentSizeChange` 测量自动增高，最多显示六行，超出后框内滚动。删减文字后按内容缩小，发送清空后立即恢复一行；会话切换按草稿 key 重建输入框，避免沿用其他会话的高度。计算包含字体缩放、内边距和边框，Android 禁用额外字体 padding。

UWA 工具栏的模型选择只保留图标；完整模型名留在选择面板和无障碍标签中，模型不可用时仍显示可操作的提示。任务未运行时隐藏原来的“继续”发送方式入口，箭头直接发送；运行中保留调整／排队和停止操作。

验证：

- 两版 `npm run typecheck --workspace @openerx/mobile` 通过。
- UWA `npm run test:ui --workspace @openerx/mobile`：92 项通过。包含 iOS／Android 条件下的一行起步、聚焦不扩高、换行增高、六行上限滚动、删除缩回、发送回执清空，以及模型仅图标和空闲发送方式隐藏。
- 两版 `npm run build --workspace @openerx/mobile` 均完成 iOS 与 Android Expo/Hermes 导出，使用各自固定 `apps/mobile/dist/ios` 与 `dist/android` 目录。
- 两版 `ComposerInput.tsx` 内容一致，工作区差异检查通过。

界面测试使用原生组件的 DOM 替身及测量事件，不代替真机键盘与布局验收。本轮未安装或替换手机安装包，未改动桌面／服务端实现，也未更改桌面一致性基线。

## 后续调整：输入框与按钮同排

openerx、UWA v3 和 legacy 的输入框与操作按钮改为同排、底部对齐。输入框占据剩余宽度并保持原有的自动增高；按钮使用 44 × 44 的图标点击区域，保留无障碍名称。UWA 运行中发送方式使用图标打开原有模式面板；legacy 的图片、文件选择收进同排的附件按钮。

本次重新执行两版移动端类型检查和 UWA 全部 92 项界面测试，均通过。使用已安装 React Native 的 Yoga 原生布局引擎，读取本次源码样式验证 320、360、375、390、393、430、768 宽度、1／1.5／2 倍字体和 1／3／6 行内容、不同按钮数量，共 441 个布局组合，未发现重叠或溢出，按钮底部对齐。最窄输入框分别为 UWA 66、openerx 104、legacy 76 点；这些是几何检查，不是手机键盘视觉验收。检查脚本与结果保存在 `.codex-temp/mobile-composer-inline/`。

此次布局调整未重新导出或安装手机包；上文 Expo 导出结果属于此前的一行自增高改动。
