# chat 会话

历史消息与陌生人列表。

## history

```ts
const history = await bot.chat.history(chatId, { count: 20 })
```

| 参数 | 类型 | 说明 |
|------|------|------|
| chatId | `string` | 会话标识 |
| opts.cursor | `number` | 翻页游标，来自上次返回 |
| opts.count | `number` | 单页条数 |

## strangers

```ts
const strangers = await bot.chat.strangers()
```
