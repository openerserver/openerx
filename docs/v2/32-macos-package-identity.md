# macOS 安装包身份与更新后的系统权限

2026-09-15。

此前本机普通打包默认生成 ad-hoc 签名，其 designated requirement 绑定当前构建的 cdhash。重新打包后该身份可能变化，旧的录屏/辅助功能授权不能证明新版已获授权。Apple 的 [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) 说明了 ad-hoc 身份只匹配特定版本代码的限制。

普通 macOS 打包现在优先使用显式 `OPENERX_MAC_SIGN_IDENTITY`；未指定时，自动选用钥匙串中唯一有效的 Developer ID Application 签名身份。有多个候选时停止并要求显式选择，读取身份失败时停止，不会悄悄退回临时签名。没有有效 Developer ID 的开发机器仍可构建本机临时包。

正式发布或设置 `OPENERX_REQUIRE_SIGNED_MACOS=1` 的打包继续要求显式指定身份；原有正式发布配置、公证和更新清单门禁保持有效。自动选用证书不会导出私钥、修改钥匙串权限或替用户打开 macOS 隐私权限。

```sh
npm run package:v2
OPENERX_REQUIRE_SIGNED_MACOS=1 npm run verify:native-signature --workspace @openerx/desktop
```

已验证的正式证书签名以应用标识及签名证书规则确定身份，不绑定单个 cdhash。应持续使用相同团队与应用标识。首次从临时签名切换到证书签名后，仍需用户在系统设置中为当前应用完成授权；签名验证成功不能替代真实权限检测。

源版本与单次构建标识继续独立记录；本次签名修复用于本地安装包，不开启自动更新服务，不代表完成 Apple 公证或商店发布。
