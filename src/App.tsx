import {
  Archive,
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
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { confirmAction } from "./lib/confirmAction";
import { DEFAULT_LOG_PREVIEW_LIMIT, getRecentLogs, groupLogsByScroll } from "./lib/logViews";
import { clampScale, computeActiveSegmentIndex, computeImmersiveScrollHeight, computeInitialPan, computePanForHeldDirection, computeSegmentLayout, computeVisibleImageLayout, computeZoomAroundPoint } from "./lib/panoramaViewer";
import { summarizePrompt } from "./lib/promptDisplay";
import { buildImageCaption } from "./lib/imageCaption";
import { FIXED_OVERLAP_RATIO } from "./lib/stitching";
import { formatStitchScore } from "./lib/stitchQuality";
import { formatClock, formatDateMinute, getCountdownParts, getGenerationPlanItems } from "./lib/time";
import { buildNotifications, defaultUserProfile, normalizeUserProfile, type NotificationItem, type UserProfile } from "./lib/userAccount";
import { useInfiniteScrollStore } from "./lib/store";
import { AI_SCRIPT_TEMPLATE, AI_SCRIPT_TEMPLATE_VERSION, DEFAULT_SCRIPT_FRAME_COUNT, SCRIPT_FRAME_COUNTS, type ScriptDraft, type ScriptFrame } from "./lib/scriptDraft";
import type { GenerationJob, GenerationLog, Scroll, ScrollImage } from "./types";

const USER_PROFILE_STORAGE_KEY = "infinite-scroll:user-profile:v1";

export const statusText: Record<Scroll["status"], string> = {
  generating: "生成中",
  paused: "已暂停",
  complete: "已完结",
};

type View = "workspace" | "archive" | "console" | "logs" | "settings";

export function App({ initialCreateScrollOpen = false }: { initialCreateScrollOpen?: boolean } = {}) {
  const store = useInfiniteScrollStore();
  const [view, setView] = useState<View>("workspace");
  const [editing, setEditing] = useState(false);
  const [creatingScroll, setCreatingScroll] = useState(initialCreateScrollOpen);
  const [viewerInitialImageId, setViewerInitialImageId] = useState("");
  const [toastNotification, setToastNotification] = useState<NotificationItem | null>(null);
  const seenSuccessNotificationIds = useRef<Set<string> | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    if (typeof window === "undefined") return defaultUserProfile;
    try {
      return normalizeUserProfile(JSON.parse(window.localStorage.getItem(USER_PROFILE_STORAGE_KEY) ?? "null"));
    } catch {
      return defaultUserProfile;
    }
  });
  const countdown = store.selectedScroll ? getCountdownParts(store.selectedScroll.nextRunAt).label : "00:00";
  const notifications = useMemo(
    () =>
      buildNotifications({
        logs: store.allLogs,
        jobs: store.allJobs,
        selectedScroll: store.selectedScroll,
        systemStatus: store.systemStatus,
        preferences: userProfile.notifications,
      }),
    [store.allJobs, store.allLogs, store.selectedScroll, store.systemStatus, userProfile.notifications],
  );

  function saveUserProfile(nextProfile: UserProfile) {
    const normalized = normalizeUserProfile(nextProfile);
    setUserProfile(normalized);
    if (typeof window !== "undefined") window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  }

  useEffect(() => {
    const successNotifications = notifications.filter((item) => item.level === "success");
    if (seenSuccessNotificationIds.current === null) {
      seenSuccessNotificationIds.current = new Set(successNotifications.map((item) => item.id));
      return;
    }

    const newest = successNotifications.find((item) => !seenSuccessNotificationIds.current?.has(item.id));
    for (const item of successNotifications) seenSuccessNotificationIds.current.add(item.id);
    if (!newest || !userProfile.notifications.generationSuccess) return;

    setToastNotification(newest);
    const timer = window.setTimeout(() => setToastNotification(null), 5200);
    return () => window.clearTimeout(timer);
  }, [notifications, userProfile.notifications.generationSuccess]);

  return (
    <div className="app-shell">
      <Sidebar
        scrolls={store.scrolls}
        selectedScrollId={store.selectedScroll?.id ?? ""}
        view={view}
        onView={setView}
        onCreate={() => setCreatingScroll(true)}
        onDelete={store.deleteScroll}
        onSelect={(id) => {
          store.selectScroll(id);
          setView("workspace");
        }}
      />
      <main className="app-main">
        <Topbar
          isGenerating={store.isGenerating || store.systemStatus.activeConcurrentJobs > 0}
          notifications={notifications}
          userProfile={userProfile}
          onOpenConsole={() => setView("console")}
          onNavigate={setView}
        />
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
              insertDisabledReason={store.selectedScroll?.storyTemplate === AI_SCRIPT_TEMPLATE ? "编剧模式 v1 暂不支持随意插入图片，请先调整剧本帧结构。" : ""}
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
        {view === "archive" && (
          <ArchivePage
            scrolls={store.archivedScrolls}
            images={store.archivedImages}
            activeScrolls={store.scrolls}
            onRestoreScroll={async (id) => {
              await store.restoreScroll(id);
              store.selectScroll(id);
              setView("workspace");
            }}
            onPurgeScroll={store.purgeArchivedScroll}
            onRestoreImage={async (id) => {
              await store.restoreArchivedImage(id);
              setView("workspace");
            }}
          />
        )}
        {view === "settings" && <SettingsPage userProfile={userProfile} onSaveProfile={saveUserProfile} />}
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
      {creatingScroll && (
        <CreateScrollDialog
          onClose={() => setCreatingScroll(false)}
          onOptimize={store.optimizePrompt}
          onDraftScript={store.draftScript}
          onCreate={async (input) => {
            await store.createScroll(input);
            setCreatingScroll(false);
            setView("workspace");
          }}
        />
      )}
      {viewerInitialImageId && (
        <ScrollPanoramaViewer images={store.images} scroll={store.currentScroll} initialImageId={viewerInitialImageId} onClose={() => setViewerInitialImageId("")} />
      )}
      {toastNotification && <GenerationToast notification={toastNotification} onClose={() => setToastNotification(null)} />}
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
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><img src="/favicon.png" alt="" /></div>
        <div>
          <h1>无限画卷</h1>
          <p>让 AI 持续绘制无限画卷</p>
        </div>
      </div>
      <div className="create-box">
        <button className="create-button" aria-expanded="false" onClick={onCreate}>
          <Plus size={17} /> 创建画卷
        </button>
      </div>
      <nav className="main-nav">
        <button className={`nav-item ${view === "workspace" ? "active" : ""}`} onClick={() => onView("workspace")}>
          <Box size={17} /> 我的画卷
        </button>
        <button className={`nav-item ${view === "archive" ? "active" : ""}`} onClick={() => onView("archive")}>
          <Archive size={17} /> 归档站
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
                confirmAction(`确定将画卷「${scroll.title}」移入归档站吗？7 天内可以恢复，之后会自动彻底删除。`, () => {
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

function Topbar({
  isGenerating,
  notifications,
  userProfile,
  onOpenConsole,
  onNavigate,
}: {
  isGenerating: boolean;
  notifications: NotificationItem[];
  userProfile: UserProfile;
  onOpenConsole: () => void;
  onNavigate: (view: View) => void;
}) {
  const [openPanel, setOpenPanel] = useState<"notifications" | "account" | null>(null);
  const unreadCount = notifications.filter((item) => item.level === "error" || item.level === "warning").length;

  return (
    <header className="topbar">
      <div />
      <div className="topbar-actions">
        <span className="service-pill"><span />{isGenerating ? "正在生成" : "服务运行中"}</span>
        <button className="outline-button" onClick={onOpenConsole}><List size={16} /> 控制台</button>
        <div className="topbar-menu">
          <button
            className={`icon-button notification-button ${openPanel === "notifications" ? "active" : ""}`}
            aria-label="通知"
            onClick={() => setOpenPanel(openPanel === "notifications" ? null : "notifications")}
          >
            <Bell size={17} />
            {unreadCount > 0 && <span className="notification-dot">{unreadCount}</span>}
          </button>
          {openPanel === "notifications" && (
            <NotificationPanel
              notifications={notifications}
              onNavigate={(nextView) => {
                onNavigate(nextView);
                setOpenPanel(null);
              }}
            />
          )}
        </div>
        <div className="topbar-menu">
          <button
            className={`account-trigger ${openPanel === "account" ? "active" : ""}`}
            onClick={() => setOpenPanel(openPanel === "account" ? null : "account")}
          >
            <UserAvatar profile={userProfile} />
            <span className="username">{userProfile.displayName}</span>
          </button>
          {openPanel === "account" && (
            <AccountMenu
              userProfile={userProfile}
              onNavigate={(nextView) => {
                onNavigate(nextView);
                setOpenPanel(null);
              }}
            />
          )}
        </div>
      </div>
    </header>
  );
}

function NotificationPanel({ notifications, onNavigate }: { notifications: NotificationItem[]; onNavigate: (view: View) => void }) {
  return (
    <section className="topbar-popover notification-panel">
      <div className="popover-title">
        <strong>通知中心</strong>
        <span>{notifications.length} 条</span>
      </div>
      {notifications.length ? (
        <div className="notification-list">
          {notifications.map((item) => (
            <button key={item.id} className={`notification-item ${item.level}`} onClick={() => onNavigate(item.action)}>
              <span className="notification-level" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
                <time>{formatClock(item.createdAt)}</time>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">当前没有新的生成通知。</p>
      )}
      <button className="popover-footer" onClick={() => onNavigate("logs")}>查看全部日志</button>
    </section>
  );
}

function AccountMenu({ userProfile, onNavigate }: { userProfile: UserProfile; onNavigate: (view: View) => void }) {
  return (
    <section className="topbar-popover account-panel">
      <div className="account-card">
        <UserAvatar profile={userProfile} size="large" />
        <div>
          <strong>{userProfile.displayName}</strong>
          <p>{userProfile.email}</p>
        </div>
      </div>
      <button onClick={() => onNavigate("settings")}>账号中心</button>
      <button onClick={() => onNavigate("logs")}>通知记录</button>
      <button onClick={() => onNavigate("console")}>任务控制台</button>
    </section>
  );
}

function UserAvatar({ profile, size = "default" }: { profile: UserProfile; size?: "default" | "large" | "preview" }) {
  const initials = profile.displayName.trim().slice(0, 1).toUpperCase() || "U";
  return (
    <span className={`avatar ${size === "default" ? "" : size}`}>
      {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials}
    </span>
  );
}

function GenerationToast({ notification, onClose }: { notification: NotificationItem; onClose: () => void }) {
  return (
    <aside className="generation-toast" role="status">
      <div>
        <strong>{notification.title}</strong>
        <p>{notification.detail}</p>
      </div>
      <button className="ghost-icon" aria-label="关闭通知" onClick={onClose}><X size={15} /></button>
    </aside>
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
      {scroll.scriptSummary && (
        <p className="script-summary">{scroll.scriptSummary}</p>
      )}
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
          <div key={item.id} className="plan-item next creative-plan-card full-width-plan-card">
            <div className="plan-card-head plan-card-head-full">
              <div className={`countdown-ring ${item.label.tone}`}>{item.label.text}</div>
              <div>
                <strong>{item.creativePlan.title}</strong>
                <span>第 {item.targetIndex} 张 / {formatDateMinute(item.scheduledFor)}</span>
              </div>
            </div>
            <dl className="creative-plan-list">
              {item.creativePlan.mode === "story" && (
                <>
                  <div><dt>剧情进度</dt><dd>第 {item.creativePlan.storyFrameIndex} / {item.creativePlan.storyTotalFrames} 帧</dd></div>
                  <div><dt>章节</dt><dd>{item.creativePlan.chapter ?? "西游记主线"}</dd></div>
                  <div><dt>人物</dt><dd>{item.creativePlan.characters?.join("、") || "按剧情帧设定"}</dd></div>
                  <div><dt>地点</dt><dd>{item.creativePlan.location ?? "按剧情帧设定"}</dd></div>
                </>
              )}
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
  insertDisabledReason = "",
}: {
  image?: ScrollImage;
  systemStatus: ReturnType<typeof useInfiniteScrollStore>["systemStatus"];
  onOpenViewer: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onInsert: (side: "before" | "after") => void;
  insertDisabledReason?: string;
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
          <button onClick={() => onInsert("before")} disabled={Boolean(insertDisabledReason)} title={insertDisabledReason || "在前插入"}><ImagePlus size={18} />在前插入</button>
          <button onClick={() => onInsert("after")} disabled={Boolean(insertDisabledReason)} title={insertDisabledReason || "在后插入"}><ImagePlus size={18} />在后插入</button>
        </div>
        {insertDisabledReason && <p className="dialog-status">{insertDisabledReason}</p>}
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

function ArchivePage({
  scrolls,
  images,
  activeScrolls,
  onRestoreScroll,
  onPurgeScroll,
  onRestoreImage,
}: {
  scrolls: Scroll[];
  images: ScrollImage[];
  activeScrolls: Scroll[];
  onRestoreScroll: (id: string) => void | Promise<void>;
  onPurgeScroll: (id: string) => void | Promise<void>;
  onRestoreImage: (id: string) => void | Promise<void>;
}) {
  const scrollTitleById = new Map(activeScrolls.map((scroll) => [scroll.id, scroll.title]));
  const total = scrolls.length + images.length;

  return (
    <main className="console-page archive-page">
      <section className="console-hero panel">
        <div>
          <h2>归档站</h2>
          <p>删除的画卷和图片会先暂存在这里，7 天后自动彻底清理。</p>
        </div>
        <div className="console-metrics">
          <Metric label="归档画卷" value={`${scrolls.length}`} />
          <Metric label="归档图片" value={`${images.length}`} />
          <Metric label="保留天数" value="7" />
        </div>
      </section>
      {scrolls.length > 0 && (
        <>
          <div className="section-title"><h3>画卷</h3></div>
          <section className="archive-grid">
            {scrolls.map((scroll) => (
              <article key={scroll.id} className="panel archive-card">
                <img src={scroll.thumbnail} alt="" />
                <div className="archive-card-body">
                  <div>
                    <h3>{scroll.title}</h3>
                    <p>{scroll.imageCount} 张图片</p>
                  </div>
                  <dl className="archive-meta">
                    <div><dt>归档时间</dt><dd>{scroll.archivedAt ? formatDateMinute(scroll.archivedAt) : "未知"}</dd></div>
                    <div><dt>彻底删除</dt><dd>{scroll.purgeAfter ? formatDateMinute(scroll.purgeAfter) : "7 天后"}</dd></div>
                  </dl>
                  <div className="archive-actions">
                    <button className="small-button" onClick={() => void onRestoreScroll(scroll.id)}>恢复</button>
                    <button
                      className="small-button danger"
                      onClick={() =>
                        confirmAction(`确定彻底删除画卷「${scroll.title}」吗？此操作会删除全部图片、任务和日志，且无法撤销。`, () => {
                          void onPurgeScroll(scroll.id);
                        })
                      }
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
      {images.length > 0 && (
        <>
          <div className="section-title"><h3>图片</h3></div>
          <section className="archive-grid">
            {images.map((image) => (
              <article key={image.id} className="panel archive-card">
                <img src={image.src} alt="" />
                <div className="archive-card-body">
                  <div>
                    <h3>第 {image.index} 张图片</h3>
                    <p>{scrollTitleById.get(image.scrollId) ?? "原画卷"}</p>
                  </div>
                  <dl className="archive-meta">
                    <div><dt>原位置</dt><dd>第 {image.index} 张</dd></div>
                    <div><dt>归档时间</dt><dd>{image.archivedAt ? formatDateMinute(image.archivedAt) : "未知"}</dd></div>
                    <div><dt>彻底删除</dt><dd>{image.purgeAfter ? formatDateMinute(image.purgeAfter) : "7 天后"}</dd></div>
                  </dl>
                  <div className="archive-actions">
                    <button className="small-button" onClick={() => void onRestoreImage(image.id)}>恢复到原位置</button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
      {total === 0 && (
        <section className="panel archive-empty">
          <Archive size={24} />
          <p>暂无归档内容。</p>
        </section>
      )}
    </main>
  );
}

function SettingsPage({ userProfile, onSaveProfile }: { userProfile: UserProfile; onSaveProfile: (profile: UserProfile) => void }) {
  const [draft, setDraft] = useState(userProfile);

  useEffect(() => {
    setDraft(userProfile);
  }, [userProfile]);

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(userProfile);
  const handleAvatarFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setDraft((current) => ({ ...current, avatarUrl: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <main className="console-page">
      <section className="panel console-hero">
        <div><h2>用户中心</h2><p>管理账号资料、头像和生成通知偏好。</p></div>
      </section>
      <div className="settings-grid">
        <section className="panel account-settings">
          <div className="account-card large-card">
            <UserAvatar profile={draft} size="preview" />
            <div>
              <h3>{draft.displayName}</h3>
              <p>{draft.role} / {draft.email}</p>
            </div>
          </div>
          <div className="avatar-controls">
            <label>
              头像 URL
              <input value={draft.avatarUrl} onChange={(event) => setDraft({ ...draft, avatarUrl: event.target.value })} placeholder="https://..." />
            </label>
            <div className="avatar-actions">
              <label className="small-button file-button">
                选择图片
                <input type="file" accept="image/*" onChange={(event) => handleAvatarFile(event.target.files?.[0])} />
              </label>
              <button className="small-button" type="button" onClick={() => setDraft({ ...draft, avatarUrl: "" })}>清除头像</button>
            </div>
          </div>
          <label>
            昵称
            <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
          </label>
          <label>
            邮箱
            <input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          </label>
          <label>
            角色
            <input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} />
          </label>
          <button className="create-button" disabled={!hasChanges} onClick={() => onSaveProfile(draft)}>
            <Save size={16} /> 保存账号资料
          </button>
        </section>
        <section className="panel preference-panel">
          <h3>通知偏好</h3>
          <PreferenceToggle
            title="图片生成成功"
            detail="新图片生成并同步到 Supabase 后提醒我。"
            checked={draft.notifications.generationSuccess}
            onChange={(checked) => setDraft({ ...draft, notifications: { ...draft.notifications, generationSuccess: checked } })}
          />
          <PreferenceToggle
            title="生成失败或上传异常"
            detail="任务失败、Storage 上传失败或接口异常时优先提醒。"
            checked={draft.notifications.generationFailure}
            onChange={(checked) => setDraft({ ...draft, notifications: { ...draft.notifications, generationFailure: checked } })}
          />
          <PreferenceToggle
            title="队列与下一张计划"
            detail="显示下一张画卷片段的队列状态和触发提醒。"
            checked={draft.notifications.queueReminder}
            onChange={(checked) => setDraft({ ...draft, notifications: { ...draft.notifications, queueReminder: checked } })}
          />
        </section>
      </div>
    </main>
  );
}

function PreferenceToggle({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="preference-toggle">
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function CreateScrollDialog({
  onClose,
  onOptimize,
  onDraftScript,
  onCreate,
}: {
  onClose: () => void;
  onOptimize: (theme: string, requirements?: string) => Promise<string>;
  onDraftScript: (input: { theme: string; frameCount: number; requirements: string; stylePrompt: string }) => Promise<ScriptDraft | null>;
  onCreate: (input: {
    theme: string;
    optimizedPrompt: string;
    generationMode?: "free" | "story";
    storyTemplate?: string | null;
    storyTemplateVersion?: string | null;
    storyTotalFrames?: number | null;
    scriptSummary?: string;
    characterBible?: string;
    storyFrames?: ScriptFrame[];
  }) => Promise<void>;
}) {
  const [theme, setTheme] = useState("");
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [requirements, setRequirements] = useState("");
  const [scriptMode, setScriptMode] = useState(false);
  const [frameCount, setFrameCount] = useState(DEFAULT_SCRIPT_FRAME_COUNT);
  const [draft, setDraft] = useState<ScriptDraft | null>(null);
  const [status, setStatus] = useState("输入主题后可创建自由画卷，也可以开启编剧模式先生成完整分镜。");
  const [error, setError] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const themeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    themeInputRef.current?.focus();
  }, []);

  async function optimizeTheme() {
    const cleanTheme = theme.trim();
    if (!cleanTheme) {
      setError("请输入你想生成的画卷主题");
      themeInputRef.current?.focus();
      return;
    }

    setError("");
    setIsOptimizing(true);
    setStatus("DeepSeek 正在理解你的主题，并扩展为连续画卷提示词...");
    const nextPrompt = await onOptimize(cleanTheme, requirements);
    setIsOptimizing(false);

    if (!nextPrompt.trim()) {
      setError("DeepSeek 暂时没有返回有效提示词，请稍后重试或手动填写。");
      setStatus("可以重试扩写，也可以直接手动填写提示词。");
      return;
    }

    setOptimizedPrompt(nextPrompt);
    setStatus("DeepSeek 已完成扩写，你可以继续修改，确认满意后再创建画卷。");
  }

  async function draftScript() {
    const cleanTheme = theme.trim();
    if (!cleanTheme) {
      setError("请输入你想生成的画卷主题");
      themeInputRef.current?.focus();
      return;
    }
    setError("");
    setIsDrafting(true);
    setStatus("DeepSeek 正在规划完整剧本分镜...");
    const nextDraft = await onDraftScript({ theme: cleanTheme, frameCount, requirements, stylePrompt: optimizedPrompt });
    setIsDrafting(false);
    if (!nextDraft) {
      setError("DeepSeek 暂时没有返回有效剧本，请稍后重试。");
      return;
    }
    setDraft(nextDraft);
    setOptimizedPrompt(nextDraft.visualStyle || optimizedPrompt);
    setStatus("剧本草稿已生成，你可以检查并修改分镜后创建空白画卷。");
  }

  async function createScroll() {
    const cleanTheme = theme.trim();
    if (!cleanTheme) {
      setError("请输入你想生成的画卷主题");
      themeInputRef.current?.focus();
      return;
    }
    if (!scriptMode && !optimizedPrompt.trim()) {
      setError("请先让 DeepSeek 丰富提示词，或手动填写完整提示词后再确认创建。");
      return;
    }
    if (scriptMode && !draft) {
      setError("请先生成剧本草稿，再确认创建。");
      return;
    }

    setError("");
    setIsCreating(true);
    setStatus("正在创建画卷...");
    await onCreate(
      scriptMode && draft
        ? {
            theme: cleanTheme,
            optimizedPrompt: optimizedPrompt || draft.visualStyle,
            generationMode: "story",
            storyTemplate: AI_SCRIPT_TEMPLATE,
            storyTemplateVersion: AI_SCRIPT_TEMPLATE_VERSION,
            storyTotalFrames: draft.frames.length,
            scriptSummary: draft.summary,
            characterBible: draft.characterBible,
            storyFrames: draft.frames,
          }
        : { theme: cleanTheme, optimizedPrompt },
    );
    setIsCreating(false);
  }

  function updateFrame(index: number, patch: Partial<ScriptFrame>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            frames: current.frames.map((frame, frameIndex) => (frameIndex === index ? { ...frame, ...patch } : frame)),
          }
        : current,
    );
  }

  const busy = isOptimizing || isDrafting || isCreating;

  return (
    <div className="create-dialog-backdrop">
      <section className="create-scroll-dialog" role="dialog" aria-modal="true" aria-labelledby="create-scroll-title">
        <header className="create-dialog-header">
          <div>
            <h3 id="create-scroll-title">创建新画卷</h3>
            <p>自由画卷可以直接扩写提示词；编剧模式会先生成可编辑长剧本。</p>
          </div>
          <button className="ghost-icon" aria-label="关闭创建画卷" onClick={onClose} disabled={busy}>
            <X size={17} />
          </button>
        </header>
        <div className="create-dialog-body">
          <aside className="create-dialog-aside">
            <strong>创建流程</strong>
            <span>1. 输入主题和补充要求</span>
            <span>2. 选择自由画卷或编剧模式</span>
            <span>3. 编剧模式先生成并编辑分镜</span>
            <span>4. 确认创建空白画卷</span>
          </aside>
          <div className="create-dialog-form">
            <label className="dialog-label">
              输入你想生成的画卷主题
              <input
                ref={themeInputRef}
                value={theme}
                onChange={(event) => {
                  setTheme(event.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void optimizeTheme();
                  if (event.key === "Escape" && !busy) onClose();
                }}
                placeholder="例如：宋代汴京雨夜市集、海底丝绸之路、赛博敦煌夜市"
              />
            </label>
            <label className="dialog-label">
              补充要求
              <textarea value={requirements} onChange={(event) => setRequirements(event.target.value)} placeholder="例如：主角是少年与机械鸟，剧情偏温暖冒险，不要恐怖元素。" />
            </label>
            <label className="dialog-check">
              <input type="checkbox" checked={scriptMode} onChange={(event) => setScriptMode(event.target.checked)} />
              开启编剧模式：先由 DeepSeek 规划完整剧本，再逐帧生成
            </label>
            <label className="dialog-label">
              剧本长度
              <select value={frameCount} onChange={(event) => setFrameCount(Number(event.target.value))} disabled={!scriptMode}>
                {SCRIPT_FRAME_COUNTS.map((count) => (
                  <option key={count} value={count}>{count} 帧</option>
                ))}
              </select>
            </label>
            <button className="create-button" onClick={() => void optimizeTheme()} disabled={isOptimizing || isCreating}>
              {isOptimizing ? <Loader2 size={17} className="spin" /> : <RefreshCw size={17} />}
              让 DeepSeek 丰富提示词
            </button>
            <label className="dialog-label">
              DeepSeek 生成的画卷提示词
              <textarea
                value={optimizedPrompt}
                onChange={(event) => {
                  setOptimizedPrompt(event.target.value);
                  if (error) setError("");
                }}
                placeholder="DeepSeek 扩写后的提示词会出现在这里，你可以继续编辑。"
              />
            </label>
            <button className="create-button" onClick={() => void draftScript()} disabled={busy || !scriptMode}>
              {isDrafting ? <Loader2 size={17} className="spin" /> : <ScrollText size={17} />}
              生成长剧本分镜
            </button>
            {scriptMode && draft && (
              <div className="script-draft-panel">
                <strong>{draft.title}</strong>
                <p>{draft.summary}</p>
                <p>{draft.characterBible}</p>
                <div className="script-frame-list">
                  {draft.frames.map((frame, index) => (
                    <div className="script-frame-editor" key={frame.frameIndex}>
                      <span>第 {frame.frameIndex} / {draft.frames.length} 帧</span>
                      <input value={frame.title} onChange={(event) => updateFrame(index, { title: event.target.value })} />
                      <input value={frame.chapter} onChange={(event) => updateFrame(index, { chapter: event.target.value })} />
                      <textarea value={frame.scene} onChange={(event) => updateFrame(index, { scene: event.target.value })} />
                      <input value={frame.characters.join("、")} onChange={(event) => updateFrame(index, { characters: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} />
                      <input value={frame.location} onChange={(event) => updateFrame(index, { location: event.target.value })} />
                      <input value={frame.mood} onChange={(event) => updateFrame(index, { mood: event.target.value })} />
                      <textarea value={frame.forbidden} onChange={(event) => updateFrame(index, { forbidden: event.target.value })} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className={`dialog-status ${error ? "error" : ""}`}>{error || status}</p>
          </div>
        </div>
        <footer className="dialog-actions">
          <button className="small-button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="create-button" onClick={() => void createScroll()} disabled={busy}>
            {isCreating ? <Loader2 size={17} className="spin" /> : <CheckCircle2 size={17} />}
            确认创建画卷
          </button>
        </footer>
      </section>
    </div>
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

export function ScrollPanoramaViewer({
  images,
  scroll,
  initialImageId,
  onClose,
}: {
  images: ScrollImage[];
  scroll?: Scroll;
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
  const [isViewPositioned, setIsViewPositioned] = useState(false);

  const scrollHeight = computeImmersiveScrollHeight(viewport.height);
  const layout = useMemo(() => computeSegmentLayout(images, scrollHeight), [images, scrollHeight]);
  const initialIndex = Math.max(0, images.findIndex((image) => image.id === initialImageId));
  const activeIndex = isViewPositioned ? computeActiveSegmentIndex(layout, pan.x, scale) : initialIndex;
  const activeImage = images[activeIndex] ?? images[initialIndex] ?? images[0];
  const caption = activeImage ? buildImageCaption(activeImage, activeIndex) : null;

  const resetView = useCallback(() => {
    setScale(1);
    setPan({ x: computeInitialPan(layout, initialImageId, viewport.width), y: 0 });
    setIsViewPositioned(true);
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

  const zoomFromCenter = useCallback(
    (nextScale: number) => {
      if (!stageRef.current) {
        setScale(clampScale(nextScale));
        return;
      }
      const rect = stageRef.current.getBoundingClientRect();
      updateScaleAroundPoint(nextScale, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [updateScaleAroundPoint],
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
          <button onClick={() => zoomFromCenter(scale - 0.25)} aria-label="缩小">
            <Minus size={16} />
            缩小
          </button>
          <button onClick={() => zoomFromCenter(1)} aria-label="一比一">
            1:1
          </button>
          <button onClick={() => zoomFromCenter(scale + 0.25)} aria-label="放大">
            <Plus size={16} />
            放大
          </button>
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
      {caption && (
        <div className="panorama-caption" aria-live="polite">
          <span className="panorama-caption-eyebrow">{caption.eyebrow}</span>
          <div className="panorama-caption-copy">
            <strong>{caption.title}</strong>
            {caption.details && <span>{caption.details}</span>}
            <p>{caption.body}</p>
          </div>
        </div>
      )}
      {scroll && (scroll.scriptSummary || scroll.characterBible) && (
        <div className="panorama-intro">
          {scroll.scriptSummary && (
            <div className="panorama-intro-section">
              <strong>画卷简介</strong>
              <p>{scroll.scriptSummary}</p>
            </div>
          )}
          {scroll.characterBible && (
            <div className="panorama-intro-section">
              <strong>角色设定</strong>
              <p>{scroll.characterBible}</p>
            </div>
          )}
        </div>
      )}
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
