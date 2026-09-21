# CONTEXT

基于抖音 IM 协议的开发 SDK。代码移植自 [karin-plugin-adapter-douyin](D:/there/karin-project/karin-plugin-adapter-douyin) 的 core 协议层，剥离 karin 依赖，重组为独立 SDK。

## 决策记录

| 项 | 决策 |
|----|------|
| 包名 | `douyin.ts` |
| 标准 | TypeScript 7（tsgo），严格模式 |
| 工程 | pnpm + tsdown，纯 ESM，Node.js ≥ 20 |
| 登录 | 扫码全链路作为 API（QR 串 + 轮询 + MFA 二次验证 + 本地安全验证页），QR 串交付渲染权给调用方 |
| 会话 | 不持久化；login 返回 `{ userId, cookie }`，存储由调用方自理 |
| 范围 | 登录 + HTTP 通道 + IM WS 收消息 + 签名 + 媒体上传 |
| 不做 | 账号存储、密码/短信直登（passport-lite 密码表单不做，lite 传输层保留供 MFA 用）、karin 适配层 |
| API | 分组式 `bot.域.动作`，统一两级结构；入口 `new Bot(...)` |
| 依赖 | `ws`、`protobufjs`、`react`/`react-dom`（验证页 UMD）；无 karin / qrcode |

## 来源映射（参考项目 → 本项目）

| 参考 | 本项目 | 说明 |
|------|--------|------|
| core/sign/* | src/sign/* | 签名算法，算法体保持原样，文件名缩短 |
| core/http/* | src/http/* | jar / res / client，剥离 node-karin logger |
| core/auth/qr.ts | src/login.ts | login() 编排：取码 → 轮询 → MFA → 会话 |
| core/auth/device-profile.ts | src/device.ts | 设备注册，去落盘（进程内身份） |
| core/auth/verification.ts | src/verify.ts | 本地安全验证页，logger 换 log.ts |
| core/auth/passport-lite.ts | src/lite.ts | desktop lite Passport 传输层（MFA 依赖） |
| core/auth/bootstrap.ts | src/user.ts | 仅取 fetchSelf（自动获取自身 uid） |
| core/im/protocol/* | src/im/protocol/* | codec / proto / wire / ws 原样移植 |
| core/im/{transport,receiver,notifications,send,inbox,upload,media,content,types} | src/im/* | 文件名缩短 |
| core/im/client.ts | src/bot.ts | 重组为分组式 Bot 门面 |
| resources/verification/*.js、react UMD | assets/ | 验证页静态资源随包发布 |
| adapter/*、apps/*、core/store/* | 不移植 | 超出范围 |

## 目标结构

```
src/
  index.ts      # 导出 Bot / login + 类型
  bot.ts        # Bot 门面：bot.域.动作 + on 事件
  log.ts        # 轻量彩色日志，可注入
  login.ts      # 扫码登录编排（QR/MFA）
  lite.ts       # desktop lite Passport 传输
  device.ts     # 设备注册（进程内身份）
  verify.ts     # 本地安全验证页
  user.ts       # 自身资料（uid 自动解析）
  http/         # jar.ts res.ts client.ts
  sign/         # bogus.ts ac.ts aid.ts mix.ts qs.ts browser.ts source.ts frontier.ts const.ts
  im/           # types.ts content.ts transport.ts recv.ts notice.ts send.ts inbox.ts upload.ts media.ts im.ts
    protocol/   # codec.ts proto.ts wire.ts ws.ts
assets/         # second-verify.js + react UMD（验证页资源）
```

## API 形态

### 登录（顶层函数，回调交付渲染权）

```ts
import { login, Bot } from 'douyin.ts'

const session = await login({
  onQr: qr => render(qr.url),            // QR 串（含 base64 图与扫码页 URL）
  onStatus: s => {},                     // new/scanned/verifying/confirmed...
  onVerifyUrl: url => {},                // 滑块等本地安全验证页地址
  onMfa: async info => '123456',         // 短信/密码二次验证输入
})
const bot = new Bot(session)             // session: { userId, cookie }
```

### Bot（统一 `bot.域.动作`）

```ts
const bot = new Bot({ cookie, userId? })   // userId 省略时自动获取
bot.on('message' | 'notice' | 'request' | 'reconnecting' | 'close', fn)
await bot.start() / bot.stop()

bot.msg.send(chatId, { text | image | ... })  // 统一会话标识 chatId 字符串，内部解析 address
bot.msg.reply() / media() / forward() / recall() / react() / read()
bot.media.image() / video() / file()
bot.frd.list() / requests() / approve() / reject()
bot.grp.list() / members() / requests() / approve() / reject() / rename()
bot.chat.history() / strangers()
bot.user.self()
```

事件收消息走 Android Frontier WS 推送，发消息统一 HTTP cookie 通道（cmd=100），HTTP 同时承担收件箱查询与媒体上传。

## 发布与自动化（GitHub Actions）

参考 changesets / pkg.pr.new 主流实践，main 双通道分支模型：

| Workflow | 触发 | 做什么 |
|----------|------|--------|
| ci.yml | pull_request | `pnpm check` + `build` + `docs:build` 门槛 |
| preview.yml | pull_request / push main | pkg.pr.new 发布即时可装预览包：`pnpm add https://pkg.pr.new/<owner>/<repo>@<sha>` |
| release.yml | push main | changesets/action：有 changeset → 开/更新 Version PR（汇总版本号 + CHANGELOG）；Version PR 合并 → `changeset publish` 发 npm + 自动 GitHub Release |
| docs.yml | push main | VitePress 构建并部署 GitHub Pages |

版本标准（semver，由 changeset 文件的 bump 类型决定）：

- 功能/破坏面迭代 → `minor`（0.1.0 → 0.2.0）
- 修复/小调整 → `patch`（0.2.0 → 0.2.1）

流程：普通 PR 需附 `.changeset/*.md`（`pnpm changeset` 生成，注明 minor/patch 与描述）→ 合并 main → 机器人开 Version PR → 审核合并 Version PR → 自动发布 + 更新日志。

仓库建好后需配置：npm `NPM_TOKEN` secret；GitHub Pages Source 选 GitHub Actions。
