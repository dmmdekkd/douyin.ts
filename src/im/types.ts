import type { ImageResource, VideoResource, FileAsset, LinkCard, UserCard, VideoSend, LocationCard, GroupCard } from './media.js'
import type { MediaInput } from './source.js'

/* ---------------------------------------------------------------------------
 * 会话与消息
 * ------------------------------------------------------------------------- */

export interface ConversationMember {
  uid: string
  secUid?: string
  role: number
}

/** cmd 2006 返回的会话；纯数字 ID 且 type=2 的条目为群聊。 */
export interface GroupInfo {
  conversationId: string
  conversationShortId: string
  conversationType: number
  isGroup: boolean
  name: string
  avatar?: string
  ownerUid?: string
  lastMessageTime: number
  members: ConversationMember[]
  /** 群号（ConversationCoreInfo.ext 的 a:s_group_number，客户端群资料页展示；私聊无） */
  groupNumber?: string
  /** 会话校验凭证（proto ConversationV2.ticket，发群邀请卡 aweme_invite_card.ticket 同源） */
  ticket?: string
}

export interface ThreadPeer {
  uid: string
  secUid?: string
  nickname: string
  avatarThumb?: string
  [key: string]: unknown
}

export interface ChatMessage {
  msgId: string
  threadId: string
  senderUid: string
  senderSecUid?: string
  content: string
  msgType: number
  createTime: number
  status: number
  indexInConversation?: string
  indexInConversationV2?: string
  [key: string]: unknown
}

/** 会话线程（get_by_user_init 返回；陌生人/好友列表的中间结构） */
export interface PrivateThread {
  threadId: string
  /** protobuf int64，必须用字符串避免精度丢失 */
  conversationShortId?: string
  conversationType?: number
  peer: ThreadPeer
  lastMessage?: ChatMessage
  unreadCount: number
  updateTime: number
  [key: string]: unknown
}

/** 好友（P2P 会话对端）信息 */
export interface FriendInfo {
  uid: string
  secUid?: string
  nickname: string
  conversationId: string
  conversationShortId: string
  lastMessage?: ChatMessage
  lastMessageTime: number
  unreadCount: number
}

/** 陌生人会话信息 */
export interface StrangerInfo {
  uid: string
  nickname?: string
  conversationId: string
  conversationShortId: string
  lastMessage?: ChatMessage
  lastMessageTime: number
  unreadCount: number
}

/* ---------------------------------------------------------------------------
 * 发送
 * ------------------------------------------------------------------------- */

/** 会话寻址（发送/撤回等共用）；type=50 为盖楼：conversationId 即 threadId 全串 */
export interface ConversationAddress {
  conversationId: string
  conversationShortId: string
  conversationType: 1 | 2 | 50
  inboxType?: number
}

/** 作品分享卡片入参（messageType=8 / aweType=800）；itemId 与 uid 须对应真实作品，其余字段可选 */
export interface ShareItem {
  /** 作品 id（itemId），服务端可能校验存在性 */
  itemId: string
  /** 作者数字 uid */
  uid: string
  /** 作者 sec uid（缺省不渲染作者头像/主页跳转） */
  secUid?: string
  /** 作品标题（content_title），缺省用 itemId */
  title?: string
  /** 作者昵称（content_name） */
  authorName?: string
  /** 封面 URL（缺省卡片无封面图） */
  coverUrl?: string
}

/** 引用消息元数据；在 cmd100 field 11 编码，正文仍使用普通文本 content。 */
export interface SendMessageReference {
  referencedMessageId: string
  hint: string
  rootMessageId?: string
  rootMessageConvIndex?: string
}

export interface SendMessageItem {
  conversationId: string
  conversationShortId: string
  conversationType?: 1 | 2 | 50
  inboxType?: number
  /** 消息 content；普通文本可直接传文本，会自动包装为 desktop 模板 */
  content: string
  messageType?: number
  /** 引用消息；提供时走 reply 路径 */
  reference?: SendMessageReference
  /** @ 提及的用户 uid（sendMessage 字段 9） */
  mentionedUsers?: string[]
  /** @所有人 发送：ext 写 s:mentioned_users="0"（HAR 权威样本：web 客户端 @all 时值填 "0"） */
  atAll?: boolean
  /** 客户端消息 id；同会话重复使用会被服务端幂等去重（返回原消息 id） */
  clientMessageId?: string
}

/** sendBody 附加选项 */
export interface SendBodyOptions {
  clientMessageId?: string
  /** 引用元数据（refMsgInfo）；提供时本条消息为引用回复，与消息类型无关 */
  reference?: SendMessageReference
}

/** 消息表情回应（cmd=705 set_property，key=se:<emoji>） */
export interface ModifyReactionItem extends ConversationAddress {
  serverMessageId: string
  /** 抖音表态键值（skey 文本表情，如 '[爱心]'）或小表情 id（如 weixiao，自动解析为键值） */
  emoji: string
  /** 表态者 uid（bot 自身） */
  operatorUid: string
  /** true 添加 / false 移除 */
  enabled: boolean
}

export interface SendMessageResponse {
  statusCode: number
  statusMsg: string
  serverMessageId?: string
  clientMessageId?: string
  /** 内容安全审核状态码（0=通过，非0=被拦截/需审核） */
  checkCode?: number
}

export interface RecallItem extends ConversationAddress {
  serverMessageId: string
}

/** 会话标记已读（cmd=2002 mark_conversation_read，对齐 native rawMarkConversationRead） */
export interface MarkReadItem extends ConversationAddress {
  /** 已读位置：read_message_index（proto field 4，取消息 createTime 微秒时间戳） */
  readMessageIndex?: string
  /** 已读位置 v2（read_message_index_v2，proto field 7，可选） */
  readMessageIndexV2?: string
  /** 已读的消息 id（server_message_id，proto field 10，可选） */
  serverMessageId?: string
}

export interface RecallResult {
  statusCode: number
  statusMsg: string
  recalled: boolean
}

export interface ActionResult {
  statusCode: number
  statusMsg: string
  checkCode?: number
}

/* ---------------------------------------------------------------------------
 * 群成员 / 申请
 * ------------------------------------------------------------------------- */

export interface GroupMemberInfo {
  uid: string
  secUid?: string
  nickname?: string
  avatar?: string
  role: number
  alias?: string
  sortOrder?: string
  blocked?: number
  leftBlockTime?: string
  ext?: Readonly<Record<string, string>>
}

export enum GroupJoinRequestStatus {
  PENDING = 1,
  APPROVED = 2,
  REJECTED = 3,
  INVALID = 4,
}

export interface GroupJoinRequestInfo {
  requestId: string
  applicantUid: string
  applicantSecUid?: string
  applicantNickname?: string
  applicantAvatar?: string
  groupShortId: string
  conversationType: number
  status: GroupJoinRequestStatus
  reason?: string
  inviterUid?: string
  inviterSecUid?: string
  createdAt?: string
  modifiedAt?: string
  moderatorUid?: string
  ext?: Readonly<Record<string, string>>
}

export enum FriendRequestStatus {
  PENDING = 1,
  APPROVED = 2,
  REJECTED = 3,
  INVALID = 4,
}

export interface FriendRequestInfo {
  applicantUid: string
  nickname?: string
  avatar?: string
  requestedAt?: string
  status: FriendRequestStatus
  message?: string
  ext?: Readonly<Record<string, string>>
}

/* ---------------------------------------------------------------------------
 * 推送 / 通知 / 请求事件
 * ------------------------------------------------------------------------- */

/** 被引用消息（回复）信息：同 cmd=100 refMsgInfo 字段结构 */
export interface MessageReference {
  referencedMessageId: string
  hint: string
  rootMessageId?: string
}

/** WS 原始推送（解析前中间结构，等价参考 ImPushMessage） */
export interface PushMessage {
  cmd: number
  inboxType?: number
  conversationId: string
  conversationShortId: string
  conversationType: number
  senderUid: string
  senderSecUid?: string
  content: string
  messageType: number
  serverMessageId?: string
  createTime?: string
  indexInConversation?: string
  indexInConversationV2?: string
  reference?: MessageReference
  /** 盖楼层 id（serverMessageId:clientMessageId:convShortId）；楼内消息均有 */
  threadId?: string
  /** 盖楼短 id */
  threadShortId?: string
  /** 盖楼根消息（messageType=50002、正文为空），楼内回复为普通文本消息 */
  isThreadRoot?: boolean
  /** 消息编辑次数（ext s:edit_count）；编辑重推后 ≥1 */
  editCount?: number
  /** 消息编辑元数据（ext s:edit_info，content_editor 为 19 位 uid 已保精度） */
  editInfo?: { contentIsEdited: boolean; editorUid: string; editTime: string }
  /** 编辑前原始消息类型（ext s:org_msg_type；编辑重推时 messageType 可能变化，如根消息 org=7 而 messageType=50002） */
  orgMsgType?: number
  /** f:9 key-values（s:xxx / a:xxx 上下文键；撤回帧的 target_server_message_id 等在此，content 常为空） */
  ext?: Readonly<Record<string, string>>
  raw: Record<string, unknown>
}

/** 入站业务消息：原始推送 + 收侧平铺消息体（type 判别，text 一律可读；媒体恒为资产形态，替代段数组） */
export type InboundMessage = PushMessage & RecvBody

export type GroupMemberIncreaseSource =
  | 'invite'
  | 'command'
  | 'qrcode'
  | 'duoshan'
  | 'apply'
  | 'search'
  | 'activity'
  | 'face-to-face'
  | 'circle'
  /** 被移出成员重新入群（50011 unblock diff 通道） */
  | 'rejoin'
  /** 50001 command_type=7 成员变更帧（增删成员同步，无来源信息） */
  | 'sync'

export type GroupMemberDecreaseSource = 'kick' | 'leave' | 'sync'

export interface NoticeUser {
  uid: string
  secUid?: string
  nickname?: string
}

/** 语音/视频来电（messageType=50018 响铃信令，cmd=500 推送）。主叫=推送发送者；callInfo 含服务端 RTC 入会参数（individual.live_core_param 等）。
 * 区分语音/视频看 cameraOff：0=视频（开摄像头）、1=语音；voipType 恒为 1（1v1 通话形态，非媒体类型） */
export interface VoipCallEvent {
  type: 'voip.call'
  conversationId: string
  conversationType: number
  callerUid: string
  callId: string
  roomId: string
  /** 1v1 通话形态（实测恒为 1）；媒体类型看 cameraOff */
  voipType: number
  callType: number
  /** 0=视频通话 / 1=语音通话（发起时摄像头策略，实测为语音视频区分依据） */
  cameraOff: number
  /** 原始 call_info（participants/individual/init_state 等全量字段） */
  callInfo: Record<string, unknown>
}

/** 单聊已读回执（messageType=50013，cmd=504 推送；发送者视角显示为本机，读方取自 content.P2PSender） */
export interface ReadEvent {
  type: 'read'
  conversationId: string
  /** 已读方 uid */
  readerUid: string
  /** 会话短 id */
  conShortId: string
  /** 最新被读消息 id */
  messageId: string
  /** 已读方游标 */
  readIndex: string
}

/** 会话属性变更项（content.ext_data[i]；如 a:chat_theme 更换背景） */
export interface StatusExtItem {
  key: string
  value: string
  version: number
  opType: number
}

/** 群成员资料变更明细（content.updated_participant_info[i]；role 0 普通 / 1 群主 / 2 管理员） */
export interface GroupMemberUpdate {
  uid: string
  role: number
  secUid?: string
  /** 群昵称：本帧下发即表示昵称被变更（有值=新昵称，空串=昵称被清空）；未下发表示本帧未涉及昵称 */
  alias?: string
}

/** 群成员变更（command_type=7）：增删成员与角色/群主/群昵称变更；added/removed 均空而 updated 非空即成员资料变更 */
export interface GroupMemberChange {
  /** 新增成员 uid（added_participant） */
  added: string[]
  /** 移除成员 uid（removed_participant） */
  removed: string[]
  /** 角色/群昵称等资料变更明细（modified_participant 对应 updated_participant_info） */
  updated: GroupMemberUpdate[]
  /** 变更前群主 uid（仅群主移交帧与 newOwnerId 成对带出） */
  oldOwnerId?: string
  /** 变更后群主 uid（new_owner_id 非 0 即群主移交；普通帧无此键） */
  newOwnerId?: string
}

/**
 * 会话状态变更（messageType=50001，高频，自发也下发）。command_type 实测取值：
 * 1/14 红点计数与已读游标同步、2 消息删除（message_id 指向被删消息）、6 会话属性变更（nameChange/avatarChange/ext_data 带具体属性）、7 群成员变更（memberChange）。
 */
export interface StatusEvent {
  type: 'status'
  conversationId: string
  conversationType: number
  commandType: number
  /** 未读计数；仅红点同步类（command_type=1/14）携带，删除/属性变更等缺省无 */
  unread?: number
  /** 已读游标 */
  readIndex: string
  /** 被删消息 id（command_type=2 携带，ext 字符串无损；content.message_id 为 JS 精度丢失版） */
  messageId?: string
  /** 群名变更（command_type=6 且 ext_data 含 a:s_name_operator / a:group_name_lifecycle-event=name_change）；name 为新群名，operatorUid 来自 a:s_name_operator（缺省空） */
  nameChange?: { name: string; operatorUid: string }
  /** 群头像变更（command_type=6 且 ext_data 含 a:group_avatar_user_set / s_user_set_avatar / a:ab_avatar）；icon 为新头像 URL，operatorUid 来自前者（ab_avatar 帧缺省空） */
  avatarChange?: { icon: string; operatorUid: string }
  /** 群成员变更（command_type=7）：增删成员/角色变更/群主变更/群昵称变更 */
  memberChange?: GroupMemberChange
  /** 会话属性变更（command_type=6 时带；如 a:chat_theme） */
  extData?: StatusExtItem[]
  /** 原始 content（conversation_id/read_index_v2/inbox_type 等全量字段） */
  raw: Record<string, unknown>
}

/** 业务通知事件（撤回/好友增减/群成员增减/已读等；好友与入群申请分流到 RequestEvent） */
export type NoticeEvent =
  | {
    /** cmd=500 f500 property 推送的消息表情回应（ModifyPropertyBody 下发）。 */
    type: 'message.reaction'
    conversationId: string
    serverMessageId: string
    /** 抖音表态键值（se: 后文本，如 '[爱心]'） */
    emoji: string
    /** 表态者 uid（idempotent_id） */
    operatorUid: string
    /** true 添加 / false 移除 */
    isSet: boolean
    raw: Record<string, unknown>
  }
  | {
    /** cmd508 的好友关系建立事实。 */
    type: 'friend.increase'
    peerUid: string
    fromUid?: string
    toUid?: string
    content?: string
    ext?: Readonly<Record<string, string>>
    raw: Record<string, unknown>
  }
  | {
    /** cmd508 的好友关系解除事实。 */
    type: 'friend.decrease'
    peerUid: string
    fromUid?: string
    toUid?: string
    content?: string
    ext?: Readonly<Record<string, string>>
    raw: Record<string, unknown>
  }
  | {
    type: 'conversation.read'
    conversationId: string
    conversationType: number
    readMessageIndex: string
    readMessageIndexV2: string
    raw: Record<string, unknown>
  }
  | {
    /** cmd504 NewP2PMessageNotify 的输入状态回推（客户端输入框有内容时周期上报）。 */
    type: 'conversation.typing'
    conversationId: string
    /** 双人对话对端 uid */
    peerUid: string
    peerSecUid?: string
    /** 正在输入的成员 uid */
    senderUid: string
    /** true 正在输入 / false 已停止 */
    typing: boolean
    raw: Record<string, unknown>
  }
  | {
    type: 'conversation.update'
    conversationId: string
    conversationType: number
    raw: Record<string, unknown>
  }
  | {
    type: 'conversation.delete'
    conversationId: string
    conversationType: number
    /** 原始推送 ext（f:9 key-values；群解散导致的删除带 :dissolv_his 标记） */
    ext?: Readonly<Record<string, string>>
    raw: Record<string, unknown>
  }
  | {
    type: 'message.recall'
    conversationId: string
    conversationType: number
    /** 被撤回消息 id（ext s:target_server_message_id） */
    serverMessageId?: string
    /** 被撤回消息客户端 id（ext s:target_client_message_id） */
    targetClientMessageId?: string
    /** 撤回操作者 uid（ext s:recall_uid） */
    recallUid?: string
    /** 撤回者身份（ext s:recall_role，实测 1） */
    recallRole?: number
    /** 原始推送 ext（f:9 key-values，撤回辅助信息） */
    ext?: Readonly<Record<string, string>>
    raw: Record<string, unknown>
  }
  | {
    /** 群系统消息中的成员加入事实；一条消息可以包含多个成员。 */
    type: 'group.member-increase'
    conversationId: string
    conversationShortId: string
    conversationType: 2
    source: GroupMemberIncreaseSource
    members: NoticeUser[]
    operators: NoticeUser[]
    raw: Record<string, unknown>
  }
  | {
    /** 群系统消息中的成员离开事实；kick 的 passive_users 为离群成员，leave 的 active_users 为离群成员。 */
    type: 'group.member-decrease'
    conversationId: string
    conversationShortId: string
    conversationType: 2
    source: GroupMemberDecreaseSource
    members: NoticeUser[]
    operators: NoticeUser[]
    raw: Record<string, unknown>
  }
  | {
    /** messageType=1001, aweType=100110；设为管理员。 */
    type: 'group.admin'
    conversationId: string
    conversationShortId: string
    conversationType: 2
    members: NoticeUser[]
    operators: NoticeUser[]
    enabled: true
    raw: Record<string, unknown>
  }
  | {
    /** messageType=1001, aweType=100106；name 取不到时仍保留通知和 raw。 */
    type: 'group.name-change'
    conversationId: string
    conversationShortId: string
    conversationType: 2
    name?: string
    operators: NoticeUser[]
    raw: Record<string, unknown>
  }
  | {
    /** messageType=1001, aweType=100115；avatar 取不到时仍保留通知和 raw。 */
    type: 'group.avatar-change'
    conversationId: string
    conversationShortId: string
    conversationType: 2
    avatar?: string
    operators: NoticeUser[]
    raw: Record<string, unknown>
  }
  | {
    /** messageType=1001, aweType=100124；群被解散（解散者即推送发送方，无 active_users）。 */
    type: 'group.dismiss'
    conversationId: string
    conversationShortId: string
    conversationType: 2
    /** 解散操作者（取推送发送方；取不到时缺省） */
    operatorUid?: string
    operators: NoticeUser[]
    raw: Record<string, unknown>
  }
  | {
    type: 'im.command'
    conversationId: string
    conversationType: number
    messageType: number
    content: string
    raw: Record<string, unknown>
  }

/** 需要上层处理的请求事件（好友申请 / 入群申请） */
export type RequestEvent =
  | {
    /** cmd508 的 SendApply 信号；SDK 收到后刷新可处理的好友申请列表。 */
    type: 'friend.request'
    applicantUid: string
    fromUid?: string
    toUid?: string
    content?: string
    ext?: Readonly<Record<string, string>>
    raw: Record<string, unknown>
  }
  | {
    /** cmd500 messageType=90001；SDK 收到后拉取审核列表再生成可操作 request。 */
    type: 'group.join-request'
    conversationId: string
    conversationShortId: string
    conversationType: number
    requestId?: string
    content: string
    raw: Record<string, unknown>
  }

/* ---------------------------------------------------------------------------
 * 消息统一结构（收/发同构）：type 判别，载荷字段平铺；发侧媒体可为输入源，send 自动上传
 * ------------------------------------------------------------------------- */

/** 合并转发节点（messageType=136 list_content + msg_ids） */
export interface ForwardNode {
  /** 发送者 uid */
  uid: string
  /** 发送者昵称 */
  nickname: string
  /** 节点文本摘要（图片为 [图片] 等） */
  text: string
  /** 节点消息类型（7 文本 / 27 图片 …） */
  msgType: number
  /** 节点 aweType（700 文本 / 2702 图片 …） */
  aweType: number
  /** 节点消息 id */
  msgId: string
  /** 发送者 secUid（如有） */
  secUid?: string
  /** 节点发送时间 ms */
  createTime?: number
}

/** 文件发送项：source 简写（自动上传，name 缺省从来源推断）或预上传 asset（uploadFile 返回值与 FileAsset 同形） */
export type FileSend =
  | { source: MediaInput; name?: string }
  | { asset: FileAsset }

/**
 * 消息统一结构基：type 判别类型，载荷字段平铺，收/发同构。
 * 仅媒体载荷按方向收窄（S='send' 可给输入源由 send 自动上传；S='recv' 恒为资产/资源形态可直接回传）。
 * text 为展示文本，一律可读；@ 提及并入 text 的 ats（含纯 @ 消息），@所有人 用 atAll（占位自动前置）。
 */
/** 接龙条目录入项（chains_entry_list[i]：e_c_u=提交者 uid、e_t=文本） */
export interface ChainsEntry {
  uid: string
  text: string
}

/** 接龙消息（messageType=152，aweType=15200）：push_detail 即官方客户端展示文本 */
export interface Chains {
  id: string
  description: string
  isStart: boolean
  entries: ChainsEntry[]
}

/** 互动卡消息（messageType=110，aweType=110402 打卡邀请等）：im_dynamic_patch 为卡片载荷 */
export interface Card {
  /** 卡片 key（patch.card_key，如 msg_guide / msg_preview） */
  key: string
  /** 服务端卡片类型（patch.card_type，如 douyin_admin_msg_guide_invite / douyin_admin_msg_preview_ugc） */
  type: string
  /** 卡片 id（patch.card_id；打卡卡 id 是嵌套 JSON 字符串，取内层 id） */
  id: string
  /** 原互动类型（content.aweType，如引导卡 110402 / 打卡记录卡 110372；回传恢复原值） */
  aweType: number
  /** 主文案（raw_data.content_middle_top / content_top 的 content） */
  title: string
  /** 附属文案（raw_data.content_middle_content / content_middle 的 content） */
  desc: string
  /** 按钮文案（raw_data.bottom / bottom_right 的 content） */
  button: string
  /** 展示图片（raw_data.content_left / content_bottom 首位，url） */
  coverUrl: string
  /** 官方签名（patch.sign，下发时生成；回传发送原样回填） */
  sign: string
  /** 完整互动载荷（patch 原对象，收/发同构直接复用） */
  patch: Record<string, unknown>
}

type RawBody<S extends 'send' | 'recv'> =
  | { type: 'text'; text: string; ats?: { uid: string; nickname?: string }[]; atAll?: boolean }
  | { type: 'image'; text?: string; image: S extends 'send' ? ImageResource | MediaInput : ImageResource }
  | { type: 'video'; text?: string; video: S extends 'send' ? VideoResource | VideoSend : VideoResource }
  | { type: 'file'; text?: string; file: S extends 'send' ? FileAsset | FileSend : FileAsset }
  | { type: 'share'; text?: string; share: ShareItem }
  | { type: 'userCard'; text?: string; user: UserCard }
  | { type: 'forward'; text?: string; nodes: ForwardNode[] }
  | { type: 'audio'; text?: string; audio: { urls: string[]; uri: string } }
  // emoji 传小表情 id（如 weixiao，按官方键值文本发送）/ im-resource 资源 id（经 trending 解析签名直链发 lite_emoji）/ 完整 CDN 直链
  | { type: 'emoji'; text?: string; emoji: string }
  | { type: 'link'; text?: string; link: LinkCard }
  | { type: 'chains'; text?: string; chains: Chains }
  | { type: 'card'; text?: string; card: Card }
  | { type: 'groupCard'; text?: string; groupCard: GroupCard }
  | { type: 'location'; text?: string; location: LocationCard }
  | { type: 'unknown'; text?: string; raw: Record<string, unknown> | string }

/** 发侧消息体：统一走 bot.msg.send(chatId, body)，媒体可给输入源（send 自动上传） */
export type MsgBody = RawBody<'send'>

/** 收侧消息体：媒体恒为资产/资源形态，与 MsgBody 同构，可直接回传 send */
export type RecvBody = RawBody<'recv'>
