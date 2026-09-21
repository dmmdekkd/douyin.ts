import protobuf from "protobufjs";
//#region src/im/protocol/ws.d.ts
interface WsReconnectEvent {
  attempt: number;
  delayMs: number;
  code?: number;
  reason?: string;
}
interface WsCloseEvent {
  code?: number;
  reason?: string;
}
//#endregion
//#region src/im/media.d.ts
interface ImageResource {
  oid: string;
  skey: string;
  md5: string;
  dataSize: number;
  width: number;
  height: number;
  originUrls: string[];
  largeUrls: string[];
  mediumUrls: string[];
  thumbUrls: string[];
}
interface VideoResource {
  tkey: string;
  skey: string;
  md5: string;
  width: number;
  height: number;
  checkPics: string[];
  poster?: ImageResource;
}
interface LinkCard {
  url: string;
  title?: string;
  description?: string;
  coverUrl?: string;
}
interface UserCard {
  uid: string;
  secUid?: string;
  name?: string;
  avatarUrl?: string;
}
interface FileAsset {
  uri: string;
  skey: string;
  md5: string;
  name: string;
  dataSize: number;
}
type ImageFormat = 'webp' | 'jpeg' | 'png' | 'gif' | 'heic' | 'unknown';
//#endregion
//#region src/http/jar.d.ts
/** 精简 Cookie 会话:不区分 domain/path,整站共享一份键值对 */
declare class Jar {
  private readonly store;
  constructor(initial?: string);
  get(name: string): string | undefined;
  has(name: string): boolean;
  set(name: string, value: string): void;
  delete(name: string): void;
  /** 导入 Cookie 请求头格式;响应 Set-Cookie 走 absorb 以支持过期删除 */
  merge(raw: string): void;
  header(): string;
  /** 接受独立或合并的 Set-Cookie 字段(容忍 Expires 中的逗号),max-age<=0 或已过期则删除 */
  absorb(raw: string, now?: number): void;
}
//#endregion
//#region src/http/res.d.ts
/** 统一响应形态:data 与 text 并存,JSON/HTML/protobuf 调用方按需取用 */
interface Res<T = unknown> {
  ok: boolean;
  status: number;
  headers: Headers;
  data: T;
  text: string;
}
//#endregion
//#region src/log.d.ts
/**
 * 轻量日志:SDK 保持零依赖,输出通道收敛到 console;
 * 调用方可注入同形态实现替换(静默、落盘、上报等)。
 */
interface Log {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}
/** quiet 用于调用方整体关停输出;tag 用于多实例区分来源 */
declare function createLog(opts?: {
  tag?: string;
  quiet?: boolean;
}): Log;
//#endregion
//#region src/http/client.d.ts
interface HttpOpts {
  /** 浏览器复制的 Cookie 或上一轮会话 */
  cookie?: string;
  /** 当前账号 uid,发消息/收件箱/上传链路使用 */
  userId?: string;
  userAgent?: string;
  /** 默认请求超时毫秒;init.signal 显式传入时优先生效 */
  timeout?: number;
  log?: Log;
}
/** 抖音 HTTP 通道:Cookie/UA/超时封装 + Passport 请求头;签名(sign/qs/a_bogus)由调用方组装进 URL 后直发 */
declare class Http {
  readonly jar: Jar;
  readonly userId: string;
  readonly ua: string;
  readonly log: Log;
  bizTraceId: string;
  /** 服务端注册的桌面设备身份(登录时注入;'0' 表示未注册) */
  deviceId: string;
  installId: string;
  guid: string;
  private readonly timeout;
  private readonly portrait;
  constructor(opts?: HttpOpts);
  /** 注入服务端注册的桌面设备身份(device_register 签发) */
  setDevice(device: {
    deviceId: string;
    installId: string;
    guid: string;
  }): void;
  hasDevice(): boolean;
  /** Passport 接口请求头;imdesktop(桌面)与 creator(web)分流 */
  passportHeaders(url?: string): Record<string, string>;
  private aidSignFor;
  request(url: string, init?: RequestInit): Promise<Res<string>>;
  json<T>(url: string, init?: RequestInit): Promise<Res<T>>;
  bytes(url: string, init?: RequestInit): Promise<{
    ok: boolean;
    status: number;
    headers: Headers;
    data: Uint8Array;
  }>;
  get(url: string, init?: RequestInit): Promise<Res<string>>;
  /** Passport form 链路:body 为已编码的 urlencoded 串,默认补 Content-Type */
  post(url: string, body?: string, init?: RequestInit): Promise<Res<string>>;
  /** 媒体上传:body 原样透传,Content-Type 由调用方决定 */
  upload(url: string, body: NonNullable<RequestInit['body']>, init?: RequestInit): Promise<Res<string>>;
  private fetchRes;
  /** 吸收响应下发的 Set-Cookie 与 msToken,会话跨请求自续 */
  private absorb;
}
//#endregion
//#region src/im/types.d.ts
interface ConversationMember {
  uid: string;
  secUid?: string;
  role: number;
}
/** cmd 2006 返回的会话；纯数字 ID 且 type=2 的条目为群聊。 */
interface GroupInfo {
  conversationId: string;
  conversationShortId: string;
  conversationType: number;
  isGroup: boolean;
  name: string;
  avatar?: string;
  ownerUid?: string;
  lastMessageTime: number;
  members: ConversationMember[];
}
interface ChatMessage {
  msgId: string;
  threadId: string;
  senderUid: string;
  senderSecUid?: string;
  content: string;
  msgType: number;
  createTime: number;
  status: number;
  indexInConversation?: string;
  indexInConversationV2?: string;
  [key: string]: unknown;
}
/** 好友（P2P 会话对端）信息 */
interface FriendInfo {
  uid: string;
  secUid?: string;
  nickname: string;
  conversationId: string;
  conversationShortId: string;
  lastMessage?: ChatMessage;
  lastMessageTime: number;
  unreadCount: number;
}
/** 陌生人会话信息 */
interface StrangerInfo {
  uid: string;
  nickname?: string;
  conversationId: string;
  conversationShortId: string;
  lastMessage?: ChatMessage;
  lastMessageTime: number;
  unreadCount: number;
}
/** 会话寻址（发送/撤回等共用） */
interface ConversationAddress {
  conversationId: string;
  conversationShortId: string;
  conversationType: 1 | 2;
  inboxType?: number;
}
/** 消息表情回应（cmd=705 set_property，key=se:<emoji>） */
interface ModifyReactionItem extends ConversationAddress {
  serverMessageId: string;
  /** 抖音表态键值（skey 文本表情，如 '[爱心]'） */
  emoji: string;
  /** 表态者 uid（bot 自身） */
  operatorUid: string;
  /** true 添加 / false 移除 */
  enabled: boolean;
}
interface SendMessageResponse {
  statusCode: number;
  statusMsg: string;
  serverMessageId?: string;
  clientMessageId?: string;
  /** 内容安全审核状态码（0=通过，非0=被拦截/需审核） */
  checkCode?: number;
}
interface RecallItem extends ConversationAddress {
  serverMessageId: string;
}
/** 会话标记已读（cmd=2002 mark_conversation_read，对齐 native rawMarkConversationRead） */
interface MarkReadItem extends ConversationAddress {
  /** 已读位置：read_message_index（proto field 4，取消息 createTime 微秒时间戳） */
  readMessageIndex?: string;
  /** 已读位置 v2（read_message_index_v2，proto field 7，可选） */
  readMessageIndexV2?: string;
  /** 已读的消息 id（server_message_id，proto field 10，可选） */
  serverMessageId?: string;
}
interface RecallResult {
  statusCode: number;
  statusMsg: string;
  recalled: boolean;
}
interface ActionResult {
  statusCode: number;
  statusMsg: string;
  checkCode?: number;
}
interface GroupMemberInfo {
  uid: string;
  secUid?: string;
  nickname?: string;
  avatar?: string;
  role: number;
  alias?: string;
  sortOrder?: string;
  blocked?: number;
  leftBlockTime?: string;
  ext?: Readonly<Record<string, string>>;
}
declare enum GroupJoinRequestStatus {
  PENDING = 1,
  APPROVED = 2,
  REJECTED = 3,
  INVALID = 4
}
interface GroupJoinRequestInfo {
  requestId: string;
  applicantUid: string;
  applicantSecUid?: string;
  applicantNickname?: string;
  applicantAvatar?: string;
  groupShortId: string;
  conversationType: number;
  status: GroupJoinRequestStatus;
  reason?: string;
  inviterUid?: string;
  inviterSecUid?: string;
  createdAt?: string;
  modifiedAt?: string;
  moderatorUid?: string;
  ext?: Readonly<Record<string, string>>;
}
declare enum FriendRequestStatus {
  PENDING = 1,
  APPROVED = 2,
  REJECTED = 3,
  INVALID = 4
}
interface FriendRequestInfo {
  applicantUid: string;
  nickname?: string;
  avatar?: string;
  requestedAt?: string;
  status: FriendRequestStatus;
  message?: string;
  ext?: Readonly<Record<string, string>>;
}
/** 被引用消息（回复）信息：同 cmd=100 refMsgInfo 字段结构 */
interface MessageReference {
  referencedMessageId: string;
  hint: string;
  rootMessageId?: string;
}
/** WS 原始推送（解析前中间结构，等价参考 ImPushMessage） */
interface PushMessage {
  cmd: number;
  inboxType?: number;
  conversationId: string;
  conversationShortId: string;
  conversationType: number;
  senderUid: string;
  senderSecUid?: string;
  content: string;
  messageType: number;
  serverMessageId?: string;
  createTime?: string;
  indexInConversation?: string;
  indexInConversationV2?: string;
  reference?: MessageReference;
  raw: Record<string, unknown>;
}
/** 入站业务消息：原始推送 + 解析内容 + 展示文本 */
interface InboundMessage extends PushMessage {
  parsed: ParsedMessageContent;
  /** 展示文本（图片/视频等富媒体回退为 [图片] 等占位） */
  text: string;
}
type GroupMemberIncreaseSource = 'invite' | 'command' | 'qrcode' | 'duoshan' | 'apply' | 'search' | 'activity' | 'face-to-face' | 'circle';
type GroupMemberDecreaseSource = 'kick' | 'leave';
interface NoticeUser {
  uid: string;
  secUid?: string;
  nickname?: string;
}
/** 业务通知事件（撤回/好友增减/群成员增减/已读等；好友与入群申请分流到 RequestEvent） */
type NoticeEvent = {
  /** cmd=500 f500 property 推送的消息表情回应（ModifyPropertyBody 下发）。 */
  type: 'message.reaction';
  conversationId: string;
  serverMessageId: string;
  /** 抖音表态键值（se: 后文本，如 '[爱心]'） */
  emoji: string;
  /** 表态者 uid（idempotent_id） */
  operatorUid: string;
  /** true 添加 / false 移除 */
  isSet: boolean;
  raw: Record<string, unknown>;
} | {
  /** cmd508 的好友关系建立事实。 */
  type: 'friend.increase';
  peerUid: string;
  fromUid?: string;
  toUid?: string;
  content?: string;
  ext?: Readonly<Record<string, string>>;
  raw: Record<string, unknown>;
} | {
  /** cmd508 的好友关系解除事实。 */
  type: 'friend.decrease';
  peerUid: string;
  fromUid?: string;
  toUid?: string;
  content?: string;
  ext?: Readonly<Record<string, string>>;
  raw: Record<string, unknown>;
} | {
  type: 'conversation.read';
  conversationId: string;
  conversationType: number;
  readMessageIndex: string;
  readMessageIndexV2: string;
  raw: Record<string, unknown>;
} | {
  type: 'conversation.update';
  conversationId: string;
  conversationType: number;
  raw: Record<string, unknown>;
} | {
  type: 'conversation.delete';
  conversationId: string;
  conversationType: number;
  raw: Record<string, unknown>;
} | {
  type: 'message.recall';
  conversationId: string;
  conversationType: number;
  serverMessageId?: string;
  raw: Record<string, unknown>;
} | {
  /** 群系统消息中的成员加入事实；一条消息可以包含多个成员。 */
  type: 'group.member-increase';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  source: GroupMemberIncreaseSource;
  members: NoticeUser[];
  operators: NoticeUser[];
  raw: Record<string, unknown>;
} | {
  /** 群系统消息中的成员离开事实；kick 的 passive_users 为离群成员，leave 的 active_users 为离群成员。 */
  type: 'group.member-decrease';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  source: GroupMemberDecreaseSource;
  members: NoticeUser[];
  operators: NoticeUser[];
  raw: Record<string, unknown>;
} | {
  /** messageType=7, aweType=100110；设为管理员。 */
  type: 'group.admin';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  members: NoticeUser[];
  operators: NoticeUser[];
  enabled: true;
  raw: Record<string, unknown>;
} | {
  /** messageType=7, aweType=100106；name 取不到时仍保留通知和 raw。 */
  type: 'group.name-change';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  name?: string;
  operators: NoticeUser[];
  raw: Record<string, unknown>;
} | {
  /** messageType=7, aweType=100115；avatar 取不到时仍保留通知和 raw。 */
  type: 'group.avatar-change';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  avatar?: string;
  operators: NoticeUser[];
  raw: Record<string, unknown>;
} | {
  type: 'im.command';
  conversationId: string;
  conversationType: number;
  messageType: number;
  content: string;
  raw: Record<string, unknown>;
};
/** 需要上层处理的请求事件（好友申请 / 入群申请） */
type RequestEvent = {
  /** cmd508 的 SendApply 信号；SDK 收到后刷新可处理的好友申请列表。 */
  type: 'friend.request';
  applicantUid: string;
  fromUid?: string;
  toUid?: string;
  content?: string;
  ext?: Readonly<Record<string, string>>;
  raw: Record<string, unknown>;
} | {
  /** cmd500 messageType=90001；SDK 收到后拉取审核列表再生成可操作 request。 */
  type: 'group.join-request';
  conversationId: string;
  conversationShortId: string;
  conversationType: number;
  requestId?: string;
  content: string;
  raw: Record<string, unknown>;
};
/** 合并转发节点（messageType=136 list_content + msg_ids） */
interface ForwardNode {
  /** 发送者 uid */
  uid: string;
  /** 发送者昵称 */
  nickname: string;
  /** 节点文本摘要（图片为 [图片] 等） */
  text: string;
  /** 节点消息类型（7 文本 / 27 图片 …） */
  msgType: number;
  /** 节点 aweType（700 文本 / 2702 图片 …） */
  aweType: number;
  /** 节点消息 id */
  msgId: string;
  /** 发送者 secUid（如有） */
  secUid?: string;
  /** 节点发送时间 ms */
  createTime?: number;
}
type ParsedMessageContent = {
  kind: 'text';
  text: string;
  aweType: number;
} | {
  kind: 'image';
  text: string;
  aweType: number;
  image: ImageResource;
} | {
  kind: 'video';
  text: string;
  aweType: number;
  video: VideoResource;
} | {
  kind: 'emoji';
  text: string;
  aweType: number;
  url: string;
} | {
  kind: 'file';
  text: string;
  aweType: number;
  file: FileAsset;
  value: Record<string, unknown>;
} | {
  kind: 'link';
  text: string;
  aweType: number;
  link: LinkCard;
  value: Record<string, unknown>;
} | {
  kind: 'user';
  text: string;
  aweType: number;
  user: UserCard;
  value: Record<string, unknown>;
} | {
  kind: 'audio';
  text: string;
  aweType: number;
  audio: {
    urls: string[];
    uri: string;
  };
  value: Record<string, unknown>;
} | {
  kind: 'share';
  text: string;
  aweType: number;
  share: {
    itemId: string;
    title: string;
    authorUid: string;
    authorSecUid: string;
  };
  value: Record<string, unknown>;
} | {
  kind: 'forward';
  text: string;
  aweType: number;
  nodes: ForwardNode[];
  value: Record<string, unknown>;
} | {
  kind: 'unknown';
  text: string;
  aweType: number;
  value: Record<string, unknown> | string;
};
//#endregion
//#region src/im/content.d.ts
interface ImageAsset {
  oid: string;
  skey: string;
  md5: string;
  dataSize: number;
  width: number;
  height: number;
  format?: Exclude<ImageFormat, 'unknown'>;
}
/** 文本 @ 提及（richTextInfos 元数据） */
interface TextMention {
  uid: string;
  text: string;
  location: number;
  length: number;
}
interface FileAssetPayload {
  uri: string;
  skey: string;
  md5: string;
  name: string;
  dataSize: number;
}
//#endregion
//#region src/im/upload.d.ts
interface VideoAsset {
  tkey: string;
  skey: string;
  md5: string;
}
interface FileUploadAsset {
  uri: string;
  skey: string;
  md5: string;
  name: string;
  dataSize: number;
}
//#endregion
//#region src/im/inbox.d.ts
interface InboxListOptions {
  cursor?: number;
  count?: number;
}
//#endregion
//#region src/im/send.d.ts
interface SendForwardOptions extends ConversationAddress {
  nodes: ForwardNode[];
  /** 发送者 uid（bot 自身） */
  selfUid: string;
  /** 发送者 secUid（bot 自身） */
  selfSecUid?: string;
}
interface ReplyOptions extends ConversationAddress {
  text: string;
  referencedMessageId: string;
  referencedMessageType: number;
  referencedUid: string;
  referencedSecUid?: string;
  nickname?: string;
  referencedText?: string;
  rootMessageId?: string;
  rootMessageConvIndex?: string;
}
//#endregion
//#region src/im/im.d.ts
interface ImOptions {
  http: Http;
  /** 当前账号数字 uid（Android frontier device_id + 自发消息过滤） */
  userId: string;
  /** 浏览器复制的 Cookie 串（WS 握手用；HTTP 通道使用 http 实例内的 Cookie） */
  cookies: string;
  /** Desktop IM 设备 ID（收件箱 Cookie 查询/动作通道用；缺省取 http 已注册设备） */
  deviceId?: string;
  log?: Log;
}
type ImEventMap = {
  message: [message: InboundMessage];
  notice: [notice: NoticeEvent];
  request: [request: RequestEvent];
  reconnecting: [event: WsReconnectEvent];
  close: [event: WsCloseEvent];
};
type ImEvent = keyof ImEventMap;
type Listener<T extends ImEvent> = (...args: ImEventMap[T]) => void;
interface SendMediaItem extends ConversationAddress {
  /** 图片（uploadImage 结果）或视频（uploadVideo 结果 + 尺寸）或文件（uploadFile 结果）三选一 */
  image?: ImageAsset;
  video?: {
    asset: VideoAsset;
    poster: ImageAsset;
    width: number;
    height: number;
    checkPics?: string[];
  };
  file?: FileAssetPayload;
}
/**
 * IM 消息业务门面：收消息走 Android Frontier WS 推送，
 * 发消息统一 HTTP cookie 通道（native ImOption profile，cmd=100），
 * HTTP 同时承担收件箱查询/动作与媒体上传。方法直接转发到各模块。
 */
declare class Im {
  private readonly userId;
  private readonly deviceId;
  private readonly log;
  private readonly transport;
  private readonly uploader;
  private readonly inboxCtx;
  /** Android Frontier 长连接：接收推送 */
  private readonly ws;
  private readonly handlers;
  constructor(options: ImOptions);
  /** 连接 Android Frontier WS 长连接并开始接收群聊/私聊消息 */
  start(): Promise<void>;
  /** 停止接收并关闭连接 */
  stop(): void;
  /** 事件注册：message / notice / request / reconnecting / close（start 前注册同样生效） */
  on<T extends ImEvent>(event: T, callback: Listener<T>): void;
  off<T extends ImEvent>(event: T, callback: Listener<T>): void;
  private emit;
  /** Android Frontier 帧分发：原生通知/请求 + 消息推送（过滤自发，命令消息分流为 notice/request） */
  private handleFrame;
  /** 好友申请/入群申请走 request，其余通知走 notice */
  private routeEvent;
  sendText(address: ConversationAddress, text: string, mentions?: TextMention[]): Promise<SendMessageResponse>;
  /** 合并转发（messageType=136） */
  sendMergeForward(options: SendForwardOptions): Promise<SendMessageResponse>;
  /** 发送图片/视频/文件（媒体需先 uploadImage/uploadVideo/uploadFile） */
  sendMedia(item: SendMediaItem): Promise<SendMessageResponse>;
  reply(options: ReplyOptions): Promise<SendMessageResponse>;
  recall(item: RecallItem): Promise<RecallResult>;
  /** 消息表情回应（cmd=705 set_property，emoji 为抖音 skey 文本键） */
  modifyReaction(item: ModifyReactionItem): Promise<{
    statusCode: number;
    statusMsg: string;
  }>;
  /** 会话标记已读（cmd=2002 mark_conversation_read） */
  markRead(item: MarkReadItem): Promise<{
    statusCode: number;
    statusMsg: string;
  }>;
  uploadImage(data: Uint8Array): Promise<ImageAsset>;
  uploadVideo(data: Uint8Array): Promise<VideoAsset>;
  uploadFile(data: Uint8Array, name: string): Promise<FileUploadAsset>;
  getFriendList(options?: InboxListOptions): Promise<FriendInfo[]>;
  getGroupList(options?: InboxListOptions): Promise<GroupInfo[]>;
  getGroupMembers(address: ConversationAddress): Promise<GroupMemberInfo[]>;
  getStrangerList(): Promise<StrangerInfo[]>;
  getChatHistory(address: ConversationAddress & {
    cursor?: number;
    count?: number;
  }): Promise<ChatMessage[]>;
  getFriendRequests(options?: {
    status?: FriendRequestStatus;
  }): Promise<FriendRequestInfo[]>;
  getGroupJoinRequests(options?: {
    conversationShortId?: string;
  }): Promise<GroupJoinRequestInfo[]>;
  approveFriend(applicantUid: string): Promise<ActionResult>;
  rejectFriend(applicantUid: string): Promise<ActionResult>;
  approveGroupJoin(requestId: string): Promise<ActionResult & {
    request?: GroupJoinRequestInfo;
  }>;
  rejectGroupJoin(requestId: string): Promise<ActionResult & {
    request?: GroupJoinRequestInfo;
  }>;
  /** 设置群名（cmd=902） */
  setGroupName(address: ConversationAddress, name: string): Promise<ActionResult>;
  /** 统一发送上下文：HTTP cookie 通道（native ImOption profile） */
  private sendCtx;
}
//#endregion
//#region src/user.d.ts
interface SelfInfo {
  uid?: string;
  nickname?: string;
  /** 真实头像(avatar_thumb.url_list 首个;passport 的 avatar_url 是 mosaic 占位) */
  avatar?: string;
}
//#endregion
//#region src/bot.d.ts
/** chatId：`type:shortId:conversationId` 的不透明串，内部解析为 address，格式不承诺稳定 */
declare function chatIdOf(src: PushMessage | {
  conversationId: string;
  conversationShortId: string;
  conversationType: number;
}): string;
/** 发送内容：文本与富媒体可组合（媒体走独立消息） */
interface SendContent {
  text?: string;
  image?: ImageAsset;
  video?: {
    asset: VideoAsset;
    poster: ImageAsset;
    width: number;
    height: number;
  };
  file?: FileAssetPayload;
  mentions?: TextMention[];
}
type MediaPart = Omit<SendMediaItem, keyof ConversationAddress>;
type ForwardPart = Omit<SendForwardOptions, keyof ConversationAddress | 'selfUid'>;
/** 入站消息附 chatId，发消息直接回传 */
type BotMessage = InboundMessage & {
  chatId: string;
};
type BotEventMap = {
  message: [BotMessage];
  notice: [NoticeEvent];
  request: [RequestEvent];
  reconnecting: [WsReconnectEvent];
  close: [WsCloseEvent];
};
type BotEvent = keyof BotEventMap;
declare class Msg {
  private readonly bot;
  constructor(bot: Bot);
  send(chatId: string, content: SendContent): Promise<ReturnType<Im['sendText']>>;
  /** 引用回复：消息对象来自 bot.on('message')，自动提取引用元数据 */
  reply(chatId: string, msg: BotMessage, text: string): ReturnType<Im['reply']>;
  /** 富媒体独立消息（与文本分开发送） */
  media(chatId: string, item: MediaPart): ReturnType<Im['sendMedia']>;
  /** 合并转发：nodes 里的伪装发送者缺省用自己 */
  forward(chatId: string, options: ForwardPart): ReturnType<Im['sendMergeForward']>;
  recall(chatId: string, serverMessageId: string): ReturnType<Im['recall']>;
  /** 表情回应：emoji 为抖音键值（如 '[爱心]'），isSet false 取消 */
  react(chatId: string, serverMessageId: string, emoji: string, isSet?: boolean): ReturnType<Im['modifyReaction']>;
  /** 标记已读；msg 缺省读到底 */
  read(chatId: string, msg?: BotMessage): ReturnType<Im['markRead']>;
}
declare class Media {
  private readonly bot;
  constructor(bot: Bot);
  image(data: Uint8Array): Promise<ImageAsset>;
  video(data: Uint8Array): Promise<VideoAsset>;
  file(data: Uint8Array, name?: string): Promise<FileUploadAsset>;
}
declare class Frd {
  private readonly bot;
  constructor(bot: Bot);
  list(): Promise<Array<{
    chatId: string;
  } & Awaited<ReturnType<Im['getFriendList']>>[number]>>;
  requests(status?: FriendRequestStatus): ReturnType<Im['getFriendRequests']>;
  approve(uid: string): ReturnType<Im['approveFriend']>;
  reject(uid: string): ReturnType<Im['rejectFriend']>;
}
declare class Grp {
  private readonly bot;
  constructor(bot: Bot);
  list(): Promise<Array<{
    chatId: string;
  } & Awaited<ReturnType<Im['getGroupList']>>[number]>>;
  members(chatId: string): ReturnType<Im['getGroupMembers']>;
  /** 群入群申请；省略 chatId 查全部群 */
  requests(chatId?: string): ReturnType<Im['getGroupJoinRequests']>;
  approve(requestId: string): ReturnType<Im['approveGroupJoin']>;
  reject(requestId: string): ReturnType<Im['rejectGroupJoin']>;
  rename(chatId: string, name: string): ReturnType<Im['setGroupName']>;
}
declare class Chat {
  private readonly bot;
  constructor(bot: Bot);
  history(chatId: string, opts?: {
    cursor?: number;
    count?: number;
  }): ReturnType<Im['getChatHistory']>;
  strangers(): ReturnType<Im['getStrangerList']>;
}
declare class User {
  private readonly bot;
  constructor(bot: Bot);
  self(): Promise<SelfInfo>;
}
interface BotOpts {
  /** 登录 Cookie（login 返回或已登录浏览器复制） */
  cookie: string;
  /** 自身数字 uid；省略时 start() 自动获取 */
  userId?: string;
  userAgent?: string;
  timeout?: number;
  log?: Log;
}
/**
 * SDK 门面：统一 `bot.域.动作`。收消息走 Android Frontier WS 推送，
 * 发消息统一 HTTP cookie 通道（cmd=100），HTTP 同时承担收件箱查询与媒体上传。
 */
declare class Bot {
  readonly msg: Msg;
  readonly media: Media;
  readonly frd: Frd;
  readonly grp: Grp;
  readonly chat: Chat;
  readonly user: User;
  private readonly opts;
  private readonly log;
  private userId;
  private httpInstance?;
  private imInstance?;
  /** start 前注册的监听，start 时统一接到 Im */
  private readonly pending;
  constructor(opts: BotOpts);
  /** 自身数字 uid（start 后可用） */
  get id(): string;
  on<T extends BotEvent>(event: T, fn: (...args: BotEventMap[T]) => void): void;
  off<T extends BotEvent>(event: T, fn: (...args: BotEventMap[T]) => void): void;
  start(): Promise<void>;
  stop(): void;
  /** 域方法内部取用；未启动即抛出 */
  im(): Im;
  http(): Http;
}
//#endregion
//#region src/login.d.ts
type QrStatus = 'new' | 'scanned' | 'confirmed' | 'expired' | (string & {});
interface QrUserData {
  app_id?: number;
  user_id?: number;
  user_id_str?: string;
  sec_user_id?: string;
  screen_name?: string;
  name?: string;
  avatar_url?: string;
  mobile?: string;
  has_password?: number;
  country_code?: number;
  [key: string]: unknown;
}
/** 二次验证输入描述:kind=sms 附 maskedMobile,kind=password 需返回账号密码 */
interface MfaInfo {
  kind?: 'sms' | 'password';
  maskedMobile?: string;
}
interface LoginOpts {
  /** 取码后回调:QR 串(扫码页 URL,兜底 token)与 base64 图,渲染权交给调用方 */
  onQr?: (qr: {
    url: string;
    base64?: string;
  }) => void | Promise<void>;
  /** 扫码状态:new/scanned/verifying/confirmed…(含中文提示文案) */
  onStatus?: (s: string) => void | Promise<void>;
  /** 需本地安全验证时回调:验证页地址(浏览器打开) */
  onVerifyUrl?: (url: string) => void;
  /** 触发二次验证时回调:返回短信验证码或密码;未提供则登录失败 */
  onMfa?: (info: MfaInfo) => string | Promise<string>;
  userAgent?: string;
  log?: Log;
}
/** 登录会话:userId 为数字 uid(frontier 握手/消息过滤需要),存储由调用方自理 */
interface Session {
  userId: string;
  cookie: string;
  userData?: QrUserData;
}
/** 扫码登录全流程;调用链形态对齐 douyin-im beginLogin 桌面流程 */
declare function login(opts?: LoginOpts): Promise<Session>;
//#endregion
export { type ActionResult, Bot, type BotEvent, type BotEventMap, type BotMessage, type BotOpts, type ChatMessage, type ConversationAddress, type FileAssetPayload, type FileUploadAsset, type FriendInfo, type FriendRequestInfo, type GroupInfo, type GroupJoinRequestInfo, type GroupMemberInfo, type ImageAsset, type InboundMessage, type LinkCard, type Log, type LoginOpts, type MfaInfo, type NoticeEvent, type QrStatus, type RecallResult, type RequestEvent, type SendContent, type Session, type StrangerInfo, type TextMention, type UserCard, type VideoAsset, type WsCloseEvent, type WsReconnectEvent, chatIdOf, createLog, login };