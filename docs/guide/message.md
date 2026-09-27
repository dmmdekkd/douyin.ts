# 消息与事件

## chatId

会话标识统一为 `chatId`（`type:shortId:conversationId` 的不透明字符串），来自事件或列表查询，发消息时原样回传。`type`：`1` 私聊、`2` 群聊。

## 事件

```ts
bot.on('message', async msg => {
  if (msg.text === 'ping') await bot.msg.send(msg.chatId, { type: 'text', text: 'pong' })
})
bot.on('notice', n => console.log('通知', n.type))
bot.on('request', r => console.log('申请', r.type))
bot.on('close', () => console.log('连接关闭'))
```

| 事件 | 载荷 | 触发时机 |
|------|------|----------|
| message / message:edited | `BotMessage` | 收到新消息 / 消息被编辑 |
| notice | `NoticeEvent` | 业务通知（撤回/已读/成员增减等） |
| request | `RequestEvent` | 好友/入群申请 |
| voip | `VoipCallEvent` | 语音/视频来电 |
| read | `ReadEvent` | 单聊已读回执 |
| status | `StatusEvent` | 会话状态变更（高频） |
| reconnecting / close | `WsReconnectEvent` / `WsCloseEvent` | 自动重连 / 连接关闭 |

详情见 [事件](/events/message)。`bot.off(event, fn)` 取消监听。

## 消息类型

入站消息 `msg.type` 判别类型，载荷平铺在消息对象上；同一结构传给 `bot.msg.send` 即为发出。

| type | 收 | 发 | 说明 |
|------|----|----|------|
| text | ✓ | ✓ | 文本 |
| image | ✓ | ✓ | 图片 |
| video | ✓ | ✓ | 视频 |
| audio | ✓ | ✗ | 语音 |
| file | ✓ | ✓ | 文件 |
| emoji | ✓ | ✗ | 表情消息 |
| link | ✓ | ✗ | 链接卡片 |
| share | ✓ | ✓ | 作品分享卡片 |
| userCard | ✓ | ✓ | 用户卡片 |
| forward | ✓ | ⚠ | 合并转发 |
| card | ✓ | ⚠ | 互动卡片 |
| location | ✓ | ⚠ | 位置|
| groupCard | ✓ | ✓ | 群邀请卡 |
| unknown | ✓ | ✗ | 未识别类型兜底 |

## 发消息

```ts
await bot.msg.send(chatId, { type: 'text', text: 'hi' })
// 媒体可直接传 URL / 路径 / base64 / 字节，SDK 自动上传
await bot.msg.send(chatId, { type: 'image', image: 'https://example.com/cat.jpg' })

// 引用回复 / 表情回应 / 撤回 / 已读
await bot.msg.reply(chatId, msg, '回复内容')
await bot.msg.react(chatId, msg.serverMessageId!, '[爱心]')
await bot.msg.recall(chatId, sent.serverMessageId)
await bot.msg.read(chatId, msg)
```

## 收件箱查询

```ts
const history = await bot.chat.history(chatId, { count: 20 })
const friends = await bot.frd.list()
const groups = await bot.grp.list()
```

完整签名见 [msg](/api/msg) / [chat](/api/chat) / [grp](/api/grp)。