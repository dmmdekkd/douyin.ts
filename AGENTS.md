# AGENTS

本项目编码规范，所有代码必须遵守。设计上下文见 CONTEXT.md。

## 命名（全部统一、简洁简短）

- 文件名：全小写、单个语义词、能短则短（`client.ts` `jar.ts` `res.ts` `recv.ts` `notice.ts` `types.ts`）
- 类 / 接口 / 类型：PascalCase 短词（`Client` `Http` `Jar` `InMsg`）
- 常量：短名，禁止长前缀堆叠；域常量用分组对象（`im` / `web`），大元信息对象并入使用函数内联不导出
- 变量 / 函数 / 方法：camelCase 短动词（`send` `req` `on` `parse`）
- 同一概念全库只用同一个词，禁止同义混用（如 cookie 会话统一叫 `jar`，入站消息统一叫 `recv`）

## 写法（全部统一）

- 纯 ESM；相对导入带 `.js` 后缀；类型导入一律 `import type` 分离
- 每个目录一个 `index.ts` 聚合导出；文件单一职责，域方法直接转发到对应模块，不写包装逻辑
- 方法体简短：超过 40 行考虑拆分；单处使用的类型可内联，不单独导出
- 严禁：`any`、`console.log`、魔法延迟、冗长命名、防御式重复校验
- 日志走 `log.ts`，等级 info/warn/error，彩色输出，频繁重复日志（重连心跳等）不打印
- 注释用中文，只写「为什么」，不写「是什么」

## API 规范

- 统一形态 `bot.域.动作`，两级结构，不新增第三级
- 会话标识统一 `chatId` 字符串，内部解析为 address，不暴露解析细节
- 方法返回 Promise 或同步值，事件统一 `bot.on(event, fn)`
- 对外导出只走 `src/index.ts`

## 验证

- `pnpm check`（tsgo 类型检查）+ `pnpm build`（tsdown）通过才算完成
- 移植自参考项目的算法体（sign / protocol）保持逻辑原样，只改命名与依赖，不做「顺手优化」
