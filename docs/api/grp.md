# grp 群

群列表、成员、入群申请、群名。

## list

```ts
const groups = await bot.grp.list()
// [{ chatId, groupName, memberCount, ... }]
```

返回项已附 `chatId`。

## members

```ts
const members = await bot.grp.members(chatId)
```

## requests

入群申请；`chatId` 缺省查全部群。

```ts
const list = await bot.grp.requests()
const one = await bot.grp.requests(chatId)
```

## approve / reject

```ts
await bot.grp.approve(request.requestId)
await bot.grp.reject(request.requestId)
```

## rename

```ts
await bot.grp.rename(chatId, '新群名')
```
