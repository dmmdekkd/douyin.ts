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
  PushMessage,
  RecallItem,
} from './im/types.js'
import type { SendMediaItem } from './im/im.js'
import type { SendForwardOptions, ReplyOptions } from './im/send.js'
import type { ImageAsset, VideoAsset, FileAssetPayload, TextMention, FileUploadAsset } from './im/index.js'
import { Http } from './http/index.js'
import { createLog } from './log.js'
import type { Log } from './log.js'
import { createDevice } from './device.js'
import { self } from './user.js'
import type { SelfInfo } from './user.js'
import type { FriendRequestStatus } from './im/index.js'

/** chatId：`type:shortId:conversationId` 的不透明串，内部解析为 address，格式不承诺稳定 */
export function chatIdOf (src: PushMessage | { conversationId: string; conversationShortId: string; conversationType: number }): string {
  return `${src.conversationType}:${src.conversationShortId}:${src.conversationId}`
}

function toAddress (chatId: string): ConversationAddress {
  const [type, shortId, conversationId] = chatId.split(':')
  if (!type || !shortId || !conversationId) {
    throw new Error(`非法 chatId: ${chatId}`)
  }
  return {
    conversationId,
    conversationShortId: shortId,
    conversationType: Number(type) as 1 | 2,
  }
}

/** 发送内容：文本与富媒体可组合（媒体走独立消息） */
export interface SendContent {
  text?: string
  image?: ImageAsset
  video?: { asset: VideoAsset; poster: ImageAsset; width: number; height: number }
  file?: FileAssetPayload
  mentions?: TextMention[]
}

type MediaPart = Omit<SendMediaItem, keyof ConversationAddress>
type ForwardPart = Omit<SendForwardOptions, keyof ConversationAddress | 'selfUid'>

/** 入站消息附 chatId，发消息直接回传 */
export type BotMessage = InboundMessage & { chatId: string }

export type BotEventMap = {
  message: [BotMessage]
  notice: [NoticeEvent]
  request: [RequestEvent]
  reconnecting: [WsReconnectEvent]
  close: [WsCloseEvent]
}

export type BotEvent = keyof BotEventMap

class Msg {
  constructor (private readonly bot: Bot) {}

  async send (chatId: string, content: SendContent): Promise<ReturnType<Im['sendText']>> {
    const address = toAddress(chatId)
    if (content.image || content.video || content.file) {
      return this.bot.im().sendMedia({ ...address, image: content.image, video: content.video, file: content.file })
    }
    return this.bot.im().sendText(address, content.text ?? '', content.mentions)
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

  /** 富媒体独立消息（与文本分开发送） */
  media (chatId: string, item: MediaPart): ReturnType<Im['sendMedia']> {
    return this.bot.im().sendMedia({ ...toAddress(chatId), ...item })
  }

  /** 合并转发：nodes 里的伪装发送者缺省用自己 */
  forward (chatId: string, options: ForwardPart): ReturnType<Im['sendMergeForward']> {
    return this.bot.im().sendMergeForward({
      ...toAddress(chatId),
      ...options,
      selfUid: this.bot.id,
    })
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

  image (data: Uint8Array): Promise<ImageAsset> {
    return this.bot.im().uploadImage(data)
  }

  video (data: Uint8Array): Promise<VideoAsset> {
    return this.bot.im().uploadVideo(data)
  }

  file (data: Uint8Array, name = 'file'): Promise<FileUploadAsset> {
    return this.bot.im().uploadFile(data, name)
  }
}

class Frd {
  constructor (private readonly bot: Bot) {}

  async list (): Promise<Array<{ chatId: string } & Awaited<ReturnType<Im['getFriendList']>>[number]>> {
    const list = await this.bot.im().getFriendList()
    return list.map(f => ({ chatId: chatIdOf({ ...f, conversationType: 1 }), ...f }))
  }

  requests (status?: FriendRequestStatus): ReturnType<Im['getFriendRequests']> {
    return this.bot.im().getFriendRequests(status ? { status } : {})
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

  members (chatId: string): ReturnType<Im['getGroupMembers']> {
    return this.bot.im().getGroupMembers(toAddress(chatId))
  }

  /** 群入群申请；省略 chatId 查全部群 */
  requests (chatId?: string): ReturnType<Im['getGroupJoinRequests']> {
    const shortId = chatId ? toAddress(chatId).conversationShortId : undefined
    return this.bot.im().getGroupJoinRequests(shortId ? { conversationShortId: shortId } : {})
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
}

class Chat {
  constructor (private readonly bot: Bot) {}

  history (chatId: string, opts: { cursor?: number; count?: number } = {}): ReturnType<Im['getChatHistory']> {
    return this.bot.im().getChatHistory({ ...toAddress(chatId), ...opts })
  }

  strangers (): ReturnType<Im['getStrangerList']> {
    return this.bot.im().getStrangerList()
  }
}

class User {
  constructor (private readonly bot: Bot) {}

  self (): Promise<SelfInfo> {
    return self(this.bot.http())
  }
}

export interface BotOpts {
  /** 登录 Cookie（login 返回或已登录浏览器复制） */
  cookie: string
  /** 自身数字 uid；省略时 start() 自动获取 */
  userId?: string
  userAgent?: string
  timeout?: number
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

  private readonly opts: BotOpts
  private readonly log: Log
  private userId = ''
  private httpInstance?: Http
  private imInstance?: Im
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
      bindIm(im, event, fn as unknown as (arg: unknown) => void)
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
    }
    if (!http.hasDevice()) {
      http.setDevice(await createDevice(this.log))
    }
    const im = new Im({ http, userId, cookies: this.opts.cookie, deviceId: http.deviceId, log: this.log })
    this.httpInstance = http
    this.imInstance = im
    this.userId = userId
    for (const [event, set] of this.pending) {
      for (const fn of set) bindIm(im, event, fn)
    }
    this.pending.clear()
    await im.start()
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

/** message 事件补 chatId，其余事件原样透传 */
function bindIm (im: Im, event: BotEvent, fn: (arg: unknown) => void): void {
  if (event === 'message') {
    im.on('message', msg => {
      fn({ ...msg, chatId: chatIdOf(msg) })
    })
    return
  }
  im.on(event as 'notice', ((arg: unknown) => fn(arg)) as never)
}
