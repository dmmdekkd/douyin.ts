# message

收到新消息（私聊/群聊）时触发。

## 收到消息

`message` — 收到新消息（私聊/群聊），对自身消息不触发。

```ts
bot.on('message', msg => {
  if (msg.text === 'ping') await bot.msg.send(msg.chatId, { type: 'text', text: 'pong' })
})
```

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `text` `image` `video` `audio` `file` `emoji` `link` `share` `userCard` `forward` `card` `location` `groupCard` `chains` `unknown` | 消息类型 |
| text | string | - | 展示文本，一律可读 |
| chatId | string | - | 会话标识，可直接传给 `bot.msg.*` / `bot.grp.*` |
| senderNickname | string | - | 发送者昵称，群昵称优先 |
| senderUid | string | - | 发送者 uid |
| senderSecUid | string | - | 发送者 sec uid |
| conversationId | string | - | 会话 id |
| conversationShortId | string | - | 会话短 id |
| conversationType | number | `1` `2` | 1 私聊 / 2 群聊 |
| ats | object[] | - | @ 提及（`{ uid, nickname? }`） |
| serverMessageId | string | - | 消息 id（撤回/回应定位用） |
| createTime | string | - | 消息时间 |
| indexInConversation | string | - | 会话内游标 |
| threadId | string | - | 盖楼层 id（楼内消息均有） |
| threadShortId | string | - | 盖楼短 id |
| isThreadRoot | boolean | `true` | 盖楼根消息 |
| ext | object | - | f:9 key-values 上下文键 |
| raw | object | - | 原始推送解析结果 |

各 `type` 的载荷字段（图片 `image`、视频 `video`、文件 `file` 等媒体资产形态）见[消息类型](/guide/message)。

未识别的 `messageType` 返回 `unknown` 并保留 `raw`。群系统消息（`messageType=1001`，如「xxx 邀请你加入了群聊」「群聊已被解散」）按 `locale_resources` 模板渲染为 `text`，`{0}`/`{1}` 占位按 `active_users` → `passive_users` 顺序填成员昵称；模板缺失时退回 `unknown`。已识别的系统消息（成员进出、群名/头像变更、群解散等）不发 `message`，另走 [notice](/events/notice)。

## 消息编辑

`message:edited` — 消息被编辑。与 `message` 互斥，对自身编辑也触发，`serverMessageId` 为原消息 id。

```ts
bot.on('message:edited', msg => {
  console.log(`[${msg.chatId}] ${msg.text}（编辑 ${msg.editCount} 次）`)
})
```

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| editCount | number | `≥1` | 编辑次数（编辑重推后携带） |
| editInfo | object | - | 编辑元数据（`{ contentIsEdited, editorUid, editTime }`） |
| orgMsgType | number | - | 编辑前原始消息类型 |
| 其余字段 | - | - | 同[收到消息](#收到消息)，为编辑后全文 |