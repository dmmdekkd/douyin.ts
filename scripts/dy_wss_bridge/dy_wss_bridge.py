#!/usr/bin/env python3
"""
抖音 WSS Sidecar（私信实时收发 + 直播间监听 + 数据采集 + 互动操作）

架构：
  - 通过 /api/provider-gateway/accounts 发现需要监听的抖音账号
  - 通过 /api/provider-gateway/credentials 拉取每个账号的 cookie
  - 为每个账号启动：
      · 私信 WSS 连接（wss://frontier-im.douyin.com/ws/v2）—— 实时接收 5 类私信
      · 任务拉取线程 —— 消费主应用入队的任务队列
  - 任务类型（taskType）覆盖 vendor douyin-spider 全部能力：
      · 私信：send_message / create_conversation / list_conversations
      · 直播：live_listen / live_send_danmaku / live_like
      · 采集：get_user_info / get_work_info / get_user_works / get_work_comments
             / search_general / search_user / search_live / search_video
             / get_followers / get_following / get_notices / get_favorites
             / get_collects / get_feed
      · 互动：digg_video / publish_comment / collect_aweme / move_collect / remove_collect
  - 直播间监听独立长连接，消息归一化为 live_event 事件转发到主应用

安全：
  - 与主应用之间使用 HMAC-SHA256 签名（PROVIDER_GATEWAY_WEBHOOK_SECRET）
  - cookie 仅在内存中持有，不落盘
  - 仅出站连接，不暴露任何端口
  - 失败指数退避重连，避免雪崩
"""

import contextlib
import hashlib
import hmac
import io
import json
import logging
import os
import re
import signal
import sys
import threading
import time
import traceback
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

# 第三方 vendor 代码（dy_apis/douyin_api.py get_device_id）使用 verify=False 调用抖音接口，
# 会触发 urllib3 InsecureRequestWarning。此处仅抑制警告（不改变 verify 行为），
# 因为修改 vendor 签名逻辑会破坏 a_bogus/参数链路。出站目标固定为 www.douyin.com，风险可控。
try:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    pass

# 将 vendor/douyin-spider 及其子目录加入 sys.path，以便导入第三方模块。
# vendor 内部 import 不一致：部分用 `from dy_apis.x import`，部分用 `from x import`（不带前缀），
# 因此需把 vendor 根目录和 dy_apis/ 都加入 path。
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VENDOR_PATH = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "vendor", "douyin-spider"))
for _sub in ["", "dy_apis", "utils", "builder", "static"]:
    _p = os.path.join(VENDOR_PATH, _sub) if _sub else VENDOR_PATH
    if _p not in sys.path:
        sys.path.insert(0, _p)

# 第三方依赖
from dy_apis.douyin_api import DouyinAPI  # noqa: E402
from dy_apis.douyin_recv_msg import DouyinRecvMsg  # noqa: E402
from builder.auth import DouyinAuth  # noqa: E402

# ============================================================
# 配置
# ============================================================

API_URL = os.environ.get("PROVIDER_GATEWAY_API_URL", "http://app:5000").rstrip("/")
# API_KEY 与 SECRET 必须同时配置：API_KEY 走 x-provider-api-key 头明文比对，
# SECRET 是 HMAC-SHA256 的密钥。两者均来自主应用 .env。
API_KEY = os.environ.get("PROVIDER_GATEWAY_API_KEY", "")
API_SECRET = os.environ.get("PROVIDER_GATEWAY_WEBHOOK_SECRET", "")
# 与 douyin-executor 共享 provider 名，使两者共享同一任务队列（谁在线谁拉）。
# 主应用 enqueueProviderGatewayTask 默认用 'douyin_gateway'，无需改动业务代码。
PROVIDER_NAME = os.environ.get("DOUYIN_WSS_PROVIDER_NAME", "douyin_gateway")
LISTENER_ENABLED = os.environ.get("DOUYIN_WSS_LISTENER_ENABLED", "1") == "1"
MAX_ACCOUNTS = int(os.environ.get("DOUYIN_WSS_LISTENER_MAX_ACCOUNTS", "8"))
POLL_INTERVAL_SEC = int(os.environ.get("DOUYIN_WSS_LISTENER_POLL_INTERVAL", "60"))
HEARTBEAT_INTERVAL_SEC = int(os.environ.get("DOUYIN_WSS_LISTENER_HEARTBEAT_INTERVAL", "30"))
RECONNECT_BASE_SEC = float(os.environ.get("DOUYIN_WSS_RECONNECT_BASE_SEC", "5"))
RECONNECT_MAX_SEC = float(os.environ.get("DOUYIN_WSS_RECONNECT_MAX_SEC", "300"))
HTTP_TIMEOUT_SEC = int(os.environ.get("DOUYIN_WSS_HTTP_TIMEOUT", "15"))

# 任务拉取（发送/会话管理）
TASK_PULL_ENABLED = os.environ.get("DOUYIN_WSS_TASK_PULL_ENABLED", "1") == "1"
TASK_PULL_INTERVAL_SEC = float(os.environ.get("DOUYIN_WSS_TASK_PULL_INTERVAL", "2"))
TASK_PULL_LIMIT = int(os.environ.get("DOUYIN_WSS_TASK_PULL_LIMIT", "10"))
TASK_PROCESS_TIMEOUT_SEC = float(os.environ.get("DOUYIN_WSS_TASK_PROCESS_TIMEOUT", "30"))
# 会话三元组缓存上限（按账号+toUserId）
CONV_CACHE_MAX = int(os.environ.get("DOUYIN_WSS_CONV_CACHE_MAX", "1024"))

# 直播间监听（独立长连接，与私信 WSS 并行）
LIVE_LISTEN_ENABLED = os.environ.get("DOUYIN_WSS_LIVE_LISTEN_ENABLED", "1") == "1"
LIVE_LISTEN_POLL_INTERVAL_SEC = int(os.environ.get("DOUYIN_WSS_LIVE_LISTEN_POLL_INTERVAL", "60"))
LIVE_LISTEN_MAX_ROOMS = int(os.environ.get("DOUYIN_WSS_LIVE_LISTEN_MAX_ROOMS", "16"))
LIVE_RECONNECT_BASE_SEC = float(os.environ.get("DOUYIN_WSS_LIVE_RECONNECT_BASE_SEC", "5"))
LIVE_RECONNECT_MAX_SEC = float(os.environ.get("DOUYIN_WSS_LIVE_RECONNECT_MAX_SEC", "600"))

# HTTP 代理（可选，所有 vendor requests 调用共用）
HTTP_PROXY = os.environ.get("DOUYIN_WSS_HTTP_PROXY") or os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy") or ""
PROXIES = {"http": HTTP_PROXY, "https": HTTP_PROXY} if HTTP_PROXY else None

# 抖音侧常量（来自第三方项目）
APP_KEY = "e1bd35ec9db7b8d846de66ed140b1ad9"
FP_ID = "9"
ACCESS_KEY_SALT = "f8a69f1719916z"

# 消息类型映射（抖音 protocol → 我们的 msg_type）
# 来自 dy_apis/douyin_recv_msg.py 第 30-46 行
MSG_TYPE_MAP = {
    7: "text",
    5: "image",       # 表情包
    17: "voice",      # 语音
    27: "image",      # 图片
    8: "video",       # 分享视频
    50001: "read_receipt",
}

# ============================================================
# 日志
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("dy_wss")

# ============================================================
# HMAC 签名（与 src/lib/provider-gateway-signature.ts 严格对齐）
# 服务端验证逻辑：
#   1. x-provider-api-key 必须 timing-safe 等于 PROVIDER_GATEWAY_API_KEY
#   2. x-provider-timestamp 必须在 5 分钟容差内
#   3. x-provider-signature = HMAC-SHA256(secret, f"{timestamp}.{rawBody}") hex
# 注意：分隔符是 "."（点）而非换行；签名载荷是 timestamp.body，不含 api_key。
# ============================================================


def sign_request(body: str, timestamp_ms: int) -> Dict[str, str]:
    """生成与主应用 verifyProviderGatewayRequest 一致的 HMAC 签名头。"""
    if not API_KEY or not API_SECRET:
        raise RuntimeError("PROVIDER_GATEWAY_API_KEY / PROVIDER_GATEWAY_WEBHOOK_SECRET 未配置")
    # 与 TS signProviderGatewayPayload(rawBody, timestamp, secret) 完全一致：
    # createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
    string_to_sign = f"{timestamp_ms}.{body}"
    signature = hmac.new(
        API_SECRET.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "Content-Type": "application/json",
        "x-provider-api-key": API_KEY,
        "x-provider-timestamp": str(timestamp_ms),
        "x-provider-signature": signature,
    }


def post_to_main_app(path: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """向主应用发送签名 POST 请求。"""
    url = f"{API_URL}{path}"
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    headers = sign_request(body, int(time.time() * 1000))
    try:
        resp = requests.post(url, data=body.encode("utf-8"), headers=headers, timeout=HTTP_TIMEOUT_SEC)
        if resp.status_code >= 400:
            log.warning("主应用 %s 返回 %s: %s", path, resp.status_code, resp.text[:300])
            return None
        return resp.json()
    except requests.RequestException as e:
        log.warning("主应用 %s 请求失败: %s", path, e)
        return None


# ============================================================
# 账号发现与凭证拉取
# ============================================================


def discover_accounts() -> list:
    """调用 /api/provider-gateway/accounts 获取需要监听的抖音账号列表。"""
    resp = post_to_main_app(
        "/api/provider-gateway/accounts",
        {"provider": PROVIDER_NAME, "platform": "douyin"},
    )
    if not resp or resp.get("code") != 0:
        log.warning("账号发现失败: %s", resp)
        return []
    items = resp.get("data", {}).get("items", []) if isinstance(resp.get("data"), dict) else resp.get("data", [])
    return items or []


def fetch_credentials(account_id: int, slot_id: str) -> Optional[str]:
    """调用 /api/provider-gateway/credentials 获取账号的 cookie header。"""
    resp = post_to_main_app(
        "/api/provider-gateway/credentials",
        {"provider": PROVIDER_NAME, "accountId": account_id, "slotId": slot_id},
    )
    if not resp or resp.get("code") != 0:
        log.warning("凭证拉取失败 accountId=%s: %s", account_id, resp)
        return None
    data = resp.get("data", {}) or {}
    return data.get("cookieHeader") or None


# ============================================================
# 事件转发
# ============================================================


def submit_event(event: Dict[str, Any]) -> None:
    """向 /api/provider-gateway/events 提交归一化后的事件。"""
    post_to_main_app("/api/provider-gateway/events", event)


def submit_heartbeat(account_id: int, slot_id: str, status: str, message: str = "") -> None:
    """上报心跳/状态变更。"""
    submit_event({
        "eventId": f"wss-hb-{account_id}-{int(time.time() * 1000)}",
        "provider": PROVIDER_NAME,
        "platform": "douyin",
        "eventType": "listener_status",
        "accountId": account_id,
        "slotId": slot_id,
        "listenerStatus": status,
        "metadata": {"message": message, "ts": int(time.time())},
    })


def submit_message_event(
    account_id: int,
    slot_id: str,
    conversation_id: str,
    server_message_id: int,
    index_in_conversation: int,
    message_type: int,
    sender: int,
    content: Any,
) -> None:
    """归一化并提交一条私信事件。"""
    our_msg_type = MSG_TYPE_MAP.get(message_type, "unknown")
    event_id = f"wss-msg-{account_id}-{server_message_id}-{index_in_conversation}"

    # 提取消息正文（按第三方项目的解析逻辑）
    text_content = None
    media_url = None
    extra = {"raw_message_type": message_type}
    try:
        if isinstance(content, dict):
            if message_type == 7:
                text_content = content.get("text", "")
            elif message_type == 5:
                urls = content.get("url", {}).get("url_list", [])
                media_url = urls[0] if urls else None
                text_content = "[表情包]"
            elif message_type == 17:
                urls = content.get("resource_url", {}).get("url_list", [])
                media_url = urls[0] if urls else None
                text_content = "[语音]"
            elif message_type == 27:
                urls = content.get("resource_url", {}).get("origin_url_list", [])
                media_url = urls[0] if urls else None
                text_content = "[图片]"
            elif message_type == 8:
                extra["itemId"] = content.get("itemId")
                text_content = f"[分享视频:{content.get('itemId', '')}]"
            elif message_type == 50001:
                # 已读回执 — 主应用尚无 read 状态更新逻辑，发送会被当成新消息插入。
                # 暂以 conversation.read 事件上报（主应用 ignored 分支），保留会话归属信息便于后续扩展。
                submit_event({
                    "eventId": event_id,
                    "provider": PROVIDER_NAME,
                    "platform": "douyin",
                    "eventType": "conversation.read",
                    "accountId": account_id,
                    "slotId": slot_id,
                    "conversation": {
                        "id": conversation_id,
                        "platformConversationId": conversation_id,
                        "openId": str(sender) if sender else conversation_id,
                    },
                    "metadata": {**extra, "readIndex": content.get("read_index"), "serverMessageId": str(server_message_id)},
                })
                return
    except Exception as e:
        log.warning("消息内容解析失败 msg_type=%s: %s", message_type, e)

    payload = {
        "eventId": event_id,
        "provider": PROVIDER_NAME,
        "platform": "douyin",
        "eventType": "new_message",
        "accountId": account_id,
        "slotId": slot_id,
        "direction": "inbound",
        "conversation": {
            # id 与 platformConversationId 同值：主应用 findOrCreateConversation 回退取 conversation.id 作为 customerOpenId
            "id": conversation_id,
            "platformConversationId": conversation_id,
            "openId": str(sender) if sender else conversation_id,
        },
        "message": {
            "serverMessageId": str(server_message_id),
            "platformMessageId": str(server_message_id),
            "conversationId": conversation_id,
            "indexInConversation": index_in_conversation,
            "senderId": str(sender),
            "msgType": our_msg_type,
            "messageType": our_msg_type,
            "content": text_content or "",
            "mediaUrls": [media_url] if media_url else [],
            "createdAt": int(time.time() * 1000),
            "timestamp": int(time.time() * 1000),
        },
        "raw": {"content": content, "message_type": message_type} if isinstance(content, dict) else None,
        "metadata": extra,
    }
    submit_event(payload)


# ============================================================
# Auth 对象缓存 + 会话三元组缓存（发送路径）
# ============================================================
# WSS 接收路径只持 cookie_str；发送路径需要完整的 DouyinAuth（含 msToken、uid）。
# 首次发送时构造 auth 并缓存；cookie 失效后由调用方重建。
# 会话三元组 (conversation_id, conversation_short_id, ticket) 按 (account_id, to_user_id) 缓存，
# 避免每次发送都打一次 /v2/conversation/create。

_AUTH_CACHE: Dict[int, Any] = {}  # account_id → DouyinAuth
_AUTH_CACHE_LOCK = threading.Lock()
_CONV_CACHE: Dict[tuple, tuple] = {}  # (account_id, to_user_id) → (conv_id, conv_short_id, ticket)
_CONV_CACHE_LOCK = threading.Lock()


def get_auth_for_account(account_id: int, slot_id: str) -> Optional[Any]:
    """获取或构造账号的 DouyinAuth 对象，失败返回 None。"""
    with _AUTH_CACHE_LOCK:
        cached = _AUTH_CACHE.get(account_id)
        if cached is not None:
            return cached
    # 重新拉 cookie 并构造 auth
    cookie_header = fetch_credentials(account_id, slot_id)
    if not cookie_header:
        log.warning("任务处理无法获取 cookie aid=%s", account_id)
        return None
    try:
        auth = DouyinAuth()
        auth.perepare_auth(cookie_header, "", "")
        # 触发一次 get_uid 缓存自身 UID（发送/会话创建需要）
        _ = auth.get_uid()
    except Exception as e:
        log.warning("构造 DouyinAuth 失败 aid=%s: %s", account_id, e)
        return None
    with _AUTH_CACHE_LOCK:
        _AUTH_CACHE[account_id] = auth
    return auth


def invalidate_auth(account_id: int) -> None:
    """cookie 失效时清除缓存，下次拉取会重新构造。"""
    with _AUTH_CACHE_LOCK:
        _AUTH_CACHE.pop(account_id, None)


def get_conversation_triple(account_id: int, to_user_id: int) -> Optional[tuple]:
    with _CONV_CACHE_LOCK:
        return _CONV_CACHE.get((account_id, to_user_id))


def set_conversation_triple(account_id: int, to_user_id: int, triple: tuple) -> None:
    with _CONV_CACHE_LOCK:
        if len(_CONV_CACHE) >= CONV_CACHE_MAX:
            # 简单 LRU：弹出最早的项
            try:
                _CONV_CACHE.pop(next(iter(_CONV_CACHE)))
            except StopIteration:
                pass
        _CONV_CACHE[(account_id, to_user_id)] = triple


# ============================================================
# 任务拉取与处理（send_message / create_conversation / list_conversations）
# ============================================================


def pull_tasks(slot_id: str) -> list:
    """从主应用拉取待处理任务。"""
    resp = post_to_main_app(
        "/api/provider-gateway/tasks/pull",
        {
            "provider": PROVIDER_NAME,
            "slotId": slot_id,
            "limit": TASK_PULL_LIMIT,
        },
    )
    if not resp or resp.get("code") != 0:
        return []
    data = resp.get("data", {}) or {}
    items = data.get("items", []) if isinstance(data, dict) else []
    return items or []


def ack_task(
    task_uuid: str,
    status: str,
    *,
    platform_msg_id: Optional[str] = None,
    error: Optional[str] = None,
    response_payload: Optional[Dict[str, Any]] = None,
) -> None:
    """向主应用上报任务处理结果。"""
    payload: Dict[str, Any] = {
        "taskUuid": task_uuid,
        "status": status,
    }
    if platform_msg_id:
        payload["platformMsgId"] = platform_msg_id
    if error:
        payload["error"] = error[:2000]
    if response_payload:
        payload["responsePayload"] = response_payload
    post_to_main_app("/api/provider-gateway/tasks/ack", payload)


def _safe_int(value: Any, default: int = 0) -> int:
    """将任意值转为 int，失败返回 default。toUserId 可能是字符串。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _handle_send_message(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """处理 send_message 任务。payload 必须含 toUserId 和 content。"""
    payload = task.get("payload", {}) or {}
    to_user_id = _safe_int(payload.get("toUserId"))
    content = str(payload.get("content") or payload.get("text") or "").strip()
    msg_type = str(payload.get("msgType") or payload.get("type") or "text")

    if not to_user_id:
        return {"success": False, "error": "toUserId 缺失或非数字"}
    if not content:
        return {"success": False, "error": "content 为空"}
    if msg_type != "text":
        # 第三方 send_msg 仅支持文本；图片/语音等需扩展 build_send_message_request
        return {"success": False, "error": f"暂不支持 msgType={msg_type}，仅支持 text"}

    # 1) 查询会话三元组缓存，未命中则调用 create_conversation
    triple = get_conversation_triple(account_id, to_user_id)
    if not triple:
        try:
            triple = DouyinAPI.create_conversation(auth, to_user_id)
        except Exception as e:
            err_msg = str(e)
            err_safe = re.sub(r'token=[^&\s]+', 'token=***', err_msg)[:500]
            log.warning("create_conversation 失败 aid=%s to=%s: %s", account_id, to_user_id, err_safe)
            # 401/身份失效时清除 auth 缓存
            if "uid" in err_safe.lower() or "cookie" in err_safe.lower() or "auth" in err_safe.lower():
                invalidate_auth(account_id)
            return {"success": False, "error": f"create_conversation 失败: {err_safe}"}
        if not triple or len(triple) < 3:
            return {"success": False, "error": "create_conversation 返回数据不完整"}
        set_conversation_triple(account_id, to_user_id, triple)
        log.info("会话已创建并缓存 aid=%s to=%s conv_id=%s", account_id, to_user_id, triple[0])

    conversation_id, conversation_short_id, ticket = triple

    # 2) 调用 send_msg
    try:
        result = DouyinAPI.send_msg(auth, conversation_id, conversation_short_id, ticket, content)
    except Exception as e:
        err_msg = str(e)
        err_safe = re.sub(r'token=[^&\s]+', 'token=***', err_msg)[:500]
        log.warning("send_msg 失败 aid=%s conv=%s: %s", account_id, conversation_id, err_safe)
        # ticket/会话失效时清除缓存，下次发送会重新 create_conversation
        # 启发式：错误信息含 conversation/ticket/expired/auth 关键词时清除
        if any(kw in err_safe.lower() for kw in ["conversation", "ticket", "expired", "auth", "permission"]):
            with _CONV_CACHE_LOCK:
                _CONV_CACHE.pop((account_id, to_user_id), None)
            log.info("已清除会话缓存 aid=%s to=%s", account_id, to_user_id)
        return {"success": False, "error": f"send_msg 失败: {err_safe}"}

    return {
        "success": True,
        "platformMsgId": str(result) if result is not None else None,
        "responsePayload": {
            "conversationId": str(conversation_id),
            "conversationShortId": str(conversation_short_id),
            "toUserId": str(to_user_id),
        },
    }


def _handle_create_conversation(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """处理 create_conversation 任务。payload 必须含 toUserId。"""
    payload = task.get("payload", {}) or {}
    to_user_id = _safe_int(payload.get("toUserId"))
    if not to_user_id:
        return {"success": False, "error": "toUserId 缺失或非数字"}

    try:
        triple = DouyinAPI.create_conversation(auth, to_user_id)
    except Exception as e:
        err_safe = re.sub(r'token=[^&\s]+', 'token=***', str(e))[:500]
        return {"success": False, "error": f"create_conversation 失败: {err_safe}"}

    if not triple or len(triple) < 3:
        return {"success": False, "error": "create_conversation 返回数据不完整"}

    set_conversation_triple(account_id, to_user_id, triple)
    return {
        "success": True,
        "responsePayload": {
            "conversationId": str(triple[0]),
            "conversationShortId": str(triple[1]),
            "ticket": str(triple[2]),
            "toUserId": str(to_user_id),
        },
    }


def _handle_list_conversations(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """处理 list_conversations 任务。payload 必须含 toUserId 和 conversationShortId。

    依赖 blackboxprotobuf 解码无 schema 的响应；缺包时优雅失败，不影响其他任务类型。
    """
    payload = task.get("payload", {}) or {}
    to_user_id = _safe_int(payload.get("toUserId"))
    conversation_short_id = _safe_int(payload.get("conversationShortId") or payload.get("conversationShortId"))
    if not to_user_id or not conversation_short_id:
        return {"success": False, "error": "toUserId 和 conversationShortId 必填"}

    try:
        import blackboxprotobuf  # noqa: F401  延迟导入，缺包时只在调用此任务时报错
    except ImportError:
        return {
            "success": False,
            "error": "blackboxprotobuf 未安装，list_conversations 不可用；请联系运维在容器内 pip install blackboxprotobuf",
        }

    try:
        # 第三方实现返回 secure_uid；具体字段以 blackboxprotobuf 解码为准
        result = DouyinAPI.get_conversation_list(auth, to_user_id, conversation_short_id)
    except Exception as e:
        err_safe = re.sub(r'token=[^&\s]+', 'token=***', str(e))[:500]
        return {"success": False, "error": f"get_conversation_list 失败: {err_safe}"}

    return {
        "success": True,
        "responsePayload": {
            "secureUid": str(result) if result else "",
            "toUserId": str(to_user_id),
            "conversationShortId": str(conversation_short_id),
        },
    }


# ============================================================
# 数据采集任务处理器
# ============================================================
# 所有处理器统一签名：(task, auth, account_id) -> {success, responsePayload?, error?}
# vendor 方法内部 print 会污染日志，统一用 contextlib.redirect_stdout(io.StringIO()) 抑制。
# 错误信息经 _sanitize_err 脱敏（去除 token=xxx）后回写。


@contextlib.contextmanager
def _suppress_stdout():
    """临时重定向 stdout 到 StringIO，抑制 vendor 内部 print。"""
    with contextlib.redirect_stdout(io.StringIO()):
        yield


def _sanitize_err(err: Any) -> str:
    """错误信息脱敏：去除 token=xxx，限制 500 字符。"""
    return re.sub(r'token=[^&\s]+', 'token=***', str(err))[:500]


def _payload(task: Dict[str, Any]) -> Dict[str, Any]:
    return task.get("payload", {}) or {}


def _str(value: Any) -> str:
    return str(value) if value is not None else ""


def _handle_get_user_info(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取用户主页信息。payload.userUrl 必填。"""
    p = _payload(task)
    user_url = _str(p.get("userUrl") or p.get("user_url") or "").strip()
    if not user_url:
        return {"success": False, "error": "userUrl 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_user_info(auth, user_url, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_user_info 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"userInfo": result, "userUrl": user_url}}


def _handle_get_work_info(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取单个作品详情。payload.workUrl 必填。"""
    p = _payload(task)
    work_url = _str(p.get("workUrl") or p.get("work_url") or p.get("url") or "").strip()
    if not work_url:
        return {"success": False, "error": "workUrl 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_work_info(auth, work_url)
    except Exception as e:
        return {"success": False, "error": f"get_work_info 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"workInfo": result, "workUrl": work_url}}


def _handle_get_user_works(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取用户全部作品（自动翻页）。payload.userUrl 必填。"""
    p = _payload(task)
    user_url = _str(p.get("userUrl") or p.get("user_url") or "").strip()
    if not user_url:
        return {"success": False, "error": "userUrl 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_user_all_work_info(auth, user_url, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_user_all_work_info 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"works": result, "count": len(result) if isinstance(result, list) else 0}}


def _handle_get_work_comments(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取作品全部评论（一级 + 二级回复）。payload.workUrl 必填。"""
    p = _payload(task)
    work_url = _str(p.get("workUrl") or p.get("work_url") or p.get("url") or "").strip()
    if not work_url:
        return {"success": False, "error": "workUrl 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_work_all_comment(auth, work_url, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_work_all_comment 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"comments": result, "count": len(result) if isinstance(result, list) else 0}}


def _handle_search_general(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """综合搜索（视频/用户/直播混合）。payload.query 与 payload.num 必填。"""
    p = _payload(task)
    query = _str(p.get("query") or p.get("keyword") or "").strip()
    num = int(p.get("num") or 20)
    sort_type = _str(p.get("sortType") or "0")
    publish_time = _str(p.get("publishTime") or "0")
    if not query:
        return {"success": False, "error": "query 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.search_some_general_work(
                auth, query, num, sort_type, publish_time,
                filter_duration=_str(p.get("filterDuration") or ""),
                search_range=_str(p.get("searchRange") or ""),
                content_type=_str(p.get("contentType") or ""),
                proxies=PROXIES,
            )
    except Exception as e:
        return {"success": False, "error": f"search_general 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"results": result, "count": len(result) if isinstance(result, list) else 0, "query": query}}


def _handle_search_user(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """搜索用户。payload.query 与 payload.num 必填。"""
    p = _payload(task)
    query = _str(p.get("query") or p.get("keyword") or "").strip()
    num = int(p.get("num") or 20)
    if not query:
        return {"success": False, "error": "query 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.search_some_user(auth, query, num, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"search_user 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"users": result, "count": len(result) if isinstance(result, list) else 0, "query": query}}


def _handle_search_live(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """搜索直播间。payload.query 与 payload.num 必填。"""
    p = _payload(task)
    query = _str(p.get("query") or p.get("keyword") or "").strip()
    num = int(p.get("num") or 20)
    if not query:
        return {"success": False, "error": "query 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.search_some_live(auth, query, num, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"search_live 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"lives": result, "count": len(result) if isinstance(result, list) else 0, "query": query}}


def _handle_search_video(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """视频搜索。payload.query 与 payload.num 必填。"""
    p = _payload(task)
    query = _str(p.get("query") or p.get("keyword") or "").strip()
    num = int(p.get("num") or 16)
    if not query:
        return {"success": False, "error": "query 缺失"}
    try:
        with _suppress_stdout():
            video_list, guide_words = DouyinAPI.search_some_video_work(
                auth, query, num=num,
                sort_type=_str(p.get("sortType") or "0"),
                publish_time=_str(p.get("publishTime") or "0"),
                filter_duration=_str(p.get("filterDuration") or ""),
                search_range=_str(p.get("searchRange") or "0"),
                proxies=PROXIES,
            )
    except Exception as e:
        return {"success": False, "error": f"search_video 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"videos": video_list, "guideWords": guide_words, "count": len(video_list) if isinstance(video_list, list) else 0, "query": query}}


def _handle_get_followers(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取粉丝列表。payload.userId 与 payload.secId 必填。"""
    p = _payload(task)
    user_id = _str(p.get("userId") or p.get("user_id") or "").strip()
    sec_id = _str(p.get("secId") or p.get("sec_id") or "").strip()
    num = int(p.get("num") or 20)
    if not user_id or not sec_id:
        return {"success": False, "error": "userId 与 secId 必填"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_some_user_follower_list(auth, user_id, sec_id, num, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_followers 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"followers": result, "count": len(result) if isinstance(result, list) else 0}}


def _handle_get_following(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取关注列表。payload.userId 与 payload.secId 必填。"""
    p = _payload(task)
    user_id = _str(p.get("userId") or p.get("user_id") or "").strip()
    sec_id = _str(p.get("secId") or p.get("sec_id") or "").strip()
    num = int(p.get("num") or 20)
    if not user_id or not sec_id:
        return {"success": False, "error": "userId 与 secId 必填"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_some_user_following_list(auth, user_id, sec_id, num, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_following 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"followings": result, "count": len(result) if isinstance(result, list) else 0}}


def _handle_get_notices(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取消息通知。payload.num 可选，默认 20。"""
    p = _payload(task)
    num = int(p.get("num") or 20)
    notice_group = _str(p.get("noticeGroup") or "700")
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_some_notice_list(auth, num=num, notice_group=notice_group, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_notices 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"notices": result, "count": len(result) if isinstance(result, list) else 0}}


def _handle_get_favorites(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取用户收藏的作品。payload.secId 必填。"""
    p = _payload(task)
    sec_id = _str(p.get("secId") or p.get("sec_id") or "").strip()
    if not sec_id:
        return {"success": False, "error": "secId 缺失"}
    try:
        with _suppress_stdout():
            # 注意：vendor get_user_favorite 内部存在硬编码 sec_user_id bug（line 665），
            # sec_id 仅用于 referer。返回结果仍为硬编码账号的收藏，需 vendor 升级修复。
            result = DouyinAPI.get_user_favorite(auth, sec_id, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_favorites 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"favorites": result}}


def _handle_get_collects(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取收藏夹列表。"""
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_collect_list(auth, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_collects 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"collects": result}}


def _handle_get_feed(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """获取推荐流。payload.count 可选，默认 20。"""
    p = _payload(task)
    count = _str(p.get("count") or "20")
    try:
        with _suppress_stdout():
            result = DouyinAPI.get_feed(auth, count=count, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"get_feed 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"feed": result}}


# ============================================================
# 互动操作任务处理器
# ============================================================


def _handle_digg_video(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """视频点赞/取消点赞。payload.awemeId 必填；payload.action 可选，1 点赞 0 取消。"""
    p = _payload(task)
    aweme_id = _str(p.get("awemeId") or p.get("aweme_id") or "").strip()
    action = _str(p.get("action") or "1")
    if not aweme_id:
        return {"success": False, "error": "awemeId 缺失"}
    try:
        with _suppress_stdout():
            # vendor digg() 返回 bool（is_digg==0 表示已点赞）
            ok = DouyinAPI.digg(auth, aweme_id, digg_type=action, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"digg_video 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"awemeId": aweme_id, "action": action, "liked": bool(ok)}}


def _handle_publish_comment(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """发布评论或回复评论。payload.awemeId 与 payload.content 必填；payload.replyId 可选。"""
    p = _payload(task)
    aweme_id = _str(p.get("awemeId") or p.get("aweme_id") or "").strip()
    content = _str(p.get("content") or "").strip()
    reply_id = _str(p.get("replyId") or p.get("reply_id") or "")
    if not aweme_id or not content:
        return {"success": False, "error": "awemeId 与 content 必填"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.publish_comment(auth, aweme_id, content=content, reply_id=reply_id, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"publish_comment 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"result": result, "awemeId": aweme_id}}


def _handle_collect_aweme(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """收藏/取消收藏作品。payload.awemeId 必填；payload.action 1 收藏 0 取消。"""
    p = _payload(task)
    aweme_id = _str(p.get("awemeId") or p.get("aweme_id") or "").strip()
    action = _str(p.get("action") or "1")
    if not aweme_id:
        return {"success": False, "error": "awemeId 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.collect_aweme(auth, aweme_id, action=action, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"collect_aweme 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"result": result, "awemeId": aweme_id, "action": action}}


def _handle_move_collect(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """移动到收藏夹。payload.awemeId/collectName/collectId 必填。"""
    p = _payload(task)
    aweme_id = _str(p.get("awemeId") or p.get("aweme_id") or "").strip()
    collect_name = _str(p.get("collectName") or p.get("collect_name") or "")
    collect_id = _str(p.get("collectId") or p.get("collect_id") or "")
    if not aweme_id or not collect_name or not collect_id:
        return {"success": False, "error": "awemeId / collectName / collectId 必填"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.move_collect_aweme(auth, aweme_id, collect_name, collect_id, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"move_collect 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"result": result, "awemeId": aweme_id}}


def _handle_remove_collect(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """从收藏夹移除。payload.awemeId/collectName/collectId 必填。"""
    p = _payload(task)
    aweme_id = _str(p.get("awemeId") or p.get("aweme_id") or "").strip()
    collect_name = _str(p.get("collectName") or p.get("collect_name") or "")
    collect_id = _str(p.get("collectId") or p.get("collect_id") or "")
    if not aweme_id or not collect_name or not collect_id:
        return {"success": False, "error": "awemeId / collectName / collectId 必填"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.remove_collect_aweme(auth, aweme_id, collect_name, collect_id, proxies=PROXIES)
    except Exception as e:
        return {"success": False, "error": f"remove_collect 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"result": result, "awemeId": aweme_id}}


# ============================================================
# 直播间操作任务处理器
# ============================================================


def _handle_live_send_danmaku(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """直播间发弹幕。payload.roomId 与 payload.content 必填。"""
    p = _payload(task)
    room_id = _str(p.get("roomId") or p.get("room_id") or "").strip()
    content = _str(p.get("content") or "").strip()
    if not room_id or not content:
        return {"success": False, "error": "roomId 与 content 必填"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.sendMsgInRoom(auth, room_id, content=content)
    except Exception as e:
        return {"success": False, "error": f"live_send_danmaku 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"result": result, "roomId": room_id}}


def _handle_live_like(task: Dict[str, Any], auth: Any, account_id: int) -> Dict[str, Any]:
    """直播间点赞。payload.roomId 必填；payload.count 可选，默认 1。"""
    p = _payload(task)
    room_id = _str(p.get("roomId") or p.get("room_id") or "").strip()
    count = _str(p.get("count") or "1")
    if not room_id:
        return {"success": False, "error": "roomId 缺失"}
    try:
        with _suppress_stdout():
            result = DouyinAPI.diggLiveRoom(auth, room_id, count=count)
    except Exception as e:
        return {"success": False, "error": f"live_like 失败: {_sanitize_err(e)}"}
    return {"success": True, "responsePayload": {"result": result, "roomId": room_id, "count": count}}


# live_listen 任务由 LiveListenerManager 处理（长连接），不通过 process_task 走任务队列。
# 主应用通过 /api/douyin/spider/live/listen 启停，sidecar 通过 LiveListenerManager._reconcile 发现。


# 任务类型 → 处理器映射表
TASK_HANDLERS: Dict[str, Any] = {
    # 私信
    "send_message": _handle_send_message,
    "create_conversation": _handle_create_conversation,
    "list_conversations": _handle_list_conversations,
    # 数据采集
    "get_user_info": _handle_get_user_info,
    "get_work_info": _handle_get_work_info,
    "get_user_works": _handle_get_user_works,
    "get_work_comments": _handle_get_work_comments,
    "search_general": _handle_search_general,
    "search_user": _handle_search_user,
    "search_live": _handle_search_live,
    "search_video": _handle_search_video,
    "get_followers": _handle_get_followers,
    "get_following": _handle_get_following,
    "get_notices": _handle_get_notices,
    "get_favorites": _handle_get_favorites,
    "get_collects": _handle_get_collects,
    "get_feed": _handle_get_feed,
    # 互动
    "digg_video": _handle_digg_video,
    "publish_comment": _handle_publish_comment,
    "collect_aweme": _handle_collect_aweme,
    "move_collect": _handle_move_collect,
    "remove_collect": _handle_remove_collect,
    # 直播间操作
    "live_send_danmaku": _handle_live_send_danmaku,
    "live_like": _handle_live_like,
    # 心跳
    "sync_status": None,  # 在 process_task 中特殊处理
}


def process_task(task: Dict[str, Any]) -> None:
    """处理单个任务并 ACK 结果。"""
    task_uuid = task.get("taskUuid") or ""
    account_id = _safe_int(task.get("accountId"))
    task_type = task.get("taskType") or "send_message"
    slot_id = task.get("slotId") or ""

    if not task_uuid or not account_id:
        ack_task(task_uuid, "failed", error="task_uuid 或 accountId 缺失")
        return

    log.info("处理任务 uuid=%s type=%s aid=%s", task_uuid, task_type, account_id)

    auth = get_auth_for_account(account_id, slot_id)
    if auth is None:
        ack_task(task_uuid, "failed", error="无法获取账号凭证或构造 auth")
        return

    try:
        if task_type == "sync_status":
            # 心跳已通过 listener_status 上报，这里直接 ACK success
            result = {"success": True, "responsePayload": {"syncedAt": int(time.time())}}
        else:
            handler = TASK_HANDLERS.get(task_type)
            if handler is None:
                result = {"success": False, "error": f"未知 taskType: {task_type}"}
            else:
                result = handler(task, auth, account_id)
    except Exception as e:
        log.error("任务处理异常 uuid=%s: %s", task_uuid, e)
        log.debug(traceback.format_exc())
        result = {"success": False, "error": f"任务处理异常: {_sanitize_err(e)}"}

    status = "success" if result.get("success") else "failed"
    ack_task(
        task_uuid,
        status,
        platform_msg_id=result.get("platformMsgId"),
        error=result.get("error"),
        response_payload=result.get("responsePayload"),
    )
    log.info("任务完成 uuid=%s status=%s", task_uuid, status)


def task_pull_loop(slot_id: str, stop_event: threading.Event) -> None:
    """任务拉取循环：每个账号一个 slot，按 slot_id 拉取。"""
    log.info("任务拉取循环启动 slot=%s interval=%ss", slot_id, TASK_PULL_INTERVAL_SEC)
    while not stop_event.wait(TASK_PULL_INTERVAL_SEC):
        try:
            tasks = pull_tasks(slot_id)
            if not tasks:
                continue
            log.info("拉取到 %d 个任务 slot=%s", len(tasks), slot_id)
            for task in tasks:
                try:
                    process_task(task)
                except Exception as e:
                    log.error("任务处理顶层异常: %s", e)
        except Exception as e:
            log.error("任务拉取循环异常 slot=%s: %s", slot_id, e)
            stop_event.wait(min(TASK_PULL_INTERVAL_SEC * 5, 30))


# ============================================================
# 直播间实时监听管理器
# ============================================================
# 独立于私信 WSS 的长连接：每个直播间一个 DouyinLive 子类实例，
# 子类覆写 on_message 把解析后的消息归一化为 live_event 事件转发到主应用。
# 直播间发现通过 /api/provider-gateway/tasks/pull 拉取 live_listen 任务（payload.liveId 必填）。


def _import_douyin_live():
    """延迟导入 DouyinLive，避免缺包时整个 sidecar 启动失败。"""
    from dy_live.server import DouyinLive  # noqa: E402
    return DouyinLive


class _LiveCallbackWrapper:
    """子类化 DouyinLive，覆写 on_message 把消息回调到 sidecar 事件转发。

    不修改 vendor 源码，通过继承 + 方法覆写实现钩子注入。
    """

    def __init__(self, base_live_cls, live_id: str, auth: Any, account_id: int, slot_id: str):
        self._base_cls = base_live_cls
        self._live_id = live_id
        self._auth = auth
        self._account_id = account_id
        self._slot_id = slot_id
        self._instance = None

    def _on_message(self, ws, message):  # noqa: ARG002
        """覆写 on_message：解析 protobuf 后归一化并转发。"""
        import gzip
        from static import Live_pb2  # type: ignore
        try:
            frame = Live_pb2.PushFrame()
            frame.ParseFromString(message)
            if frame.payloadType != "pb":
                return
            payload = gzip.decompress(frame.payload)
            response = Live_pb2.LiveResponse()
            response.ParseFromString(payload)
            if response.needAck:
                ack = Live_pb2.PushFrame()
                ack.payloadType = "ack"
                ack.payload = response.internalExt.encode('utf-8')
                ack.logId = frame.logId
                ws.send(ack.SerializeToString(), opcode=0x02)
            for item in response.messagesList:
                self._dispatch_message(item)
        except Exception as e:
            log.warning("直播间消息解析失败 aid=%s live=%s: %s", self._account_id, self._live_id, e)

    def _dispatch_message(self, item) -> None:
        """按 method 分发消息并归一化转发。"""
        from static import Live_pb2  # type: ignore
        method = item.method
        payload = item.payload
        event_type = "live_event"
        msg_kind = "unknown"
        msg_data: Dict[str, Any] = {"method": method}

        try:
            if method == "WebcastChatMessage":
                m = Live_pb2.ChatMessage()
                m.ParseFromString(payload)
                msg_kind = "chat"
                msg_data.update({
                    "secUid": m.user.sec_uid,
                    "nickname": m.user.nickname,
                    "content": m.content,
                })
            elif method == "WebcastGiftMessage":
                m = Live_pb2.GiftMessage()
                m.ParseFromString(payload)
                msg_kind = "gift"
                msg_data.update({
                    "secUid": m.user.sec_uid,
                    "nickname": m.user.nickname,
                    "toUserSecUid": m.toUser.sec_uid,
                    "toUserNickname": m.toUser.nickname,
                    "giftName": m.gift.name,
                    "comboCount": m.comboCount,
                })
            elif method == "WebcastMemberMessage":
                m = Live_pb2.MemberMessage()
                m.ParseFromString(payload)
                msg_kind = "member_enter"
                msg_data.update({
                    "secUid": m.user.sec_uid,
                    "nickname": m.user.nickname,
                })
            elif method == "WebcastLikeMessage":
                m = Live_pb2.LikeMessage()
                m.ParseFromString(payload)
                msg_kind = "like"
                msg_data.update({
                    "secUid": m.user.sec_uid,
                    "nickname": m.user.nickname,
                    "count": m.count,
                    "total": m.total,
                })
            elif method == "WebcastSocialMessage":
                m = Live_pb2.SocialMessage()
                m.ParseFromString(payload)
                msg_kind = "social"
                msg_data.update({
                    "secUid": m.user.sec_uid,
                    "nickname": m.user.nickname,
                    "action": m.action,
                })
            elif method == "WebcastRoomStatsMessage":
                m = Live_pb2.RoomStatsMessage()
                m.ParseFromString(payload)
                msg_kind = "room_stats"
                msg_data.update({"displayLong": m.displayLong})
            else:
                return
        except Exception as e:
            log.warning("直播间消息分发失败 method=%s: %s", method, e)
            return

        submit_event({
            "eventId": f"live-{self._account_id}-{self._live_id}-{int(time.time() * 1000)}-{method}",
            "provider": PROVIDER_NAME,
            "platform": "douyin",
            "eventType": event_type,
            "accountId": self._account_id,
            "slotId": self._slot_id,
            "metadata": {
                "liveId": self._live_id,
                "msgKind": msg_kind,
                "data": msg_data,
                "ts": int(time.time()),
            },
        })

    def start(self) -> None:
        """构造 DouyinLive 实例并覆写回调后启动。"""
        try:
            self._instance = self._base_cls(self._live_id, self._auth)
            # 覆写实例方法（Python 允许运行时替换实例属性）
            self._instance.on_message = self._on_message
            # 抑制 vendor 的 on_open/on_close 中的 print 与无限重连
            self._instance.on_open = lambda ws: None
            self._instance.on_error = lambda ws, err: log.warning(
                "直播间 WSS 错误 aid=%s live=%s: %s",
                self._account_id, self._live_id, _sanitize_err(err),
            )
            self._instance.on_close = lambda ws, code, msg: log.info(
                "直播间 WSS 关闭 aid=%s live=%s code=%s",
                self._account_id, self._live_id, code,
            )
            with _suppress_stdout():
                self._instance.start_ws()
        except Exception as e:
            log.warning("直播间监听启动失败 aid=%s live=%s: %s", self._account_id, self._live_id, _sanitize_err(e))


class LiveListenerManager:
    """直播间监听器生命周期管理：从主应用拉取 live_listen 任务并启动/停止监听。"""

    def __init__(self):
        self.listeners: Dict[str, _LiveCallbackWrapper] = {}  # key=f"{account_id}:{live_id}"
        self.threads: Dict[str, threading.Thread] = {}
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self._live_cls = None  # 延迟导入

    def _ensure_live_cls(self):
        if self._live_cls is None:
            self._live_cls = _import_douyin_live()
        return self._live_cls

    def _fetch_live_listen_tasks(self) -> List[Dict[str, Any]]:
        """从主应用拉取 live_listen 任务（任务类型特殊：长连接，不 ACK success/fail，仅用于发现）。

        主应用通过 /api/douyin/spider/live/listen 入队 live_listen 任务，sidecar 拉取后
        启动监听并 ACK success（任务完成 = 监听已启动）；停止通过 live_stop 任务或主应用删除账号触发。
        """
        # 复用任务拉取接口，但过滤 taskType=live_listen
        try:
            resp = post_to_main_app(
                "/api/provider-gateway/tasks/pull",
                {
                    "provider": PROVIDER_NAME,
                    "slotId": "live-listener-pool",  # 独立 slot，不与账号 slot 冲突
                    "limit": LIVE_LISTEN_MAX_ROOMS,
                    "taskType": "live_listen",  # 服务端按 taskType 过滤（如不支持则忽略）
                },
            )
            if not resp or resp.get("code") != 0:
                return []
            data = resp.get("data", {}) or {}
            items = data.get("items", []) if isinstance(data, dict) else []
            return [t for t in items if t.get("taskType") == "live_listen"]
        except Exception as e:
            log.warning("拉取 live_listen 任务失败: %s", e)
            return []

    def _start_listener(self, account_id: int, live_id: str, slot_id: str) -> None:
        """启动一个直播间监听线程。"""
        key = f"{account_id}:{live_id}"
        if key in self.listeners:
            return
        # 获取该账号的 auth（复用私信路径的 auth 缓存）
        auth = get_auth_for_account(account_id, slot_id)
        if auth is None:
            log.warning("无法获取 auth，跳过直播间监听 aid=%s live=%s", account_id, live_id)
            return
        cls = self._ensure_live_cls()
        wrapper = _LiveCallbackWrapper(cls, live_id, auth, account_id, slot_id)
        self.listeners[key] = wrapper
        t = threading.Thread(
            target=self._run_listener,
            args=(wrapper, key),
            name=f"live-{account_id}-{live_id}",
            daemon=True,
        )
        self.threads[key] = t
        t.start()
        log.info("直播间监听已启动 aid=%s live=%s", account_id, live_id)

    def _run_listener(self, wrapper: _LiveCallbackWrapper, key: str) -> None:
        """运行直播间监听，含指数退避重连。"""
        attempt = 0
        while not self.stop_event.is_set():
            try:
                wrapper.start()
            except Exception as e:
                log.warning("直播间监听异常 key=%s: %s", key, e)
            if self.stop_event.is_set():
                break
            attempt += 1
            delay = min(LIVE_RECONNECT_BASE_SEC * (2 ** min(attempt, 6)), LIVE_RECONNECT_MAX_SEC)
            log.info("直播间监听将在 %.1fs 后重连 key=%s（第 %d 次）", delay, key, attempt)
            self.stop_event.wait(delay)

    def _stop_listener(self, key: str) -> None:
        """停止一个直播间监听。"""
        wrapper = self.listeners.pop(key, None)
        self.threads.pop(key, None)
        if wrapper and wrapper._instance and wrapper._instance.ws:
            try:
                wrapper._instance.ws.close()
            except Exception:
                pass
        log.info("直播间监听已停止 key=%s", key)

    def _reconcile(self) -> None:
        """轮询主应用，启动新增 live_listen、停止已删除的。"""
        if not LIVE_LISTEN_ENABLED:
            return
        tasks = self._fetch_live_listen_tasks()
        seen_keys = set()
        for task in tasks:
            account_id = _safe_int(task.get("accountId"))
            payload = task.get("payload", {}) or {}
            live_id = _str(payload.get("liveId") or payload.get("live_id") or "").strip()
            slot_id = _str(task.get("slotId") or f"live-{account_id}")
            if not account_id or not live_id:
                continue
            key = f"{account_id}:{live_id}"
            seen_keys.add(key)
            if key not in self.listeners and len(self.listeners) < LIVE_LISTEN_MAX_ROOMS:
                self._start_listener(account_id, live_id, slot_id)
                # live_listen 任务 ACK success（已启动监听）
                ack_task(task.get("taskUuid") or "", "success", response_payload={"liveId": live_id, "started": True})

        # 停止不在最新任务列表中的监听器
        with self.lock:
            stale_keys = [k for k in self.listeners.keys() if k not in seen_keys]
        for k in stale_keys:
            self._stop_listener(k)

    def run(self, stop_event: threading.Event) -> None:
        """主循环：定期 reconcile。"""
        log.info("直播间监听管理器启动 enabled=%s max=%s", LIVE_LISTEN_ENABLED, LIVE_LISTEN_MAX_ROOMS)
        while not stop_event.wait(LIVE_LISTEN_POLL_INTERVAL_SEC):
            try:
                self._reconcile()
            except Exception as e:
                log.error("直播间监听 reconcile 异常: %s", e)
                log.debug(traceback.format_exc())
        # 退出时清理
        with self.lock:
            keys = list(self.listeners.keys())
        for k in keys:
            self._stop_listener(k)


class AccountListener:
    """一个抖音账号的 WSS 监听器，包含重连逻辑。"""

    def __init__(self, account_id: int, slot_id: str, cookie_header: str):
        self.account_id = account_id
        self.slot_id = slot_id
        self.cookie_header = cookie_header
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.current_status = "offline"

    def _set_status(self, status: str, message: str = "") -> None:
        if status != self.current_status:
            self.current_status = status
            submit_heartbeat(self.account_id, self.slot_id, status, message)

    def _run(self) -> None:
        attempt = 0
        while not self.stop_event.is_set():
            try:
                self._set_status("connecting")
                auth = DouyinAuth()
                # WSS 接收路径只需要 cookie；不需要 web_protect_str/keys_str
                auth.perepare_auth(self.cookie_header, "", "")
                listener = DouyinRecvMsg(auth, auto_reconnect=False)
                # 覆盖回调，注入我们的事件转发逻辑
                listener.on_message = self._build_on_message(listener)
                listener.on_error = self._build_on_error(listener)
                listener.on_close = self._build_on_close(listener)
                self._set_status("online")
                log.info("账号 %s WSS 连接已建立", self.account_id)
                listener.start()
            except Exception as e:
                log.warning("账号 %s WSS 连接异常: %s", self.account_id, e)
                self._set_status("error", str(e)[:200])
            # 退出 listener.start() 后进入重连循环
            if self.stop_event.is_set():
                break
            attempt += 1
            delay = min(RECONNECT_BASE_SEC * (2 ** min(attempt, 6)), RECONNECT_MAX_SEC)
            log.info("账号 %s 将在 %.1fs 后重连（第 %d 次）", self.account_id, delay, attempt)
            self.stop_event.wait(delay)

    def _build_on_message(self, listener: DouyinRecvMsg):
        def on_message(ws, message):  # noqa: ARG001
            try:
                self._handle_raw_frame(message)
            except Exception as e:
                log.warning("账号 %s 消息处理失败: %s", self.account_id, e)
                log.debug(traceback.format_exc())
        return on_message

    def _build_on_error(self, listener: DouyinRecvMsg):
        def on_error(ws, error):  # noqa: ARG001
            # WSS URL 含 sessionid token，错误对象 str() 可能包含完整 URL，
            # 仅记录错误类型与截断消息，避免凭证泄露到日志。
            err_str = str(error)
            err_safe = re.sub(r'token=[^&\s]+', 'token=***', err_str)[:200]
            log.warning("账号 %s WSS 错误: %s", self.account_id, err_safe)
            self._set_status("error", err_safe)
        return on_error

    def _build_on_close(self, listener: DouyinRecvMsg):
        def on_close(ws, close_status_code, close_msg):  # noqa: ARG001
            log.info("账号 %s WSS 关闭 code=%s", self.account_id, close_status_code)
            self._set_status("offline", f"closed code={close_status_code}")
        return on_close

    def _handle_raw_frame(self, message: bytes) -> None:
        """解析 protobuf PushFrame 并提交归一化事件。"""
        from static import Live_pb2, Response_pb2  # type: ignore

        frame = Live_pb2.PushFrame()
        frame.ParseFromString(message)

        if frame.payloadType == "text/json":
            try:
                log.info("账号 %s 收到 text/json 帧: %s", self.account_id, json.loads(frame.payload))
            except Exception:
                log.info("账号 %s 收到 text/json 帧（解析失败）", self.account_id)
            return

        if frame.payloadType != "pb":
            return

        response = Response_pb2.Response()
        response.ParseFromString(frame.payload)
        notify = response.body.new_message_notify
        if not notify or not notify.message:
            return

        msg = notify.message
        try:
            content = json.loads(msg.content) if msg.content else {}
        except (json.JSONDecodeError, TypeError):
            content = msg.content or ""

        submit_message_event(
            account_id=self.account_id,
            slot_id=self.slot_id,
            conversation_id=msg.conversation_id or notify.conversation_id,
            server_message_id=msg.server_message_id,
            index_in_conversation=msg.index_in_conversation,
            message_type=msg.message_type,
            sender=msg.sender,
            content=content,
        )

    def start(self) -> None:
        self.thread = threading.Thread(
            target=self._run,
            name=f"dy-wss-{self.account_id}",
            daemon=True,
        )
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=5)


# ============================================================
# 主调度器
# ============================================================


class WssBridge:
    """账号发现 + 监听器生命周期管理 + 任务拉取（发送/会话/采集/互动/直播）。"""

    def __init__(self):
        self.listeners: Dict[int, AccountListener] = {}
        self.task_threads: Dict[int, threading.Thread] = {}  # account_id → 任务拉取线程
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.live_manager = LiveListenerManager()
        self.live_thread: Optional[threading.Thread] = None

    def _reconcile(self) -> None:
        """对比已运行监听器与当前账号列表，启动新增、停止移除。"""
        if not LISTENER_ENABLED:
            return
        accounts = discover_accounts()
        if not accounts:
            log.info("未发现需要监听的抖音账号")
        # 限制并发账号数
        accounts = accounts[:MAX_ACCOUNTS]
        seen_ids = {int(a.get("accountId")) for a in accounts if a.get("accountId")}

        with self.lock:
            # 停止已移除账号的监听器和任务线程
            for aid in list(self.listeners.keys()):
                if aid not in seen_ids:
                    log.info("账号 %s 已下线，停止监听", aid)
                    self.listeners[aid].stop()
                    del self.listeners[aid]

            # 启动新增账号的监听器
            for acc in accounts:
                aid = int(acc.get("accountId"))
                if aid in self.listeners:
                    continue
                slot_id = acc.get("slotId") or f"douyin-wss-{aid}"
                cookie_header = fetch_credentials(aid, slot_id)
                if not cookie_header:
                    log.warning("账号 %s 无法获取 cookie，跳过", aid)
                    continue
                listener = AccountListener(aid, slot_id, cookie_header)
                self.listeners[aid] = listener
                listener.start()
                log.info("账号 %s 已启动 WSS 监听器 slot=%s", aid, slot_id)

                # 启动该账号的任务拉取线程（仅当 task_pull 启用）
                if TASK_PULL_ENABLED and aid not in self.task_threads:
                    t = threading.Thread(
                        target=task_pull_loop,
                        args=(slot_id, self.stop_event),
                        name=f"task-pull-{aid}",
                        daemon=True,
                    )
                    self.task_threads[aid] = t
                    t.start()
                    log.info("账号 %s 已启动任务拉取线程 slot=%s", aid, slot_id)

    def _heartbeat_loop(self) -> None:
        """定期上报所有监听器的心跳。"""
        while not self.stop_event.wait(HEARTBEAT_INTERVAL_SEC):
            with self.lock:
                listeners = list(self.listeners.values())
            for l in listeners:
                try:
                    submit_heartbeat(l.account_id, l.slot_id, l.current_status)
                except Exception as e:
                    log.warning("心跳上报失败 aid=%s: %s", l.account_id, e)

    def run(self) -> None:
        log.info("抖音 WSS Bridge 启动 api=%s provider=%s enabled=%s", API_URL, PROVIDER_NAME, LISTENER_ENABLED)
        log.info(
            "配置: max_accounts=%s poll=%ss heartbeat=%ss task_pull=%s live_listen=%s",
            MAX_ACCOUNTS, POLL_INTERVAL_SEC, HEARTBEAT_INTERVAL_SEC, TASK_PULL_ENABLED, LIVE_LISTEN_ENABLED,
        )

        # 启动心跳线程
        hb = threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True)
        hb.start()

        # 启动直播间监听管理器（独立线程，与私信 WSS 并行）
        if LIVE_LISTEN_ENABLED:
            self.live_thread = threading.Thread(
                target=self.live_manager.run,
                args=(self.stop_event,),
                name="live-listener-mgr",
                daemon=True,
            )
            self.live_thread.start()

        # 主账号发现循环
        while not self.stop_event.wait(POLL_INTERVAL_SEC):
            try:
                self._reconcile()
            except Exception as e:
                log.error("账号发现循环异常: %s", e)
                log.debug(traceback.format_exc())

        # 退出时清理
        log.info("正在停止所有监听器...")
        with self.lock:
            for listener in self.listeners.values():
                listener.stop()
            self.listeners.clear()
            self.task_threads.clear()
        # 直播间监听器由 LiveListenerManager.run 自行在 stop_event 触发后清理

    def stop(self) -> None:
        self.stop_event.set()


# ============================================================
# 入口
# ============================================================


def main() -> None:
    if not API_KEY or not API_SECRET:
        log.error("PROVIDER_GATEWAY_API_KEY 和 PROVIDER_GATEWAY_WEBHOOK_SECRET 必须同时配置，无法启动")
        sys.exit(1)
    if not LISTENER_ENABLED:
        log.info("DOUYIN_WSS_LISTENER_ENABLED=0，sidecar 退出")
        sys.exit(0)

    bridge = WssBridge()

    def handle_signal(signum, _frame):
        log.info("收到信号 %s，正在退出...", signum)
        bridge.stop()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        bridge.run()
    except KeyboardInterrupt:
        pass
    log.info("抖音 WSS Bridge 已退出")


if __name__ == "__main__":
    main()
