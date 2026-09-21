# user 用户

## self

```ts
const me = await bot.user.self()
// { uid, nickname, avatar }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| uid | `string` | 自身数字 uid（与 `bot.id` 一致） |
| nickname | `string` | 昵称 |
| avatar | `string` | 真实头像 URL |
