# frd 好友

好友列表与申请处理。返回项均附 `chatId`，可直接发消息。

## 好友列表

`bot.frd.list()` — 获取全部好友。

```ts
const friends = await bot.frd.list()
// [{ chatId, uid, nickname, ... }]
```

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