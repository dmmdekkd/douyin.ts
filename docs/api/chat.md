# chat 会话

历史消息、会话信息与已读相关。`chatId` 来自事件消息或 `frd.list()` / `grp.list()`。

## 历史消息

`bot.chat.history(chatId, opts?)` — 分页拉取会话历史消息，`cursor` 为上页返回的翻页游标。

```ts
const history = await bot.chat.history(chatId, { count: 20 })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| opts.cursor | number | - | 翻页游标，来自上次返回 |
| opts.count | number | - | 单页条数 |

## 陌生人列表

`bot.chat.strangers()` — 获取陌生人列表（非好友的会话对象）。

```ts
const strangers = await bot.chat.strangers()
```

## 会话详情

`bot.chat.info(chatId)` — 按 chatId 查会话详情（ticket/未读/成员）。

```ts
const conv = await bot.chat.info(chatId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |

## 已读游标

`bot.chat.readIndex(chatId)` — 会话各成员已读游标，`readIndex` 为微秒时间戳量级。

```ts
const rows = await bot.chat.readIndex(chatId)
// [{ uid, readIndex, extra? }]
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |

## 最小同步游标

`bot.chat.minIndex(chatId)` — 会话各成员最小同步游标（增量拉取起点）。

```ts
const rows = await bot.chat.minIndex(chatId)
// [{ uid, minIndex }]
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |

## 消息区间查询

`bot.chat.userMessageStat(req?)` — 按 uid 消息区间查询。HAR 捕获的响应字段全为 0，语义不完整，返回原始结构。

```ts
const stat = await bot.chat.userMessageStat({ startIndex: '...', messageType: '0' })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| req.startIndex | string | - | uid 起始（int64 字符串） |
| req.messageType | string | - | 消息类型过滤 |
| req.endIndex | string | - | uid 结束 |
| req.cursor | string | - | 游标 |
| req.inboxType | number | - | 收件箱类型 |

## 消息回执

`bot.chat.ack(chatId, serverMessageId)` — 客户端消息回执确认。

```ts
await bot.chat.ack(chatId, serverMessageId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| serverMessageId | string | - | 消息 id |

## 陌生人会话

`bot.chat.strangerConversations()` — 陌生人会话列表。实测服务端常限流返回 409，结果 `statusMsg` 会给出原因。

```ts
const res = await bot.chat.strangerConversations()
```

## 标记已读

`bot.chat.readSwitch(chatId, msgs)` — 将一批入站消息标记为已读（会话侧收到已读回执的依据），可一次标记多条。

```ts
bot.on('message', async msg => {
  await bot.chat.readSwitch(msg.chatId, [msg])
})
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| msgs | `BotMessage[]` | - | 收到的消息对象数组（取引用元数据） |

## 删除会话

`bot.chat.delete(chatId)` — 删除会话。响应为空 body，`statusCode` 为 0 即成功。

```ts
await bot.chat.delete(chatId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |

## 会话设置

`bot.chat.setting(chatId, input)` — 会话设置，置顶/免打扰/收藏：`true` 开启、`false` 关闭，未传字段不动。响应回读完整设置。

```ts
const res = await bot.chat.setting(chatId, { setStickOnTop: true })
// { statusCode, statusMsg, setting?: { stickOnTop, mute, favorite, ... } }
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| input.setStickOnTop | boolean | `true` `false` | 会话置顶 |
| input.setMute | boolean | `true` `false` | 免打扰 |
| input.setFavorite | boolean | `true` `false` | 收藏会话 |

## 批量已读游标

`bot.chat.batchReadIndex(chatId)` — 批量查所有成员已读游标。

```ts
const res = await bot.chat.batchReadIndex(chatId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |