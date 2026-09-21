# frd 好友

好友列表与申请处理。

## list

```ts
const friends = await bot.frd.list()
// [{ chatId, uid, nickname, ... }]
```

返回项已附 `chatId`，可直接用于发消息。

## requests

好友申请列表；`status` 缺省查待处理。

```ts
const list = await bot.frd.requests() // FriendRequestStatus.PENDING
const all = await bot.frd.requests(FriendRequestStatus.REJECTED)
```

`FriendRequestStatus`：`PENDING = 1` `APPROVED = 2` `REJECTED = 3` `INVALID = 4`。

## approve / reject

```ts
await bot.frd.approve(request.applicantUid)
await bot.frd.reject(request.applicantUid)
```
