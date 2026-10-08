# frd 好友

好友列表、关注/粉丝关系与申请处理。返回项均附 `chatId`，可直接发消息。

## 好友列表

`bot.frd.list(options?)` — 获取好友列表，缺省自动翻页拉全量。列表取自最近会话中的 P2P 会话；从未产生过会话记录的好友不会出现。

| options | 类型 | 默认 | 说明 |
|---------|------|------|------|
| cursor | number | `0` | 起始翻页游标 |
| count | number | `20` | 单页条数 |

```ts
const friends = await bot.frd.list()
// [{ chatId, uid, nickname, ... }]
```

## 关注 / 粉丝

`bot.frd.follows(options?)` — 关注列表（我关注的人）。

`bot.frd.fans(options?)` — 粉丝列表（关注我的人）。

```ts
const page = await bot.frd.follows()
// RelationPage

// 粉丝翻页：offset + maxTime 都取上页返回值；关注列表翻页只传 offset
const next = await bot.frd.fans({ offset: page.offset, maxTime: page.maxTime })
```

### 参数

| options | 类型 | 默认 | 说明 |
|---------|------|------|------|
| uid | string | 登录账号 | 目标用户 uid，传他人则查他人 |
| secUid | string | - | 目标用户 secUid（与 uid 同时提供） |
| offset | number | `0` | 起始偏移，翻页传上页返回值 |
| maxTime | number | `0` | 粉丝列表时间游标，翻页传上页返回值 |
| count | number | `20` | 单页条数 |

### 返回（RelationPage）

| 字段 | 类型 | 说明 |
|------|------|------|
| users | RelationUser[] | 当页条目 |
| total | number | 列表总数 |
| hasMore | boolean | 是否还有下一页 |
| offset | number | 下一页起始偏移 |
| maxTime? | number | 下一页时间游标（仅粉丝列表） |

### RelationUser

| 字段 | 类型 | 说明 |
|------|------|------|
| uid | string | 用户数字 uid |
| secUid? | string | 用户 secUid |
| nickname | string | 昵称 |
| avatar? | string | 头像 CDN 直链 |
| signature? | string | 个性签名 |
| following | boolean | 我是否关注对方 |
| followed | boolean | 对方是否关注我 |
| followerCount? | number | 对方粉丝数 |

## 互关列表

`bot.frd.mutual(options?)` — 互关列表（`following` 与 `followed` 皆为真）。自动翻页关注列表并过滤，`limit` 控制数量上限，缺省拉全量。

```ts
const mutuals = await bot.frd.mutual({ limit: 50 })
// RelationUser[]
```

### 参数

| options | 类型 | 默认 | 说明 |
|---------|------|------|------|
| limit | number | 不限 | 互关数量上限，拉满即止 |
| uid / secUid / count | | | 同「关注 / 粉丝」 |

## 好友申请列表

`bot.frd.requests(status?)` — 好友申请列表；`status` 缺省查待处理。

```ts
const list = await bot.frd.requests() // FriendRequestStatus.PENDING
const all = await bot.frd.requests(FriendRequestStatus.REJECTED)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| status | `FriendRequestStatus` | `1` `2` `3` `4` | PENDING=1 / APPROVED=2 / REJECTED=3 / INVALID=4，缺省查待处理 |

## 通过好友申请

`bot.frd.approve(uid)` — 同意申请，建立好友关系。

```ts
await bot.frd.approve(request.applicantUid)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| uid | string | - | 申请人数字 uid（`requests()` 返回项的 `applicantUid`） |

## 拒绝好友申请

`bot.frd.reject(uid)` — 拒绝申请。

```ts
await bot.frd.reject(request.applicantUid)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| uid | string | - | 申请人数字 uid（`requests()` 返回项的 `applicantUid`） |
