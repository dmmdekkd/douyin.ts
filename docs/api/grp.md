# grp 群

群列表、成员、入群申请与群管理。`chatId` 来自事件消息或 `grp.list()`。

## 群列表

`bot.grp.list(options?)` — 获取群列表

| options | 类型 | 默认 | 说明 |
|---------|------|------|------|
| cursor | number | `0` | 起始翻页游标 |
| count | number | `20` | 单页条数 |

```ts
const groups = await bot.grp.list()
// [{ chatId, groupName, memberCount, ... }]
```

## 群成员

`bot.grp.members(chatId)` — 获取群成员列表。

```ts
const members = await bot.grp.members(chatId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |

## 入群申请

`bot.grp.requests(chatId?)` — 入群申请；`chatId` 缺省查全部群。

```ts
const list = await bot.grp.requests()
const one = await bot.grp.requests(chatId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识，缺省查全部群 |

## 通过入群申请

`bot.grp.approve(requestId)` — 同意入群。

```ts
await bot.grp.approve(request.requestId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| requestId | string | - | 入群申请 id（`requests()` 返回项的 `requestId`） |

## 拒绝入群申请

`bot.grp.reject(requestId)` — 拒绝入群。

```ts
await bot.grp.reject(request.requestId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| requestId | string | - | 入群申请 id（`requests()` 返回项的 `requestId`） |

## 修改群名

`bot.grp.rename(chatId, name)` — 修改群名。

```ts
await bot.grp.rename(chatId, '新群名')
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| name | string | - | 新群名 |

## 拉人入群

`bot.grp.addMembers(chatId, uids)` — 添加群成员，成功/失败名单在返回中回读。

```ts
const res = await bot.grp.addMembers(chatId, ['10000', '10001'])
// { statusCode, statusMsg, success?: string[], failed?: string[] }
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| uids | string[] | - | 目标 uid 列表 |

## 移出群成员

`bot.grp.removeMembers(chatId, uids)` — 将成员移出群。

```ts
await bot.grp.removeMembers(chatId, ['10000'])
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |
| uids | string[] | - | 目标 uid 列表 |

## 退出群聊

`bot.grp.leave(chatId)` — 退出群聊。响应为空 body，`statusCode` 为 0 即成功。

```ts
await bot.grp.leave(chatId)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| chatId | string | - | 会话标识 |

## 创建群聊

`bot.grp.create(options)` — 创建群聊。`participantUids` 须含创建者本人，返回创建出的会话（含 `chatId`）。

```ts
const res = await bot.grp.create({
  participantUids: ['10000', '10001'],
  name: '新群',
  description: '群简介',
})
// { statusCode, statusMsg, group?, chatId? }
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| participantUids | string[] | - | 参与成员 uid（含创建者本人） |
| name | string | - | 群名（可选） |
| description | string | - | 群简介（可选） |

## 群分享校验

`bot.grp.verifyShare(input)` — 用群邀请链接换取群邀请凭证 `ticket` 与群资料，无需先有 `chatId`。传链接时自动解析其中的 `secret` 与 `group_id`；返回的 `ticket` 即传入的 `secret`（同值 AAED 串），与 `chat.info()` 下发的 ticket 是两条不同的串。

```ts
const r = await bot.grp.verifyShare({ share: 'https://v.douyin.com/xxx/' })
// 纯 secret 需补群 conversationId 定位会话
const one = await bot.grp.verifyShare({ share: 'AAED...', conversationId: '7683354495350293038' })
// { ticket, conversationId, conversationShortId, name, desc, avatar?, memberCount, ownerUid?, ownerSecUid?, ownerNickname?, inviterUid?, inviterSecUid?, auditQuestion? }
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| share | string | - | 邀请链接或链接中的 secret（AAED 前缀） |
| conversationId | string | - | 群 conversationId；链接自带 group_id 时可省略（可选） |
| scene | number | - | 邀请卡场景 `invite_card_scene`，缺省 0（可选） |