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
bot.stop()        // 断开连接
```

域方法在 `start()` 之前调用会抛「bot 未启动」。