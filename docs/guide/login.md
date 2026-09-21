# 登录

`login()` 完成扫码登录全流程：设备注册 → 取码 → 轮询 → 本地安全验证 / 二次验证 → 会话。SDK 不落盘任何东西，返回的 session 由调用方存储。

```ts
import { login } from 'douyin.ts'

const session = await login({
  onQr: qr => renderQr(qr.url),
  onStatus: s => console.log(s),
  onVerifyUrl: url => open(url),
  onMfa: async info => getcode(info),
})
```

## 选项

| 选项 | 类型 | 说明 |
|------|------|------|
| onQr | `(qr: { url: string; base64?: string }) => void \| Promise<void>` | 取码后回调：`url` 为扫码页 URL，`base64` 为响应自带的二维码图（存在时无需再调转码接口），渲染权归调用方 |
| onStatus | `(s: string) => void \| Promise<void>` | 扫码状态：`new` / `scanned` / `verifying` / `confirmed` 等，含服务端中文提示文案 |
| onVerifyUrl | `(url: string) => void` | 需本地安全验证（滑块等）时回调验证页地址，浏览器打开完成验证后流程自动继续 |
| onMfa | `(info: MfaInfo) => string \| Promise<string>` | 触发二次验证时回调，返回短信验证码或账号密码；未提供则登录失败 |
| userAgent | `string` | 自定义 UA，默认桌面 UA |
| log | `Log` | 自定义日志 |

`MfaInfo`：`kind` 为 `sms`（附 `maskedMobile` 掩码手机号）或 `password`。

## 返回值 Session

```ts
interface Session {
  userId: string      // 数字 uid，frontier 握手与消息过滤需要
  cookie: string      // 登录 Cookie，后续 new Bot 用
  userData?: {        // 扫码账号资料（昵称 / 头像 / 掩码手机号等）
    user_id_str?: string
    screen_name?: string
    avatar_url?: string
    mobile?: string
    // ...
  }
}
```

存储自理——比如本地文件：

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const cache = 'session.json'
const session = existsSync(cache)
  ? JSON.parse(readFileSync(cache, 'utf8'))
  : await login({ /* ... */ })
if (!existsSync(cache)) writeFileSync(cache, JSON.stringify(session))
```

下次直接 `new Bot(session)` 免扫码。Cookie 失效时重新走 `login()`。

## 复用已有登录态

已有浏览器登录 Cookie 时跳过 `login()`，直接构建（userId 省略时 `start()` 自动获取）：

```ts
const bot = new Bot({ cookie: '粘贴浏览器 Cookie' })
```
