# 配置

```ts
import { Bot } from 'douyin.ts'

const bot = new Bot({
  cookie: '登录 Cookie',
  userId: '123456',   // 可选，省略时 start() 自动获取
})
```

## BotOpts

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| cookie | `string` | 必填 | 登录 Cookie |
| userId | `string` | 自动获取 | 自身数字 uid |
| userAgent | `string` | 桌面 UA | 需与 Cookie 所在环境一致 |
| timeout | `number` | `30000` | 请求超时毫秒 |
| device | `Device` | 自动注册 | 已持久化的设备身份，注入后跳过注册 |
| log | `Log` | 内置彩色日志 | 自定义日志 |

## 自定义日志

```ts
import type { Log } from 'douyin.ts'

const log: Log = {
  info: m => console.log(m),
  warn: m => console.warn(m),
  error: m => console.error(m),
}
```

## 生命周期

```ts
await bot.start() // 初始化连接，开始收消息
bot.id            // 自身 uid
bot.device        // 设备身份（start 后可用）
bot.stop()        // 断开连接
```

域方法在 `start()` 之前调用会抛「bot 未启动」。

## 设备身份持久化

`start()` 未注入 `device` 时会现场注册设备；注册失败会回退随机 GUID 哈希，每次启动身份都变，容易触发二次验证。把身份落盘复用即可：

```ts
import fs from 'node:fs'
import { Bot } from 'douyin.ts'

const file = 'device.json'
const device = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined

const bot = new Bot({ cookie: '登录 Cookie', device })
await bot.start()
fs.writeFileSync(file, JSON.stringify(bot.device))
```

`login()` 同样支持注入并回传设备身份（见 [登录](/guide/login)），扫码与复用 Cookie 两条路径可共用同一份 `device.json`。