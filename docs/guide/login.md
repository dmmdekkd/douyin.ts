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
| onVerifyWays | `(ways: VerifyWay[]) => string \| undefined` | 二次验证方式拉取，返回要使用的方式名；缺省按内置优先级 |
| userAgent | `string` | 自定义 UA |
| log | `Log` | 自定义日志 |

`MfaInfo.kind`：`sms`（附 `maskedMobile`）或 `password`。

### 二次验证方式

触发二次验证时 `onVerifyWays` 回调服务端全部可用方式（`VerifyWay[]`），返回想用的 `verify_way` 名称即按其执行；返回 `undefined`（或不提供回调）走内置优先级：安全手机短信 > 绑定手机短信 > 上行短信 > 登录密码。

| verify_way | 说明 |
|------------|------|
| `assist_mobile_sms_verify` | 安全手机短信验证码（`mobile` 为脱敏号码） |
| `mobile_sms_verify` | 绑定手机短信验证码 |
| `assist_mobile_up_sms_verify` | 上行短信：用安全手机发指定短信（`sms_content` → `channel_mobile`），免输入 |
| `pwd_verify` | 登录密码验证 |

每个可用方式的字段（`VerifyWay`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| verify_way | `string` | 方式名，即上表取值 |
| mobile | `string` | 脱敏手机号（短信类方式用于展示） |
| sms_content | `string` | 上行短信内容 |
| channel_mobile | `string` | 上行短信接收号码 |

选择免输入的上行短信可避开 `onMfa` 交互：

```ts
const session = await login({
  onVerifyWays: ways => {
    // 展示给用户选择,或固定挑一种
    return ways.find(w => w.verify_way === 'assist_mobile_up_sms_verify')?.verify_way
  },
})
```

## Session

```ts
{
  userId: string,   // 数字 uid
  cookie: string,   // 登录 Cookie，new Bot 用
  userData?: { user_id_str, screen_name, avatar_url, mobile, ... }
  device?: { deviceId, installId, guid }   // 本次登录使用的设备身份
}
```

## 复用登录态

- **已存 session**：`new Bot(JSON.parse(fs.readFileSync('session.json')))`，免扫码。
- **浏览器 Cookie**：`new Bot({ cookie: '粘贴的 Cookie' })`，`userId` 省略时 `start()` 自动获取。

`login()` 与 `Bot` 都支持注入设备身份：把 `session.device` 落盘，下次 `login({ device })` / `new Bot({ cookie, device })` 传入即可复用同一设备，避免每次登录/启动重新注册触发二次验证。

```ts
import fs from 'node:fs'
import { login } from 'douyin.ts'

const file = 'device.json'
const device = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined
const session = await login({ onQr: qr => console.log(qr.url), device })
if (session.device) fs.writeFileSync(file, JSON.stringify(session.device))
```