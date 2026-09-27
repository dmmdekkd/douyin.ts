# notice

业务通知事件（撤回/已读/成员增减/表情回应等）。好友与入群申请分流到 [request](./request)。

```ts
bot.on('notice', n => {
  if (n.type === 'message.recall') {
    console.log(`[${n.conversationId}] 消息被撤回`)
  }
})
```

所有事件 `type` 为字面量联合，TypeScript 自动收窄分支；`raw` 保留原始推送解析结果。

## 消息表情回应

`message.reaction` — 消息表情回应（添加/移除）。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `message.reaction` | 事件类型 |
| conversationId | string | - | 会话 id |
| serverMessageId | string | - | 消息 id |
| emoji | string | `[爱心]` 等 | 抖音表情键值 |
| operatorUid | string | - | 表态者 uid |
| isSet | boolean | `true` `false` | true 添加 / false 移除 |
| raw | object | - | 原始推送解析结果 |

## 消息撤回

`message.recall` — 消息被撤回。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `message.recall` | 事件类型 |
| conversationId | string | - | 会话 id |
| conversationType | number | `1` `2` | 1 私聊 / 2 群聊 |
| serverMessageId | string | - | 被撤回消息 id |
| targetClientMessageId | string | - | 被撤回消息客户端 id |
| recallUid | string | - | 撤回操作者 uid |
| recallRole | number | `1` | 撤回者身份 |
| ext | object | - | 原始推送 ext（撤回辅助信息） |
| raw | object | - | 原始推送解析结果 |

## 会话已读

`conversation.read` — 会话已被读。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `conversation.read` | 事件类型 |
| conversationId | string | - | 会话 id |
| conversationType | number | `1` `2` | 1 私聊 / 2 群聊 |
| readMessageIndex | string | - | 已读消息游标 |
| readMessageIndexV2 | string | - | 已读消息游标（v2） |
| raw | object | - | 原始推送解析结果 |

## 输入状态

`conversation.typing` — 对方正在输入（周期性上报）。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `conversation.typing` | 事件类型 |
| conversationId | string | - | 会话 id |
| peerUid | string | - | 双人对话对端 uid |
| peerSecUid | string | - | 对端 sec uid |
| senderUid | string | - | 正在输入的成员 uid |
| typing | boolean | `true` `false` | true 正在输入 / false 已停止 |
| raw | object | - | 原始推送解析结果 |

## 会话信息更新

`conversation.update` — 会话信息更新。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `conversation.update` | 事件类型 |
| conversationId | string | - | 会话 id |
| conversationType | number | `1` `2` | 1 私聊 / 2 群聊 |
| raw | object | - | 原始推送解析结果 |

## 会话删除

`conversation.delete` — 会话被删除。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `conversation.delete` | 事件类型 |
| conversationId | string | - | 会话 id |
| conversationType | number | `1` `2` | 1 私聊 / 2 群聊 |
| raw | object | - | 原始推送解析结果 |

## 好友关系建立

`friend.increase` — 好友关系建立。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `friend.increase` | 事件类型 |
| peerUid | string | - | 新好友 uid |
| fromUid | string | - | 申请链路发起方 uid |
| toUid | string | - | 申请链路接收方 uid |
| content | string | - | 申请留言 |
| ext | object | - | 扩展键值 |
| raw | object | - | 原始推送解析结果 |

## 好友关系解除

`friend.decrease` — 好友关系解除。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `friend.decrease` | 事件类型 |
| peerUid | string | - | 解除好友 uid |
| fromUid | string | - | 申请链路发起方 uid |
| toUid | string | - | 申请链路接收方 uid |
| content | string | - | 申请留言 |
| ext | object | - | 扩展键值 |
| raw | object | - | 原始推送解析结果 |

## 群成员加入

`group.member-increase` — 群成员加入。一条消息可包含多个成员。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `group.member-increase` | 事件类型 |
| conversationId | string | - | 群会话 id |
| conversationShortId | string | - | 群会话短 id |
| conversationType | number | `2` | 群聊 |
| source | string | `invite` `command` `qrcode` `duoshan` `apply` `search` `activity` `face-to-face` `circle` `rejoin` | 加入方式（rejoin 为被移出后重新入群） |
| members | NoticeUser[] | - | 加入的成员（`{ uid, secUid?, nickname? }`） |
| operators | NoticeUser[] | - | 操作者 |
| raw | object | - | 原始推送解析结果 |

## 群成员退出

`group.member-decrease` — 群成员退出。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `group.member-decrease` | 事件类型 |
| conversationId | string | - | 群会话 id |
| conversationShortId | string | - | 群会话短 id |
| conversationType | number | `2` | 群聊 |
| source | string | `kick` `leave` | kick 被踢 / leave 主动退群 |
| members | NoticeUser[] | - | 退出的成员 |
| operators | NoticeUser[] | - | 操作者（踢人者；主动退群为自己） |
| raw | object | - | 原始推送解析结果 |

## 群管理员变更

`group.admin` — 设为群管理员。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `group.admin` | 事件类型 |
| conversationId | string | - | 群会话 id |
| conversationShortId | string | - | 群会话短 id |
| conversationType | number | `2` | 群聊 |
| members | NoticeUser[] | - | 被设为管理员的成员 |
| operators | NoticeUser[] | - | 操作者 |
| enabled | boolean | `true` | 恒为 true（仅设管理员，无取消推送） |
| raw | object | - | 原始推送解析结果 |

## 群名变更

`group.name-change` — 群名变更。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `group.name-change` | 事件类型 |
| conversationId | string | - | 群会话 id |
| conversationShortId | string | - | 群会话短 id |
| conversationType | number | `2` | 群聊 |
| name | string | - | 新群名（取不到时缺省，仍保留通知与 raw） |
| operators | NoticeUser[] | - | 操作者 |
| raw | object | - | 原始推送解析结果 |

## 群头像变更

`group.avatar-change` — 群头像变更。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `group.avatar-change` | 事件类型 |
| conversationId | string | - | 群会话 id |
| conversationShortId | string | - | 群会话短 id |
| conversationType | number | `2` | 群聊 |
| avatar | string | - | 新头像 URL（取不到时缺省，仍保留通知与 raw） |
| operators | NoticeUser[] | - | 操作者 |
| raw | object | - | 原始推送解析结果 |

## 未分类指令

`im.command` — 未分类的 IM 命令推送（兜底）。

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `im.command` | 事件类型 |
| conversationId | string | - | 会话 id |
| conversationType | number | `1` `2` | 1 私聊 / 2 群聊 |
| messageType | number | - | 原始消息类型 |
| content | string | - | 原始内容 |
| raw | object | - | 原始推送解析结果 |