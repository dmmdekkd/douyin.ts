<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vitepress'

// 顶部加载条：SPA 路由切换期间以品牌色细条推进，替代浏览器原生加载反馈
const state = ref<'idle' | 'run' | 'done'>('idle')
const bar = ref<HTMLElement>()

const router = useRouter()
let prevBefore: typeof router.onBeforeRouteChange
let prevAfter: typeof router.onAfterRouteChange

// 切断动画前固化当前宽度，避免动画移除瞬间宽度闪回 0
const start = () => {
  if (!bar.value) return
  bar.value.style.width = '0px'
  state.value = 'run'
}

const finish = () => {
  if (state.value !== 'run' || !bar.value) return
  state.value = 'done'
  bar.value.style.width = getComputedStyle(bar.value).width
  // 下一帧释放内联宽度，让样式表的 100% 生效并触发补满过渡
  requestAnimationFrame(() => {
    if (bar.value) bar.value.style.width = ''
  })
}

// 补满 / 淡出过渡结束后复位，准备下一次切换
const onTrans = (e: TransitionEvent) => {
  if (e.target !== bar.value || state.value !== 'done') return
  state.value = 'idle'
}

onMounted(() => {
  bar.value?.addEventListener('transitionend', onTrans)
  // 保留既有 hook，链式调用再触发进度条，避免覆盖上层配置
  prevBefore = router.onBeforeRouteChange
  prevAfter = router.onAfterRouteChange
  router.onBeforeRouteChange = (to) => {
    void prevBefore?.(to)
    start()
  }
  router.onAfterRouteChange = (to) => {
    void prevAfter?.(to)
    finish()
  }
})

onBeforeUnmount(() => {
  bar.value?.removeEventListener('transitionend', onTrans)
  router.onBeforeRouteChange = prevBefore
  router.onAfterRouteChange = prevAfter
})
</script>

<template>
  <div class="page-progress" :class="state" aria-hidden="true">
    <div ref="bar" class="bar" />
  </div>
</template>

<style scoped>
/* 顶部 2px 加载条，覆盖在导航之上；仅路由切换期间可见 */
.page-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 999;
  pointer-events: none;
  opacity: 0;
}

.page-progress.run {
  opacity: 1;
}

/* run 用动画慢速推进（动画优先级高于过渡），done 短转到 100% 后淡出 */
.page-progress.run .bar {
  animation: page-progress-run 2s ease-out forwards;
}

.page-progress.done {
  opacity: 0;
  transition: opacity 0.25s ease 0.1s;
}

.page-progress.done .bar {
  width: 100%;
  opacity: 0;
}

.bar {
  height: 100%;
  width: 0;
  opacity: 1;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 10px color-mix(in srgb, var(--vp-c-brand-1) 70%, transparent);
  transition:
    width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.25s ease;
}

/* 慢速推进到 9 成，剩余交给 done 补满，观感接近真实加载 */
@keyframes page-progress-run {
  from {
    width: 0;
  }
  60% {
    width: 70%;
  }
  to {
    width: 90%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-progress {
    display: none;
  }
}
</style>