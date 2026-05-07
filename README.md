# 无限画卷

个人使用的 AI 长卷生成 Web 应用 MVP。应用使用 Supabase 存储画卷、图片、任务和日志，本地 `dev:api` 提供真实生图、扩图衔接、自动调度和图片操作 API。

## 本地运行

```bash
npm install
npm run dev:api
npm run dev -- --port 5173
```

打开 `http://127.0.0.1:5173`。

本地 API 启动后会自动开启调度器，每 30 秒扫描一次到期画卷。也可以手动触发一次扫描：

```bash
curl -X POST http://127.0.0.1:5180/api/system/tick
```

## 验证

```bash
npm test
npm run build
```

## Vercel 环境变量

在 Vercel Project Settings 里配置：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- 可选：`DEEPSEEK_API_KEY`
- 可选：`MAX_CONCURRENT_JOBS`
- 可选：`GENERATION_TIMEOUT_MS`

本地或 CI 可先运行：

```bash
npm run check:deploy-env
```

部署后验证：

1. 打开 Vercel 域名，确认页面能读取 Supabase 画卷。
2. 访问 `/api/cron/generate?manual=1&scrollId=<真实画卷ID>`，确认返回 `ok: true`。
3. 回到页面刷新，确认 `generation_jobs`、`generation_logs` 和 `scroll_images` 有更新。
4. 等待 Vercel Cron 触发，确认到期画卷能自动生成。

## 已实现

- 创建画卷并保存到 Supabase。
- DeepSeek 优化画卷提示词。
- 第一张真实生图，后续使用 Image Edit 扩图续画。
- 图片上传 Supabase Storage，并写入 `scroll_images`。
- 预览按 `visible_crop` 只展示非重复区域。
- 像素级覆盖衔接：上一张右侧重叠区会硬覆盖到下一张左侧。
- 衔接质量评分：基于重叠区像素差异给出 0-100 分，低分自动标记风险。
- 本地自动生成调度器。
- Vercel Cron API 复用扩图、锁、失败释放和并行逻辑。
- 失败任务一键重试。
- 插入/中间重生成后自动批量重绘后续段。
- 标题、主题、提示词编辑。
