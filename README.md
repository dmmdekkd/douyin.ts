# douyin.ts

抖音 IM 开发 SDK。TypeScript 7 · 纯 ESM。

支持：扫码登录、收消息（WS 推送）、发消息（HTTP 通道）、媒体上传、好友/群管理

## 安装

```bash
pnpm add douyin.ts
```

## 快速开始

```ts
import { login, Bot } from 'douyin.ts'

// 扫码登录：QR 串交给调用方渲染，二次验证通过回调交付
const session = await login({
  onQr: qr => renderQr(qr.url),          // QR 串（含扫码页 URL 与 base64 图），渲染归你
  onStatus: s => console.log(s),          // new / scanned / verifying / confirmed...
  onVerifyUrl: url => open(url),          // 滑块等本地安全验证页
  onMfa: async info => getcode(info),     // 短信/密码二次验证输入
})
// session: { userId, cookie, userData? } — 自行保存，下次直接创建 Bot

const bot = new Bot(session)              // 已有登录 Cookie 时也可 new Bot({ cookie })

bot.on('message', async msg => {
  if (msg.text === 'hi') await bot.msg.send(msg.chatId, { text: 'hello' })
})

await bot.start()
```

## API（统一 `bot.域.动作`）

| 域 | 动作 | 说明 |
|----|------|------|
| msg | send / reply / media / forward / recall / react / read | 发消息、引用回复、富媒体、合并转发、撤回、表情回应、已读 |
| media | image / video / file | 媒体上传 |
| frd | list / requests / approve / reject | 好友列表与申请处理 |
| grp | list / members / requests / approve / reject / rename | 群列表、成员、入群申请、群名 |
| chat | history / strangers | 历史消息、陌生人列表 |
| user | self | 自身资料 |

事件：`message` `notice` `request` `reconnecting` `close`

```ts
// 发文本
await bot.msg.send(chatId, { text: 'hi' })
// 发图 + 文字
const img = await bot.media.image(data)
await bot.msg.send(chatId, { image: img, text: '看这个' })
// 撤回
await bot.msg.recall(chatId, msgId)
```

## 配置

```ts
new Bot({
  cookie: string          // 登录 Cookie（login 返回或已登录浏览器复制）
  userId?: string         // 自身数字 uid，省略自动获取
  userAgent?: string      // 默认桌面 UA
  timeout?: number        // 请求超时毫秒，默认 30000
  log?: Log               // 自定义日志，默认内置彩色日志
})
```
