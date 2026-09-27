/** 抖音 IM：协议编解码、收发、收件箱与媒体上传 */

export { Im } from './im.js'
export type { ImOptions, ImEventMap, ImEvent } from './im.js'
export {
  ProtoTransport, sendCmd411, buildCmd411Frame, fingerprintParams, PC_UA,
  type Cmd411FrameOptions, type Cmd411SendOptions,
} from './transport.js'
export { toInboundMessage, extractAndroidPushes, extractReactions } from './recv.js'
export { getUserProfiles, profileScene, profileOther, type UserProfile, type ProfileDetail } from './users.js'
export { getVideoUrl, awemeDetail, type AwemeDetail } from './play.js'
export { decryptCencMp4 } from './cenc.js'
export { resolveMedia, fileNameOf, isInput, type MediaInput } from './source.js'
export { probeVideo, extractVideoPoster } from './video.js'
export {
  noticeFromPush, extractAndroidNotices, fieldString, messageChildren, collectKeyValues,
} from './notice.js'
export {
  send, sendText, sendBody, sendMergeForward, sendImage, sendVideo, sendFile, sendShare, sendUserCard, reply, buildForwardNodes,
  sendTyping, startVoiceCall,
  type SendContext, type SendForwardOptions, type SendMediaOptions,
  type SendVideoOptions, type SendFileOptions, type SendShareOptions, type SendUserCardOptions, type ReplyOptions, type VoiceCallResult,
} from './send.js'
export {
  actionResponse, modifyReaction, markConversationRead, recall,
  listConversations, listCookieThreads, listStrangerThreads, getChatHistory,
  getFriendList, getGroupList, getGroupMembers, getStrangerList,
  getGroupJoinRequests, setGroupName, reviewGroupJoinRequest, getFriendRequests, reviewFriendRequest,
  addGroupMembers, removeGroupMembers, leaveGroup, deleteConversation, setConversationSetting, createGroup,
  type InboxContext, type InboxListOptions,
  type ConversationSettingInput, type CreateGroupOptions,
} from './inbox.js'
export {
  getInfoList, getReadIndex, getMinIndex, getUserMessage, clientAck, strangerConversations, getPeer, batchReadIndex,
  type ReadIndexRow, type MinIndexRow, type UserMessageQuery, type ClientAckItem,
  type StrangerListOptions, type GetPeerRequest, type GetPeerResult,
} from './query.js'
export {
  Uploader, uploadProcessFunctions, signVodRequest, crc32Hex, canonicalUploadQuery,
  type UploadCredentials, type VodSignature, type FileUploadAsset,
} from './upload.js'
export {
  buildLegacyTextContent, buildCreatorTextContent, buildDesktopTextContent,
  buildImageContent, buildFileContent, buildVideoContent, buildShareContent, buildUserCardContent, buildReplyPayload,
  buildCardContent, buildLocationContent, buildGroupCardContent,
  parseBody, normalizeTextMessageContent, normalizeDesktopTextMessageContent,
  type ReplyMessageOptions, type ReplyPayload, type TextMention,
} from './content.js'
export {
  pickImageUrl, decryptImage, decryptCencSample, sniffImageFormat,
  type ImageResource, type VideoResource, type LinkCard, type UserCard, type LocationCard, type GroupCard,
  type FileAsset, type ImageFormat, type CencSubsample, type EncryptedVideoUrl,
  type ImageAsset, type VideoAsset, type VideoSend,
} from './media.js'
export * from './types.js'
export { getEmojiList, type EmojiInfo } from './emoji.js'
export {
  stickerList, stickerCollect, emojiTrending, strategyConfig, SCENES_FAVS,
  type Sticker, type StickerImage, type StickerPage, type StickerCollectResult, type StrategyConfig,
} from './resource.js'
export {
  heartbeat, onlineStatus, activeSwitch, readSwitch,
  type OnlineItem, type ReadSwitchItem,
} from './active.js'
export {
  AndroidFrontierWs, buildAndroidFrontierUrl, reconnectDelay, cookieValue,
  ANDROID_APP_KEY, ANDROID_ACCESS_SALT, ANDROID_UA, ANDROID_SDK_VERSION,
  type AndroidFrontierWsOptions, type AndroidFrontierWsCallbacks,
  type WsReconnectEvent, type WsCloseEvent,
} from './protocol/index.js'
