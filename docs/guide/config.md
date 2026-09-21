# 配置

```ts
import { Bot } from 'douyin.ts'

const bot = new Bot({
  cookie: '登录 Cookie',
  userId: '123456',
})
```

## BotOpts

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| cookie | `string` | 必填 | 登录 Cookie（`login()` 返回或已登录浏览器复制） |
| userId | `string` | 自动获取 | 自身数字 uid；省略时 `start()` 通过自身资料接口获取 |
| userAgent | `string` | 桌面 UA | 请求 UA，需与 Cookie 所属登录环境一致 |
| timeout | `number` | `30000` | 请求超时毫秒 |
| log | `Log` | 内置彩色日志 | 自定义日志实现 |

## 自定义日志

`Log` 接口三个方法，频繁重复日志（重连、心跳）SDK 内部已做抑制：

```ts
import type { Log } from 'douyin.ts'

const log: Log = {
  info: msg => myLogger.info(msg),
  warn: msg => myLogger.warn(msg),
  error: msg => myLogger.error(msg),
}

const bot = new Bot({ cookie, log })
```

`login()` 同样接受 `log` 选项。

## 生命周期

```ts
await bot.start() // 初始化 HTTP + WS，触发 pending 监听绑定
bot.id            // 自身 uid（start 后可用）
bot.stop()        // 断开 WS
```

域方法（`bot.msg` 等）在 `start()` 之前调用会抛出「bot 未启动」。
