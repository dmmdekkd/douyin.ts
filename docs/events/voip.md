# voip

语音/视频来电事件。仅感知来电，出站拨打未支持。

## 来电

`voip.call` — 收到语音/视频来电（messageType=50018 响铃信令）。区分语音/视频看 `cameraOff`：0=视频 / 1=语音。

```ts
bot.on('voip', ({ callerUid, cameraOff, roomId, callId }) => {
  const kind = cameraOff === 1 ? '语音' : '视频'
  console.log(`来电：${callerUid} ${kind} room=${roomId} callId=${callId}`)
})
```

### 事件数据

| 字段 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| type | string | `voip.call` | 事件类型 |
| conversationId | string | - | 会话标识（私聊 threadId） |
| conversationType | number | `1` `2` | 1 私聊 / 2 群聊 |
| callerUid | string | - | 主叫用户数字 uid |
| callId | string | - | 通话 id |
| roomId | string | - | RTC 房间 id（通话唯一标识） |
| voipType | number | `1` | 1v1 通话形态 |
| callType | number | - | 呼叫类型 |
| cameraOff | number | `0` `1` | 0 视频 / 1 语音 |
| callInfo | object | - | 原始 call_info（含 RTC 入会参数 `live_core_param`） |