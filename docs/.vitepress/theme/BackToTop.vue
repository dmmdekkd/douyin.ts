<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useData } from 'vitepress'
import type { BackToTopOptions } from './backToTop'

const { theme } = useData<{ backToTop?: BackToTopOptions }>()

// 默认外观，可被 config.mts 的 themeConfig.backToTop 覆盖；
// 阴影用 color-mix 跟随品牌色，切主题色时整体一致
const opt = computed(() => ({
  size: 44,
  radius: 50,
  bg: 'var(--vp-c-brand-1)',
  hoverBg: 'var(--vp-c-brand-2)',
  color: '#fff',
  shadow: '0 6px 24px color-mix(in srgb, var(--vp-c-brand-1) 30%, transparent)',
  bottom: 80,
  right: 24,
  iconSize: 20,
  duration: 600,
  ...(theme.value.backToTop ?? {}),
}))

// CSS 变量，供 scoped 样式引用颜色
const vars = computed(() => ({
  '--b2t-bg': opt.value.bg,
  '--b2t-hover-bg': opt.value.hoverBg,
  '--b2t-color': opt.value.color,
  '--b2t-shadow': opt.value.shadow,
}))

const pos = computed(() => ({
  width: `${opt.value.size}px`,
  height: `${opt.value.size}px`,
  borderRadius: opt.value.radius >= 50 ? '50%' : `${opt.value.radius}px`,
  bottom: `${opt.value.bottom}px`,
  right: `${opt.value.right}px`,
}))

const show = ref(false)
let ticking = false

const onScroll = () => {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    show.value = window.scrollY > window.innerHeight
    ticking = false
  })
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

// 缓动滚动回顶：easeInOutCubic，时长可配
const toTop = () => {
  const start = window.scrollY
  if (start <= 0) return
  const startTime = performance.now()
  const ease = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  const duration = opt.value.duration

  const step = (now: number) => {
    const p = Math.min((now - startTime) / duration, 1)
    window.scrollTo(0, start * (1 - ease(p)))
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
</script>

<template>
  <Transition name="b2t">
    <button
      v-if="show"
      class="back-to-top"
      aria-label="回到顶部"
      :style="[vars, pos]"
      @click="toTop"
    >
      <svg
        :width="opt.iconSize"
        :height="opt.iconSize"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 19V5"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        />
        <path
          d="M5 12L12 5l7 7"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </Transition>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--b2t-bg);
  color: var(--b2t-color, #fff);
  box-shadow: var(--b2t-shadow);
  cursor: pointer;
  z-index: 200;
}

.back-to-top:hover {
  background: var(--b2t-hover-bg);
}

/* 出现 / 消失：淡入 + 轻微上移，与官方动效节奏一致 */
.b2t-enter-active,
.b2t-leave-active {
  transition:
    opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.b2t-enter-from,
.b2t-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.b2t-enter-to,
.b2t-leave-from {
  opacity: 1;
  transform: translateY(0);
}

@media print {
  .back-to-top {
    display: none;
  }
}
</style>