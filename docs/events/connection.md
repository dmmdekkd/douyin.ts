# connection

长连接状态事件。SDK 内置指数退避自动重连，正常无需干预；`close` 通常意味着登录态失效或网络长时间不可用。

```ts
bot.on('reconnecting', ({ attempt, delayMs }) => {
  console.log(`第 ${attempt} 次重连，${delayMs}ms 后重试`)
})

bot.on('close', ({ code }) => {
  console.log(`连接已关闭 (${code})，建议重新扫码登录`)
})
```

## 重连中

`reconnecting` — 长连接断开，每次重连尝试前触发。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| attempt | number | - | 第几次重试 |
| delayMs | number | - | 本次等待毫秒 |
| code | number | - | 断开状态码 |
| reason | string | - | 断开原因 |

## 连接关闭

`close` — 长连接关闭，SDK 不再自动重连。可提示重新扫码，或调 `bot.start()` 重新拉起（登录态仍有效时）。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| code | number | - | 断开状态码 |
| reason | string | - | 断开原因 |