# social 社交

IM 社交关系：关注、可能认识的人、气泡详情。

## 关注列表

`bot.social.spotlight(options?)` — 关注/好友关系列表（含推荐与真实网络标记）。

```ts
const page = await bot.social.spotlight({ count: 100 })
// { users: [{ uid, secUid, nickname, avatar?, signature?, uniqueId?, followStatus, followerStatus, raw }], hasMore, maxTime, minTime }
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| count | number | 拉取条数，缺省 100 |
| source | string | 列表来源，缺省 `coldup_full` |

## 可能认识的人

`bot.social.familiar(options?)` — 熟人推荐列表。

```ts
const list = await bot.social.familiar()
// [{ uid, secUid, nickname, ... }]
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| count | number | 条数，缺省 100 |
| cursor | number | 起始游标，缺省 0 |
| recommendType | number | 推荐类型，缺省 22 |

## 关注用户

`bot.social.follow(userId, secUid, options?)` — 关注/取消关注用户（type=0 关注）。

```ts
await bot.social.follow('1447387211504184', secUid)
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| userId | string | 对方数字 uid |
| secUid | string | 对方 sec uid |
| type | number | 0=关注（缺省），1=取消关注 |
| tag | string | 关系标签，缺省 `frienddetail` |

> 响应体为空，仅以 HTTP 状态判定成败。

## 气泡详情

`bot.social.bubble(bubbleId, options?)` — 气泡（会话背景样式）详情，`current` 标记是否为当前使用中。

```ts
const list = await bot.social.bubble(bubbleId)
// [{ id, name, type, source, description?, lightPreview?, darkPreview?, current, raw }]
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| bubbleId | string | 气泡 id（`bubble_id_str`） |
| needCurrent | boolean | 是否附带当前使用标记，缺省 true |