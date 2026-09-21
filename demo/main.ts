import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { login, Bot, createLog } from 'douyin.ts'
import type { BotMessage, Session } from 'douyin.ts'

// 运行前先 pnpm build：demo 走包名自引用，加载 dist 产物
const log = createLog({ tag: 'demo' })

// session 存储自理：demo 用本地文件演示，复用后免扫码
const cache = new URL('./session.json', import.meta.url)
const cached: Session | undefined = existsSync(cache)
  ? JSON.parse(readFileSync(cache, 'utf8'))
  : undefined

async function input (tip: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(tip)
  rl.close()
  return answer.trim()
}

// 扫码登录：QR 串交给调用方渲染，二次验证通过回调交付
const session = cached ?? await login({
  onQr: async qr => {
    log.info(`扫码页: ${qr.url}`)
    // 在线接口简单转码成二维码图；响应自带 base64 时直接用，省一次请求
    const base64 = qr.base64?.replace(/^data:image\/\w+;base64,/, '')
    const png = base64
      ? Buffer.from(base64, 'base64')
      : Buffer.from(await (await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr.url)}`)).arrayBuffer())
    writeFileSync(new URL('./qrcode.png', import.meta.url), png)
    log.info('二维码已保存 demo/qrcode.png，用抖音 App 扫码')
  },
  onStatus: s => log.info(`登录状态: ${s}`),
  onVerifyUrl: url => log.info(`需安全验证，浏览器打开: ${url}`),
  onMfa: info => input(`二次验证${info.kind === 'password' ? '密码' : `短信验证码（${info.maskedMobile ?? ''}）`}: `),
})
if (cached) {
  log.info(`复用 session uid=${session.userId}（删除 demo/session.json 可重新扫码）`)
} else {
  writeFileSync(cache, JSON.stringify(session, null, 2))
  log.info(`登录成功 uid=${session.userId}，session 已存 demo/session.json`)
}

const bot = new Bot(session)

bot.on('message', async msg => {
  log.info(`收到 [${msg.chatId}] ${msg.senderUid}: ${msg.text}`)
  try {
    await cmd(msg)
  } catch (err) {
    log.error(`处理失败: ${err instanceof Error ? err.message : String(err)}`)
  }
})

bot.on('notice', n => log.info(`通知: ${n.type}`))
bot.on('request', r => log.info(`申请: ${r.type}`))
bot.on('reconnecting', e => log.warn(`重连中: ${e.reason ?? ''}`))
bot.on('close', () => log.warn('连接关闭'))

await bot.start()
log.info(`bot 已启动 uid=${bot.id}，Ctrl+C 退出`)

// 冒烟：拉好友/群列表验证 HTTP 通道
const [frds, grps] = [await bot.frd.list(), await bot.grp.list()]
log.info(`好友 ${frds.length} 个，群 ${grps.length} 个`)
log.info('命令: ping /echo x /img /file /reply /react /recall /forward /read')

const friend = frds[0]
if (friend) log.info(`示例 chatId: ${friend.chatId}`)

/** 消息类型测试命令：给 bot 发对应指令触发各发送通道 */
async function cmd (msg: BotMessage): Promise<void> {
  const text = msg.text
  if (text === 'ping') {
    await bot.msg.send(msg.chatId, { text: 'pong' })
  } else if (text.startsWith('/echo ')) {
    await bot.msg.send(msg.chatId, { text: text.slice(6) })
  } else if (text === '/img') {
    // 在线接口取一张二维码图当测试图
    const png = await fetch('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=douyin.ts').then(r => r.arrayBuffer())
    const img = await bot.media.image(new Uint8Array(png))
    await bot.msg.media(msg.chatId, { image: img })
  } else if (text === '/file') {
    const f = await bot.media.file(Buffer.from('douyin.ts 文件消息测试'), 'test.txt')
    await bot.msg.media(msg.chatId, { file: f })
  } else if (text === '/reply') {
    await bot.msg.reply(msg.chatId, msg, '引用回复测试')
  } else if (text === '/react') {
    await bot.msg.react(msg.chatId, msg.serverMessageId!, '[爱心]')
  } else if (text === '/recall') {
    const sent = await bot.msg.send(msg.chatId, { text: '这条马上撤回' })
    if (sent.serverMessageId) await bot.msg.recall(msg.chatId, sent.serverMessageId)
  } else if (text === '/forward') {
    // 合并转发：把对方刚发的内容包成转发节点（7/700 为文本类型）
    await bot.msg.forward(msg.chatId, {
      nodes: [{ uid: msg.senderUid, nickname: 'demo', text, msgType: 7, aweType: 700, msgId: String(Date.now() * 1000) }],
    })
  } else if (text === '/read') {
    await bot.msg.read(msg.chatId, msg)
  }
}
