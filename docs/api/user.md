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

## 用户信息

`bot.user.info(secUids)` — 按 secUid 批量查用户信息（昵称/头像/签名/关系）。

```ts
const list = await bot.user.info([secUid])
// [{ uid, secUid, nickname?, avatar?, signature?, shortId?, uniqueId?, followStatus?, followerStatus?, isBlock?, imActiveness?, raw }]
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| secUids | string[] | - | 用户 sec uid 列表 |

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

## 账号详情

`bot.user.account()` — passport 账号详情（登录态；passport account/info/v2）。

```ts
const a = await bot.user.account()
// { userId, secUserId, name?, screenName?, avatar?, mobile?, email?, gender?, hasPassword?, createTime?, raw }
```

### 参数

无。

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | string | 数字 uid |
| secUserId | string | sec uid |
| name | string | 默认昵称（「用户xxx」） |
| screenName | string | 显示昵称 |
| avatar | string | 头像 URL（passport 为 mosaic 占位图） |
| mobile | string | 绑定手机（未绑为空串） |
| email | string | 绑定邮箱 |
| gender | number | 性别 |
| hasPassword | boolean | 是否设置密码 |
| createTime | number | 注册时间戳 |
| raw | object | 未建模字段原样透传 |

## 令牌心跳

`bot.user.beatToken(scene?)` — passport 令牌心跳，长时间在线时周期调用续杯防掉线（passport token/beat/web）。

```ts
await bot.user.beatToken('boot')
// 之后定时:await bot.user.beatToken('polling')
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| scene | string | `boot`=启动首跳（缺省），`polling`=周期轮询 |

## 我的资料

`bot.user.profileSelf()` — 自己的完整个人资料（profile/self；其他 profile 接口只能查别人的资料）。

```ts
const p = await bot.user.profileSelf()
// { uid, secUid, nickname?, signature?, avatar?, uniqueId?, followingCount?, followerCount?, raw }
```