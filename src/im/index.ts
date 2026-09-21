/** 抖音 IM：协议编解码、收发、收件箱与媒体上传 */

export { Im } from './im.js'
export type { ImOptions, ImEventMap, ImEvent, SendMediaItem } from './im.js'
export {
  ProtoTransport, sendCmd100, buildCmd100Frame, matchSendAck,
  fingerprintParams, PC_UA,
  type Cmd100FrameOptions, type Cmd100SendOptions, type SendAck,
} from './transport.js'
export { toInboundMessage, extractAndroidPushes, extractReactions } from './recv.js'
export {
  noticeFromPush, extractAndroidNotices, fieldString, messageChildren, collectKeyValues,
} from './notice.js'
export {
  send, sendText, sendMergeForward, sendImage, sendVideo, sendFile, reply, buildForwardNodes,
  type SendContext, type SendForwardOptions, type SendMediaOptions,
  type SendVideoOptions, type SendFileOptions, type ReplyOptions,
} from './send.js'
export {
  actionResponse, modifyReaction, markConversationRead, recall,
  listConversations, listCookieThreads, listStrangerThreads, getChatHistory,
  getFriendList, getGroupList, getGroupMembers, getStrangerList,
  getGroupJoinRequests, setGroupName, reviewGroupJoinRequest, getFriendRequests, reviewFriendRequest,
  type InboxContext, type InboxListOptions,
} from './inbox.js'
export {
  Uploader, uploadProcessFunctions, signVodRequest, crc32Hex, canonicalUploadQuery,
  type UploadCredentials, type VideoAsset, type VodSignature, type FileUploadAsset,
} from './upload.js'
export {
  buildLegacyTextContent, buildCreatorTextContent, buildDesktopTextContent,
  buildImageContent, buildFileContent, buildVideoContent, buildReplyPayload,
  parseMessageContent, normalizeTextMessageContent, normalizeDesktopTextMessageContent, displayText,
  type ImageAsset, type ReplyMessageOptions, type ReplyPayload, type TextMention,
  type FileAssetPayload, type ParsedMessageContent,
} from './content.js'
export {
  pickImageUrl, decryptImage, decryptCencSample, sniffImageFormat,
  type ImageResource, type VideoResource, type LinkCard, type UserCard,
  type FileAsset, type ImageFormat, type CencSubsample,
} from './media.js'
export * from './types.js'
export {
  AndroidFrontierWs, buildAndroidFrontierUrl, reconnectDelay, cookieValue,
  ANDROID_APP_KEY, ANDROID_ACCESS_SALT, ANDROID_UA, ANDROID_SDK_VERSION,
  type AndroidFrontierWsOptions, type AndroidFrontierWsCallbacks,
  type WsReconnectEvent, type WsCloseEvent,
} from './protocol/index.js'
