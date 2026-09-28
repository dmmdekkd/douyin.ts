import { Im } from './im/index.js'
import type {
  NoticeEvent,
  RequestEvent,
  WsReconnectEvent,
  WsCloseEvent,
} from './im/index.js'
import type {
  ConversationAddress,
  InboundMessage,
  MarkReadItem,
  MsgBody,
  PushMessage,
  ReadEvent,
  RecallItem,
  SendBodyOptions,
  StatusEvent,
  VoipCallEvent,
} from './im/types.js'
import type { ReplyOptions } from './im/send.js'
import type { ImageAsset, VideoAsset, FileUploadAsset } from './im/index.js'
import type { EncryptedVideoUrl, EmojiInfo } from './im/index.js'
import type { GetPeerRequest, UserMessageQuery } from './im/index.js'
import type { ConversationSettingInput, CreateGroupOptions } from './im/index.js'
import { resolveMedia, fileNameOf, probeVideo, extractVideoPoster, isInput } from './im/index.js'
import type { MediaInput } from './im/index.js'
import { Http } from './http/index.js'
import { createLog } from './log.js'
import type { Log } from './log.js'
import { createDevice } from './device.js'
import { self } from './user.js'
import type { SelfInfo } from './user.js'
import type { FriendRequestStatus } from './im/index.js'

/** chatId：`type:shortId:conversationId` 的不透明串，内部解析为 address，格式不承诺稳定 */
export function chatIdOf (src: PushMessage | { conversationId: string; conversationShortId: string; conversationType: number }): string {
  // 盖楼消息：type=50 哨兵，会话位直接装 threadId 全串；回传发送走普通 HTTP（不支持进楼，见 docs）
  if ('threadId' in src && src.threadId) {
    return `50:${src.threadShortId ?? src.conversationShortId ?? ''}:${src.threadId}`
  }
  return `${src.conversationType}:${src.conversationShortId}:${src.conversationId}`
}

function toAddress (chatId: string): ConversationAddress {
  // conversationId 本身含冒号（私聊 threadId 形如 0:1:uid:uid），首两段之外全部归属 conversationId
  const [type, shortId, ...rest] = chatId.split(':')
  const conversationId = rest.join(':')
  if (!type || !shortId || !conversationId) {
    throw new Error(`非法 chatId: ${chatId}`)
  }
  return {
    conversationId,
    conversationShortId: shortId,
    conversationType: Number(type) as 1 | 2 | 50,
  }
}

/** 入站消息附 chatId 与发送者昵称，发消息直接回传 */
export type BotMessage = InboundMessage & { chatId: string; senderNickname?: string }

/** 可进昵称缓存的条目（好友/陌生人/群成员/申请列表的公共形状） */
type NickEntry = { uid: string; nickname?: string; alias?: string }

export type BotEventMap = {
  message: [BotMessage]
  /** 消息被编辑（编辑重推：原消息全文 + editCount/editInfo 元数据） */
  'message:edited': [BotMessage]
  notice: [NoticeEvent]
  request: [RequestEvent]
  /** 语音来电（messageType=50018；出站 msg.call 未支持，来电可感知） */
  voip: [VoipCallEvent]
  /** 单聊已读回执（messageType=50013） */
  read: [ReadEvent]
  /** 会话状态变更，高频（messageType=50001） */
  status: [StatusEvent]
  reconnecting: [WsReconnectEvent]
  close: [WsCloseEvent]
}

export type BotEvent = keyof BotEventMap

class Msg {
  constructor (private readonly bot: Bot) {}

  /** 统一发送：type 判别一条消息；媒体输入源自动上传，收侧消息对象可直接回传 */
  async send (chatId: string, body: MsgBody, opts?: SendBodyOptions): Promise<ReturnType<Im['sendBody']>> {
    return this.bot.im().sendBody(toAddress(chatId), await this.prepare(body), opts)
  }

  /** 编辑已发送消息——不支持：HTTP 复用原 cmid 会被服务端幂等去重（返回原消息 id，内容不更新），
   *  官方编辑走 App 专属通道（WS 直发已实测证伪）。此方法仅作为「同 cmid 发新消息（去重）」兜底。 */
  async edit (chatId: string, clientMessageId: string, body: MsgBody): Promise<ReturnType<Im['sendBody']>> {
    return this.bot.im().sendBody(toAddress(chatId), await this.prepare(body), { clientMessageId })
  }

  /** 媒体输入源归一化：image/video/file 简写源先上传为资产，预上传 asset 原样透传 */
  private async prepare (body: MsgBody): Promise<MsgBody> {
    if (body.type === 'text' && body.ats?.some(at => !at.nickname)) {
      // @ 昵称自动补：缺 nickname 的项按 uid 查缓存/好友列表，占位渲染真艾特
      const ats = await Promise.all(body.ats.map(async at => ({
        ...at,
        nickname: at.nickname ?? await this.bot.nickOf(at.uid),
      })))
      return { ...body, ats }
    }
    if (body.type === 'image') {
      if (!isInput(body.image)) return body
      return { ...body, image: await this.bot.im().uploadImage(await resolveMedia(body.image)) }
    }
    if (body.type === 'video') {
      const video = body.video
      if (!('source' in video)) return body
      const bytes = await resolveMedia(video.source)
      const dims = await probeVideo(bytes)
      let width = video.width ?? dims.width
      let height = video.height ?? dims.height
      let poster = video.poster
      if (poster !== undefined) {
        poster = isInput(poster) ? await this.bot.im().uploadImage(await resolveMedia(poster)) : poster
      } else {
        // 无封面：本地解出首帧当封面，顺带以 pixel 尺寸兜底宽高
        const shot = await extractVideoPoster(bytes)
        poster = await this.bot.im().uploadImage(shot.jpeg)
        width ||= shot.width
        height ||= shot.height
      }
      return {
        ...body,
        video: {
          asset: await this.bot.im().uploadVideo(bytes),
          poster,
          width: width > 0 ? width : undefined,
          height: height > 0 ? height : undefined,
        },
      }
    }
    if (body.type === 'file') {
      const file = body.file
      if (!('source' in file)) return body
      const name = file.name ?? fileNameOf(file.source)
      return { ...body, file: { asset: await this.bot.im().uploadFile(await resolveMedia(file.source), name) } }
    }
    return body
  }

  /** 上报输入状态（true 正在输入 / false 停止），对方端显示「正在输入…」 */
  sendTyping (chatId: string, typing: boolean): Promise<boolean> {
    return this.bot.im().sendTyping(toAddress(chatId), typing)
  }

  /** 发起语音通话（未支持：服务端无 VOIP 通道，返回 statusCode=-1） */
  call (chatId: string, calleeUid: string): ReturnType<Im['callVoice']> {
    return this.bot.im().callVoice(toAddress(chatId), calleeUid)
  }

  /** 引用回复：消息对象来自 bot.on('message')，自动提取引用元数据 */
  reply (chatId: string, msg: BotMessage, text: string): ReturnType<Im['reply']> {
    const options: ReplyOptions = {
      ...toAddress(chatId),
      text,
      referencedMessageId: msg.serverMessageId ?? '',
      referencedMessageType: msg.messageType,
      referencedUid: msg.senderUid,
      referencedSecUid: msg.senderSecUid,
      referencedText: msg.text,
      rootMessageId: msg.reference?.rootMessageId,
    }
    return this.bot.im().reply(options)
  }

  recall (chatId: string, serverMessageId: string): ReturnType<Im['recall']> {
    const item: RecallItem = { ...toAddress(chatId), serverMessageId }
    return this.bot.im().recall(item)
  }

  /** 表情回应：emoji 为抖音键值（如 '[爱心]'），isSet false 取消 */
  react (chatId: string, serverMessageId: string, emoji: string, isSet = true): ReturnType<Im['modifyReaction']> {
    return this.bot.im().modifyReaction({
      ...toAddress(chatId),
      serverMessageId,
      emoji,
      operatorUid: this.bot.id,
      enabled: isSet,
    })
  }

  /** 标记已读；msg 缺省读到底 */
  read (chatId: string, msg?: BotMessage): ReturnType<Im['markRead']> {
    const item: MarkReadItem = {
      ...toAddress(chatId),
      readMessageIndex: msg?.createTime,
      readMessageIndexV2: msg?.indexInConversationV2,
      serverMessageId: msg?.serverMessageId,
    }
    return this.bot.im().markRead(item)
  }
}

class Media {
  constructor (private readonly bot: Bot) {}

  /** 图片上传：url/路径/base64/字节均可 */
  async image (input: MediaInput): Promise<ImageAsset> {
    return this.bot.im().uploadImage(await resolveMedia(input))
  }

  /** 视频上传：url/路径/base64/字节均可 */
  async video (input: MediaInput): Promise<VideoAsset> {
    return this.bot.im().uploadVideo(await resolveMedia(input))
  }

  /** 文件上传：url/路径/base64/字节均可，名字缺省从来源推断 */
  async file (input: MediaInput, name?: string): Promise<FileUploadAsset> {
    const data = await resolveMedia(input)
    return this.bot.im().uploadFile(data, name ?? fileNameOf(input))
  }

  /** 用消息视频的 tkey 换加密 CDN 播放地址（CENC 加密流，需解密后才能播放） */
  videoUrl (tkey: string): Promise<EncryptedVideoUrl> {
    return this.bot.im().videoUrl(tkey)
  }

  /** 按 awemeId 批量拉作品详情（视频/图文） */
  awemeDetail (
    awemeIds: string[],
    options?: { originType?: string; requestSource?: number; conversationShortId?: string },
  ): ReturnType<Im['awemeDetail']> {
    return this.bot.im().awemeDetail(awemeIds, options)
  }

  /** CDN 传输节点调度（按文件信息选可用传输节点） */
  getPeer (req: GetPeerRequest): ReturnType<Im['getPeer']> {
    return this.bot.im().getPeer(req)
  }

  /** 官方表情资源全量映射（id/键值/CDN 直链），发送表情消息与表态键值用 */
  emojiList (): Promise<EmojiInfo[]> {
    return this.bot.im().emojiList()
  }
}

class Sticker {
  constructor (private readonly bot: Bot) {}

  /** 表情资源列表；scenes 缺省我的收藏，其他面板场景可自行传参探测 */
  list (options?: { scenes?: string; cursor?: number; limit?: number }): ReturnType<Im['stickerList']> {
    return this.bot.im().stickerList(options)
  }

  /** 我的收藏表情（CUSTOM_STICKER_PAGE 面板） */
  favs (): ReturnType<Im['stickerFavs']> {
    return this.bot.im().stickerFavs()
  }

  /** 动图/GIF 表情：收藏中带 animate 动图的贴纸 */
  gifs (): ReturnType<Im['stickerGifs']> {
    return this.bot.im().stickerGifs()
  }

  /** 收藏/取消收藏表情（remove=true 取消） */
  collect (ids: string[], options?: { remove?: boolean }): ReturnType<Im['stickerCollect']> {
    return this.bot.im().stickerCollect(ids, options)
  }

  /** 热门表情分页（cursor+count 翻页） */
  trending (options?: { cursor?: number; count?: number }): ReturnType<Im['emojiTrending']> {
    return this.bot.im().emojiTrending(options)
  }

  /** app 能力开关（决策树 + 动效资源包配置） */
  strategy (scenes?: string[]): ReturnType<Im['strategyConfig']> {
    return this.bot.im().strategyConfig(scenes)
  }
}

class Frd {
  constructor (private readonly bot: Bot) {}

  async list (): Promise<Array<{ chatId: string } & Awaited<ReturnType<Im['getFriendList']>>[number]>> {
    const list = await this.bot.im().getFriendList()
    this.bot.rememberNicks(list)
    return list.map(f => ({ chatId: chatIdOf({ ...f, conversationType: 1 }), ...f }))
  }

  async requests (status?: FriendRequestStatus): ReturnType<Im['getFriendRequests']> {
    const list = await this.bot.im().getFriendRequests(status ? { status } : {})
    this.bot.rememberNicks(list.map(r => ({ uid: r.applicantUid, nickname: r.nickname })))
    return list
  }

  approve (uid: string): ReturnType<Im['approveFriend']> {
    return this.bot.im().approveFriend(uid)
  }

  reject (uid: string): ReturnType<Im['rejectFriend']> {
    return this.bot.im().rejectFriend(uid)
  }
}

class Grp {
  constructor (private readonly bot: Bot) {}

  async list (): Promise<Array<{ chatId: string } & Awaited<ReturnType<Im['getGroupList']>>[number]>> {
    const list = await this.bot.im().getGroupList()
    return list.map(g => ({ chatId: chatIdOf(g), ...g }))
  }

  async members (chatId: string): ReturnType<Im['getGroupMembers']> {
    const list = await this.bot.im().getGroupMembers(toAddress(chatId))
    this.bot.rememberNicks(list)
    return list
  }

  /** 群入群申请；省略 chatId 查全部群 */
  async requests (chatId?: string): ReturnType<Im['getGroupJoinRequests']> {
    const shortId = chatId ? toAddress(chatId).conversationShortId : undefined
    const list = await this.bot.im().getGroupJoinRequests(shortId ? { conversationShortId: shortId } : {})
    this.bot.rememberNicks(list.map(r => ({ uid: r.applicantUid, nickname: r.applicantNickname })))
    return list
  }

  approve (requestId: string): ReturnType<Im['approveGroupJoin']> {
    return this.bot.im().approveGroupJoin(requestId)
  }

  reject (requestId: string): ReturnType<Im['rejectGroupJoin']> {
    return this.bot.im().rejectGroupJoin(requestId)
  }

  rename (chatId: string, name: string): ReturnType<Im['setGroupName']> {
    return this.bot.im().setGroupName(toAddress(chatId), name)
  }

  /** 拉人入群（cmd=650，成功/失败名单在返回里回读） */
  addMembers (chatId: string, uids: string[]): ReturnType<Im['addGroupMembers']> {
    return this.bot.im().addGroupMembers(toAddress(chatId), uids)
  }

  /** 移出群成员（cmd=651） */
  removeMembers (chatId: string, uids: string[]): ReturnType<Im['removeGroupMembers']> {
    return this.bot.im().removeGroupMembers(toAddress(chatId), uids)
  }

  /** 退出群聊（cmd=652，响应为空 body） */
  leave (chatId: string): ReturnType<Im['leaveGroup']> {
    return this.bot.im().leaveGroup(toAddress(chatId))
  }

  /** 创建群聊（cmd=609），返回会话（含 chatId） */
  async create (options: CreateGroupOptions): Promise<Awaited<ReturnType<Im['createGroup']>> & { chatId?: string }> {
    const result = await this.bot.im().createGroup(options)
    return result.group ? { ...result, chatId: chatIdOf(result.group) } : result
  }
}

class Chat {
  constructor (private readonly bot: Bot) {}

  history (chatId: string, opts: { cursor?: number; count?: number } = {}): ReturnType<Im['getChatHistory']> {
    return this.bot.im().getChatHistory({ ...toAddress(chatId), ...opts })
  }

  async strangers (): ReturnType<Im['getStrangerList']> {
    const list = await this.bot.im().getStrangerList()
    this.bot.rememberNicks(list)
    return list
  }

  /** 会话详情（ticket/未读/成员），映射对齐列表会话 */
  info (chatId: string): ReturnType<Im['conversationsInfo']> {
    return this.bot.im().conversationsInfo([toAddress(chatId)])
  }

  /** 会话成员已读游标（cmd=2000 get_read_index） */
  readIndex (chatId: string): ReturnType<Im['readIndex']> {
    return this.bot.im().readIndex(toAddress(chatId))
  }

  /** 会话成员最小同步游标（cmd=2001 get_min_index，增量拉取起点） */
  minIndex (chatId: string): ReturnType<Im['minIndex']> {
    return this.bot.im().minIndex(toAddress(chatId))
  }

  /** 按 uid 消息区间查询（cmd=2048，语义不完整返回原始结构） */
  userMessageStat (req: UserMessageQuery = {}): ReturnType<Im['userMessageStat']> {
    return this.bot.im().userMessageStat(req)
  }

  /** 消息回执确认（cmd=2010 client/ack） */
  ack (chatId: string, serverMessageId: string): ReturnType<Im['ackMessage']> {
    const addr = toAddress(chatId)
    return this.bot.im().ackMessage({ serverMessageId, conversationShortId: addr.conversationShortId })
  }

  /** 陌生人会话列表（实测服务端限流 409 时 statusMsg 会给出原因） */
  strangerConversations (): ReturnType<Im['strangerConversations']> {
    return this.bot.im().strangerConversations()
  }

  /** 将一批入站消息标记已读（会话侧收到 50013 已读回执的依据） */
  readSwitch (chatId: string, msgs: BotMessage[]): ReturnType<Im['readSwitch']> {
    const addr = toAddress(chatId)
    return this.bot.im().readSwitch(msgs
      .filter(m => m.serverMessageId)
      .map(m => ({
        msgId: m.serverMessageId as string,
        convId: addr.conversationId,
        convShortId: addr.conversationShortId,
        createTime: Number(m.createTime ?? 0),
        convType: addr.conversationType,
      })))
  }

  /** 删除会话（cmd=603，响应为空 body） */
  delete (chatId: string): ReturnType<Im['deleteConversation']> {
    return this.bot.im().deleteConversation(toAddress(chatId))
  }

  /** 会话设置：置顶/免打扰/收藏（cmd=921，响应回读完整设置） */
  setting (chatId: string, input: ConversationSettingInput): ReturnType<Im['setConversationSetting']> {
    return this.bot.im().setConversationSetting(toAddress(chatId), input)
  }

  /** 批量查所有成员已读游标（cmd=2038，HAR 响应为空 body） */
  batchReadIndex (chatId: string): ReturnType<Im['batchReadIndex']> {
    return this.bot.im().batchReadIndex(toAddress(chatId))
  }
}

class User {
  constructor (private readonly bot: Bot) {}

  self (): Promise<SelfInfo> {
    return self(this.bot.http())
  }

  /** 对话场景资料（字段比 profileOther 少） */
  profileScene (secUid: string): ReturnType<Im['profileScene']> {
    return this.bot.im().profileScene(secUid)
  }

  /** 完整资料（含地域/年龄等原始字段，raw 透传） */
  profileOther (secUid: string): ReturnType<Im['profileOther']> {
    return this.bot.im().profileOther(secUid)
  }

  /** 批量查 sec 用户在线状态 */
  onlineStatus (secUserIds: string[], source?: string): ReturnType<Im['onlineStatus']> {
    return this.bot.im().onlineStatus(secUserIds, source)
  }

  /** im 活跃心跳上报（登录后打一次即可） */
  heartbeat (): ReturnType<Im['heartbeat']> {
    return this.bot.im().heartbeat()
  }

  /** 在线状态开关（1=开启，我可被对方看到在线） */
  activeSwitch (): ReturnType<Im['activeSwitch']> {
    return this.bot.im().activeSwitch()
  }
}

export interface BotOpts {
  /** 登录 Cookie（login 返回或已登录浏览器复制） */
  cookie: string
  /** 自身数字 uid；省略时 start() 自动获取 */
  userId?: string
  userAgent?: string
  timeout?: number
  /** true 时自发消息也作为 message 事件下发（默认过滤） */
  selfMessage?: boolean
  log?: Log
}

/**
 * SDK 门面：统一 `bot.域.动作`。收消息走 Android Frontier WS 推送，
 * 发消息统一 HTTP cookie 通道（cmd=100），HTTP 同时承担收件箱查询与媒体上传。
 */
export class Bot {
  readonly msg = new Msg(this)
  readonly media = new Media(this)
  readonly frd = new Frd(this)
  readonly grp = new Grp(this)
  readonly chat = new Chat(this)
  readonly user = new User(this)
  readonly sticker = new Sticker(this)

  private readonly opts: BotOpts
  private readonly log: Log
  private userId = ''
  private httpInstance?: Http
  private imInstance?: Im
  /** uid → 昵称 + 写入时间缓存：事件下发 senderNickname 用（群成员 alias 优先）；TTL 1 分钟，过期随好友列表整体刷新（昵称会变更，避免长期陈旧） */
  private readonly nicks = new Map<string, string>()
  private readonly nickAt = new Map<string, number>()

  private static readonly NICK_TTL = 60_000
  private static readonly now = () => Date.now()

  /** 单条写入（消息补拉路径用，与 rememberNicks 一致记时间） */
  private setNick (uid: string, nickname: string): void {
    this.nicks.set(uid, nickname)
    this.nickAt.set(uid, Bot.now())
  }
  /** 正在后台补拉昵称的 uid，防重复请求 */
  private readonly nickFetching = new Map<string, Promise<void>>()
  /** start 前注册的监听，start 时统一接到 Im */
  private readonly pending = new Map<BotEvent, Set<(arg: unknown) => void>>()

  constructor (opts: BotOpts) {
    this.opts = opts
    this.log = opts.log ?? createLog({ tag: 'bot' })
  }

  /** 自身数字 uid（start 后可用） */
  get id (): string {
    return this.userId
  }

  on<T extends BotEvent> (event: T, fn: (...args: BotEventMap[T]) => void): void {
    const im = this.imInstance
    if (im) {
      this.bind(im, event, fn as unknown as (arg: unknown) => void)
      return
    }
    const set = this.pending.get(event) ?? new Set()
    set.add(fn as unknown as (arg: unknown) => void)
    this.pending.set(event, set)
  }

  off<T extends BotEvent> (event: T, fn: (...args: BotEventMap[T]) => void): void {
    this.imInstance?.off(event, fn as never)
    this.pending.get(event)?.delete(fn as unknown as (arg: unknown) => void)
  }

  async start (): Promise<void> {
    if (this.imInstance) return
    const http = new Http({
      cookie: this.opts.cookie,
      userId: this.opts.userId,
      userAgent: this.opts.userAgent,
      timeout: this.opts.timeout,
      log: this.log,
    })
    let userId = this.opts.userId ?? ''
    if (!userId) {
      const info = await self(http)
      if (!info.uid) throw new Error('无法获取自身 uid，请检查 Cookie 是否有效')
      userId = info.uid
      if (info.nickname) this.setNick(userId, info.nickname)
    }
    if (!http.hasDevice()) {
      http.setDevice(await createDevice(this.log))
    }
    const im = new Im({ http, userId, cookies: this.opts.cookie, deviceId: http.deviceId, selfMessage: this.opts.selfMessage, log: this.log })
    this.httpInstance = http
    this.imInstance = im
    this.userId = userId
    for (const [event, set] of this.pending) {
      for (const fn of set) this.bind(im, event, fn)
    }
    this.pending.clear()
    // 预热好友昵称缓存（与 WS 握手并行），常见私聊对象首条消息即命中
    void this.im().getFriendList().then(list => this.rememberNicks(list)).catch(() => {})
    await im.start()
  }

  /** 列表查询结果顺带进昵称缓存（记录写入时间供 TTL 判定） */
  rememberNicks (entries: readonly NickEntry[]): void {
    const now = Bot.now()
    for (const entry of entries) {
      const nick = entry.alias ?? entry.nickname
      if (nick) {
        this.nicks.set(entry.uid, nick)
        this.nickAt.set(entry.uid, now)
      }
    }
  }

  /** 按 uid 查昵称：TTL 内命中直接返回，过期/未命中拉一次好友列表整体回填（发送 @ 自动补昵称用） */
  async nickOf (uid: string): Promise<string | undefined> {
    const now = Bot.now()
    if (this.nicks.has(uid) && now - (this.nickAt.get(uid) ?? 0) < Bot.NICK_TTL) return this.nicks.get(uid)
    const list = await this.im().getFriendList().catch(() => [])
    this.rememberNicks(list)
    return this.nicks.get(uid)
  }

  /** 发送者昵称补拉：未命中先查资料接口/列表，同 uid 并发去重共用同一 promise；失败静默不影响下发 */
  private ensureNick (msg: InboundMessage): Promise<void> {
    if (msg.senderUid === this.userId || this.nicks.has(msg.senderUid)) return Promise.resolve()
    const pending = this.nickFetching.get(msg.senderUid)
    if (pending) return pending
    const task = this.fetchNicks(msg)
      .catch(() => { /* 补拉失败静默，下条消息重试 */ })
      .finally(() => { this.nickFetching.delete(msg.senderUid) })
    this.nickFetching.set(msg.senderUid, task)
    return task
  }

  private async fetchNicks (msg: InboundMessage): Promise<void> {
    if (msg.conversationType === 2) {
      // 群：605 拿全群 uid+secUid（顺带缓存群昵称 alias），资料接口批量回填昵称
      const members = await this.im().getGroupMembers({
        conversationId: msg.conversationId,
        conversationShortId: msg.conversationShortId,
        conversationType: 2,
      })
      this.rememberNicks(members)
      const profiles = await this.im().getUserProfiles(members.map(m => m.secUid ?? ''))
      for (const m of members) {
        const nickname = m.secUid ? profiles.get(m.secUid)?.nickname : undefined
        if (nickname) this.setNick(m.uid, nickname)
      }
    } else if (msg.senderSecUid) {
      // 私聊：推送自带发送者 secUid，单次资料查询即可
      const profiles = await this.im().getUserProfiles([msg.senderSecUid])
      const nickname = profiles.get(msg.senderSecUid)?.nickname
      if (nickname) this.setNick(msg.senderUid, nickname)
    } else {
      const [friends, strangers] = await Promise.all([this.im().getFriendList(), this.im().getStrangerList()])
      this.rememberNicks([...friends, ...strangers])
    }
  }

  /** message 事件补 chatId 与 senderNickname（等待补拉完成，首条即带昵称），其余事件原样透传 */
  private bind (im: Im, event: BotEvent, fn: (arg: unknown) => void): void {
    if (event === 'message' || event === 'message:edited') {
      im.on(event, async msg => {
        await Promise.all([this.ensureNick(msg), this.ensureVideoUrl(msg)])
        fn({ ...msg, chatId: chatIdOf(msg), senderNickname: this.nicks.get(msg.senderUid) })
      })
      return
    }
    im.on(event as 'notice', ((arg: unknown) => fn(arg)) as never)
  }

  /** 视频播放地址补拉：随事件直接下发完整解密流程所需 URL；失败静默（调用方仍可 media.videoUrl 手动换） */
  private async ensureVideoUrl (msg: InboundMessage): Promise<void> {
    if (msg.type !== 'video') return
    // 收侧 video 必为 VideoResource（含 url 可选）；VideoSend 无 url，用 in 判别后直接写入
    if ('url' in msg.video) {
      try {
        msg.video.url = await this.im().videoUrl(msg.video.tkey)
      } catch { /* 换取失败静默，不阻塞下发 */ }
    }
  }

  stop (): void {
    this.imInstance?.stop()
  }

  /** 域方法内部取用；未启动即抛出 */
  im (): Im {
    if (!this.imInstance) throw new Error('bot 未启动，请先 await bot.start()')
    return this.imInstance
  }

  http (): Http {
    if (!this.httpInstance) throw new Error('bot 未启动，请先 await bot.start()')
    return this.httpInstance
  }
}
