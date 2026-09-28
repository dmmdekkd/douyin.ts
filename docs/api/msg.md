# msg 消息

消息发送与交互。`chatId` 来自事件消息或 `frd.list()` / `grp.list()`。

## 发送消息

`bot.msg.send(chatId, body)` — 统一消息体发送（与收侧同构）。`type` 判别消息类型，载荷字段平铺；媒体字段可直接给输入源（URL / 路径 / base64 / 字节），SDK 自动上传。

```ts
await bot.msg.send(chatId, { type: 'text', text: 'hi' })

// 文本附 @
await bot.msg.send(chatId, { type: 'text', text: '你好', ats: [{ uid: 'uid', nickname: '昵称' }] })

// 文本 @所有人：占位「@所有人 」自动前置（需群主/管理员权限）
await bot.msg.send(chatId, { type: 'text', text: '记得填表', atAll: true })

// 媒体：预上传资产（bot.media.* 返回值）或输入源
await bot.msg.send(chatId, { type: 'image', image: imgAsset })
await bot.msg.send(chatId, { type: 'image', image: 'https://example.com/cat.jpg' })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| body | object | - | 统一消息体；收侧消息对象可直接回传 |

`body.type` 可能值：`text` `image` `video` `audio` `file` `emoji` `link` `share` `userCard` `forward` `card` `location` `groupCard` `chains` `unknown`，各类型载荷见[消息类型](/guide/message)。

`bot.msg.send(chatId, body, opts)` 第三参可选：

| 参数 | 类型 | 说明 |
|------|------|------|
| clientMessageId | string | 客户端消息 id；同会话重复使用被服务端幂等去重 |

::: warning 文件消息兼容性
文件消息的消息类型字段官方未公开，部分客户端版本接收端可能渲染异常（如无法预览）；文本 / 图片 / 视频不受影响。
:::

## 盖楼

接收侧照常解析盖楼消息（`threadId` / `threadShortId` / `isThreadRoot`）；发送不支持——HTTP 通道不认盖楼会话（网关拒 `conversationType=50`）。

```ts
bot.on('message', async msg => {
  if (msg.threadId && msg.text === '+1') {
    await bot.msg.send(msg.chatId, { type: 'text', text: '盖楼上' }) // 仅作普通消息发出
  }
})
```

## 引用回复

`bot.msg.reply(chatId, msg, text)` — 引用回复。消息对象直接来自 `bot.on('message')`，引用元数据自动提取。

```ts
await bot.msg.reply(chatId, msg, '回复内容')

// 引用 + @所有人（需群主/管理员权限）
await bot.msg.reply(chatId, msg, '记得填表', { atAll: true })

// 引用 + @提及
await bot.msg.reply(chatId, msg, '看这条', { ats: [{ uid: 'uid', nickname: '昵称' }] })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| msg | object | - | 收到的消息对象，取引用元数据 |
| text | string | - | 回复文本 |
| opts | object | - | 可选；`{ atAll?, ats? }`，与发送文本 `@所有人` / `@提及` 同形态 |

## 合并转发

`bot.msg.send(chatId, { type: 'forward', nodes })` — 合并转发。`nodes` 里的伪装发送者缺省用自己。

::: warning 协议限制
接收端点开合并转发卡片时按云端记录拉取内容，而云端注册接口仅部署在 App 通道，故卡片无内文，属协议层限制。
:::

```ts
await bot.msg.send(chatId, {
  type: 'forward',
  nodes: [{
    uid: '发送者uid',
    nickname: '昵称',
    text: '内容',
    msgType: 7,    // 7 = 文本
    aweType: 700,
    msgId: '消息serverMessageId',
  }],
})
```

### 载荷 nodes[]

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| uid | string | - | 伪装发送者数字 uid |
| nickname | string | - | 伪装发送者昵称 |
| text | string | - | 节点文本摘要（图片 `[图片]`、视频 `[视频]`） |
| msgType | number | `7` `27` | 7 文本 / 27 图片 |
| aweType | number | `700` `2702` | 700 文本 / 2702 图片 |
| msgId | string | - | 节点消息 id |
| secUid | string | - | 伪装发送者 sec uid |
| createTime | number | - | 节点发送时间（ms） |

## 撤回消息

`bot.msg.recall(chatId, serverMessageId)` — 撤回自己发送的消息。

```ts
const sent = await bot.msg.send(chatId, { type: 'text', text: '稍后撤回' })
if (sent.serverMessageId) await bot.msg.recall(chatId, sent.serverMessageId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| serverMessageId | string | - | `send` 返回的消息 id |

## 编辑消息

`bot.msg.edit(chatId, clientMessageId, body)` — 编辑已发送的消息。**发送不支持**：服务端按「同会话 + 同 cmid」幂等去重，重发仅返回原消息 id，内容不更新；官方编辑走 App 专属通道，此方法仅作兜底。

```ts
const sent = await bot.msg.send(chatId, { type: 'text', text: '旧文案' })
await bot.msg.edit(chatId, sent.clientMessageId!, { type: 'text', text: '新文案' })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| clientMessageId | string | - | 原消息 cmid（`send` / `reply` 返回值） |
| body | object | - | 编辑后的消息体 |

对方端编辑触发 [message:edited](../events/message#消息编辑) 事件（与 `message` 互斥，不新增消息）。

## 表情回应

`bot.msg.react(chatId, serverMessageId, emoji, isSet?)` — 消息表情回应。`emoji` 传抖音键值（如 `'[爱心]'`）或小表情 id（如 `weixiao`，自动解析为键值）；`isSet` 传 `false` 取消。

```ts
await bot.msg.react(chatId, msg.serverMessageId!, '[爱心]')
await bot.msg.react(chatId, msg.serverMessageId!, 'weixiao')
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| serverMessageId | string | - | 消息 id |
| emoji | string | `[爱心]` `weixiao` 等 | 抖音表情键值或小表情 id |
| isSet | boolean | `true` `false` | 缺省 true 设置，false 取消 |

## 标记已读

`bot.msg.read(chatId, msg?)` — 标记已读；`msg` 缺省读到底。

```ts
await bot.msg.read(chatId, msg)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| msg | object | - | 已读到的消息；缺省读到底 |

## 作品分享

`bot.msg.send(chatId, { type: 'share', share })` — 发送作品分享卡片。`itemId` 与 `uid` 须对应真实作品，服务端会基于 `itemId` 拉取作品信息重建卡片内容。

```ts
await bot.msg.send(chatId, {
  type: 'share',
  share: { itemId: '7682712994194722091', uid: '4419689514795870', title: '作品标题', authorName: '作者昵称' },
})
```

### 载荷 share

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| itemId | string | - | 作品 id，须真实（服务端据此拉取作品信息） |
| uid | string | - | 作者数字 uid |
| secUid | string | - | 作者 sec uid，缺省不渲染作者头像/主页跳转 |
| title | string | - | 作品标题，缺省用 itemId |
| authorName | string | - | 作者昵称 |
| coverUrl | string | - | 封面 URL，缺省卡片无封面图 |

## 用户卡片

`bot.msg.send(chatId, { type: 'userCard', user })` — 发送用户卡片。`user` 复用收侧 `UserCard`（`msg.type === 'userCard'` 时读 `msg.user`）直接回发。

```ts
if (msg.type !== 'userCard') return
await bot.msg.send(chatId, { type: 'userCard', user: msg.user })
```

### 载荷 user

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| uid | string | - | 用户数字 uid，须真实（服务端据此拉取用户信息） |
| secUid | string | - | 用户 sec uid，缺省不渲染主页跳转 |
| name | string | - | 昵称 |
| avatarUrl | string | - | 头像 URL，缺省卡片无头像 |
| desc | string | - | 个性签名 |
| followerCount | string | - | 粉丝数（字符串） |
| coverItems | string[] | - | 名片展示的作品 itemId 列表 |
| coverUrls | string[] | - | 上述作品的封面 URL 列表，与 coverItems 一一对应 |

## 表情消息

`bot.msg.send(chatId, { type: 'emoji', emoji, text? })` — `emoji` 三形态自动识别，id 对照见 [sticker 的 ID 对照表](/api/sticker#id-对照表-贴纸分区)：

| emoji 传参 | 发送形态 |
|------------|----------|
| 小表情 id（如 `weixiao`） | 键值文本 `[微笑]`（messageType=7，官方小表情即文本形态） |
| `im-resource` 资源 id | lite_emoji（messageType=5，自动解析签名直链） |
| 完整 CDN 直链 | lite_emoji 原样发送 |

```ts
await bot.msg.send(chatId, { type: 'emoji', emoji: 'weixiao' })
await bot.msg.send(chatId, { type: 'emoji', emoji: '1687263281313-ts-e7bbade781abe88ab12e706e67', text: '续火花' })
```

::: warning
lite_emoji 直链必须来自 `im-resource`/`im-emoticon` 域（`bot.sticker.trending()`）；`bot.media.emojiList()` 的 tos-cn 域 URL 会被服务端标记 `s:visible` 仅发送者可见。`text` 为贴纸名（display_name，缺省 `[表情]`）。
:::

## 互动卡

`bot.msg.send(chatId, { type: 'card', card })` — 互动卡（messageType=110）。`card` 复用收侧载荷（`msg.type === 'card'` 时读 `msg.card`）原样回传。

::: warning 协议限制
发送仅自身可见：服务端不向群成员广播，仅回显给发送者。
:::

```ts
if (msg.type !== 'card') return
await bot.msg.send(chatId, { type: 'card', card: msg.card })
```

## 位置消息

`bot.msg.send(chatId, { type: 'location', location })` — 发送位置消息（POI 定位）。`location` 复用收侧载荷（`msg.type === 'location'` 时读 `msg.location`）原样回传。

::: warning 协议限制
发送仅自身可见：服务端不向群成员广播，仅回显给发送者。
:::

```ts
if (msg.type !== 'location') return
await bot.msg.send(chatId, { type: 'location', location: msg.location })
```

## 群邀请卡

`bot.msg.send(chatId, { type: 'groupCard', groupCard })` — 发送群聊邀请卡：向某会话（群聊 / 私聊）发送「邀请加入某群」卡片。`groupCard` 复用收侧载荷（`msg.type === 'groupCard'` 时读 `msg.groupCard`）原样回发。

```ts
if (msg.type !== 'groupCard') return
await bot.msg.send(chatId, { type: 'groupCard', groupCard: msg.groupCard })
```

### 载荷 groupCard

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| conversationId | string | - | 被邀请群 id，须真实 |
| groupName | string | - | 群名 |
| iconUrl | string | - | 群图标 URL，缺省卡片无图 |
| memberCount | number | - | 群成员数 |
| ownerUid | string | - | 群主 uid |
| ownerSecUid | string | - | 群主 sec uid |
| ownerNickname | string | - | 群主昵称 |
| fromUid | string | - | 邀请人 uid，缺省以发送者身份填充 |
| fromSecUid | string | - | 邀请人 sec uid |
| fromNickname | string | - | 邀请人昵称，缺省用 uid |

## 输入状态

`bot.msg.sendTyping(chatId, typing)` — 上报输入状态，对方端显示「正在输入…」。fire-and-forget，无回执。

```ts
await bot.msg.sendTyping(chatId, true)   // 正在输入
await bot.msg.sendTyping(chatId, false)  // 停止/清除
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| typing | boolean | `true` `false` | true 正在输入 / false 停止 |

## 语音通话

`bot.msg.call(chatId, calleeUid)` — 发起语音通话。**当前未支持**：接口保留签名，直接返回 `statusCode=-1`，不发起网络请求。

```ts
const result = await bot.msg.call(chatId, msg.senderUid)
// statusCode === -1 即未支持
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| calleeUid | string | - | 被叫用户数字 uid |