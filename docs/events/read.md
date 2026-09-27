# read

单聊已读回执事件。对方读了你的消息后触发。

## 已读回执

`read` — 单聊已读回执（messageType=50013）。仅单聊；群聊已读走 [status](./status)。

```ts
bot.on('read', ({ conversationId, readerUid, messageId, readIndex }) => {
  console.log(`${readerUid} 已读，最新读到消息 ${messageId}，游标 ${readIndex}`)
})
```

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `read` | 事件类型 |
| conversationId | string | - | 会话标识（0:1:uid:uid） |
| readerUid | string | - | 已读方用户数字 uid |
| conShortId | string | - | 会话短 id |
| messageId | string | - | 最新被读消息 id |
| readIndex | string | - | 已读方游标 |