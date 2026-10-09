# setting 设置

消息提醒、账号综合设置与合规设置。

## 桌面消息提醒

`bot.setting.desktop()` — 桌面消息提醒开关。

```ts
const s = await bot.setting.desktop()
// { messageAlert, showMessageDetail }
```

### 参数

无。

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| messageAlert | number | 消息提醒开关（1=开） |
| showMessageDetail | number | 显示消息详情开关（服务端字段拼写即 swtich） |

## 账号综合设置

`bot.setting.account()` — 账号综合设置，未建模字段在 `raw` 透传全量。

```ts
const s = await bot.setting.account()
// { chatSet, teenMode, isMinor, settingsVersion?, raw }
```

### 参数

无。

## 合规设置

`bot.setting.compliance()` — 合规/青少年模式设置。

```ts
const c = await bot.setting.compliance()
// { minorControlType, isMinor, teenMode, raw }
```

### 参数

无。