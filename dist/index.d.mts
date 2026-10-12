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
//#region src/im/source.d.ts
/** 媒体输入源：http(s) URL、本地文件路径、base64 串或原始字节 */
type MediaInput = string | Uint8Array | ArrayBuffer;
//#endregion
//#region src/im/media.d.ts
interface ImageResource {
  oid: string;
  skey: string;
  md5: string;
  dataSize: number;
  width: number;
  height: number;
  originUrls?: string[];
  largeUrls?: string[];
  mediumUrls?: string[];
  thumbUrls?: string[];
  /** 图片格式（发侧上传脚本可由 oid 推断；收侧缺省） */
  format?: ImageFormat;
}
/** 图片上传资产（uploadImage 返回；字段与 ImageResource 同形，发侧要求齐全） */
interface ImageAsset {
  oid: string;
  skey: string;
  md5: string;
  dataSize: number;
  width: number;
  height: number;
  format?: ImageFormat;
}
/** 视频上传资产（uploadVideo 返回） */
interface VideoAsset {
  tkey: string;
  skey: string;
  md5: string;
}
/** 视频发送项：source 简写（自动上传/抽帧封面）或预上传 asset */
type VideoSend = {
  source: MediaInput;
  poster?: MediaInput | ImageAsset;
  width?: number;
  height?: number;
} | {
  asset: VideoAsset;
  poster?: ImageAsset;
  width?: number;
  height?: number;
};
/** batch_play_info 换取的加密视频地址（CENC 加密流，下载后用 decryptCencMp4 解密才能播放） */
interface EncryptedVideoUrl {
  mainUrl: string;
  backupUrl?: string;
  /** 签名过期时间（秒级时间戳），过期后 URL 失效需重取 */
  expireTime?: number;
}
interface VideoResource {
  tkey: string;
  skey: string;
  md5: string;
  width: number;
  height: number;
  checkPics: string[];
  poster?: ImageResource;
  /** 内置缩略图（WEBP base64 裸串，前缀 data:image/webp;base64, 即显；poster 签名 URL 过期时的兜底） */
  inlinePic?: string;
  /** 播放地址（事件下发前自动换取；过期后可 media.videoUrl(tkey) 重取） */
  url?: EncryptedVideoUrl;
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
  desc?: string;
  followerCount?: string;
  coverItems?: string[];
  coverUrls?: string[];
}
/** 群聊邀请卡载荷（messageType=58 / aweme_invite_card）：向某会话发送「邀请加入某群」卡片 */
interface GroupCard {
  /** 被邀请群 id（conversation_id 与 conversation_short_id 同值下发） */
  conversationId: string;
  /** 群名（group_name，title/desc 展示文案内嵌） */
  groupName: string;
  /** 群图标 URL（group_icon.url_list 首位；缺省卡片无图） */
  iconUrl?: string;
  /** 群成员数（group_member_count） */
  memberCount?: number;
  /** 群主 uid（group_owner_uid） */
  ownerUid?: string;
  /** 群主 sec uid（sec_group_owner_uid） */
  ownerSecUid?: string;
  /** 群主昵称（group_owner_nickname，缺省空） */
  ownerNickname?: string;
  /** 邀请人 uid（from_uid；缺省用发送者自身） */
  fromUid?: string;
  /** 邀请人 sec uid（sec_from_uid），缺省省略 */
  fromSecUid?: string;
  /** 邀请人昵称（title/desc 文案；缺省用 uid） */
  fromNickname?: string;
  /** 群邀请凭证（aweme_invite_card.ticket）：经 chat.info 查目标群详情取得，服务端校验通过才派发卡片 */
  ticket?: string;
}
/** 位置消息载荷（messageType=502 POI 定位）：坐标 + 地点信息 + 封面图 */
interface LocationCard {
  /** 地点名（poi_name，text 展示） */
  name: string;
  /** 详细地址（poi_address） */
  address: string;
  /** 纬度 */
  latitude: number;
  /** 经度 */
  longitude: number;
  /** 模板 POI id（poi_id） */
  poiId?: string;
  /** 作品 POI id（aweme_poi_id） */
  awemePoiId?: string;
  /** 封面资源路径（cover_info.resource_url.uri） */
  uri?: string;
  /** 封面 URL 列表（cover_info.resource_url.url_list，发侧缺省用空数组） */
  urlList?: string[];
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
  /** Passport 接口请求头;imdesktop(桌面,含登录)/creator(web)分流 */
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
//#region src/im/upload.d.ts
interface FileUploadAsset {
  uri: string;
  skey: string;
  md5: string;
  name: string;
  dataSize: number;
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
  /** 群号（ConversationCoreInfo.ext 的 a:s_group_number，客户端群资料页展示；私聊无） */
  groupNumber?: string;
  /** 会话校验凭证（proto ConversationV2.ticket，发群邀请卡 aweme_invite_card.ticket 同源） */
  ticket?: string;
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
/** 会话寻址（发送/撤回等共用）；type=50 为盖楼：conversationId 即 threadId 全串 */
interface ConversationAddress {
  conversationId: string;
  conversationShortId: string;
  conversationType: 1 | 2 | 50;
  inboxType?: number;
}
/** 作品分享卡片入参（messageType=8 / aweType=800）；itemId 与 uid 须对应真实作品，其余字段可选 */
interface ShareItem {
  /** 作品 id（itemId），服务端可能校验存在性 */
  itemId: string;
  /** 作者数字 uid */
  uid: string;
  /** 作者 sec uid（缺省不渲染作者头像/主页跳转） */
  secUid?: string;
  /** 作品标题（content_title），缺省用 itemId */
  title?: string;
  /** 作者昵称（content_name） */
  authorName?: string;
  /** 封面 URL（缺省卡片无封面图） */
  coverUrl?: string;
}
/** 引用消息元数据；在 cmd100 field 11 编码，正文仍使用普通文本 content。 */
interface SendMessageReference {
  referencedMessageId: string;
  hint: string;
  rootMessageId?: string;
  rootMessageConvIndex?: string;
}
/** sendBody 附加选项 */
interface SendBodyOptions {
  clientMessageId?: string;
  /** 引用元数据（refMsgInfo）；提供时本条消息为引用回复，与消息类型无关 */
  reference?: SendMessageReference;
}
/** 消息表情回应（cmd=705 set_property，key=se:<emoji>） */
interface ModifyReactionItem extends ConversationAddress {
  serverMessageId: string;
  /** 抖音表态键值（skey 文本表情，如 '[爱心]'）或小表情 id（如 weixiao，自动解析为键值） */
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
  /** 盖楼层 id（serverMessageId:clientMessageId:convShortId）；楼内消息均有 */
  threadId?: string;
  /** 盖楼短 id */
  threadShortId?: string;
  /** 盖楼根消息（messageType=50002、正文为空），楼内回复为普通文本消息 */
  isThreadRoot?: boolean;
  /** 消息编辑次数（ext s:edit_count）；编辑重推后 ≥1 */
  editCount?: number;
  /** 消息编辑元数据（ext s:edit_info，content_editor 为 19 位 uid 已保精度） */
  editInfo?: {
    contentIsEdited: boolean;
    editorUid: string;
    editTime: string;
  };
  /** 编辑前原始消息类型（ext s:org_msg_type；编辑重推时 messageType 可能变化，如根消息 org=7 而 messageType=50002） */
  orgMsgType?: number;
  /** f:9 key-values（s:xxx / a:xxx 上下文键；撤回帧的 target_server_message_id 等在此，content 常为空） */
  ext?: Readonly<Record<string, string>>;
  raw: Record<string, unknown>;
}
/** 入站业务消息：原始推送 + 收侧平铺消息体（type 判别，text 一律可读；媒体恒为资产形态，替代段数组） */
type InboundMessage = PushMessage & RecvBody;
type GroupMemberIncreaseSource = 'invite' | 'command' | 'qrcode' | 'duoshan' | 'apply' | 'search' | 'activity' | 'face-to-face' | 'circle' |
/** 被移出成员重新入群（50011 unblock diff 通道） */
'rejoin' |
/** 50001 command_type=7 成员变更帧（增删成员同步，无来源信息） */
'sync';
type GroupMemberDecreaseSource = 'kick' | 'leave' | 'sync';
interface NoticeUser {
  uid: string;
  secUid?: string;
  nickname?: string;
}
/** 语音/视频来电（messageType=50018 响铃信令，cmd=500 推送）。主叫=推送发送者；callInfo 含服务端 RTC 入会参数（individual.live_core_param 等）。
 * 区分语音/视频看 cameraOff：0=视频（开摄像头）、1=语音；voipType 恒为 1（1v1 通话形态，非媒体类型） */
interface VoipCallEvent {
  type: 'voip.call';
  conversationId: string;
  conversationType: number;
  callerUid: string;
  callId: string;
  roomId: string;
  /** 1v1 通话形态（实测恒为 1）；媒体类型看 cameraOff */
  voipType: number;
  callType: number;
  /** 0=视频通话 / 1=语音通话（发起时摄像头策略，实测为语音视频区分依据） */
  cameraOff: number;
  /** 原始 call_info（participants/individual/init_state 等全量字段） */
  callInfo: Record<string, unknown>;
}
/** 单聊已读回执（messageType=50013，cmd=504 推送；发送者视角显示为本机，读方取自 content.P2PSender） */
interface ReadEvent {
  type: 'read';
  conversationId: string;
  /** 已读方 uid */
  readerUid: string;
  /** 会话短 id */
  conShortId: string;
  /** 最新被读消息 id */
  messageId: string;
  /** 已读方游标 */
  readIndex: string;
}
/** 会话属性变更项（content.ext_data[i]；如 a:chat_theme 更换背景） */
interface StatusExtItem {
  key: string;
  value: string;
  version: number;
  opType: number;
}
/** 群成员资料变更明细（content.updated_participant_info[i]；role 0 普通 / 1 群主 / 2 管理员） */
interface GroupMemberUpdate {
  uid: string;
  role: number;
  secUid?: string;
  /** 群昵称：本帧下发即表示昵称被变更（有值=新昵称，空串=昵称被清空）；未下发表示本帧未涉及昵称 */
  alias?: string;
}
/** 群成员变更（command_type=7）：增删成员与角色/群主/群昵称变更；added/removed 均空而 updated 非空即成员资料变更 */
interface GroupMemberChange {
  /** 新增成员 uid（added_participant） */
  added: string[];
  /** 移除成员 uid（removed_participant） */
  removed: string[];
  /** 角色/群昵称等资料变更明细（modified_participant 对应 updated_participant_info） */
  updated: GroupMemberUpdate[];
  /** 变更前群主 uid（仅群主移交帧与 newOwnerId 成对带出） */
  oldOwnerId?: string;
  /** 变更后群主 uid（new_owner_id 非 0 即群主移交；普通帧无此键） */
  newOwnerId?: string;
}
/**
 * 会话状态变更（messageType=50001，高频，自发也下发）。command_type 实测取值：
 * 1/14 红点计数与已读游标同步、2 消息删除（message_id 指向被删消息）、6 会话属性变更（nameChange/avatarChange/ext_data 带具体属性）、7 群成员变更（memberChange）。
 */
interface StatusEvent {
  type: 'status';
  conversationId: string;
  conversationType: number;
  commandType: number;
  /** 未读计数；仅红点同步类（command_type=1/14）携带，删除/属性变更等缺省无 */
  unread?: number;
  /** 已读游标 */
  readIndex: string;
  /** 被删消息 id（command_type=2 携带，ext 字符串无损；content.message_id 为 JS 精度丢失版） */
  messageId?: string;
  /** 群名变更（command_type=6 且 ext_data 含 a:s_name_operator / a:group_name_lifecycle-event=name_change）；name 为新群名，operatorUid 来自 a:s_name_operator（缺省空） */
  nameChange?: {
    name: string;
    operatorUid: string;
  };
  /** 群头像变更（command_type=6 且 ext_data 含 a:group_avatar_user_set / s_user_set_avatar / a:ab_avatar）；icon 为新头像 URL，operatorUid 来自前者（ab_avatar 帧缺省空） */
  avatarChange?: {
    icon: string;
    operatorUid: string;
  };
  /** 群成员变更（command_type=7）：增删成员/角色变更/群主变更/群昵称变更 */
  memberChange?: GroupMemberChange;
  /** 会话属性变更（command_type=6 时带；如 a:chat_theme） */
  extData?: StatusExtItem[];
  /** 原始 content（conversation_id/read_index_v2/inbox_type 等全量字段） */
  raw: Record<string, unknown>;
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
  /** cmd504 NewP2PMessageNotify 的输入状态回推（客户端输入框有内容时周期上报）。 */
  type: 'conversation.typing';
  conversationId: string;
  /** 双人对话对端 uid */
  peerUid: string;
  peerSecUid?: string;
  /** 正在输入的成员 uid */
  senderUid: string;
  /** true 正在输入 / false 已停止 */
  typing: boolean;
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
  /** 原始推送 ext（f:9 key-values；群解散导致的删除带 :dissolv_his 标记） */
  ext?: Readonly<Record<string, string>>;
  raw: Record<string, unknown>;
} | {
  type: 'message.recall';
  conversationId: string;
  conversationType: number;
  /** 被撤回消息 id（ext s:target_server_message_id） */
  serverMessageId?: string;
  /** 被撤回消息客户端 id（ext s:target_client_message_id） */
  targetClientMessageId?: string;
  /** 撤回操作者 uid（ext s:recall_uid） */
  recallUid?: string;
  /** 撤回者身份（ext s:recall_role，实测 1） */
  recallRole?: number;
  /** 原始推送 ext（f:9 key-values，撤回辅助信息） */
  ext?: Readonly<Record<string, string>>;
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
  /** messageType=1001, aweType=100110；设为管理员。 */
  type: 'group.admin';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  members: NoticeUser[];
  operators: NoticeUser[];
  enabled: true;
  raw: Record<string, unknown>;
} | {
  /** messageType=1001, aweType=100106；name 取不到时仍保留通知和 raw。 */
  type: 'group.name-change';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  name?: string;
  operators: NoticeUser[];
  raw: Record<string, unknown>;
} | {
  /** messageType=1001, aweType=100115；avatar 取不到时仍保留通知和 raw。 */
  type: 'group.avatar-change';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  avatar?: string;
  operators: NoticeUser[];
  raw: Record<string, unknown>;
} | {
  /** messageType=1001, aweType=100124；群被解散（解散者即推送发送方，无 active_users）。 */
  type: 'group.dismiss';
  conversationId: string;
  conversationShortId: string;
  conversationType: 2;
  /** 解散操作者（取推送发送方；取不到时缺省） */
  operatorUid?: string;
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
/** 文件发送项：source 简写（自动上传，name 缺省从来源推断）或预上传 asset（uploadFile 返回值与 FileAsset 同形） */
type FileSend = {
  source: MediaInput;
  name?: string;
} | {
  asset: FileAsset;
};
/**
 * 消息统一结构基：type 判别类型，载荷字段平铺，收/发同构。
 * 仅媒体载荷按方向收窄（S='send' 可给输入源由 send 自动上传；S='recv' 恒为资产/资源形态可直接回传）。
 * text 为展示文本，一律可读；@ 提及并入 text 的 ats（含纯 @ 消息），@所有人 用 atAll（占位自动前置）。
 */
/** 接龙条目录入项（chains_entry_list[i]：e_c_u=提交者 uid、e_t=文本） */
interface ChainsEntry {
  uid: string;
  text: string;
}
/** 接龙消息（messageType=152，aweType=15200）：push_detail 即官方客户端展示文本 */
interface Chains {
  id: string;
  description: string;
  isStart: boolean;
  entries: ChainsEntry[];
}
/** 互动卡消息（messageType=110，aweType=110402 打卡邀请等）：im_dynamic_patch 为卡片载荷 */
interface Card {
  /** 卡片 key（patch.card_key，如 msg_guide / msg_preview） */
  key: string;
  /** 服务端卡片类型（patch.card_type，如 douyin_admin_msg_guide_invite / douyin_admin_msg_preview_ugc） */
  type: string;
  /** 卡片 id（patch.card_id；打卡卡 id 是嵌套 JSON 字符串，取内层 id） */
  id: string;
  /** 原互动类型（content.aweType，如引导卡 110402 / 打卡记录卡 110372；回传恢复原值） */
  aweType: number;
  /** 主文案（raw_data.content_middle_top / content_top 的 content） */
  title: string;
  /** 附属文案（raw_data.content_middle_content / content_middle 的 content） */
  desc: string;
  /** 按钮文案（raw_data.bottom / bottom_right 的 content） */
  button: string;
  /** 展示图片（raw_data.content_left / content_bottom 首位，url） */
  coverUrl: string;
  /** 官方签名（patch.sign，下发时生成；回传发送原样回填） */
  sign: string;
  /** 完整互动载荷（patch 原对象，收/发同构直接复用） */
  patch: Record<string, unknown>;
}
type RawBody<S extends 'send' | 'recv'> = {
  type: 'text';
  text: string;
  ats?: {
    uid: string;
    nickname?: string;
  }[];
  atAll?: boolean;
} | {
  type: 'image';
  text?: string;
  image: S extends 'send' ? ImageResource | MediaInput : ImageResource;
} | {
  type: 'video';
  text?: string;
  video: S extends 'send' ? VideoResource | VideoSend : VideoResource;
} | {
  type: 'file';
  text?: string;
  file: S extends 'send' ? FileAsset | FileSend : FileAsset;
} | {
  type: 'share';
  text?: string;
  share: ShareItem;
} | {
  type: 'userCard';
  text?: string;
  user: UserCard;
} | {
  type: 'forward';
  text?: string;
  nodes: ForwardNode[];
} | {
  type: 'audio';
  text?: string;
  audio: {
    urls: string[];
    uri: string;
  };
} | {
  type: 'emoji';
  text?: string;
  emoji: string;
} | {
  type: 'link';
  text?: string;
  link: LinkCard;
} | {
  type: 'chains';
  text?: string;
  chains: Chains;
} | {
  type: 'card';
  text?: string;
  card: Card;
} | {
  type: 'groupCard';
  text?: string;
  groupCard: GroupCard;
} | {
  type: 'location';
  text?: string;
  location: LocationCard;
} | {
  type: 'unknown';
  text?: string;
  raw: Record<string, unknown> | string;
};
/** 发侧消息体：统一走 bot.msg.send(chatId, body)，媒体可给输入源（send 自动上传） */
type MsgBody = RawBody<'send'>;
/** 收侧消息体：媒体恒为资产/资源形态，与 MsgBody 同构，可直接回传 send */
type RecvBody = RawBody<'recv'>;
//#endregion
//#region src/im/inbox.d.ts
interface InboxListOptions {
  cursor?: number;
  count?: number;
}
interface ConversationSettingInput {
  setStickOnTop?: boolean;
  setMute?: boolean;
  setFavorite?: boolean;
}
interface CreateGroupOptions {
  /** 参与成员 uid（含创建者本人） */
  participantUids: string[];
  name?: string;
  description?: string;
}
//#endregion
//#region src/im/content.d.ts
/** 文本 @ 提及（richTextInfos 元数据；收侧无昵称，text 为发侧可选） */
interface TextMention {
  uid: string;
  /** 会话 id（官方 info.con_id，@ 归属会话） */
  conId?: string;
  text?: string;
  location: number;
  length: number;
}
//#endregion
//#region src/im/send.d.ts
interface VoiceCallResult {
  /** call 阶段 VoipInfo.channel_id / create 失败的 channel_id */
  channelId?: string;
  /** VoipStatus */
  status?: number;
  /** CallVoipResponseBody.check_code */
  checkCode?: string;
  /** CallVoipResponseBody.check_message */
  checkMessage?: string;
  /** create 阶段 VoipStatusCode（非 0 表示创建失败） */
  statusCode?: number;
}
interface SendForwardOptions extends ConversationAddress {
  nodes: ForwardNode[];
  /** 发送者 uid（bot 自身） */
  selfUid: string;
  /** 发送者 secUid（bot 自身） */
  selfSecUid?: string;
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string;
  /** 引用元数据（refMsgInfo）：本条消息为引用回复 */
  reference?: SendMessageReference;
}
interface SendShareOptions extends ConversationAddress {
  item: ShareItem;
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string;
  /** 引用元数据（refMsgInfo）：本条消息为引用回复 */
  reference?: SendMessageReference;
}
interface SendUserCardOptions extends ConversationAddress {
  user: UserCard;
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string;
  /** 引用元数据（refMsgInfo）：本条消息为引用回复 */
  reference?: SendMessageReference;
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
  /** @所有人 引用回复：正文前置「@所有人 」占位，f9 mentioned_users=[0]（与 sendBody 同形态） */
  atAll?: boolean;
  /** @ 提及（正文 richTextInfos + f9 mentionedUsers）；缺省纯文本 */
  ats?: Array<{
    uid: string;
    nickname?: string;
  }>;
}
//#endregion
//#region src/im/query.d.ts
/** 会话成员已读游标行 */
interface ReadIndexRow {
  uid: string;
  /** 已读游标（微秒时间戳量级） */
  readIndex: number;
  extra?: number;
}
/** 会话成员最小同步游标行 */
interface MinIndexRow {
  uid: string;
  minIndex: number;
}
interface UserMessageQuery {
  /** uid 消息区间（int64 字符串） */
  startIndex?: string;
  messageType?: string;
  endIndex?: string;
  cursor?: string;
  inboxType?: number;
}
interface ClientAckItem {
  serverMessageId: string;
  clientMessageId?: string;
  conversationShortId?: string;
  /** 消息类型过滤，缺省 500（到达/已读确认） */
  messageType?: number;
  status?: number;
  count?: number;
  inboxType?: number;
}
interface StrangerListOptions {
  /** 分页游标 */
  cursor?: number;
  source?: number;
  scene?: number;
  inboxType?: number;
}
interface GetPeerRequest {
  appId?: number;
  sid?: number;
  taskType?: number;
  /** 原始键透传（vid/cdn_url/file_type/sfid 等），对齐服务端字段 */
  fileInfo: Record<string, unknown>;
}
interface GetPeerResult {
  status: number;
  fid: string;
  traceId: string;
  reqId: string;
  token: string;
  nodes: unknown[];
  multiNodes?: unknown[] | null;
  indexNum: number;
  countryCode: number;
  ispCode: number;
}
//#endregion
//#region src/im/users.d.ts
/** 用户公开资料（昵称/头像） */
interface UserProfile {
  nickname?: string;
  avatar?: string;
}
/** IM 用户信息（desktop im/user/info；未建模字段走 raw 透传） */
interface UserInfo {
  uid: string;
  secUid: string;
  nickname?: string;
  avatar?: string;
  signature?: string;
  shortId?: string;
  uniqueId?: string;
  followStatus?: number;
  followerStatus?: number;
  isBlock?: boolean;
  imActiveness?: number;
  raw: Record<string, unknown>;
}
/** 用户详细资料（profileScene/profileOther 共用；未建模字段走 raw 透传） */
interface ProfileDetail {
  uid: string;
  secUid: string;
  nickname?: string;
  signature?: string;
  avatar?: string;
  uniqueId?: string;
  followingCount?: number;
  followerCount?: number;
  followStatus?: number;
  followerStatus?: number;
  raw: Record<string, unknown>;
}
//#endregion
//#region src/im/active.d.ts
/** 在线状态项（secUserId 维度） */
interface OnlineItem {
  secUserId: string;
  /** 最后活跃时间（秒时间戳），0 表示从未在线 */
  lastActiveTime: number;
}
/** 已读回执项（conv_short_id 透传原样，避免 int64 在 JSON 里丢精度） */
interface ReadSwitchItem {
  msgId: string;
  convId: string;
  convShortId: string | number;
  createTime: number;
  convType: number;
}
//#endregion
//#region src/im/play.d.ts
/** 作品详情摘要（aweme 结构繁复，仅提取常用字段，其余透传 raw） */
interface AwemeDetail {
  awemeId: string;
  desc?: string;
  createTime?: number;
  /** 播放地址列表（video.play_addr.url_list） */
  playUrls?: string[];
  /** 封面地址列表（video.cover.url_list） */
  coverUrls?: string[];
  author?: {
    secUid?: string;
    nickname?: string;
    avatar?: string;
  };
  raw: Record<string, unknown>;
}
//#endregion
//#region src/im/emoji.d.ts
/** 官方表情资源（/aweme/v1/web/emoji/list/ 下发，id 为拼音资源名，name 与表态键值同源） */
interface EmojiInfo {
  /** 资源 id（如 weixiao / jinli） */
  id: string;
  /** 显示键值（如 [微笑]） */
  name: string;
  /** TOS 资源路径（tos-cn-i-tsj2vxp0zn/<hash>，hash 与官方面板小表情分区图片一致） */
  uri: string;
  /** CDN 直链（带签名时效，过期后可用 uri 重新换链） */
  urls: string[];
}
//#endregion
//#region src/im/resource.d.ts
/** 贴纸图片（static 静态 / animate 动图，抖音 GIF 表情即动图贴纸） */
interface StickerImage {
  width: number;
  height: number;
  uri: string;
  urls: string[];
}
/** 表情贴纸（收藏/自定义/官方面板通用结构） */
interface Sticker {
  /** 贴纸 id（用 id_str 字符串，服务端 number 字段在 JS 中会丢精度） */
  id: string;
  /** sticker_type：如 2=表情贴纸 */
  type: number;
  /** 显示名（如 [微笑]，空串不返回） */
  name?: string;
  hash?: string;
  /** 来源标记（comment_emoji 等） */
  source?: string;
  /** 静态图 */
  static?: StickerImage;
  /** 动图（webp/gif 载体） */
  animate?: StickerImage;
}
/** 表情资源列表页（scenes 决定响应顶层键，统一收拢为此结构） */
interface StickerPage {
  list: Sticker[];
  total: number;
  cursor: number;
  done: boolean;
}
/** 收藏操作结果：成功收藏/取消的贴纸 id */
interface StickerCollectResult {
  ids: string[];
}
/** strategy/config:app 能力开关结果（决策树 + 动效资源包配置） */
interface StrategyConfig {
  decisionTrees?: Record<string, unknown>;
  interactiveResourceConfig?: Record<string, unknown>;
}
//#endregion
//#region src/im/share.d.ts
/** 群分享入参：邀请链接（自动解析 secret/group_id）或纯 secret + conversationId */
interface GroupShareInput {
  /** 邀请链接或链接中的 secret（AAED 前缀） */
  share: string;
  /** 群 conversationId；链接自带 group_id 时可省略 */
  conversationId?: string;
  /** 邀请卡场景（invite_card_scene），缺省 0 */
  scene?: number;
}
/** 群分享校验结果：发群邀请卡所需的 ticket 与群资料 */
interface GroupShareResult {
  ticket: string;
  conversationId: string;
  conversationShortId: string;
  name: string;
  desc: string;
  avatar?: string;
  memberCount: number;
  ownerUid?: string;
  ownerSecUid?: string;
  ownerNickname?: string;
  inviterUid?: string;
  inviterSecUid?: string;
  auditQuestion?: string;
}
//#endregion
//#region src/im/account.d.ts
/** 当前 passport 账号详情(未建模字段走 raw 透传) */
interface AccountInfo {
  userId: string;
  secUserId: string;
  name?: string;
  screenName?: string;
  avatar?: string;
  mobile?: string;
  email?: string;
  gender?: number;
  hasPassword?: boolean;
  createTime?: number;
  raw: Record<string, unknown>;
}
//#endregion
//#region src/im/watch.d.ts
/** 弹幕条目（danmaku/get_v2 单条，仅提取常用字段） */
interface Danmaku {
  id: string;
  itemId: string;
  /** 发送者数字 uid */
  userId: string;
  /** 出现时刻（毫秒偏移） */
  offsetTime: number;
  text: string;
  diggCount: number;
  showDigg: boolean;
}
//#endregion
//#region src/im/social.d.ts
/** 社交用户摘要（spotlight/relation 与 familiar/list 共用；未建模字段走 raw 透传） */
interface SocialUser {
  uid: string;
  secUid: string;
  nickname: string;
  avatar?: string;
  signature?: string;
  uniqueId?: string;
  followStatus: number;
  followerStatus: number;
  raw: Record<string, unknown>;
}
/** 气泡详情（bubble/detail_list 单条；resource 结构繁复，只提取预览图） */
interface Bubble {
  id: string;
  name: string;
  type: number;
  source: number;
  description?: string;
  /** 亮色预览图 */
  lightPreview?: string;
  /** 暗色预览图 */
  darkPreview?: string;
  /** 是否为用户当前使用中的气泡 */
  current: boolean;
  raw: Record<string, unknown>;
}
/** 好友/关注列表分页（spotlight 返回 top 侧分页字段） */
interface RelationPage {
  users: SocialUser[];
  hasMore: boolean;
  maxTime: number;
  minTime: number;
}
//#endregion
//#region src/im/notify.d.ts
/** 通知分组未读数（notice/count 单组；401=互动，924=其他） */
interface NoticeCount {
  group: number;
  count: number;
  /** 红点未读数（含已读聚合） */
  dotCount: number;
  latestTime: number;
  showType: number;
  interactiveShowType: number;
}
/** 通知条目（notice/ 单条；type 决定 follow 等分组结构，未建模字段走 raw 透传） */
interface Notice {
  nid: string;
  type: number;
  createTime: number;
  raw: Record<string, unknown>;
}
/** 通知列表页 */
interface NoticePage {
  list: Notice[];
  hasMore: boolean;
  maxTime: number;
  minTime: number;
}
//#endregion
//#region src/im/setting.d.ts
/** 桌面 IM 消息设置（im/desktop/setting/get） */
interface DesktopSetting {
  /** 消息提醒开关 */
  messageAlert: number;
  /** 显示消息详情开关（服务端字段拼写即 swtich） */
  showMessageDetail: number;
}
/** 账号综合设置（user/settings，字段庞大，未建模字段走 raw 透传） */
interface UserSettings {
  /** 私密账号等级 */
  chatSet: number;
  teenMode: number;
  isMinor: boolean;
  settingsVersion?: string;
  raw: Record<string, unknown>;
}
/** 合规/青少年模式设置（compliance/settings） */
interface ComplianceSetting {
  minorControlType: number;
  isMinor: boolean;
  teenMode: number;
  raw: Record<string, unknown>;
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
  /** true 时自发消息也作为 message 事件下发（默认过滤） */
  selfMessage?: boolean;
  log?: Log;
}
type ImEventMap = {
  message: [message: InboundMessage];
  /** 消息被编辑（编辑重推：内容为编辑后全文，ext 带 editCount/editInfo） */
  'message:edited': [message: InboundMessage];
  notice: [notice: NoticeEvent];
  request: [request: RequestEvent];
  /** 语音来电（messageType=50018；出站未支持，来电可感知） */
  voip: [event: VoipCallEvent];
  /** 单聊已读回执（messageType=50013，发放于自发过滤之前） */
  read: [event: ReadEvent];
  /** 会话状态变更，高频（messageType=50001，发放于自发过滤之前） */
  status: [event: StatusEvent];
  reconnecting: [event: WsReconnectEvent];
  close: [event: WsCloseEvent];
};
type ImEvent = keyof ImEventMap;
type Listener<T extends ImEvent> = (...args: ImEventMap[T]) => void;
/**
 * IM 消息业务门面：收消息走 Android Frontier WS 推送，
 * 发消息统一 HTTP cookie 通道（native ImOption profile，cmd=100），
 * HTTP 同时承担收件箱查询/动作与媒体上传。方法直接转发到各模块。
 */
declare class Im {
  private readonly http;
  private readonly userId;
  private readonly deviceId;
  private readonly log;
  private readonly transport;
  private readonly uploader;
  private readonly inboxCtx;
  /** Android Frontier 长连接：接收推送 */
  private readonly ws;
  private readonly handlers;
  private readonly opts;
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
  /** 分发层调试日志：打印每条原始推送（含被过滤的自发），诊断收不到事件用 */
  private debug;
  /** 好友申请/入群申请走 request，其余通知走 notice */
  private routeEvent;
  sendText(address: ConversationAddress, text: string, mentions?: TextMention[]): Promise<SendMessageResponse>;
  /** 统一发送：type 判别一条消息（text/at 合 messageType=7，媒体/卡片各成一条），与收侧结构同构 */
  sendBody(address: ConversationAddress, body: MsgBody, opts?: SendBodyOptions): Promise<SendMessageResponse>;
  /** 上报输入状态（true 正在输入 / false 停止），对方端显示「正在输入…」 */
  sendTyping(address: ConversationAddress, typing: boolean): Promise<boolean>;
  /** 发起语音通话：未支持（服务端无 VOIP 通道，返回 statusCode=-1） */
  callVoice(address: ConversationAddress, calleeUid: string): Promise<VoiceCallResult>;
  /** 合并转发（messageType=136） */
  sendMergeForward(options: SendForwardOptions): Promise<SendMessageResponse>;
  /** 发送作品分享卡片（messageType=8 / aweType=800） */
  sendShare(options: SendShareOptions): Promise<SendMessageResponse>;
  /** 发送用户名片卡片（messageType=25 / aweType=0） */
  sendUserCard(options: SendUserCardOptions): Promise<SendMessageResponse>;
  reply(options: ReplyOptions): Promise<SendMessageResponse>;
  recall(item: RecallItem): Promise<RecallResult>;
  /** 消息表情回应（cmd=705 set_property，emoji 为抖音 skey 文本键；传小表情 id 自动解析为键值） */
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
  listConversationsByCookie(options?: InboxListOptions): Promise<GroupInfo[]>;
  /** 批量查用户资料（昵称/头像），按 secUid 索引 */
  getUserProfiles(secUids: string[]): Promise<Map<string, UserProfile>>;
  /** IM 用户信息（昵称/头像/签名/关系），按 secUid 批量 */
  userInfo(secUids: string[]): Promise<UserInfo[]>;
  /** 用消息视频的 tkey 换加密 CDN 播放地址（CENC 加密流） */
  videoUrl(tkey: string): Promise<EncryptedVideoUrl>;
  /** 官方表情资源全量映射（id/键值/CDN 直链），发送表情消息与表态键值用 */
  emojiList(): Promise<EmojiInfo[]>;
  /** 表情资源列表（sticker/scenes 决定面板：缺省我的收藏，其他面板场景可传参探测） */
  stickerList(options?: {
    scenes?: string;
    cursor?: number;
    limit?: number;
  }): Promise<StickerPage>;
  /** 我的收藏表情（CUSTOM_STICKER_PAGE 面板） */
  stickerFavs(): Promise<StickerPage>;
  /** 动图/GIF 表情：我的收藏中带 animate 动图的贴纸 */
  stickerGifs(): Promise<StickerPage>;
  /** 收藏/取消收藏表情（remove=true 取消） */
  stickerCollect(ids: string[], options?: {
    remove?: boolean;
  }): Promise<StickerCollectResult>;
  getChatHistory(address: ConversationAddress & {
    cursor?: number;
    count?: number;
  }): Promise<ChatMessage[]>;
  /** 按 id 批量查会话详情（ticket/未读/成员），映射对齐列表会话 */
  conversationsInfo(items: ConversationAddress[]): Promise<GroupInfo[]>;
  /** 群分享校验：用邀请链接的 secret 换取群邀请 ticket（不需先有 chatId） */
  verifyShare(input: GroupShareInput): Promise<GroupShareResult>;
  /** 会话成员已读游标（cmd=2000 get_read_index） */
  readIndex(conv: ConversationAddress): Promise<ReadIndexRow[]>;
  /** 会话成员最小同步游标（cmd=2001 get_min_index） */
  minIndex(conv: ConversationAddress): Promise<MinIndexRow[]>;
  /** 按 uid 消息区间查询（cmd=2048，HAR 语义不完整，返回原始结构） */
  userMessageStat(req?: UserMessageQuery): Promise<Record<string, unknown>>;
  /** 消息回执确认（cmd=2010 client/ack） */
  ackMessage(item: ClientAckItem): Promise<ActionResult>;
  /** 陌生人会话列表（cmd=1001，实测服务端限流 409 时 statusMsg 会给出原因） */
  strangerConversations(req?: StrangerListOptions): Promise<ActionResult>;
  /** 按文件信息调度 CDN 传输节点（vc-gate-edge get_peer） */
  getPeer(req: GetPeerRequest): Promise<GetPeerResult>;
  /** im 活跃心跳上报（登录后打一次即可，成功即静默） */
  heartbeat(): Promise<void>;
  /** 批量查 sec 用户在线状态（source 透传，缺省 heartbeat） */
  onlineStatus(secUserIds: string[], source?: string): Promise<OnlineItem[]>;
  /** 查询在线状态开关（1=开启，我可被对方看到在线） */
  activeSwitch(): Promise<number>;
  /** 标记一批消息已读（会话侧收件箱收到 50013 的依据） */
  readSwitch(items: ReadSwitchItem[]): Promise<void>;
  /** 对话场景资料（字段比 profileOther 少） */
  profileScene(secUid: string): Promise<ProfileDetail>;
  /** 完整资料（含地域/年龄等原始字段，raw 透传） */
  profileOther(secUid: string): Promise<ProfileDetail>;
  /** 自己的完整资料（其他接口查的是别人的资料） */
  profileSelf(): Promise<ProfileDetail>;
  /** 按 awemeId 批量拉消息中的作品详情（视频/图文） */
  awemeDetail(awemeIds: string[], options?: {
    originType?: string;
    requestSource?: number;
    conversationShortId?: string;
  }): Promise<AwemeDetail[]>;
  /** 热门表情分页（cursor+count 翻页） */
  emojiTrending(options?: {
    cursor?: number;
    count?: number;
  }): Promise<StickerPage>;
  /** app 能力开关（决策树 + 动效资源包配置） */
  strategyConfig(scenes?: string[]): Promise<StrategyConfig>;
  /** 图源 uri 渲染为打码图（分享卡片脱敏用），返回 CDN 直链列表 */
  privacyImage(uri: string, options?: {
    format?: string;
    tpl?: string;
  }): Promise<string[]>;
  /** 当前账号详情（uid/昵称/手机/邮箱，passport 登录态） */
  accountInfo(): Promise<AccountInfo>;
  /** passport 令牌心跳（scene=boot 启动 / polling 周期轮询），续杯防掉线 */
  beatToken(scene?: string): Promise<void>;
  /** 拉取作品弹幕（startTime/endTime 为毫秒偏移窗口） */
  danmaku(itemId: string, options?: {
    groupId?: string;
    startTime?: number;
    endTime?: number;
    duration?: number;
    token?: string;
  }): Promise<Danmaku[]>;
  /** 上报播放进度（服务端据此续播/记历史） */
  playProgress(itemId: string, progress: number, duration: number): Promise<void>;
  /** 短剧剧集观看记录 */
  seriesRecord(seriesId: string, itemId: string, episode: number): Promise<void>;
  /** 合集观看记录 */
  mixRecord(mixId: string, itemId: string, episode: number): Promise<void>;
  /** 写入观看历史（preItemId 缺省为空表示首次写入） */
  historyWrite(awemeId: string, options?: {
    authorId?: string;
    preItemId?: string;
  }): Promise<void>;
  /** 批量查作品安全等级 */
  safetyCheck(itemIds: string[]): Promise<Array<Record<string, unknown>>>;
  /** 气泡详情（附带当前使用标记） */
  bubbleDetail(bubbleId: string, options?: {
    needCurrent?: boolean;
  }): Promise<Bubble[]>;
  /** 关注/好友关系列表（count+source 可调，其余固定参数随官方） */
  spotlight(options?: {
    count?: number;
    source?: string;
  }): Promise<RelationPage>;
  /** 关注用户（type=0 关注；响应体为空，只判 HTTP 状态） */
  followUser(userId: string, secUid: string, options?: {
    type?: number;
    tag?: string;
  }): Promise<void>;
  /** 可能认识的人 */
  familiarList(options?: {
    count?: number;
    cursor?: number;
    recommendType?: number;
  }): Promise<SocialUser[]>;
  /** 通知分组未读数（登录后轮询红点用） */
  noticeCount(): Promise<NoticeCount[]>;
  /** 通知列表（缺省互动分组 401；markRead=false 拉取但不标记已读） */
  noticeList(options?: {
    count?: number;
    group?: number;
    maxTime?: number;
    minTime?: number;
    markRead?: boolean;
  }): Promise<NoticePage>;
  /** 桌面消息提醒设置 */
  desktopSetting(): Promise<DesktopSetting>;
  /** 账号综合设置（私密等级/青少年模式，raw 透传全量字段） */
  userSettings(): Promise<UserSettings>;
  /** 合规/青少年模式设置 */
  complianceSetting(): Promise<ComplianceSetting>;
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
  /** 拉人入群（cmd=650，成功/失败名单按响应回读） */
  addGroupMembers(address: ConversationAddress, uids: string[]): Promise<ActionResult & {
    success?: string[];
    failed?: string[];
  }>;
  /** 移出群成员（cmd=651） */
  removeGroupMembers(address: ConversationAddress, uids: string[]): Promise<ActionResult>;
  /** 退出群聊（cmd=652，响应为空 body） */
  leaveGroup(address: ConversationAddress): Promise<ActionResult>;
  /** 删除会话（cmd=603，响应为空 body） */
  deleteConversation(address: ConversationAddress, options?: {
    lastMessageIndex?: string;
  }): Promise<ActionResult>;
  /** 会话设置：置顶/免打扰/收藏（cmd=921，响应回读完整设置） */
  setConversationSetting(address: ConversationAddress, input: ConversationSettingInput): Promise<ActionResult & {
    setting?: Record<string, unknown>;
  }>;
  /** 创建群聊（cmd=609），返回创建出的会话 */
  createGroup(options: CreateGroupOptions): Promise<ActionResult & {
    group?: GroupInfo;
  }>;
  /** 批量查所有成员已读游标（cmd=2038，HAR 响应为空 body） */
  batchReadIndex(conv: ConversationAddress): Promise<ActionResult>;
  /** 统一发送上下文：HTTP cookie 通道（native ImOption profile）+ WS 直发通道辅助字段 */
  private sendCtx;
}
//#endregion
//#region src/im/cenc.d.ts
/**
 * 解密 CENC(cenc 方案) 加密 mp4：keyHex 为消息 `video.skey`（32 hex = 16 字节 AES-128）。
 * 输出可直接播放的 mp4；未加密的输入原样返回。
 */
declare function decryptCencMp4(data: Uint8Array, keyHex: string): Buffer;
//#endregion
//#region src/device.d.ts
interface Device {
  guid: string;
  deviceId: string;
  installId: string;
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
/** 入站消息附 chatId 与发送者昵称，发消息直接回传 */
type BotMessage = InboundMessage & {
  chatId: string;
  senderNickname?: string;
};
/** 可进昵称缓存的条目（好友/陌生人/群成员/申请列表的公共形状） */
type NickEntry = {
  uid: string;
  nickname?: string;
  alias?: string;
};
type BotEventMap = {
  message: [BotMessage];
  /** 消息被编辑（编辑重推：原消息全文 + editCount/editInfo 元数据） */
  'message:edited': [BotMessage];
  notice: [NoticeEvent];
  request: [RequestEvent];
  /** 语音来电（messageType=50018；出站 msg.call 未支持，来电可感知） */
  voip: [VoipCallEvent];
  /** 单聊已读回执（messageType=50013） */
  read: [ReadEvent];
  /** 会话状态变更，高频（messageType=50001） */
  status: [StatusEvent];
  reconnecting: [WsReconnectEvent];
  close: [WsCloseEvent];
};
type BotEvent = keyof BotEventMap;
declare class Msg {
  private readonly bot;
  constructor(bot: Bot);
  /** 统一发送：type 判别一条消息；媒体输入源自动上传，收侧消息对象可直接回传。
   *  opts.reply 传收到的消息对象即为引用回复（任意消息类型均可被引用）。 */
  send(chatId: string, body: MsgBody, opts?: SendBodyOptions & {
    reply?: BotMessage;
  }): Promise<ReturnType<Im['sendBody']>>;
  /** 编辑已发送消息——不支持：HTTP 复用原 cmid 会被服务端幂等去重（返回原消息 id，内容不更新），
   *  官方编辑走 App 专属通道（WS 直发已实测证伪）。此方法仅作为「同 cmid 发新消息（去重）」兜底。 */
  edit(chatId: string, clientMessageId: string, body: MsgBody): Promise<ReturnType<Im['sendBody']>>;
  /** 媒体输入源归一化：image/video/file 简写源先上传为资产，预上传 asset 原样透传 */
  private prepare;
  /** 上报输入状态（true 正在输入 / false 停止），对方端显示「正在输入…」 */
  sendTyping(chatId: string, typing: boolean): Promise<boolean>;
  /** 发起语音通话（未支持：服务端无 VOIP 通道，返回 statusCode=-1） */
  call(chatId: string, calleeUid: string): ReturnType<Im['callVoice']>;
  /** 引用回复：msg 为被引用消息（任意消息类型均可引），body 可为文本或任意消息体（如引用后发图片）。
   *  文本为空时不发送（防空消息）；opts 仅文本正文时生效，可带 @所有人/@提及。 */
  reply(chatId: string, msg: BotMessage, body: string | MsgBody, opts?: Pick<ReplyOptions, 'atAll' | 'ats'>): ReturnType<Im['sendBody']>;
  recall(chatId: string, serverMessageId: string): ReturnType<Im['recall']>;
  /** 表情回应：emoji 传抖音键值（如 '[爱心]'）或小表情 id（如 weixiao），isSet false 取消 */
  react(chatId: string, serverMessageId: string, emoji: string, isSet?: boolean): ReturnType<Im['modifyReaction']>;
  /** 标记已读；msg 缺省读到底 */
  read(chatId: string, msg?: BotMessage): ReturnType<Im['markRead']>;
}
declare class Media {
  private readonly bot;
  constructor(bot: Bot);
  /** 图片上传：url/路径/base64/字节均可 */
  image(input: MediaInput): Promise<ImageAsset>;
  /** 视频上传：url/路径/base64/字节均可 */
  video(input: MediaInput): Promise<VideoAsset>;
  /** 文件上传：url/路径/base64/字节均可，名字缺省从来源推断 */
  file(input: MediaInput, name?: string): Promise<FileUploadAsset>;
  /** 用消息视频的 tkey 换加密 CDN 播放地址（CENC 加密流，需解密后才能播放） */
  videoUrl(tkey: string): Promise<EncryptedVideoUrl>;
  /** 按 awemeId 批量拉作品详情（视频/图文） */
  awemeDetail(awemeIds: string[], options?: {
    originType?: string;
    requestSource?: number;
    conversationShortId?: string;
  }): ReturnType<Im['awemeDetail']>;
  /** CDN 传输节点调度（按文件信息选可用传输节点） */
  getPeer(req: GetPeerRequest): ReturnType<Im['getPeer']>;
  /** 官方表情资源全量映射（id/键值/CDN 直链），发送表情消息与表态键值用 */
  emojiList(): Promise<EmojiInfo[]>;
}
declare class Sticker$1 {
  private readonly bot;
  constructor(bot: Bot);
  /** 表情资源列表；scenes 缺省我的收藏，其他面板场景可自行传参探测 */
  list(options?: {
    scenes?: string;
    cursor?: number;
    limit?: number;
  }): ReturnType<Im['stickerList']>;
  /** 我的收藏表情（CUSTOM_STICKER_PAGE 面板） */
  favs(): ReturnType<Im['stickerFavs']>;
  /** 动图/GIF 表情：收藏中带 animate 动图的贴纸 */
  gifs(): ReturnType<Im['stickerGifs']>;
  /** 收藏/取消收藏表情（remove=true 取消） */
  collect(ids: string[], options?: {
    remove?: boolean;
  }): ReturnType<Im['stickerCollect']>;
  /** 热门表情分页（cursor+count 翻页） */
  trending(options?: {
    cursor?: number;
    count?: number;
  }): ReturnType<Im['emojiTrending']>;
  /** app 能力开关（决策树 + 动效资源包配置） */
  strategy(scenes?: string[]): ReturnType<Im['strategyConfig']>;
  /** 图源 uri 渲染为打码图（分享卡片脱敏用），返回 CDN 直链列表 */
  privacyImage(uri: string, options?: {
    format?: string;
    tpl?: string;
  }): ReturnType<Im['privacyImage']>;
}
declare class Frd {
  private readonly bot;
  constructor(bot: Bot);
  /** list 支持分页:cursor 起始游标,count 单页条数;缺省自动翻页拉全量 */
  list(options?: {
    cursor?: number;
    count?: number;
  }): Promise<Array<{
    chatId: string;
  } & Awaited<ReturnType<Im['getFriendList']>>[number]>>;
  requests(status?: FriendRequestStatus): ReturnType<Im['getFriendRequests']>;
  approve(uid: string): ReturnType<Im['approveFriend']>;
  reject(uid: string): ReturnType<Im['rejectFriend']>;
}
declare class Grp {
  private readonly bot;
  constructor(bot: Bot);
  /** list 支持分页:cursor 起始游标,count 单页条数;缺省自动翻页拉全量 */
  list(options?: {
    cursor?: number;
    count?: number;
  }): Promise<Array<{
    chatId: string;
  } & Awaited<ReturnType<Im['getGroupList']>>[number]>>;
  members(chatId: string): ReturnType<Im['getGroupMembers']>;
  /** 群入群申请；省略 chatId 查全部群 */
  requests(chatId?: string): ReturnType<Im['getGroupJoinRequests']>;
  approve(requestId: string): ReturnType<Im['approveGroupJoin']>;
  reject(requestId: string): ReturnType<Im['rejectGroupJoin']>;
  rename(chatId: string, name: string): ReturnType<Im['setGroupName']>;
  /** 拉人入群（cmd=650，成功/失败名单在返回里回读） */
  addMembers(chatId: string, uids: string[]): ReturnType<Im['addGroupMembers']>;
  /** 移出群成员（cmd=651） */
  removeMembers(chatId: string, uids: string[]): ReturnType<Im['removeGroupMembers']>;
  /** 退出群聊（cmd=652，响应为空 body） */
  leave(chatId: string): ReturnType<Im['leaveGroup']>;
  /** 创建群聊（cmd=609），返回会话（含 chatId） */
  create(options: CreateGroupOptions): Promise<Awaited<ReturnType<Im['createGroup']>> & {
    chatId?: string;
  }>;
  /** 群分享校验：用邀请链接换群邀请凭证（ticket 可直接填入 groupCard.ticket 发卡） */
  verifyShare(input: GroupShareInput): ReturnType<Im['verifyShare']>;
}
declare class Chat {
  private readonly bot;
  constructor(bot: Bot);
  history(chatId: string, opts?: {
    cursor?: number;
    count?: number;
  }): ReturnType<Im['getChatHistory']>;
  strangers(): ReturnType<Im['getStrangerList']>;
  /** 会话列表（旧 Cookie 通道，保留备用） */
  list(options?: {
    cursor?: number;
    count?: number;
  }): ReturnType<Im['listConversationsByCookie']>;
  /** 会话详情（ticket/未读/成员），映射对齐列表会话 */
  info(chatId: string): ReturnType<Im['conversationsInfo']>;
  /** 会话成员已读游标（cmd=2000 get_read_index） */
  readIndex(chatId: string): ReturnType<Im['readIndex']>;
  /** 会话成员最小同步游标（cmd=2001 get_min_index，增量拉取起点） */
  minIndex(chatId: string): ReturnType<Im['minIndex']>;
  /** 按 uid 消息区间查询（cmd=2048，语义不完整返回原始结构） */
  userMessageStat(req?: UserMessageQuery): ReturnType<Im['userMessageStat']>;
  /** 消息回执确认（cmd=2010 client/ack） */
  ack(chatId: string, serverMessageId: string): ReturnType<Im['ackMessage']>;
  /** 陌生人会话列表（实测服务端限流 409 时 statusMsg 会给出原因） */
  strangerConversations(): ReturnType<Im['strangerConversations']>;
  /** 将一批入站消息标记已读（会话侧收到 50013 已读回执的依据） */
  readSwitch(chatId: string, msgs: BotMessage[]): ReturnType<Im['readSwitch']>;
  /** 删除会话（cmd=603，响应为空 body） */
  delete(chatId: string): ReturnType<Im['deleteConversation']>;
  /** 会话设置：置顶/免打扰/收藏（cmd=921，响应回读完整设置） */
  setting(chatId: string, input: ConversationSettingInput): ReturnType<Im['setConversationSetting']>;
  /** 批量查所有成员已读游标（cmd=2038，HAR 响应为空 body） */
  batchReadIndex(chatId: string): ReturnType<Im['batchReadIndex']>;
}
declare class User {
  private readonly bot;
  constructor(bot: Bot);
  self(): Promise<SelfInfo>;
  /** passport 账号详情（uid/昵称/手机/邮箱，登录态） */
  account(): ReturnType<Im['accountInfo']>;
  /** passport 令牌心跳（scene=boot 启动 / polling 周期轮询），续杯防掉线 */
  beatToken(scene?: string): ReturnType<Im['beatToken']>;
  /** 批量查用户信息（昵称/头像/签名/关系），按 secUid */
  info(secUids: string[]): ReturnType<Im['userInfo']>;
  /** 对话场景资料（字段比 profileOther 少） */
  profileScene(secUid: string): ReturnType<Im['profileScene']>;
  /** 完整资料（含地域/年龄等原始字段，raw 透传） */
  profileOther(secUid: string): ReturnType<Im['profileOther']>;
  /** 自己的完整资料 */
  profileSelf(): ReturnType<Im['profileSelf']>;
  /** 批量查 sec 用户在线状态 */
  onlineStatus(secUserIds: string[], source?: string): ReturnType<Im['onlineStatus']>;
  /** im 活跃心跳上报（登录后打一次即可） */
  heartbeat(): ReturnType<Im['heartbeat']>;
  /** 在线状态开关（1=开启，我可被对方看到在线） */
  activeSwitch(): ReturnType<Im['activeSwitch']>;
}
declare class Social {
  private readonly bot;
  constructor(bot: Bot);
  /** 关注/好友关系列表（count+source 可调） */
  spotlight(options?: {
    count?: number;
    source?: string;
  }): ReturnType<Im['spotlight']>;
  /** 可能认识的人 */
  familiar(options?: {
    count?: number;
    cursor?: number;
    recommendType?: number;
  }): ReturnType<Im['familiarList']>;
  /** 关注用户（响应体为空，只判 HTTP 状态） */
  follow(userId: string, secUid: string, options?: {
    type?: number;
    tag?: string;
  }): ReturnType<Im['followUser']>;
  /** 气泡详情 */
  bubble(bubbleId: string, options?: {
    needCurrent?: boolean;
  }): ReturnType<Im['bubbleDetail']>;
}
declare class Watch {
  private readonly bot;
  constructor(bot: Bot);
  /** 拉取作品弹幕（startTime/endTime 毫秒偏移窗口） */
  danmaku(itemId: string, options?: {
    groupId?: string;
    startTime?: number;
    endTime?: number;
    duration?: number;
    token?: string;
  }): ReturnType<Im['danmaku']>;
  /** 上报播放进度 */
  progress(itemId: string, progress: number, duration: number): ReturnType<Im['playProgress']>;
  /** 短剧剧集观看记录 */
  series(seriesId: string, itemId: string, episode: number): ReturnType<Im['seriesRecord']>;
  /** 合集观看记录 */
  mix(mixId: string, itemId: string, episode: number): ReturnType<Im['mixRecord']>;
  /** 写入观看历史 */
  history(awemeId: string, options?: {
    authorId?: string;
    preItemId?: string;
  }): ReturnType<Im['historyWrite']>;
  /** 批量查作品安全等级 */
  safety(itemIds: string[]): ReturnType<Im['safetyCheck']>;
}
declare class Notice$1 {
  private readonly bot;
  constructor(bot: Bot);
  /** 通知分组未读数（红点轮询用） */
  count(): ReturnType<Im['noticeCount']>;
  /** 通知列表（缺省互动分组 401；markRead=false 拉取不标记已读） */
  list(options?: {
    count?: number;
    group?: number;
    maxTime?: number;
    minTime?: number;
    markRead?: boolean;
  }): ReturnType<Im['noticeList']>;
}
declare class Setting {
  private readonly bot;
  constructor(bot: Bot);
  /** 桌面消息提醒设置 */
  desktop(): ReturnType<Im['desktopSetting']>;
  /** 账号综合设置（私密等级/青少年模式，raw 透传全量字段） */
  account(): ReturnType<Im['userSettings']>;
  /** 合规/青少年模式设置 */
  compliance(): ReturnType<Im['complianceSetting']>;
}
interface BotOpts {
  /** 登录 Cookie（login 返回或已登录浏览器复制） */
  cookie: string;
  /** 自身数字 uid；省略时 start() 自动获取 */
  userId?: string;
  userAgent?: string;
  timeout?: number;
  /** true 时自发消息也作为 message 事件下发（默认过滤） */
  selfMessage?: boolean;
  /**
   * 已持久化的设备身份（device_register 签发）；注入后跳过注册，避免每次启动重新注册。
   * 从上次 `bot.device` / `login()` 返回的 session.device 落盘复用即可。
   */
  device?: Device;
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
  readonly sticker: Sticker$1;
  readonly social: Social;
  readonly watch: Watch;
  readonly notice: Notice$1;
  readonly setting: Setting;
  private readonly opts;
  private readonly log;
  private userId;
  private httpInstance?;
  private imInstance?;
  /** uid → 昵称 + 写入时间缓存：事件下发 senderNickname 用（群成员 alias 优先）；TTL 1 分钟，过期随好友列表整体刷新（昵称会变更，避免长期陈旧） */
  private readonly nicks;
  private readonly nickAt;
  private static readonly NICK_TTL;
  private static readonly now;
  /** 单条写入（消息补拉路径用，与 rememberNicks 一致记时间） */
  private setNick;
  /** 正在后台补拉昵称的 uid，防重复请求 */
  private readonly nickFetching;
  /** start 前注册的监听，start 时统一接到 Im */
  private readonly pending;
  constructor(opts: BotOpts);
  /** 自身数字 uid（start 后可用） */
  get id(): string;
  /**
   * 当前设备身份（start 后可用）；持久化后可在下次构造时用 `opts.device` 注入，
   * 避免每次启动重新注册（注册失败会回退随机 GUID 哈希，身份不稳定易触发 MFA）。
   */
  get device(): Device | undefined;
  on<T extends BotEvent>(event: T, fn: (...args: BotEventMap[T]) => void): void;
  off<T extends BotEvent>(event: T, fn: (...args: BotEventMap[T]) => void): void;
  start(): Promise<void>;
  /** 列表查询结果顺带进昵称缓存（记录写入时间供 TTL 判定） */
  rememberNicks(entries: readonly NickEntry[]): void;
  /** 按 uid 查昵称：TTL 内命中直接返回，过期/未命中拉一次好友列表整体回填（发送 @ 自动补昵称用） */
  nickOf(uid: string): Promise<string | undefined>;
  /** 发送者昵称补拉：未命中先查资料接口/列表，同 uid 并发去重共用同一 promise；失败静默不影响下发 */
  private ensureNick;
  private fetchNicks;
  /** message 事件补 chatId 与 senderNickname（等待补拉完成，首条即带昵称），其余事件原样透传 */
  private bind;
  /** 视频播放地址补拉：随事件直接下发完整解密流程所需 URL；失败静默（调用方仍可 media.videoUrl 手动换） */
  private ensureVideoUrl;
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
/** 服务端可选的二次验证方式(assist_ 前缀 = 安全手机) */
interface VerifyWay {
  verify_way?: string;
  mobile?: string;
  sms_content?: string;
  channel_mobile?: string;
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
  /**
   * 二次验证方式拉取:触发时回调服务端全部可用方式,返回要使用的 verify_way 名称;
   * 返回 undefined 走内置优先级(安全手机短信 > 绑定手机短信 > 上行短信 > 密码)
   */
  onVerifyWays?: (ways: VerifyWay[]) => string | undefined | Promise<string | undefined>;
  userAgent?: string;
  /**
   * 已持久化的设备身份；注入后跳过注册（沿用同一设备登录，避免每次登录触发 MFA）。
   * 省略时注册新设备并通过 `session.device` 返回。
   */
  device?: Device;
  log?: Log;
}
/** 登录会话:userId 为数字 uid(frontier 握手/消息过滤需要),存储由调用方自理 */
interface Session {
  userId: string;
  cookie: string;
  userData?: QrUserData;
  /** 本次登录使用的设备身份;落盘后可在下次 login / new Bot 注入复用 */
  device?: Device;
}
/** 扫码登录全流程;调用链形态对齐 douyin-im beginLogin 桌面流程 */
declare function login(opts?: LoginOpts): Promise<Session>;
//#endregion
export { type AccountInfo, type ActionResult, type AwemeDetail, Bot, type BotEvent, type BotEventMap, type BotMessage, type BotOpts, type Bubble, type Card, type ChatMessage, type ClientAckItem, type ComplianceSetting, type ConversationAddress, type Danmaku, type DesktopSetting, type Device, type EmojiInfo, type EncryptedVideoUrl, type FileUploadAsset, type FriendInfo, type FriendRequestInfo, type GetPeerRequest, type GetPeerResult, type GroupCard, type GroupInfo, type GroupJoinRequestInfo, type GroupMemberChange, type GroupMemberInfo, type GroupMemberUpdate, type GroupShareInput, type GroupShareResult, type ImageAsset, type InboundMessage, type LinkCard, type LocationCard, type Log, type LoginOpts, type MediaInput, type MfaInfo, type MinIndexRow, type MsgBody, type Notice, type NoticeCount, type NoticeEvent, type NoticePage, type OnlineItem, type ProfileDetail, type QrStatus, type ReadEvent, type ReadIndexRow, type ReadSwitchItem, type RecallResult, type RecvBody, type RelationPage, type RequestEvent, type Session, type ShareItem, type SocialUser, type StatusEvent, type Sticker, type StickerCollectResult, type StickerImage, type StickerPage, type StrangerInfo, type StrangerListOptions, type StrategyConfig, type TextMention, type UserCard, type UserMessageQuery, type UserProfile, type UserSettings, type VerifyWay, type VideoAsset, type VideoSend, type VoipCallEvent, type WsCloseEvent, type WsReconnectEvent, chatIdOf, createLog, decryptCencMp4, login };