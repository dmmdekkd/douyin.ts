# msg 消息

消息发送与交互。`chatId` 来自事件消息或 `frd.list()` / `grp.list()`。

## send

发送文本或富媒体（含媒体时媒体走独立消息，文本一起提交）。

```ts
await bot.msg.send(chatId, { text: 'hi' })

const img = await bot.media.image(data)
await bot.msg.send(chatId, { image: img, text: '看这个' })

await bot.msg.send(chatId, {
  text: '你好 @某人',
  mentions: [{ uid: '对方uid', displayName: '@某人' }],
})
```

`SendContent`：

| 字段 | 类型 | 说明 |
|------|------|------|
| text | `string` | 文本 |
| image | `ImageAsset` | `media.image()` 返回值 |
| video | `{ asset, poster, width, height }` | `media.video()` 返回值 + 封面 |
| file | `FileAssetPayload` | `media.file()` 返回值 |
| mentions | `TextMention[]` | @ 提及 |

## reply

引用回复。消息对象直接来自 `bot.on('message')`，引用元数据自动提取。

```ts
await bot.msg.reply(chatId, msg, '回复内容')
```

## media

富媒体独立消息（不携带文本）。

```ts
await bot.msg.media(chatId, { image: img })
```

## forward

合并转发。`nodes` 里的伪装发送者缺省用自己。

```ts
await bot.msg.forward(chatId, {
  nodes: [{
    uid: '发送者uid',
    nickname: '昵称',
    text: '内容',
    msgType: 7,       // 7 = 文本
    aweType: 700,
    msgId: String(Date.now() * 1000),
  }],
})
```

## recall

撤回自己发送的消息。

```ts
const sent = await bot.msg.send(chatId, { text: '稍后撤回' })
if (sent.serverMessageId) await bot.msg.recall(chatId, sent.serverMessageId)
```

## react

表情回应。`emoji` 为抖音键值（如 `'[爱心]'`）；`isSet` 传 `false` 取消。

```ts
await bot.msg.react(chatId, msg.serverMessageId!, '[爱心]')
```

## read

标记已读；`msg` 缺省读到底。

```ts
await bot.msg.read(chatId, msg)
```
