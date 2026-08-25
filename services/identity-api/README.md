# Identity API

个人账户、邮箱验证码、设备会话和设备撤销服务边界。

M2 Account Alpha 提供 SQLite 参考实现：验证码单次使用、设备凭证轮换、旧凭证重放撤销、
短期 Access Token 和账户级设备撤销。验证码投递由 `ChallengeMailer` 注入，服务本身不会把
验证码写入响应或日志。
