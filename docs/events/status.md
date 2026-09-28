# status

会话状态变更事件（红点计数 / 已读游标 / 群属性变更）。**高频**，订阅后注意过滤。

## 会话状态变更

`status` — 会话状态变更（messageType=50001，自发也下发）。`commandType` 判定：`1` 红点更新 / `14` 已读同步 / `2` 消息删除 / `6` 群属性变更（群名、群头像）/ `7` 群成员变更（增删 / 角色 / 群主 / 群昵称）。

```ts
bot.on('status', ({ conversationId, commandType, unread, nameChange, memberChange }) => {
  if (unread > 0) console.log(`${conversationId} 有 ${unread} 条未读`)
  if (nameChange) console.log(`${conversationId} 群名变更为「${nameChange.name}」`)
  if (memberChange) console.log(`${conversationId} 群成员变更`, memberChange)
})
```

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `status` | 事件类型 |
| conversationId | string | - | 会话标识 |
| conversationType | number | `1` `2` | 1 私聊 / 2 群 |
| commandType | number | `1` `14` `2` `6` `7` | 1 红点 / 14 已读 / 2 删除 / 6 属性变更 / 7 成员变更 |
| unread | number | - | 未读计数（commandType=1/14 携带） |
| readIndex | string | - | 已读游标 |
| messageId | string | - | 被删消息 id（commandType=2 携带） |
| nameChange | object | - | 群名变更（commandType=6 且判定键命中，`{ name, operatorUid }`） |
| avatarChange | object | - | 群头像变更（commandType=6 且判定键命中，`{ icon, operatorUid }`） |
| memberChange | object | - | 群成员变更（commandType=7，见下） |
| extData | object[] | - | 会话属性变更项（如 a:chat_theme） |
| raw | object | - | 原始 content |

### memberChange

commandType=7（群成员变更）时携带：

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| added | string[] | - | 新增成员 uid |
| removed | string[] | - | 移除成员 uid |
| updated | object[] | - | 角色/资料变更（`{ uid, role, secUid?, alias? }`，role 0 普通 / 1 群主 / 2 管理员） |
| oldOwnerId | string | - | 变更前群主（仅群主移交帧与 newOwnerId 成对带出） |
| newOwnerId | string | - | 变更后群主（newOwnerId 非 0 即群主移交） |

`updated[].alias` 本帧下发即表示群昵称被变更：有值为新昵称、空串为昵称被清空；未下发则本帧未涉及昵称。`added`/`removed` 均空而 `updated` 非空即纯成员资料（如群昵称）变更。

```ts
bot.on('status', ({ memberChange }) => {
  for (const u of memberChange?.updated ?? []) {
    if (u.alias != null) console.log(`${u.uid} 群昵称改为「${u.alias}」`)  // 空串即已清空
  }
})
```

成员增删另有 [notice](./notice) 的「群成员加入 / 群成员退出」（带昵称与操作者）。