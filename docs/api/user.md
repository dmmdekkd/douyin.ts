# user 用户

自身资料、在线状态与用户资料查询。

## 自身资料

`bot.user.self()` — 获取自身资料。

```ts
const me = await bot.user.self()
// { uid, nickname, avatar }
```

### 参数

无。

### 返回

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| uid | string | - | 自身数字 uid（与 `bot.id` 一致） |
| nickname | string | - | 昵称 |
| avatar | string | - | 真实头像 URL |

## 对话场景资料

`bot.user.profileScene(secUid)` — 对话场景资料，字段比 `profileOther` 少。

```ts
const p = await bot.user.profileScene(secUid)
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| secUid | string | - | 用户 sec uid |

## 完整资料

`bot.user.profileOther(secUid)` — 完整资料（含地域/年龄等原始字段，在 `raw`）。

```ts
const p = await bot.user.profileOther(secUid)
// { uid, secUid, nickname?, signature?, avatar?, uniqueId?, followingCount?, followerCount?, followStatus?, followerStatus?, raw }
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| secUid | string | - | 用户 sec uid |

## 在线状态

`bot.user.onlineStatus(secUserIds, source?)` — 批量查询秒级在线状态，`lastActiveTime` 为 0 表示不在线。

```ts
const status = await bot.user.onlineStatus([secUid])
// [{ secUserId, lastActiveTime }]
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| secUserIds | string[] | - | sec uid 列表 |
| source | string | - | 查询来源，缺省 heartbeat |

## 心跳上报

`bot.user.heartbeat()` — im 活跃心跳，登录后打一次即可。

```ts
await bot.user.heartbeat()
```

## 在线状态开关

`bot.user.activeSwitch()` — 在线状态开关，返回 `1` 表示开启，我可被对方看到在线。

```ts
const on = await bot.user.activeSwitch()
```