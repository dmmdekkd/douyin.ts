<script setup lang="ts">
// 文档页底部贡献者：圆形头像 + 名称，数据在此维护，新增贡献者往数组里加即可
const contributors = [
  { name: 'dmmdekkd', url: 'https://github.com/dmmdekkd', avatar: 'https://github.com/dmmdekkd.png?size=96' },
]
</script>

<template>
  <div class="contributors">
    <p class="contributors-title">贡献者</p>
    <ul class="contributors-list">
      <li v-for="c in contributors" :key="c.name" class="contributors-item">
        <a :href="c.url" target="_blank" rel="noopener" class="contributors-link">
          <img :src="c.avatar" :alt="c.name" class="contributors-avatar" width="40" height="40" loading="lazy" />
          <span class="contributors-name">{{ c.name }}</span>
        </a>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.contributors {
  margin: 48px 0 32px;
  padding-top: 24px;
  /* 与正文区隔，层级一目了然 */
  border-top: 1px solid var(--vp-c-divider);
}

.contributors-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.contributors-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.contributors-item {
  margin: 0;
}

.contributors-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}

.contributors-avatar {
  border-radius: 50%;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  transition: border-color 0.25s;
}

.contributors-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}

.contributors-link:hover .contributors-avatar {
  border-color: var(--vp-c-brand-1);
}

.contributors-link:hover .contributors-name {
  color: var(--vp-c-brand-1);
}
</style>