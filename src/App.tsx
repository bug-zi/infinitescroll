import {
  Bell,
  Box,
  CheckCircle2,
  Clock3,
  Edit3,
  Eye,
  Gauge,
  ImagePlus,
  List,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { confirmAction } from "./lib/confirmAction";
import { DEFAULT_LOG_PREVIEW_LIMIT, getRecentLogs, groupLogsByScroll } from "./lib/logViews";
import { clampScale, computeInitialPan, computePanForHeldDirection, computeSegmentLayout, computeVisibleImageLayout, computeZoomAroundPoint } from "./lib/panoramaViewer";
import { summarizePrompt } from "./lib/promptDisplay";
import { FIXED_OVERLAP_RATIO } from "./lib/stitching";
import { formatStitchScore } from "./lib/stitchQuality";
import { formatClock, formatDateMinute, getCountdownParts, getGenerationPlanItems } from "./lib/time";
import { useInfiniteScrollStore } from "./lib/store";
import type { GenerationJob, GenerationLog, Scroll, ScrollImage } from "./types";

const statusText: Record<Scroll["status"], string> = {
  generating: "生成中",
  paused: "已暂停",
  complete: "已完成",
};

type View = "workspace" | "console" | "logs" | "settings";

export function App() {
  const store = useInfiniteScrollStore();
  const [view, setView] = useState<View>("workspace");
  const [editing, setEditing] = useState(false);
  const [viewerInitialImageId, setViewerInitialImageId] = useState("");
  const countdown = store.selectedScroll ? getCountdownParts(store.selectedScroll.nextRunAt).label : "00:00";

  return (
    <div className="app-shell">
      <Sidebar
        scrolls={store.scrolls}
        selectedScrollId={store.selectedScroll?.id ?? ""}
        view={view}
        onView={setView}
        onCreate={store.createScroll}
        onDelete={store.deleteScroll}
        onSelect={(id) => {
          store.selectScroll(id);
          setView("workspace");
        }}
      />
      <main className="app-main">
        <Topbar isGenerating={store.isGenerating || store.systemStatus.activeConcurrentJobs > 0} onOpenConsole={() => setView("console")} />
        {view === "workspace" && (
          <div className="workspace">
            <div className="center-column">
              <ScrollHeader
                scroll={store.selectedScroll}
                countdown={countdown}
                dataMode={store.dataMode}
                dataMessage={store.dataMessage}
                isGenerating={store.isGenerating}
                onRefresh={() => void store.refresh()}
                onGenerateNow={store.generateNextImageNow}
                onToggleAuto={store.toggleAutoGeneration}
                onEdit={() => setEditing(true)}
              />
              <ScrollPreview
                images={store.images}
                selectedImageId={store.selectedImage?.id}
                onSelect={store.setSelectedImageId}
                onOpen={(image) => setViewerInitialImageId(image.id)}
              />
              <GenerationPlan scroll={store.selectedScroll} jobs={store.jobs} images={store.images} />
              <LogPanel logs={store.logs} onViewMore={() => setView("logs")} />
            </div>
            <Inspector
              image={store.selectedImage}
              systemStatus={store.systemStatus}
              onOpenViewer={() => store.selectedImage && setViewerInitialImageId(store.selectedImage.id)}
              onRegenerate={() =>
                store.selectedImage &&
                confirmAction(`确定重新生成第 ${store.selectedImage.index} 张图片吗？`, () => {
                  void store.regenerateImage(store.selectedImage.id);
                })
              }
              onDelete={() =>
                store.selectedImage &&
                confirmAction(`确定删除第 ${store.selectedImage.index} 张图片吗？`, () => {
                  void store.deleteImage(store.selectedImage.id);
                })
              }
              onInsert={(side) =>
                store.selectedImage &&
                confirmAction(`确定在第 ${store.selectedImage.index} 张${side === "before" ? "前" : "后"}插入新图片吗？`, () => {
                  void store.insertImage(store.selectedImage.id, side);
                })
              }
            />
          </div>
        )}
        {view === "console" && (
          <ConsolePage
            scrolls={store.scrolls}
            images={store.allImages}
            jobs={store.allJobs}
            logs={store.allLogs}
            onRetryJob={store.retryJob}
            onSelectScroll={(id) => {
              store.selectScroll(id);
              setView("workspace");
            }}
          />
        )}
        {view === "logs" && (
          <LogsPage
            scrolls={store.scrolls}
            logs={store.allLogs}
            onSelectScroll={(id) => {
              store.selectScroll(id);
              setView("workspace");
            }}
          />
        )}
        {view === "settings" && <SettingsPage />}
      </main>
      {editing && store.selectedScroll && (
        <ScrollEditDialog
          scroll={store.selectedScroll}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            await store.updateScrollInfo(input);
            setEditing(false);
          }}
        />
      )}
      {viewerInitialImageId && (
        <ScrollPanoramaViewer images={store.images} initialImageId={viewerInitialImageId} onClose={() => setViewerInitialImageId("")} />
      )}
    </div>
  );
}

function Sidebar({
  scrolls,
  selectedScrollId,
  view,
  onView,
  onCreate,
  onDelete,
  onSelect,
}: {
  scrolls: Scroll[];
  selectedScrollId: string;
  view: View;
  onView: (view: View) => void;
  onCreate: (theme: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const [theme, setTheme] = useState("");

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><ScrollText size={24} /></div>
        <div>
          <h1>AI 画卷</h1>
          <p>让 AI 持续绘制无限画卷</p>
        </div>
      </div>
      <div className="create-box">
        <input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="输入画卷主题" />
        <button
          className="create-button"
          onClick={() => {
            onCreate(theme || "清明上河图风格");
            setTheme("");
          }}
        >
          <Plus size={17} /> 创建画卷
        </button>
      </div>
      <nav className="main-nav">
        <button className={`nav-item ${view === "workspace" ? "active" : ""}`} onClick={() => onView("workspace")}>
          <Box size={17} /> 我的画卷
        </button>
        <button className={`nav-item ${view === "console" ? "active" : ""}`} onClick={() => onView("console")}>
          <Gauge size={17} /> 控制台
        </button>
        <button className={`nav-item ${view === "logs" ? "active" : ""}`} onClick={() => onView("logs")}>
          <List size={17} /> 日志记录
        </button>
        <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => onView("settings")}>
          <Settings size={17} /> 设置
        </button>
      </nav>
      <div className="scroll-list">
        <div className="section-label">画卷列表</div>
        {scrolls.map((scroll) => (
          <div key={scroll.id} className={`scroll-list-item ${scroll.id === selectedScrollId ? "selected" : ""}`}>
            <button className="scroll-select-button" onClick={() => onSelect(scroll.id)}>
              <div className="scroll-row">
                <strong>{scroll.title}</strong>
                <span className={scroll.status}>{statusText[scroll.status]}</span>
              </div>
              <div className="scroll-meta">
                <span>{scroll.imageCount} 张</span>
                <span>/</span>
                <span>{scroll.autoGenerationEnabled ? "自动生成" : "手动暂停"}</span>
              </div>
              <img src={scroll.thumbnail} alt="" />
            </button>
            <button
              className="scroll-delete-button"
              aria-label={`删除画卷 ${scroll.title}`}
              title="删除画卷"
              onClick={() =>
                confirmAction(`确定删除画卷「${scroll.title}」吗？此操作会删除该画卷的全部图片、任务和日志，且无法撤销。`, () => {
                  void onDelete(scroll.id);
                })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Topbar({ isGenerating, onOpenConsole }: { isGenerating: boolean; onOpenConsole: () => void }) {
  return (
    <header className="topbar">
      <div />
      <div className="topbar-actions">
        <span className="service-pill"><span />{isGenerating ? "正在生成" : "服务运行中"}</span>
        <button className="outline-button" onClick={onOpenConsole}><List size={16} /> 控制台</button>
        <button className="icon-button" aria-label="通知"><Bell size={17} /></button>
        <div className="avatar">Y</div>
        <span className="username">Yuer</span>
      </div>
    </header>
  );
}

function ScrollHeader(props: {
  scroll?: Scroll;
  countdown: string;
  dataMode: "loading" | "supabase" | "mock";
  dataMessage: string;
  isGenerating: boolean;
  onRefresh: () => void;
  onGenerateNow: () => void;
  onToggleAuto: () => void;
  onEdit: () => void;
}) {
  const { scroll } = props;
  if (!scroll) {
    return (
      <section className="panel hero-panel">
        <h2>还没有画卷</h2>
        <p className="theme-text">请确认本地 API 服务正在运行，或在左侧创建一个新画卷。</p>
        <DataBanner mode={props.dataMode} message={props.dataMessage} onRefresh={props.onRefresh} />
      </section>
    );
  }

  return (
    <section className="panel hero-panel">
      <div className="hero-actions">
        <button className="small-button" onClick={props.onGenerateNow} disabled={props.isGenerating}>
          {props.isGenerating ? <Loader2 className="spin" size={15} /> : <ImagePlus size={15} />} {props.isGenerating ? "生成中" : "立即生成"}
        </button>
        <button className="small-button" onClick={props.onToggleAuto}>
          {scroll.autoGenerationEnabled ? <Pause size={15} /> : <Play size={15} />} {scroll.autoGenerationEnabled ? "暂停生成" : "继续生成"}
        </button>
      </div>
      <div className="title-row">
        <h2>{scroll.title}</h2>
        <button className="ghost-icon" aria-label="编辑画卷" onClick={props.onEdit}><Edit3 size={16} /></button>
      </div>
      <p className="theme-text">主题描述：{scroll.originalTheme}</p>
      <div className="prompt-box">
        <strong>优化提示词：</strong>
        <p>{scroll.optimizedPrompt || "等待提示词优化..."}</p>
      </div>
      <div className="chip-row">
        <InfoChip icon={<Clock3 size={15} />}>创建时间：{formatDateMinute(scroll.createdAt)}</InfoChip>
        <InfoChip icon={<Clock3 size={15} />}>最后生成：{formatDateMinute(scroll.lastGeneratedAt)}</InfoChip>
        <InfoChip icon={<Clock3 size={15} />}>下一张：{props.countdown}</InfoChip>
        <InfoChip icon={<Eye size={15} />}>画面比例 4:3</InfoChip>
        <InfoChip icon={<Eye size={15} />}>衔接覆盖 {Math.round(FIXED_OVERLAP_RATIO * 100)}%</InfoChip>
      </div>
      <DataBanner mode={props.dataMode} message={props.dataMessage} onRefresh={props.onRefresh} />
    </section>
  );
}

function DataBanner({ mode, message, onRefresh }: { mode: "loading" | "supabase" | "mock"; message: string; onRefresh: () => void }) {
  return (
    <div className={`data-banner ${mode}`}>
      <span>{mode === "supabase" ? "Supabase 已连接" : mode === "loading" ? "正在连接" : "本地模拟数据"}</span>
      <p>{message}</p>
      <button onClick={onRefresh}>刷新</button>
    </div>
  );
}

function InfoChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="info-chip">{icon}{children}</span>;
}

function ScrollPreview({ images, selectedImageId, onSelect, onOpen }: { images: ScrollImage[]; selectedImageId?: string; onSelect: (id: string) => void; onOpen: (image: ScrollImage) => void }) {
  const segmentHeight = 136;
  return (
    <section className="workspace-section">
      <div className="section-title"><h3>画卷预览（共 {images.length} 张）</h3></div>
      <div className="canvas-shell">
        <div className="canvas-track">
          {images.map((image) => {
            const crop = computeVisibleImageLayout(image, segmentHeight);
            return (
              <button
                key={image.id}
                className={`segment ${image.id === selectedImageId ? "selected" : ""} ${image.hasStitchWarning ? "warning" : ""} ${crop.overlapLeft > 0 ? "true-seam" : ""}`}
                style={{ width: `${Math.max(72, crop.width)}px` }}
                title={crop.overlapLeft > 0 ? "真实衔接位置" : image.title}
                onClick={() => {
                  onSelect(image.id);
                  onOpen(image);
                }}
              >
                <div className="segment-label">
                  <strong>{image.index}</strong>
                  <span>{image.dimensions.ratioLabel}</span>
                </div>
                <div className="segment-image">
                  <img
                    src={image.src}
                    alt={image.title}
                    style={{
                      height: segmentHeight,
                      width: crop.imageWidth,
                      transform: `translateX(-${crop.imageOffsetLeft}px)`,
                    }}
                  />
                </div>
              </button>
            );
          })}
          <div className="pending-segment"><strong>{images.length + 1}</strong><span>待生成</span></div>
        </div>
      </div>
    </section>
  );
}

export function GenerationPlan({ scroll, jobs, images }: { scroll?: Scroll; jobs: GenerationJob[]; images: ScrollImage[] }) {
  const items = getGenerationPlanItems(jobs, scroll);
  return (
    <section className="panel">
      <h3>生成计划</h3>
      <div className="plan-track">
        {images.slice(-1).map((image) => (
          <div key={image.id} className="plan-item latest-plan-item">
            <img src={image.src} alt="" />
            <div>
              <span>最新生成</span>
              <strong>第 {image.index} 张</strong>
              <small>{formatDateMinute(image.generatedAt)}</small>
            </div>
          </div>
        ))}
        {items.map((item) => (
          <div key={item.id} className="plan-item next creative-plan-card">
            <div className="plan-card-head">
              <div className={`countdown-ring ${item.label.tone}`}>{item.label.text}</div>
              <div>
                <strong>{item.creativePlan.title}</strong>
                <span>第 {item.targetIndex} 张 / {formatDateMinute(item.scheduledFor)}</span>
              </div>
            </div>
            <dl className="creative-plan-list">
              <div><dt>衔接锚点</dt><dd>{item.creativePlan.continuityAnchor}</dd></div>
              <div><dt>新增画面</dt><dd>{item.creativePlan.newScene}</dd></div>
              <div><dt>构图节奏</dt><dd>{item.creativePlan.composition}</dd></div>
              <div><dt>禁止偏移</dt><dd>{item.creativePlan.forbidden}</dd></div>
              <div><dt>提示词片段</dt><dd>直接写入图片生成提示词</dd></div>
            </dl>
          </div>
        ))}
      </div>
      <p className="hint">失败记录已收纳到控制台；这里仅展示最新图片和下一步生成计划。</p>
    </section>
  );
}
function LogPanel({ logs, onViewMore }: { logs: GenerationLog[]; onViewMore: () => void }) {
  const recentLogs = getRecentLogs(logs);
  const hasMoreLogs = logs.length > DEFAULT_LOG_PREVIEW_LIMIT;

  return (
    <section className="panel logs-panel">
      <div className="logs-panel-header">
        <h3>生成日志</h3>
        {hasMoreLogs && <button className="small-button logs-more-button" onClick={onViewMore}>查看更多</button>}
      </div>
      {recentLogs.length ? recentLogs.map((log) => <LogRow key={log.id} log={log} />) : <p className="hint">暂无日志。</p>}
    </section>
  );
}

function LogRow({ log }: { log: GenerationLog }) {
  return (
    <div className={`log-row ${log.level}`}>
      <CheckCircle2 size={15} />
      <strong>{log.message}</strong>
      <span>{log.detail}</span>
      <time>{formatClock(log.createdAt)}</time>
    </div>
  );
}

function Inspector({
  image,
  systemStatus,
  onOpenViewer,
  onRegenerate,
  onDelete,
  onInsert,
}: {
  image?: ScrollImage;
  systemStatus: ReturnType<typeof useInfiniteScrollStore>["systemStatus"];
  onOpenViewer: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onInsert: (side: "before" | "after") => void;
}) {
  if (!image) return <aside className="inspector"><div className="panel empty-inspector">当前画卷还没有图片。</div></aside>;

  const promptSummary = summarizePrompt(image.prompt);

  return (
    <aside className="inspector">
      <section className="panel detail-panel">
        <div className="inspector-title">
          <h3>图片详情</h3>
          <button className="ghost-icon" aria-label="关闭"><X size={17} /></button>
        </div>
        <strong>{image.title}</strong>
        <p>生成时间：{formatDateMinute(image.generatedAt)}</p>
        <img className="detail-image" src={image.src} alt={image.title} />
        {image.hasStitchWarning && <div className="warning-banner">衔接评分偏低，需要复查或重绘</div>}
        <div className="action-grid">
          <button onClick={onOpenViewer}><Maximize2 size={18} />放大查看</button>
          <button onClick={onRegenerate}><RefreshCw size={18} />重新生成</button>
          <button onClick={() => onInsert("before")}><ImagePlus size={18} />在前插入</button>
          <button onClick={() => onInsert("after")}><ImagePlus size={18} />在后插入</button>
        </div>
        <button className="delete-button" onClick={onDelete}><Trash2 size={17} /> 删除</button>
        <div className="divider" />
        <h4>图片信息</h4>
        <dl className="meta-list">
          <div><dt>尺寸：</dt><dd>{image.dimensions.width} x {image.dimensions.height}（{image.dimensions.ratioLabel}）</dd></div>
          <div><dt>文件大小：</dt><dd>{image.fileSize}</dd></div>
          <div><dt>生成模型：</dt><dd>{image.model}</dd></div>
          <div><dt>衔接评分：</dt><dd>{formatStitchScore(image.stitchQualityScore)}</dd></div>
          <div><dt>生成摘要：</dt><dd>{promptSummary}</dd></div>
        </dl>
        <details className="prompt-details">
          <summary>查看完整提示词</summary>
          <p>{image.prompt || "暂无提示词"}</p>
        </details>
        <h4>衔接信息</h4>
        <div className="stitch-preview">
          <div><span>重叠区域</span><div className="mini-stitch overlap" style={{ backgroundImage: `url(${image.src})` }} /></div>
          <div><span>新增区域</span><div className="mini-stitch new-area" style={{ backgroundImage: `url(${image.src})` }} /></div>
        </div>
      </section>
      <section className="panel status-panel">
        <h3>系统状态</h3>
        <StatusLine label="本地调度服务" value={systemStatus.serviceRunning ? "运行中" : "未运行"} good={systemStatus.serviceRunning} />
        <StatusLine label="已开启画卷" value={`${systemStatus.activeScrolls} 个`} good={systemStatus.autoGenerationEnabled} />
        <StatusLine label="下次自动生成" value={systemStatus.nextGlobalRunLabel} />
        <StatusLine label="今日已生成" value={`${systemStatus.generatedToday} 张`} />
        <StatusLine label="总生成数量" value={`${systemStatus.totalGenerated} 张`} />
        <StatusLine label="并发任务" value={`${systemStatus.activeConcurrentJobs}/${systemStatus.maxConcurrentJobs}`} />
        <StatusLine label="失败任务" value={`${systemStatus.failedJobs} 个`} good={systemStatus.failedJobs === 0} />
        <div className="health-bar"><span style={{ width: `${systemStatus.apiHealthPercent}%` }} /></div>
        <p>{systemStatus.statusError ? `状态接口异常：${systemStatus.statusError}` : `API 调用健康度 ${systemStatus.apiHealthPercent}%`}</p>
      </section>
    </aside>
  );
}

function StatusLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className="status-line"><span>{label}</span><strong className={good ? "good" : ""}>{value}</strong></div>;
}

function ConsolePage({
  scrolls,
  images,
  jobs,
  logs,
  onRetryJob,
  onSelectScroll,
}: {
  scrolls: Scroll[];
  images: ScrollImage[];
  jobs: GenerationJob[];
  logs: GenerationLog[];
  onRetryJob: (jobId: string) => void;
  onSelectScroll: (id: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const generatedToday = images.filter((image) => image.generatedAt?.startsWith(today)).length;
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const runningJobs = jobs.filter((job) => job.status === "running");
  const queuedJobs = jobs.filter((job) => job.status === "queued");
  const warningImages = images.filter((image) => image.hasStitchWarning || image.status === "needs_review");
  const nextScroll = scrolls.filter((scroll) => scroll.autoGenerationEnabled).sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0];

  return (
    <main className="console-page">
      <section className="console-hero panel">
        <div><h2>控制台</h2><p>查看自动生成、任务队列、失败记录和衔接风险。</p></div>
        <div className="console-metrics">
          <Metric label="画卷" value={`${scrolls.length}`} />
          <Metric label="图片" value={`${images.length}`} />
          <Metric label="今日生成" value={`${generatedToday}`} />
          <Metric label="运行中" value={`${runningJobs.length}`} />
        </div>
      </section>
      <section className="console-grid">
        <div className="panel">
          <h3>画卷状态</h3>
          <div className="console-list">
            {scrolls.map((scroll) => (
              <button key={scroll.id} className="console-scroll-row" onClick={() => onSelectScroll(scroll.id)}>
                <img src={scroll.thumbnail} alt="" />
                <span><strong>{scroll.title}</strong><small>{scroll.imageCount} 张 / {scroll.autoGenerationEnabled ? "自动生成" : "已暂停"}</small></span>
                <em>{formatDateMinute(scroll.nextRunAt)}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>任务队列</h3>
          <QueueSummary label="运行中" value={runningJobs.length} />
          <QueueSummary label="排队中" value={queuedJobs.length} />
          <QueueSummary label="失败任务" value={failedJobs.length} danger={failedJobs.length > 0} />
          <QueueSummary label="下一次自动生成" value={nextScroll ? formatDateMinute(nextScroll.nextRunAt) : "无"} />
          {failedJobs.length > 0 && (
            <div className="console-list">
              {failedJobs.slice(0, 6).map((job) => (
                <div key={job.id} className="risk-row">
                  <strong>第 {job.targetIndex} 张失败</strong>
                  <span>{job.errorMessage ?? "无错误详情"}</span>
                  <button className="small-button" onClick={() => onRetryJob(job.id)}>重试</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="console-grid">
        <div className="panel logs-panel">
          <h3>全局日志</h3>
          {logs.slice(0, 10).map((log) => <LogRow key={log.id} log={log} />)}
        </div>
        <div className="panel">
          <h3>衔接风险</h3>
          {warningImages.length ? (
            <div className="console-list">
              {warningImages.map((image) => (
                <div key={image.id} className="risk-row">
                  <strong>第 {image.index} 张</strong>
                  <span>{formatStitchScore(image.stitchQualityScore)} / {image.status}</span>
                </div>
              ))}
            </div>
          ) : <p className="hint">当前没有需要复查的衔接风险。</p>}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

function QueueSummary({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return <div className={`queue-summary ${danger ? "danger" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function LogsPage({ scrolls, logs, onSelectScroll }: { scrolls: Scroll[]; logs: GenerationLog[]; onSelectScroll: (id: string) => void }) {
  const groups = groupLogsByScroll(logs, scrolls);

  return (
    <main className="console-page log-groups-page">
      <section className="console-hero panel">
        <div>
          <h2>日志记录</h2>
          <p>按画卷归档完整生成日志，工作台只保留最近 10 条摘要。</p>
        </div>
        <div className="console-metrics">
          <Metric label="日志总数" value={`${logs.length}`} />
          <Metric label="画卷分组" value={`${groups.length}`} />
          <Metric label="已有画卷" value={`${scrolls.length}`} />
          <Metric label="预览条数" value={`${DEFAULT_LOG_PREVIEW_LIMIT}`} />
        </div>
      </section>
      <section className="log-groups">
        {groups.length ? (
          groups.map((group) => (
            <article key={group.scrollId} className="panel log-group">
              <div className="log-group-header">
                <div>
                  <h3>{group.title}</h3>
                  <p>{group.logs.length} 条日志</p>
                </div>
                {group.scroll && <button className="small-button" onClick={() => onSelectScroll(group.scrollId)}>打开画卷</button>}
              </div>
              <div className="log-group-list">
                {group.logs.map((log) => <LogRow key={log.id} log={log} />)}
              </div>
            </article>
          ))
        ) : (
          <section className="panel">
            <p className="hint">暂无日志。</p>
          </section>
        )}
      </section>
    </main>
  );
}

function SettingsPage() {
  return (
    <main className="console-page">
      <section className="panel console-hero">
        <div><h2>设置</h2><p>画面比例固定为 4:3；衔接覆盖是拼接用的参考区，不再当作图片比例展示。</p></div>
      </section>
      <section className="panel">
        <h3>衔接比例</h3>
        <div className="preset-row"><span className="preset-button active">统一覆盖 {Math.round(FIXED_OVERLAP_RATIO * 100)}%</span></div>
        <p className="hint">真实图片和预览标签都会显示 4:3；覆盖比例只用于保证左右衔接稳定。</p>
      </section>
    </main>
  );
}

function ScrollEditDialog({ scroll, onClose, onSave }: { scroll: Scroll; onClose: () => void; onSave: (input: { scrollId: string; title: string; originalTheme: string; optimizedPrompt: string }) => Promise<void> }) {
  const [title, setTitle] = useState(scroll.title);
  const [originalTheme, setOriginalTheme] = useState(scroll.originalTheme);
  const [optimizedPrompt, setOptimizedPrompt] = useState(scroll.optimizedPrompt);

  return (
    <div className="panorama-viewer" style={{ zIndex: 40, placeItems: "center", display: "grid" }}>
      <section className="panel" style={{ width: "min(720px, calc(100vw - 40px))" }}>
        <div className="inspector-title"><h3>编辑画卷</h3><button className="ghost-icon" onClick={onClose}><X size={17} /></button></div>
        <div className="create-box">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="画卷标题" />
          <input value={originalTheme} onChange={(event) => setOriginalTheme(event.target.value)} placeholder="主题描述" />
          <textarea value={optimizedPrompt} onChange={(event) => setOptimizedPrompt(event.target.value)} rows={8} style={{ resize: "vertical", border: "1px solid #eadfcf", borderRadius: 6, padding: 12 }} />
          <button className="create-button" onClick={() => void onSave({ scrollId: scroll.id, title, originalTheme, optimizedPrompt })}>保存</button>
        </div>
      </section>
    </div>
  );
}

function ScrollPanoramaViewer({
  images,
  initialImageId,
  onClose,
}: {
  images: ScrollImage[];
  initialImageId: string;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const heldDirection = useRef<"left" | "right" | null>(null);
  const holdStart = useRef(0);
  const animationFrame = useRef(0);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const scrollHeight = Math.min(420, Math.max(210, viewport.height * 0.46));
  const layout = useMemo(() => computeSegmentLayout(images, scrollHeight), [images, scrollHeight]);
  const activeIndex = Math.max(0, images.findIndex((image) => image.id === initialImageId));

  const resetView = useCallback(() => {
    setScale(1);
    setPan({ x: computeInitialPan(layout, initialImageId, viewport.width), y: 0 });
  }, [initialImageId, layout, viewport.width]);

  useEffect(() => {
    const updateViewport = () => {
      if (!stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    resetView();
  }, [resetView]);

  const stopHeldScroll = useCallback(() => {
    heldDirection.current = null;
    cancelAnimationFrame(animationFrame.current);
  }, []);

  const tickHeldScroll = useCallback(() => {
    const direction = heldDirection.current;
    if (!direction) return;
    setPan((current) => ({
      ...current,
      x: computePanForHeldDirection(current.x, direction, Date.now() - holdStart.current, scale),
    }));
    animationFrame.current = requestAnimationFrame(tickHeldScroll);
  }, [scale]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "0") resetView();
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? "left" : "right";
      if (heldDirection.current === direction) return;
      heldDirection.current = direction;
      holdStart.current = Date.now();
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = requestAnimationFrame(tickHeldScroll);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") stopHeldScroll();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      stopHeldScroll();
    };
  }, [onClose, resetView, stopHeldScroll, tickHeldScroll]);

  const updateScaleAroundPoint = useCallback(
    (nextScale: number, clientX: number, clientY: number) => {
      if (!stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const clampedScale = clampScale(nextScale);
      if (clampedScale === scale) return;
      setPan(
        computeZoomAroundPoint({
          pan,
          scale,
          nextScale: clampedScale,
          point: { x: clientX - rect.left, y: clientY - rect.top },
          viewportCenter: { x: rect.width / 2, y: rect.height / 2 },
        }),
      );
      setScale(clampedScale);
    },
    [pan, scale],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.18 : 0.18;
      updateScaleAroundPoint(scale + delta * Math.max(scale, 1), event.clientX, event.clientY);
    },
    [scale, updateScaleAroundPoint],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (scale > 1.4) resetView();
      else updateScaleAroundPoint(2.4, event.clientX, event.clientY);
    },
    [resetView, scale, updateScaleAroundPoint],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setIsDragging(true);
      dragStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!isDragging) return;
      setPan({
        x: dragStart.current.panX + event.clientX - dragStart.current.x,
        y: dragStart.current.panY + event.clientY - dragStart.current.y,
      });
    },
    [isDragging],
  );

  if (!images.length) return null;

  return (
    <div className="panorama-viewer" role="dialog" aria-modal="true">
      <div className="panorama-toolbar">
        <div className="panorama-title">
          <strong>画卷观赏</strong>
          <span>
            当前位置 第 {activeIndex + 1} 段附近 / 共 {images.length} 段
          </span>
        </div>
        <div className="panorama-actions">
          <button onClick={resetView}>
            <RefreshCw size={16} />
            重置
          </button>
          <button onClick={onClose}>
            <X size={18} />
            关闭
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className={`panorama-stage ${isDragging ? "dragging" : ""}`}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
      >
        <div
          className="panorama-scroll"
          style={{
            width: `${layout.totalWidth}px`,
            height: `${layout.height}px`,
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`,
          }}
        >
          {images.map((image, index) => {
            const segment = layout.segments.find((item) => item.id === image.id);
            if (!segment) return null;
            const seamOverlap = index === 0 ? 0 : 1;
            return (
              <div
                key={image.id}
                className="panorama-segment"
                style={{
                  left: `${segment.left - seamOverlap}px`,
                  width: `${segment.width + seamOverlap}px`,
                  height: `${segment.height}px`,
                }}
              >
                <img
                  src={image.src}
                  alt=""
                  draggable={false}
                  style={{
                    width: `${segment.imageWidth + seamOverlap}px`,
                    height: "100%",
                    objectFit: "fill",
                    transform: `translateX(-${segment.imageOffsetLeft}px)`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="panorama-hint">
        <span>{Math.round(scale * 100)}%</span>
        <span>按住 ← / → 缓缓移动</span>
        <span>滚轮缩放</span>
        <span>拖拽平移</span>
        <span>双击放大</span>
        <span>Esc 退出</span>
      </div>
    </div>
  );
}
