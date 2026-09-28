import { AndroidFrontierWs, decodeWireTree } from './protocol/index.js'
import type { WsCloseEvent, WsReconnectEvent } from './protocol/index.js'
import { ProtoTransport } from './transport.js'
import { toInboundMessage, extractAndroidPushes, extractReactions, toVoipCall, toReadEvent, toStatusEvent } from './recv.js'
import { extractAndroidNotices, noticeFromPush } from './notice.js'
import { Uploader } from './upload.js'
import type { FileUploadAsset } from './upload.js'
import type { VideoAsset } from './media.js'
import * as inbox from './inbox.js'
import * as send from './send.js'
import * as query from './query.js'
import * as users from './users.js'
import * as active from './active.js'
import type { UserProfile } from './users.js'
import * as play from './play.js'
import * as emoji from './emoji.js'
import type { EmojiInfo } from './emoji.js'
import * as resource from './resource.js'
import type { StickerCollectResult, StickerPage } from './resource.js'
import * as share from './share.js'
import type { EncryptedVideoUrl } from './media.js'
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
  MsgBody,
  NoticeEvent,
  ReadEvent,
  RequestEvent,
  RecallItem,
  RecallResult,
  SendBodyOptions,
  SendMessageResponse,
  StatusEvent,
  StrangerInfo,
  VoipCallEvent,
} from './types.js'
import { FriendRequestStatus, GroupJoinRequestStatus } from './types.js'
import type { TextMention } from './content.js'
import type { ImageAsset } from './media.js'

export interface ImOptions {
  http: Http
  /** 当前账号数字 uid（Android frontier device_id + 自发消息过滤） */
  userId: string
  /** 浏览器复制的 Cookie 串（WS 握手用；HTTP 通道使用 http 实例内的 Cookie） */
  cookies: string
  /** Desktop IM 设备 ID（收件箱 Cookie 查询/动作通道用；缺省取 http 已注册设备） */
  deviceId?: string
  /** true 时自发消息也作为 message 事件下发（默认过滤） */
  selfMessage?: boolean
  log?: Log
}

export type ImEventMap = {
  message: [message: InboundMessage]
  /** 消息被编辑（编辑重推：内容为编辑后全文，ext 带 editCount/editInfo） */
  'message:edited': [message: InboundMessage]
  notice: [notice: NoticeEvent]
  request: [request: RequestEvent]
  /** 语音来电（messageType=50018；出站未支持，来电可感知） */
  voip: [event: VoipCallEvent]
  /** 单聊已读回执（messageType=50013，发放于自发过滤之前） */
  read: [event: ReadEvent]
  /** 会话状态变更，高频（messageType=50001，发放于自发过滤之前） */
  status: [event: StatusEvent]
  reconnecting: [event: WsReconnectEvent]
  close: [event: WsCloseEvent]
}

export type ImEvent = keyof ImEventMap

type Listener<T extends ImEvent> = (...args: ImEventMap[T]) => void
type AnyListener = (...args: unknown[]) => void

/**
 * IM 消息业务门面：收消息走 Android Frontier WS 推送，
 * 发消息统一 HTTP cookie 通道（native ImOption profile，cmd=100），
 * HTTP 同时承担收件箱查询/动作与媒体上传。方法直接转发到各模块。
 */
export class Im {
  private readonly http: Http
  private readonly userId: string
  private readonly deviceId: string
  private readonly log: Log
  private readonly transport: ProtoTransport
  private readonly uploader: Uploader
  private readonly inboxCtx: inbox.InboxContext
  /** Android Frontier 长连接：接收推送 */
  private readonly ws: AndroidFrontierWs
  private readonly handlers = new Map<ImEvent, Set<AnyListener>>()
  private readonly opts: ImOptions

  constructor (options: ImOptions) {
    this.opts = options
    this.http = options.http
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
    this.log.info(`[frame] ${bytes.length} bytes\n${JSON.stringify(decodeWireTree(bytes))}`)
    for (const notice of extractAndroidNotices(bytes)) {
      this.debug('notice', notice)
      this.routeEvent(notice)
    }
    for (const reaction of extractReactions(bytes)) {
      this.debug('reaction', reaction)
      this.emit('notice', reaction)
    }
    for (const push of extractAndroidPushes(bytes)) {
      this.debug('push', push)
      // 高位信令先于自发过滤：50001/50013 发送者常为本机，但语义是对端/会话视角
      // （50018 来电 → voip；50013 已读回执 → read；50001 会话状态 → status；其余 500x 仅盖楼根消息透出）
      if (push.messageType === 50001) {
        const status = toStatusEvent(push)
        if (status) this.emit('status', status)
        continue
      }
      if (push.messageType === 50013) {
        const read = toReadEvent(push)
        if (read) this.emit('read', read)
        continue
      }
      if (push.messageType === 50018) {
        const voip = toVoipCall(push)
        if (voip) this.emit('voip', voip)
        continue
      }
      // 编辑重推：ext 带 edit_info/edit_count，内容为编辑后全文；独立事件透出（不进 message，
      // 且先于 50000 过滤，编辑过的盖楼根消息也能感知）
      if (push.editCount != null || push.editInfo) {
        this.emit('message:edited', toInboundMessage(push))
        continue
      }
      // 50011 群成员进出 diff（block_status 通道）与普通 500x 信令不同，需透出为 notice
      if (push.messageType === 50011) {
        const event = noticeFromPush(push)
        if (event) this.routeEvent(event)
        continue
      }
      // 盖楼根消息（50002、正文为空）不作命令静默，直接进 message 分流
      if (push.messageType >= 50000 && !push.isThreadRoot) continue
      if (push.senderUid === this.userId && !this.opts.selfMessage) continue
      const event = push.isThreadRoot ? undefined : noticeFromPush(push)
      if (event) {
        this.routeEvent(event)
        continue
      }
      this.emit('message', toInboundMessage(push))
    }
  }

  /** 分发层调试日志：打印每条原始推送（含被过滤的自发），诊断收不到事件用 */
  private debug (name: string, value: { conversationId?: string; conversationType?: number; senderUid?: string; messageType?: number; type?: string }): void {
    this.log.info(`[debug] ${name}: type=${value.type ?? value.messageType} conv=${value.conversationId ?? ''} from=${value.senderUid ?? ''}`)
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

  /** 统一发送：type 判别一条消息（text/at 合 messageType=7，媒体/卡片各成一条），与收侧结构同构 */
  sendBody (address: ConversationAddress, body: MsgBody, opts?: SendBodyOptions): Promise<SendMessageResponse> {
    return send.sendBody(this.sendCtx(), address, body, opts)
  }

  /** 上报输入状态（true 正在输入 / false 停止），对方端显示「正在输入…」 */
  sendTyping (address: ConversationAddress, typing: boolean): Promise<boolean> {
    return send.sendTyping(this.sendCtx(), address, typing)
  }

  /** 发起语音通话：未支持（服务端无 VOIP 通道，返回 statusCode=-1） */
  callVoice (address: ConversationAddress, calleeUid: string): Promise<send.VoiceCallResult> {
    return send.startVoiceCall(this.sendCtx(), address, calleeUid)
  }

  /** 合并转发（messageType=136） */
  sendMergeForward (options: send.SendForwardOptions): Promise<SendMessageResponse> {
    return send.sendMergeForward(this.sendCtx(), options)
  }

  /** 发送作品分享卡片（messageType=8 / aweType=800） */
  sendShare (options: send.SendShareOptions): Promise<SendMessageResponse> {
    return send.sendShare(this.sendCtx(), options)
  }

  /** 发送用户名片卡片（messageType=25 / aweType=0） */
  sendUserCard (options: send.SendUserCardOptions): Promise<SendMessageResponse> {
    return send.sendUserCard(this.sendCtx(), options)
  }

  reply (options: send.ReplyOptions): Promise<SendMessageResponse> {
    return send.reply(this.sendCtx(), options)
  }

  recall (item: RecallItem): Promise<RecallResult> {
    return inbox.recall(this.inboxCtx, item)
  }

  /** 消息表情回应（cmd=705 set_property，emoji 为抖音 skey 文本键；传小表情 id 自动解析为键值） */
  async modifyReaction (item: ModifyReactionItem): Promise<{ statusCode: number; statusMsg: string }> {
    const skey = (await emoji.emojiTextOf(this.http, item.emoji)) ?? item.emoji
    return inbox.modifyReaction(this.inboxCtx, { ...item, emoji: skey })
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

  /** 批量查用户资料（昵称/头像），按 secUid 索引 */
  getUserProfiles (secUids: string[]): Promise<Map<string, UserProfile>> {
    return users.getUserProfiles(this.http, secUids)
  }

  /** 用消息视频的 tkey 换加密 CDN 播放地址（CENC 加密流） */
  videoUrl (tkey: string): Promise<EncryptedVideoUrl> {
    return play.getVideoUrl(this.http, tkey)
  }

  /** 官方表情资源全量映射（id/键值/CDN 直链），发送表情消息与表态键值用 */
  emojiList (): Promise<EmojiInfo[]> {
    return emoji.getEmojiList(this.http)
  }

  /** 表情资源列表（sticker/scenes 决定面板：缺省我的收藏，其他面板场景可传参探测） */
  stickerList (options: { scenes?: string; cursor?: number; limit?: number } = {}): Promise<StickerPage> {
    return resource.stickerList(this.http, options)
  }

  /** 我的收藏表情（CUSTOM_STICKER_PAGE 面板） */
  stickerFavs (): Promise<StickerPage> {
    return resource.stickerList(this.http)
  }

  /** 动图/GIF 表情：我的收藏中带 animate 动图的贴纸 */
  async stickerGifs (): Promise<StickerPage> {
    const page = await resource.stickerList(this.http)
    return { ...page, list: page.list.filter(s => s.animate) }
  }

  /** 收藏/取消收藏表情（remove=true 取消） */
  stickerCollect (ids: string[], options: { remove?: boolean } = {}): Promise<StickerCollectResult> {
    return resource.stickerCollect(this.http, ids, options)
  }

  getChatHistory (
    address: ConversationAddress & { cursor?: number; count?: number },
  ): Promise<ChatMessage[]> {
    return inbox.getChatHistory(this.inboxCtx, address)
  }

  /** 按 id 批量查会话详情（ticket/未读/成员），映射对齐列表会话 */
  conversationsInfo (items: ConversationAddress[]): Promise<GroupInfo[]> {
    return query.getInfoList(this.inboxCtx, items)
  }

  /** 群分享校验：用邀请链接的 secret 换取群邀请 ticket（不需先有 chatId） */
  verifyShare (input: share.GroupShareInput): Promise<share.GroupShareResult> {
    return share.verifyShare(this.http, input)
  }

  /** 会话成员已读游标（cmd=2000 get_read_index） */
  readIndex (conv: ConversationAddress): Promise<query.ReadIndexRow[]> {
    return query.getReadIndex(this.inboxCtx, conv)
  }

  /** 会话成员最小同步游标（cmd=2001 get_min_index） */
  minIndex (conv: ConversationAddress): Promise<query.MinIndexRow[]> {
    return query.getMinIndex(this.inboxCtx, conv)
  }

  /** 按 uid 消息区间查询（cmd=2048，HAR 语义不完整，返回原始结构） */
  userMessageStat (req: query.UserMessageQuery = {}): Promise<Record<string, unknown>> {
    return query.getUserMessage(this.inboxCtx, req)
  }

  /** 消息回执确认（cmd=2010 client/ack） */
  ackMessage (item: query.ClientAckItem): Promise<ActionResult> {
    return query.clientAck(this.inboxCtx, item)
  }

  /** 陌生人会话列表（cmd=1001，实测服务端限流 409 时 statusMsg 会给出原因） */
  strangerConversations (req: query.StrangerListOptions = {}): Promise<ActionResult> {
    return query.strangerConversations(this.inboxCtx, req)
  }

  /** 按文件信息调度 CDN 传输节点（vc-gate-edge get_peer） */
  getPeer (req: query.GetPeerRequest): Promise<query.GetPeerResult> {
    return query.getPeer(this.http, req)
  }

  /* -- web 域补充接口 -------------------------------------------------------- */

  /** im 活跃心跳上报（登录后打一次即可，成功即静默） */
  heartbeat (): Promise<void> {
    return active.heartbeat(this.http)
  }

  /** 批量查 sec 用户在线状态（source 透传，缺省 heartbeat） */
  onlineStatus (secUserIds: string[], source?: string): Promise<active.OnlineItem[]> {
    return active.onlineStatus(this.http, secUserIds, source)
  }

  /** 查询在线状态开关（1=开启，我可被对方看到在线） */
  activeSwitch (): Promise<number> {
    return active.activeSwitch(this.http)
  }

  /** 标记一批消息已读（会话侧收件箱收到 50013 的依据） */
  readSwitch (items: active.ReadSwitchItem[]): Promise<void> {
    return active.readSwitch(this.http, items)
  }

  /** 对话场景资料（字段比 profileOther 少） */
  profileScene (secUid: string): Promise<users.ProfileDetail> {
    return users.profileScene(this.http, secUid)
  }

  /** 完整资料（含地域/年龄等原始字段，raw 透传） */
  profileOther (secUid: string): Promise<users.ProfileDetail> {
    return users.profileOther(this.http, secUid)
  }

  /** 按 awemeId 批量拉消息中的作品详情（视频/图文） */
  awemeDetail (
    awemeIds: string[],
    options?: { originType?: string; requestSource?: number; conversationShortId?: string },
  ): Promise<play.AwemeDetail[]> {
    return play.awemeDetail(this.http, awemeIds, options)
  }

  /** 热门表情分页（cursor+count 翻页） */
  emojiTrending (options?: { cursor?: number; count?: number }): Promise<StickerPage> {
    return resource.emojiTrending(this.http, options)
  }

  /** app 能力开关（决策树 + 动效资源包配置） */
  strategyConfig (scenes?: string[]): Promise<resource.StrategyConfig> {
    return resource.strategyConfig(this.http, scenes)
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

  /* -- 群成员 / 会话操作（cmd 650/651/652/603） ------------------------------ */

  /** 拉人入群（cmd=650，成功/失败名单按响应回读） */
  addGroupMembers (address: ConversationAddress, uids: string[]): Promise<ActionResult & { success?: string[]; failed?: string[] }> {
    return inbox.addGroupMembers(this.inboxCtx, address, uids)
  }

  /** 移出群成员（cmd=651） */
  removeGroupMembers (address: ConversationAddress, uids: string[]): Promise<ActionResult> {
    return inbox.removeGroupMembers(this.inboxCtx, address, uids)
  }

  /** 退出群聊（cmd=652，响应为空 body） */
  leaveGroup (address: ConversationAddress): Promise<ActionResult> {
    return inbox.leaveGroup(this.inboxCtx, address)
  }

  /** 删除会话（cmd=603，响应为空 body） */
  deleteConversation (address: ConversationAddress, options: { lastMessageIndex?: string } = {}): Promise<ActionResult> {
    return inbox.deleteConversation(this.inboxCtx, address, options)
  }

  /* -- 会话设置 / 建群（cmd 921/609） --------------------------------------- */

  /** 会话设置：置顶/免打扰/收藏（cmd=921，响应回读完整设置） */
  setConversationSetting (
    address: ConversationAddress,
    input: inbox.ConversationSettingInput,
  ): Promise<ActionResult & { setting?: Record<string, unknown> }> {
    return inbox.setConversationSetting(this.inboxCtx, address, input)
  }

  /** 创建群聊（cmd=609），返回创建出的会话 */
  createGroup (options: inbox.CreateGroupOptions): Promise<ActionResult & { group?: GroupInfo }> {
    return inbox.createGroup(this.inboxCtx, options)
  }

  /** 批量查所有成员已读游标（cmd=2038，HAR 响应为空 body） */
  batchReadIndex (conv: ConversationAddress): Promise<ActionResult> {
    return query.batchReadIndex(this.inboxCtx, conv)
  }

  /** 统一发送上下文：HTTP cookie 通道（native ImOption profile）+ WS 直发通道辅助字段 */
  private sendCtx (): send.SendContext {
    return {
      transport: this.transport,
      deviceId: this.deviceId,
      log: this.log,
      http: this.http,
      userId: this.userId,
      cookies: this.opts.cookies,
    }
  }
}
