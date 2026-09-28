import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { login, Bot, createLog, decryptCencMp4 } from 'douyin.ts'
import type { BotMessage, EncryptedVideoUrl, GroupMemberChange, Session, ShareItem, UserCard, Card, LocationCard, GroupCard } from 'douyin.ts'

// 运行前先 pnpm build：demo 走包名自引用，加载 dist 产物
const log = createLog({ tag: 'demo' })

// 全局兜底：长驻交互进程不允许单条异步失败带崩整进程
// （任何未接住的 rejection/异常都只记录，不触发 triggerUncaughtException 退出）
process.on('unhandledRejection', reason => {
  log.error(`未处理拒绝: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
})
process.on('uncaughtException', error => {
  log.error(`未捕获异常: ${error.stack ?? error.message}`)
})

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

// selfMessage：自发消息也下发（测试自身事件回环）
const bot = new Bot({ ...session, selfMessage: true })

// 最近一条视频消息（/vurl /vdl 测试用；url 为事件自动补拉的加密播放地址）
let lastVideo: { tkey: string; skey: string; url?: EncryptedVideoUrl } | undefined

// 群成员变更明细展示（status 打印用；role 0 普通 / 1 群主 / 2 管理员）
function memberDetail (m: GroupMemberChange): string {
  const roleName = (r: number) => r === 1 ? '群主' : r === 2 ? '管理员' : '普通成员'
  const parts: string[] = []
  // alias 有值为新昵称、空串为昵称被清空（未下发则无此键）
  for (const u of m.updated) parts.push(`${u.uid}=${roleName(u.role)}${u.alias == null ? '' : u.alias ? `(昵称=${u.alias})` : '(昵称清空)'}`)
  if (m.added.length) parts.push(`+${m.added.join(',')}`)
  if (m.removed.length) parts.push(`-${m.removed.join(',')}`)
  if (m.newOwnerId) parts.push(`群主=${m.oldOwnerId ?? '?'}→${m.newOwnerId}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

/** 纯资料变更帧（无增删/无群主移交）即群昵称等成员资料变更，与成员进出区分展示 */
function isMemberAliasOnly (m: GroupMemberChange | undefined): boolean {
  return !!m && m.added.length === 0 && m.removed.length === 0 && !m.newOwnerId && m.updated.some(u => u.alias != null)
}

// 最近一条作品分享（/share 测试用：复用作者信息发卡片）
let lastShare: ShareItem | undefined

// 最近一张用户名片（/user 测试用：原样复用发名片）
let lastUser: UserCard | undefined

// 最近一张互动卡（/checkin 测试用：原样回传发送打卡引导卡）
let lastCard: Card | undefined

// 最近一条位置消息（/locate 测试用：原样回传发送位置）
let lastLocation: LocationCard | undefined

// 最近一条群聊邀请卡（/grpcard 测试用：原样回传发送）
let lastGroupCard: GroupCard | undefined

// 最近一次发送的客户端消息 id（/edit 测试用：取返回值 cmid 复测 HTTP 幂等去重行为）
let lastSent: { chatId: string; clientMessageId?: string; serverMessageId?: string } | undefined

/** 文本快捷构段：与收侧 message 结构同构 */
const textMsg = (text: string) => ({ type: 'text' as const, text })

/** 收侧判别联合的载荷字段全集（不含 conversationId/senderUid 等 wire 元数据，raw 巨型字段除外） */
const BODY_KEYS = ['type', 'text', 'ats', 'image', 'video', 'file', 'share', 'user', 'nodes', 'audio', 'emoji', 'link', 'chains', 'card', 'groupCard', 'location'] as const

/** 提取结构化载荷：只保留判别联合字段，方便底部调试对照 */
function payloadOf (msg: BotMessage): Record<string, unknown> {
  return Object.fromEntries(
    BODY_KEYS.filter(k => (msg as unknown as Record<string, unknown>)[k] !== undefined)
      .map(k => [k, (msg as unknown as Record<string, unknown>)[k]]),
  )
}

/** 引用详情：hint 是服务端 JSON 串，解析成对象可读；refmsg_content 又是嵌套 JSON，再解一层 */
function referenceOf (ref: NonNullable<BotMessage['reference']>): Record<string, unknown> {
  const out: Record<string, unknown> = { referencedMessageId: ref.referencedMessageId }
  if (ref.rootMessageId) out.rootMessageId = ref.rootMessageId
  try {
    const hint = JSON.parse(ref.hint) as Record<string, unknown>
    if (typeof hint.refmsg_content === 'string') {
      try { hint.refmsg_content = JSON.parse(hint.refmsg_content) } catch { /* 保持原串 */ }
    }
    out.hint = hint
  } catch {
    out.hint = ref.hint
  }
  return out
}

/** 调试彩色 JSON：键青色 / 字符串绿色 / 数字黄色 / 布尔与 null 红色 */
function pretty (value: unknown): string {
  return (JSON.stringify(value, null, 2) ?? '')
    .replace(/"([^"]+)":/g, `\x1b[36m"$1"\x1b[0m:`)
    .replace(/: "([^"]*)"/g, `: \x1b[32m"$1"\x1b[0m`)
    .replace(/: (-?\d+(?:\.\d+)?)/g, `: \x1b[33m$1\x1b[0m`)
    .replace(/: (true|false|null)/g, `: \x1b[31m$1\x1b[0m`)
}

/** 打印各事件原始 JSON */
const dump = (name: string, value: unknown): void => {
  log.info(`${name} 原始:\n${pretty(value)}`)
}

bot.on('message', async msg => {
  if (msg.type === 'video') {
    lastVideo = { tkey: msg.video.tkey, skey: msg.video.skey, url: msg.video.url }
  }
  if (msg.type === 'share') {
    // 记录最近分享的作者信息与封面（解析已并入 share.coverUrl），供 /share 复用
    lastShare = {
      itemId: msg.share.itemId,
      uid: msg.share.uid,
      ...(msg.share.secUid ? { secUid: msg.share.secUid } : {}),
      ...(msg.share.title ? { title: msg.share.title } : {}),
      ...(msg.share.authorName ? { authorName: msg.share.authorName } : {}),
      ...(msg.share.coverUrl ? { coverUrl: msg.share.coverUrl } : {}),
    }
  }
  if (msg.type === 'userCard') lastUser = msg.user
  if (msg.type === 'card') lastCard = msg.card
  if (msg.type === 'groupCard') lastGroupCard = msg.groupCard
  if (msg.type === 'location') lastLocation = msg.location
  // 调试对照：上面先打原始解析 raw，下面再打结构化判别联合载荷
  // @ 提及显示在 msg.text 里（官方即用地名文本），ats 进结构化 JSON 供调试，不拼 @[uid] 后缀
  log.info(`消息 [${msg.chatId}] ${msg.senderNickname ?? msg.senderUid}: ${msg.text}${msg.reference ? `（回复 ${msg.reference.referencedMessageId}）` : ''}`)
  log.info(`raw:\n${pretty(msg.raw)}`)
  log.info(`结构化:\n${pretty({
    chatId: msg.chatId,
    ...payloadOf(msg),
    ...(msg.threadId ? { threadId: msg.threadId, threadShortId: msg.threadShortId, isThreadRoot: msg.isThreadRoot } : {}),
    ...(msg.reference ? { reference: referenceOf(msg.reference) } : {}),
  })}`)
  try {
    await cmd(msg)
  } catch (err) {
    log.error(`处理失败: ${err instanceof Error ? err.message : String(err)}`)
  }
})

// 编辑事件：编辑重推帧（ext 带 s:edit_info / s:edit_count）独立透出，与 message 互斥；验证发送侧是否触发
bot.on('message:edited', msg => {
  log.info(`编辑事件 [${msg.chatId}] ${msg.text} 次数=${msg.editCount ?? '-'} ` +
    `info=${JSON.stringify(msg.editInfo ?? {})} serverMsgId=${msg.serverMessageId}`)
  dump('message:edited raw', msg.raw)
})

bot.on('notice', n => {
  dump('notice', n)
  if (n.type === 'conversation.typing') {
    log.info(`输入状态 [${n.conversationId}] ${n.senderUid}: ${n.typing ? '正在输入…' : '已停止'}`)
  } else if (n.type === 'group.dismiss') {
    log.info(`群解散 [${n.conversationId}] 操作者=${n.operatorUid ?? '未知'}`)
  } else {
    log.info(`通知: ${n.type}`)
  }
})
bot.on('request', r => { dump('request', r); log.info(`申请: ${r.type}`) })
bot.on('voip', v => {
  dump('voip', v)
  log.info(`来电: 主叫=${v.callerUid} ${v.cameraOff === 1 ? '语音' : '视频'} room=${v.roomId} callId=${v.callId}`)
})
bot.on('read', r => {
  dump('read', r)
  log.info(`已读回执: 会话=${r.conversationId} 读方=${r.readerUid} msg=${r.messageId} 游标=${r.readIndex}`)
})
bot.on('status', s => {
  dump('status', s)
  const what = s.nameChange ? '群名变更' : s.avatarChange ? '群头像变更' : isMemberAliasOnly(s.memberChange) ? '群昵称变更' : s.memberChange ? '群成员变更' : s.commandType === 2 ? '消息删除' : `cmd=${s.commandType}`
  const unread = s.unread != null ? `未读=${s.unread}` : '未读数未变'
  const detail = s.nameChange
    ? ` 新名=${s.nameChange.name} 操作者=${s.nameChange.operatorUid || '-'}`
    : s.avatarChange
      ? ` 新头像=${s.avatarChange.icon} 操作者=${s.avatarChange.operatorUid || '-'}`
      : s.memberChange
        ? memberDetail(s.memberChange)
        : s.messageId
          ? ` msg=${s.messageId}`
          : s.extData ? ` 属性=${s.extData.map(e => e.key).join(',')}` : ''
  log.info(`会话状态: ${what} ${unread} 会话=${s.conversationId}${detail}`)
})
bot.on('reconnecting', e => { dump('reconnecting', e); log.warn(`重连中: ${e.reason ?? ''}`) })
bot.on('close', e => { dump('close', e); log.warn('连接关闭') })

await bot.start()
log.info(`bot 已启动 uid=${bot.id}，Ctrl+C 退出`)

// 冒烟：拉好友/群列表验证 HTTP 通道
const [frds, grps] = [await bot.frd.list(), await bot.grp.list()]
log.info(`好友 ${frds.length} 个，群 ${grps.length} 个`)
log.info('命令: ping /echo x /at /atall /img /video /videop /vurl /vdl /file /emoji /reply /replyall /replyat /react /recall /edit /forward /read /share [itemId] /user /checkin /locate /typing on|off /call /thread')

const friend = frds[0]
if (friend) log.info(`示例 chatId: ${friend.chatId}`)

/** 消息类型测试命令：给 bot 发对应指令触发各发送通道 */
async function cmd (msg: BotMessage): Promise<void> {
  const text = msg.text ?? ''
  if (text === 'ping') {
    await bot.msg.send(msg.chatId, textMsg('pong'))
  } else if (text.startsWith('/echo ')) {
    const sent = await bot.msg.send(msg.chatId, textMsg(text.slice(6)))
    if (sent.clientMessageId) {
      lastSent = { chatId: msg.chatId, clientMessageId: sent.clientMessageId, serverMessageId: sent.serverMessageId }
    }
  } else if (text.startsWith('/atall')) {
    // @所有人 发送（atAll：content 前置「@所有人 」+ mention_label 元数据，需群主/管理员权限）
    // 顺序敏感：必须在本分支消费，否则被下方 startsWith('/at') 的 /at 分支抢先（@all 变成单用户 @）
    const tail = text.slice(6).trim()
    await bot.msg.send(msg.chatId, { type: 'text', text: tail, atAll: true })
  } else if (text === '/at' || text.startsWith('/at ')) {
    // @ 提及发送（ats 渲染「@昵称 」占位 + richTextInfos 含 con_id，@ 当前发送者）
    // 纯艾特：text 留空即可（content 仍含「@昵称 」占位，客户端有显示锚点）；`/at 文字` 附带正文
    // 收紧为精确前缀，避免吃掉 /atall 等更长命令
    const tail = text.slice(3).trim()
    await bot.msg.send(msg.chatId, { type: 'text', text: tail, ats: [{ uid: msg.senderUid }] })
  } else if (text === '/img') {
    // 媒体源直接给 URL（也支持本地路径 / base64 / 字节）
    await bot.msg.send(msg.chatId, { type: 'image', image: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=douyin.ts' })
  } else if (text === '/video') {
    // 视频不带封面：SDK 自动本地抽帧当封面并探测尺寸（poster 缺省省略字段）
    await bot.msg.send(msg.chatId, {
      type: 'video',
      video: { source: 'https://v95-zj-b.douyinvod.com/1f68ae55785796f70462a2a709cfb371/6ab43a49/video/tos/cn/tos-cn-ve-15/oIqCAvxEPWT3gIoiDPHW2IAVQPiBnNQZsa9Vq/?a=1128&ch=0&cr=0&dr=0&er=0&cd=0%7C0%7C0%7C0&cv=1&br=1792&bt=1792&cs=0&ds=4&ft=QELBK-LMffPdEK~-Y1jNvAq-antLjrKgpE7uRkaVmBdtejVhWL6&mime_type=video_mp4&qs=0&rc=OmY0ZjVoNzdpNDw5PGdpZEBpMzo0OWs5cmdwZDMzNGkzM0AxMTRgMmEzXmExL14wYV5fYSNpXmBfMmQ0bGthLS1kLWFzcw%3D%3D&btag=40000e00090000&cquery=100y_10sH&dy_q=1790192681&feature_id=37f92ebd2877ae8e7eba995d406c5150&l=2026092403444149BDDEA4ABEEFA439847' },
    })
  } else if (text === '/videop') {
    // 视频带封面（尺寸自动取封面图）
    await bot.msg.send(msg.chatId, {
      type: 'video',
      video: {
        source: 'https://www.w3schools.com/html/mov_bbb.mp4',
        poster: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=douyin.ts',
      },
    })
  } else if (text === '/vurl') {
    // 最近一条视频的加密播放地址：事件已自动补拉，仅在缺失时手动换
    const url = lastVideo?.url ?? (lastVideo ? await bot.media.videoUrl(lastVideo.tkey) : undefined)
    if (!url) {
      await bot.msg.send(msg.chatId, textMsg('先给我发一条视频'))
      return
    }
    await bot.msg.send(msg.chatId, textMsg(`视频地址（CENC 加密流，${url.expireTime ? `过期 ${new Date(url.expireTime * 1000).toLocaleString()}` : '无时效'}）: ${url.mainUrl}`))
  } else if (text === '/vdl') {
    // 完整解密流程：事件自带 url → 自行下载 → decryptCencMp4 解密 → 落地 demo/video.mp4
    const url = lastVideo?.url ?? (lastVideo ? await bot.media.videoUrl(lastVideo.tkey) : undefined)
    if (!lastVideo?.skey || !url) {
      await bot.msg.send(msg.chatId, textMsg('先给我发一条视频'))
      return
    }
    const res = await fetch(url.mainUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error(`视频下载失败 (HTTP ${res.status})`)
    const mp4 = decryptCencMp4(new Uint8Array(await res.arrayBuffer()), lastVideo.skey)
    writeFileSync(new URL('./video.mp4', import.meta.url), mp4)
    await bot.msg.send(msg.chatId, textMsg(`已解密 ${mp4.length} 字节，见 demo/video.mp4`))
  } else if (text === '/file') {
    await bot.msg.send(msg.chatId, { type: 'file', file: { source: Buffer.from('douyin.ts 文件消息测试'), name: 'test.txt' } })
  } else if (text === '/emoji') {
    // 表情消息必须用 IM 面板源：list/aggregation 无浏览器签名会被服务端 blocked（返回文本非 JSON），trending 是登录态可用的表情源
    const page = await bot.sticker.trending()
    const e = page.list[0]
    if (!e) {
      await bot.msg.send(msg.chatId, textMsg('表情源不可用'))
      return
    }
    const img = e.static ?? e.animate
    const url = img?.urls[0] ?? img?.uri ?? ''
    if (!url) {
      await bot.msg.send(msg.chatId, textMsg('表情缺少图片地址'))
      return
    }
    await bot.msg.send(msg.chatId, { type: 'emoji', emoji: url, text: e.name ?? '[表情]' })
  } else if (text === '/reply') {
    await bot.msg.reply(msg.chatId, msg, '引用回复测试')
  } else if (text === '/replyall') {
    // 引用 + @所有人（需群主/管理员权限）：reply 第四参 atAll，正文前置「@所有人 」占位
    const tail = text.slice(9).trim() || '引用+@所有人测试'
    await bot.msg.reply(msg.chatId, msg, tail, { atAll: true })
  } else if (text === '/replyat') {
    // 引用 + @提及：reply 第四参 ats（@当前发送者），正文是否带文字都行
    const tail = text.slice(8).trim() || ''
    await bot.msg.reply(msg.chatId, msg, tail, { ats: [{ uid: msg.senderUid }] })
  } else if (text === '/react') {
    await bot.msg.react(msg.chatId, msg.serverMessageId!, '[爱心]')
  } else if (text === '/recall') {
    const sent = await bot.msg.send(msg.chatId, textMsg('这条马上撤回'))
    if (sent.serverMessageId) await bot.msg.recall(msg.chatId, sent.serverMessageId)
  } else if (text === '/edit') {
    // 编辑测试：复用最近一次同会话发送的 cmid 重发新文案（HTTP 幂等去重，编辑实测不支持）
    if (!lastSent?.clientMessageId) {
      await bot.msg.send(msg.chatId, textMsg('先在当前会话发一条消息（/echo 任意文字）再 /edit'))
      return
    }
    if (lastSent.chatId !== msg.chatId) {
      await bot.msg.send(msg.chatId, textMsg('最近发送不在当前会话，请回到原会话 /edit'))
      return
    }
    const result = await bot.msg.edit(msg.chatId, lastSent.clientMessageId, textMsg('已编辑：新文案（edit 实测）'))
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === 0
        ? `编辑发送不支持：cmid 幂等去重，内容不更新（原msg=${lastSent.serverMessageId ?? '-'} 返回msg=${result.serverMessageId ?? '-'}）`
        : `编辑发送不支持：用量被拒 status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
    ))
  } else if (text === '/forward') {
    // 合并转发：引用对方刚发的真实消息（msg_id 须为原消息 serverMessageId，点开按 id 取原消息渲染）
    await bot.msg.send(msg.chatId, {
      type: 'forward',
      nodes: [{
        uid: msg.senderUid,
        nickname: msg.senderNickname ?? 'demo',
        text,
        msgType: 7,
        aweType: 700,
        msgId: msg.serverMessageId!,
        secUid: msg.senderSecUid,
        createTime: Number(msg.createTime),
      }],
    })
  } else if (text === '/read') {
    await bot.msg.read(msg.chatId, msg)
  } else if (text.startsWith('/share')) {
    // 作品分享卡片：参数为 itemId（缺省用最近收到分享的），复用作者信息；服务端可能校验 itemId 真实性与封面
    if (!lastShare) {
      await bot.msg.send(msg.chatId, textMsg('先给我发一条作品分享'))
      return
    }
    const itemId = text.slice(6).trim() || lastShare.itemId
    const result = await bot.msg.send(msg.chatId, { type: 'share', share: { ...lastShare, itemId } })
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === 0
        ? `分享卡片已发送 itemId=${itemId} msg=${result.serverMessageId ?? '-'}`
        : `分享被拒 itemId=${itemId} status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
    ))
  } else if (text === '/user') {
    // 用户名片卡片：原样复用最近收到名片的用户信息；服务端可能校验 uid 真实性并重建 content
    if (!lastUser) {
      await bot.msg.send(msg.chatId, textMsg('先给我发一张用户名片'))
      return
    }
    const result = await bot.msg.send(msg.chatId, { type: 'userCard', user: lastUser })
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === 0
        ? `名片已发送 ${lastUser.name ?? lastUser.uid} msg=${result.serverMessageId ?? '-'}`
        : `名片被拒 status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
    ))
  } else if (text === '/checkin') {
    // 互动打卡卡：原样回传最近收到的卡片（patch 含官方签名）；验证服务端是否放行自造卡
    if (!lastCard) {
      await bot.msg.send(msg.chatId, textMsg('先给我发一张打卡引导卡'))
      return
    }
    const result = await bot.msg.send(msg.chatId, { type: 'card', text: lastCard.title, card: lastCard })
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === 0
        ? `互动卡已发送 ${lastCard.title} msg=${result.serverMessageId ?? '-'}`
        : `互动卡被拒 status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
    ))
  } else if (text === '/locate') {
    // 位置消息（POI）：原样回传最近收到位置消息的坐标/地点/封面；验证发送通道服务端行为
    if (!lastLocation) {
      await bot.msg.send(msg.chatId, textMsg('先给我发一条位置消息'))
      return
    }
    const result = await bot.msg.send(msg.chatId, { type: 'location', location: lastLocation })
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === 0
        ? `位置已发送 ${lastLocation.name} (${lastLocation.latitude},${lastLocation.longitude}) msg=${result.serverMessageId ?? '-'}`
        : `位置被拒 status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
    ))
  } else if (text.startsWith('/grpcard')) {
    // 群聊邀请卡：/grpcard 回传最近收卡；/grpcard <群chatId|群名> 主动邀请（群名经群列表匹配）
    // 群号不能作入口：a:s_group_number 只随 610 详情下发、群列表不带，无法反查会话
    const arg = text.split(/\s+/)[1]
    if (arg) {
      const hit = arg.includes(':') ? undefined : (await bot.grp.list()).find(g => g.name === arg)
      const chatId = hit?.chatId ?? arg
      let info: Awaited<ReturnType<typeof bot.chat.info>>[number] | undefined
      try {
        [info] = await bot.chat.info(chatId)
      } catch {
        info = undefined
      }
      const name = hit?.name || info?.name || arg
      if (!info?.ticket) {
        await bot.msg.send(msg.chatId, textMsg(`查不到 ${arg} 的邀请凭证（传群名或完整 chatId）`))
        return
      }
      const result = await bot.msg.send(msg.chatId, {
        type: 'groupCard',
        groupCard: {
          conversationId: info.conversationId,
          groupName: name,
          memberCount: info.members.length,
          ticket: info.ticket,
        },
      })
      await bot.msg.send(msg.chatId, textMsg(
        result.statusCode === 0
          ? `群卡片已主动发送 ${name} msg=${result.serverMessageId ?? '-'}`
          : `群卡片被拒 status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
      ))
      return
    }
    if (!lastGroupCard) {
      await bot.msg.send(msg.chatId, textMsg('先给我发一张群聊邀请卡，或 /grpcard <群chatId> 主动邀请'))
      return
    }
    const result = await bot.msg.send(msg.chatId, { type: 'groupCard', groupCard: lastGroupCard })
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === 0
        ? `群卡片已发送 ${lastGroupCard.groupName} msg=${result.serverMessageId ?? '-'}`
        : `群卡片被拒 status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
    ))
  } else if (text.startsWith('/gticket')) {
    // 群分享换 ticket：/gticket <邀请链接|secret> [群名|chatId]（纯 secret 需第二参定位会话）
    const [, link, groupArg] = text.split(/\s+/)
    if (!link) {
      await bot.msg.send(msg.chatId, textMsg('用法：/gticket <邀请链接|secret> [群名|chatId]'))
      return
    }
    const hit = groupArg
      ? (await bot.grp.list()).find(g => g.name === groupArg || g.chatId === groupArg)
      : undefined
    try {
      const r = await bot.grp.verifyShare({ share: link, ...(hit ? { conversationId: hit.conversationId } : {}) })
      await bot.msg.send(msg.chatId, textMsg(`群分享校验成功 ${r.name}(${r.conversationId}) ticket=${r.ticket.length} 字节`))
    } catch (error) {
      await bot.msg.send(msg.chatId, textMsg(`群分享校验失败：${error instanceof Error ? error.message : String(error)}`))
    }
  } else if (text.startsWith('/typing')) {
    // 上报输入状态：on 显示「正在输入…」，off/其它停止（走 Android WS cmd=411，fire-and-forget）
    const typing = !text.includes('off')
    const ok = await bot.msg.sendTyping(msg.chatId, typing)
    await bot.msg.send(msg.chatId, textMsg(`输入状态上报 ${ok ? '已发出' : '失败'}`))
  } else if (text === '/call') {
    // 发起语音通话：未支持（服务端无 VOIP 通道，记录实测结论后回显）
    const result = await bot.msg.call(msg.chatId, msg.senderUid)
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === -1
        ? `语音通话未支持：${result.checkMessage ?? '-'}`
        : `语音通话发起 → ${msg.senderUid}: ` +
          `channel=${result.channelId ?? '-'} status=${result.status ?? '-'} ` +
          `statusCode=${result.statusCode ?? '-'} check=${result.checkCode ?? '-'} ${result.checkMessage ?? ''}`,
    ))
  } else if (text.startsWith('/thread')) {
    // 盖楼测试：消息须在楼内（threadId）；对楼内消息回复，收到回推帧验证是否进楼
    if (!msg.threadId) {
      await bot.msg.send(msg.chatId, textMsg('当前消息不在盖楼中（需在楼内消息上触发）'))
      return
    }
    const replyText = text.slice(7).trim() || '盖楼回复测试'
    // chatId 对盖楼编码 type=50；HTTP 发送不支持进楼（实测网关拒）
    const result = await bot.msg.send(msg.chatId, textMsg(replyText))
    await bot.msg.send(msg.chatId, textMsg(
      result.statusCode === 0
        ? `已发出（未进楼）: ${result.serverMessageId ?? '-'}`
        : `盖楼发送不支持 status=${result.statusCode} check=${result.checkCode ?? '-'} ${result.statusMsg}`,
    ))
  }
}
