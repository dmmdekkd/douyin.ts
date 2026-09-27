# 登录

`login()` 完成扫码登录：设备注册 → 取码 → 轮询 → 验证 → 返回 session。SDK 不落盘，session 由调用方存储。

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
| onQr | `(qr: { url, base64? }) => void` | 取码回调，渲染权归调用方 |
| onStatus | `(s: string) => void` | 扫码状态（new / scanned / verified 等） |
| onVerifyUrl | `(url: string) => void` | 需本地安全验证（滑块等）时回调验证页地址 |
| onMfa | `(info: MfaInfo) => string \| Promise<string>` | 二次验证，返回短信验证码或密码 |
| userAgent | `string` | 自定义 UA |
| log | `Log` | 自定义日志 |

`MfaInfo.kind`：`sms`（附 `maskedMobile`）或 `password`。

## Session

```ts
{
  userId: string,   // 数字 uid
  cookie: string,   // 登录 Cookie，new Bot 用
  userData?: { user_id_str, screen_name, avatar_url, mobile, ... }
}
```

## 复用登录态

- **已存 session**：`new Bot(JSON.parse(fs.readFileSync('session.json')))`，免扫码。
- **浏览器 Cookie**：`new Bot({ cookie: '粘贴的 Cookie' })`，`userId` 省略时 `start()` 自动获取。