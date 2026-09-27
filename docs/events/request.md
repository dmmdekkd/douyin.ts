# request

需要处理的申请事件（好友申请 / 入群申请）。事件是**信号**：收到后拉取申请列表，再对列表项执行同意/拒绝。

```ts
bot.on('request', async req => {
  if (req.type === 'friend.request') {
    for (const item of await bot.frd.requests()) {
      await bot.frd.approve(item.uid)
    }
  }
})
```

## 好友申请

`friend.request` — 收到好友申请（cmd508 SendApply 信号）。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `friend.request` | 事件类型 |
| applicantUid | string | - | 申请人 uid |
| fromUid | string | - | 申请链路发起方 uid |
| toUid | string | - | 申请链路接收方 uid |
| content | string | - | 申请留言 |
| ext | object | - | 扩展键值 |
| raw | object | - | 原始推送解析结果 |

处理：`bot.frd.requests()` 拉待处理列表，`bot.frd.approve(uid)` / `bot.frd.reject(uid)` 审核。

## 入群申请

`group.join-request` — 收到入群申请（cmd500 messageType=90001）。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `group.join-request` | 事件类型 |
| conversationId | string | - | 群会话 id |
| conversationShortId | string | - | 群会话短 id |
| conversationType | number | `2` | 群聊 |
| requestId | string | - | 申请 id |
| content | string | - | 申请留言 |
| raw | object | - | 原始推送解析结果 |

处理：`bot.grp.requests()` 拉审核列表，`bot.grp.approve(requestId)` / `bot.grp.reject(requestId)` 审核。