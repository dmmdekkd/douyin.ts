import { AndroidFrontierWs } from './protocol/index.js'
import type { WsCloseEvent, WsReconnectEvent } from './protocol/index.js'
import { ProtoTransport } from './transport.js'
import { toInboundMessage, extractAndroidPushes, extractReactions } from './recv.js'
import { extractAndroidNotices, noticeFromPush } from './notice.js'
import { Uploader } from './upload.js'
import type { VideoAsset, FileUploadAsset } from './upload.js'
import * as inbox from './inbox.js'
import * as send from './send.js'
import { createLog } from '../log.js'
import type { Log } from '../log.js'
import type { Http } from '../http/client.js'
import type {
  ActionResult,
  ChatMessage,
  ConversationAddress,
  FriendInfo,
  FriendRequestInfo,
  GroupInfo,
  GroupJoinRequestInfo,
  GroupMemberInfo,
  InboundMessage,
  MarkReadItem,
  ModifyReactionItem,
  NoticeEvent,
  RecallItem,
  RecallResult,
  RequestEvent,
  SendMessageResponse,
  StrangerInfo,
} from './types.js'
import { FriendRequestStatus, GroupJoinRequestStatus } from './types.js'
import type { ImageAsset, FileAssetPayload, TextMention } from './content.js'

export interface ImOptions {
  http: Http
  /** 当前账号数字 uid（Android frontier device_id + 自发消息过滤） */
  userId: string
  /** 浏览器复制的 Cookie 串（WS 握手用；HTTP 通道使用 http 实例内的 Cookie） */
  cookies: string
  /** Desktop IM 设备 ID（收件箱 Cookie 查询/动作通道用；缺省取 http 已注册设备） */
  deviceId?: string
  log?: Log
}

export type ImEventMap = {
  message: [message: InboundMessage]
  notice: [notice: NoticeEvent]
  request: [request: RequestEvent]
  reconnecting: [event: WsReconnectEvent]
  close: [event: WsCloseEvent]
}

export type ImEvent = keyof ImEventMap

type Listener<T extends ImEvent> = (...args: ImEventMap[T]) => void
type AnyListener = (...args: unknown[]) => void

export interface SendMediaItem extends ConversationAddress {
  /** 图片（uploadImage 结果）或视频（uploadVideo 结果 + 尺寸）或文件（uploadFile 结果）三选一 */
  image?: ImageAsset
  video?: {
    asset: VideoAsset
    poster: ImageAsset
    width: number
    height: number
    checkPics?: string[]
  }
  file?: FileAssetPayload
}

/**
 * IM 消息业务门面：收消息走 Android Frontier WS 推送，
 * 发消息统一 HTTP cookie 通道（native ImOption profile，cmd=100），
 * HTTP 同时承担收件箱查询/动作与媒体上传。方法直接转发到各模块。
 */
export class Im {
  private readonly userId: string
  private readonly deviceId: string
  private readonly log: Log
  private readonly transport: ProtoTransport
  private readonly uploader: Uploader
  private readonly inboxCtx: inbox.InboxContext
  /** Android Frontier 长连接：接收推送 */
  private readonly ws: AndroidFrontierWs
  private readonly handlers = new Map<ImEvent, Set<AnyListener>>()

  constructor (options: ImOptions) {
    this.userId = options.userId
    this.deviceId = options.deviceId ?? options.http.deviceId
    this.log = options.log ?? createLog({ tag: 'im' })
    this.transport = new ProtoTransport(options.http, this.log)
    this.uploader = new Uploader(options.http, options.userId)
    this.ws = new AndroidFrontierWs({
      userId: options.userId,
      cookies: options.cookies,
      callbacks: {
        onMessage: bytes => this.handleFrame(bytes),
        onReconnecting: event => this.emit('reconnecting', event),
        onClose: event => this.emit('close', event),
      },
    })
    this.inboxCtx = {
      transport: this.transport,
      deviceId: this.deviceId,
      platformUid: options.userId,
    }
  }

  /* -- 接收 --------------------------------------------------------------- */

  /** 连接 Android Frontier WS 长连接并开始接收群聊/私聊消息 */
  async start (): Promise<void> {
    if (this.ws.connected) return
    await this.ws.connect()
  }

  /** 停止接收并关闭连接 */
  stop (): void {
    this.ws.close()
  }

  /** 事件注册：message / notice / request / reconnecting / close（start 前注册同样生效） */
  on<T extends ImEvent> (event: T, callback: Listener<T>): void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(callback as unknown as AnyListener)
  }

  off<T extends ImEvent> (event: T, callback: Listener<T>): void {
    this.handlers.get(event)?.delete(callback as unknown as AnyListener)
  }

  private emit<T extends ImEvent> (event: T, ...args: ImEventMap[T]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as Listener<T>)(...args)
    }
  }

  /** Android Frontier 帧分发：原生通知/请求 + 消息推送（过滤自发，命令消息分流为 notice/request） */
  private handleFrame (bytes: Uint8Array): void {
    for (const notice of extractAndroidNotices(bytes)) {
      this.routeEvent(notice)
    }
    for (const reaction of extractReactions(bytes)) {
      this.emit('notice', reaction)
    }
    for (const push of extractAndroidPushes(bytes)) {
      if (push.senderUid === this.userId) continue
      // cmd=500 高位类型为通话/房间信令（50013/50018/50020…），不作为聊天消息分发
      if (push.messageType >= 50000) continue
      const event = noticeFromPush(push)
      if (event) {
        this.routeEvent(event)
        continue
      }
      this.emit('message', toInboundMessage(push))
    }
  }

  /** 好友申请/入群申请走 request，其余通知走 notice */
  private routeEvent (event: NoticeEvent | RequestEvent): void {
    if (event.type === 'friend.request' || event.type === 'group.join-request') {
      this.emit('request', event)
    } else {
      this.emit('notice', event)
    }
  }

  /* -- 发送 --------------------------------------------------------------- */

  sendText (address: ConversationAddress, text: string, mentions?: TextMention[]): Promise<SendMessageResponse> {
    return send.sendText(this.sendCtx(), address, text, mentions)
  }

  /** 合并转发（messageType=136） */
  sendMergeForward (options: send.SendForwardOptions): Promise<SendMessageResponse> {
    return send.sendMergeForward(this.sendCtx(), options)
  }

  /** 发送图片/视频/文件（媒体需先 uploadImage/uploadVideo/uploadFile） */
  sendMedia (item: SendMediaItem): Promise<SendMessageResponse> {
    const ctx = this.sendCtx()
    if (item.image) return send.sendImage(ctx, { ...item, image: item.image })
    if (item.video) {
      const { asset, poster, width, height, checkPics } = item.video
      return send.sendVideo(ctx, {
        ...item,
        video: { tkey: asset.tkey, skey: asset.skey, md5: asset.md5, poster, width, height, ...(checkPics ? { checkPics } : {}) },
      })
    }
    if (item.file) return send.sendFile(ctx, { ...item, file: item.file })
    return Promise.reject(new Error('sendMedia requires image, video or file'))
  }

  reply (options: send.ReplyOptions): Promise<SendMessageResponse> {
    return send.reply(this.sendCtx(), options)
  }

  recall (item: RecallItem): Promise<RecallResult> {
    return inbox.recall(this.inboxCtx, item)
  }

  /** 消息表情回应（cmd=705 set_property，emoji 为抖音 skey 文本键） */
  modifyReaction (item: ModifyReactionItem): Promise<{ statusCode: number; statusMsg: string }> {
    return inbox.modifyReaction(this.inboxCtx, item)
  }

  /** 会话标记已读（cmd=2002 mark_conversation_read） */
  markRead (item: MarkReadItem): Promise<{ statusCode: number; statusMsg: string }> {
    return inbox.markConversationRead(this.inboxCtx, item)
  }

  /* -- 上传 --------------------------------------------------------------- */

  uploadImage (data: Uint8Array): Promise<ImageAsset> {
    return this.uploader.uploadImage(data)
  }

  uploadVideo (data: Uint8Array): Promise<VideoAsset> {
    return this.uploader.uploadVideo(data)
  }

  uploadFile (data: Uint8Array, name: string): Promise<FileUploadAsset> {
    return this.uploader.uploadFile(data, name)
  }

  /* -- 收件箱 / 联系人 ------------------------------------------------------ */

  getFriendList (options: inbox.InboxListOptions = {}): Promise<FriendInfo[]> {
    return inbox.getFriendList(this.inboxCtx, options)
  }

  getGroupList (options: inbox.InboxListOptions = {}): Promise<GroupInfo[]> {
    return inbox.getGroupList(this.inboxCtx, options)
  }

  getGroupMembers (address: ConversationAddress): Promise<GroupMemberInfo[]> {
    return inbox.getGroupMembers(this.inboxCtx, address)
  }

  getStrangerList (): Promise<StrangerInfo[]> {
    return inbox.getStrangerList(this.inboxCtx)
  }

  getChatHistory (
    address: ConversationAddress & { cursor?: number; count?: number },
  ): Promise<ChatMessage[]> {
    return inbox.getChatHistory(this.inboxCtx, address)
  }

  getFriendRequests (options: { status?: FriendRequestStatus } = {}): Promise<FriendRequestInfo[]> {
    return inbox.getFriendRequests(this.inboxCtx, options)
  }

  getGroupJoinRequests (
    options: { conversationShortId?: string } = {},
  ): Promise<GroupJoinRequestInfo[]> {
    return inbox.getGroupJoinRequests(this.inboxCtx, options)
  }

  /* -- 申请审批 ------------------------------------------------------------- */

  approveFriend (applicantUid: string): Promise<ActionResult> {
    return inbox.reviewFriendRequest(this.inboxCtx, applicantUid, FriendRequestStatus.APPROVED)
  }

  rejectFriend (applicantUid: string): Promise<ActionResult> {
    return inbox.reviewFriendRequest(this.inboxCtx, applicantUid, FriendRequestStatus.REJECTED)
  }

  approveGroupJoin (requestId: string): Promise<ActionResult & { request?: GroupJoinRequestInfo }> {
    return inbox.reviewGroupJoinRequest(this.inboxCtx, requestId, GroupJoinRequestStatus.APPROVED)
  }

  rejectGroupJoin (requestId: string): Promise<ActionResult & { request?: GroupJoinRequestInfo }> {
    return inbox.reviewGroupJoinRequest(this.inboxCtx, requestId, GroupJoinRequestStatus.REJECTED)
  }

  /** 设置群名（cmd=902） */
  setGroupName (address: ConversationAddress, name: string): Promise<ActionResult> {
    return inbox.setGroupName(this.inboxCtx, address, name)
  }

  /** 统一发送上下文：HTTP cookie 通道（native ImOption profile） */
  private sendCtx (): send.SendContext {
    return { transport: this.transport, deviceId: this.deviceId, log: this.log }
  }
}
