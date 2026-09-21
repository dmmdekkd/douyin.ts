# 消息与事件

## chatId

会话标识统一为 `chatId`——`type:shortId:conversationId` 组成的不透明字符串。它来自事件消息或列表查询，发消息时原样回传即可，内部解析细节不承诺稳定：

```ts
bot.on('message', msg => {
  console.log(msg.chatId) // "1:123456:7001234567890"
})
```

`type`：`1` 单聊、`2` 群聊。

## 事件

事件统一 `bot.on(event, fn)`，可在 `start()` 前注册：

```ts
bot.on('message', async msg => {
  // msg: BotMessage — InboundMessage 附 chatId
  if (msg.text === 'ping') await bot.msg.send(msg.chatId, { text: 'pong' })
})
bot.on('notice', n => console.log('通知', n.type))
bot.on('request', r => console.log('申请', r.type))
bot.on('reconnecting', e => console.log('重连中', e.reason))
bot.on('close', () => console.log('连接关闭'))
```

| 事件 | 载荷 | 说明 |
|------|------|------|
| message | `BotMessage` | 入站消息：`chatId` `senderUid` `text` `serverMessageId` `messageType` `reference?` 等 |
| notice | `NoticeEvent` | 通知（进群、撤回提示等非消息事件） |
| request | `RequestEvent` | 好友/入群申请 |
| reconnecting | `WsReconnectEvent` | WS 重连中 |
| close | `WsCloseEvent` | 连接关闭 |

`bot.off(event, fn)` 取消监听。

## 发消息

```ts
// 文本
await bot.msg.send(chatId, { text: 'hi' })

// 发图 + 文字（图片独立成消息，与文本一起提交）
const img = await bot.media.image(data)
await bot.msg.send(chatId, { image: img, text: '看这个' })

// 引用回复：消息对象直接来自 message 事件
await bot.msg.reply(chatId, msg, '引用回复测试')

// 表情回应 / 撤回 / 已读
await bot.msg.react(chatId, msg.serverMessageId!, '[爱心]')
await bot.msg.recall(chatId, sent.serverMessageId)
await bot.msg.read(chatId, msg)
```

完整方法签名见 [msg](/api/msg) 与 [media](/api/media)。

## 收件箱查询

```ts
// 历史消息
const history = await bot.chat.history(chatId, { count: 20 })
// 好友列表（含各自 chatId）
const friends = await bot.frd.list()
```

见 [chat](/api/chat) 与 [frd](/api/frd)。
