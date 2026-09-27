<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { useData } from 'vitepress'

// 侧边栏新版本公告：GitHub 最新 Release 高于文档当前版本才弹出，关闭后本版本不再打扰
interface Rel {
  tag: string
  link: string
}

const KEY = 'dts-release-dismissed'

const { theme } = useData()
const show = ref(false)
const rel = ref<Rel | null>(null)
let latest = ''

// 模块级缓存：一次拉取全站复用，避免路由切换反复请求 GitHub API
let cache: Rel | null | undefined

// 三位数字版本比较，a 高于 b 返回 true
function gt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

onMounted(async () => {
  const cur = String(theme.value.currentVersion ?? '').replace(/^v/, '')
  if (!cur) return
  try {
    cache ??= await fetch(
      'https://api.github.com/repos/dmmdekkd/douyin.ts/releases/latest',
      { headers: { accept: 'application/vnd.github+json' } },
    ).then(async res => {
      if (!res.ok) return null
      const d = (await res.json()) as {
        tag_name?: string
        html_url?: string
      }
      if (!d.tag_name) return null
      return {
        tag: d.tag_name,
        link: d.html_url ?? 'https://github.com/dmmdekkd/douyin.ts/releases',
      }
    })
  } catch {
    cache = null
  }
  // 无新版本或已关闭过当前版本时不打扰
  if (!cache || !gt(cache.tag.replace(/^v/, ''), cur)) return
  if (localStorage.getItem(KEY) === cache.tag) return
  latest = cache.tag
  rel.value = cache
  show.value = true
})

function dismiss() {
  localStorage.setItem(KEY, latest)
  show.value = false
}
</script>

<template>
  <aside v-if="show && rel" class="release-banner">
    <a class="main" :href="rel.link" target="_blank" rel="noopener">
      <span class="badge">新版本</span>
      <strong class="tag">{{ rel.tag }}</strong>
      <span class="arrow vpi-arrow-right" />
    </a>
    <button class="close" aria-label="关闭版本公告" @click="dismiss">×</button>
  </aside>
</template>

<style scoped>
/* 侧边栏导航顶部紧凑公告条 */
.release-banner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 12px 8px;
  padding: 8px 12px 8px 8px;
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 8px;
  background: linear-gradient(180deg, var(--vp-c-brand-soft), transparent 85%);
}

.main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

/* 版本号单行展示，超出省略 */
.tag {
  font-size: 14px;
  line-height: 1.3;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arrow {
  margin-left: auto;
  font-size: 13px;
  color: var(--vp-c-brand-1);
}

.close {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.25s, color 0.25s;
}

.close:hover {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}
</style>