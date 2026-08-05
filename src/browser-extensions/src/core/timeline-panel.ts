// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - timeline-panel.ts (shared)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Timeline profiler panel for recording and visualizing component render events.
// Inspired by React DevTools Profiler with Blazor-specific adaptations.
//
// This module is browser-agnostic: all extension messaging is injected via the
// `callApi` function so the same code drives the Chromium and Firefox panels.
//
// Features:
//   - Record/Stop/Clear controls
//   - Event timeline with swimlane visualization
//   - Ranked components view (slowest first)
//   - Event details with "Why did this render?"
//   - Real-time stats during recording
//   - Flamegraph with cursor-anchored zoom, drag-to-pan, and collapsible
//     idle gaps ("cuts") so bursts of activity stay readable
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
    TimelineEvent,
    ComponentRanking,
} from './types';
import { buildTimeScale, buildSequenceScale, type TimeScale, type TimeInterval } from './time-scale';
import { deriveCommits, type Commit } from './commits';

/** Extension-specific transport injected by the host panel (chrome.* or browser.*). */
export type CallApi = <T>(method: string, ...args: unknown[]) => Promise<T>;

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const EVENT_COLORS: Record<string, string> = {
    // Lifecycle Events
    OnInitialized: '#7c3aed',
    OnInitializedAsync: '#8b5cf6',
    OnParametersSet: '#2563eb',
    OnParametersSetAsync: '#3b82f6',
    SetParametersAsync: '#1d4ed8',
    BuildRenderTree: '#16a34a',
    OnAfterRender: '#ca8a04',
    OnAfterRenderAsync: '#eab308',
    Disposed: '#6b7280',

    // ShouldRender
    ShouldRenderTrue: '#22c55e',
    ShouldRenderFalse: '#9ca3af',

    // State & Events
    StateHasChanged: '#f97316',
    StateHasChangedIgnored: '#fdba74',
    EventCallbackInvoked: '#ef4444',

    // Batch Events
    RenderBatchStarted: '#0ea5e9',
    RenderBatchCompleted: '#0284c7',
    ComponentRendered: '#d1d5db',

    // App Events
    CircuitOpened: '#10b981',
    CircuitClosed: '#dc2626',
    NavigationStart: '#8b5cf6',
    NavigationEnd: '#a78bfa',
    FirstRender: '#7c3aed',
};

const EVENT_ICONS: Record<string, string> = {
    OnInitialized: '●',
    OnInitializedAsync: '○',
    OnParametersSet: '◆',
    OnParametersSetAsync: '◇',
    SetParametersAsync: '◈',
    BuildRenderTree: '▶',
    OnAfterRender: '★',
    OnAfterRenderAsync: '☆',
    Disposed: '✕',
    ShouldRenderTrue: '✓',
    ShouldRenderFalse: '⊘',
    StateHasChanged: '⚡',
    StateHasChangedIgnored: '⚡',
    EventCallbackInvoked: '🔥',
    RenderBatchStarted: '┌',
    RenderBatchCompleted: '└',
    ComponentRendered: '□',
    CircuitOpened: '◉',
    CircuitClosed: '◎',
    NavigationStart: '→',
    NavigationEnd: '⇢',
    FirstRender: '①',
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 100;
const WHEEL_ZOOM_FACTOR = 1.15;
const BUTTON_ZOOM_FACTOR = 1.25;
/** Pointer must travel this many pixels before a press counts as a pan, not a click. */
const DRAG_THRESHOLD_PX = 4;
const MAX_SWIMLANES = 30;
const POLL_INTERVAL_MS = 500;
const AXIS_MODE_STORAGE_KEY = 'bdt-timeline-axis-mode';

/**
 * How the flamegraph x-axis maps time to pixels:
 *  - sequence:       "subway map" — event order, uniform spacing, elapsed-time
 *                    markers between bursts (default)
 *  - time:           linear wall-clock (the "scientific" view)
 *  - time-collapsed: linear wall-clock with idle stretches >= 300ms cut out
 */
type AxisMode = 'sequence' | 'time' | 'time-collapsed';
const AXIS_MODES: readonly AxisMode[] = ['sequence', 'time', 'time-collapsed'];

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

let callApi: CallApi;
let isRecording = false;
let events: TimelineEvent[] = [];
let rankedComponents: ComponentRanking[] = [];
let selectedEvent: TimelineEvent | null = null;
let currentView: 'events' | 'ranked' | 'flamegraph' | 'commits' = 'events';
let refreshInterval: number | null = null;
let lastEventId = -1;

// Flamegraph view state (virtual-time space, see time-scale.ts)
let zoomLevel = 1;
let panOffset = 0; // 0..1 fraction of the pannable range
let axisMode: AxisMode = 'sequence';
let timeScale: TimeScale | null = null;
let timeScaleEventCount = -1;
let timeScaleAxisMode: AxisMode | null = null;

// Commits view state (commits derived client-side, see commits.ts)
let commitsCache: Commit[] | null = null;
let commitsCacheEventCount = -1;
let selectedCommitIndex: number | null = null;

// Skeleton tracking: rebuild swimlane rows only when the component set changes.
let renderedSwimlaneKey = '';

// Event-list tracking: rebuild rows only when data or selection actually changed.
let renderedListKey = '';

// Drag-to-pan state
let pointerDownX: number | null = null;
let dragStartPan = 0;
let dragMoved = false;
let pendingViewUpdate = false;

// Connection health: the inspected page can stop answering at any moment
// (reload, navigation, circuit dropped). We surface that instead of letting
// promise rejections escape to the extension error log.
let connectionError: string | null = null;
let consecutivePollFailures = 0;
const MAX_POLL_FAILURES = 4; // ~2s of failed polls -> assume the page is gone

let initialized = false;

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE API METHODS
// ═══════════════════════════════════════════════════════════════════════════════

async function startRecording(): Promise<void> {
    await callApi('StartTimelineRecording');
    connectionError = null;
    consecutivePollFailures = 0;
    isRecording = true;
    lastEventId = -1;
    events = [];
    invalidateRenderCaches();
    updateUI();
    startPolling();
}

async function stopRecording(): Promise<void> {
    stopPolling();
    try {
        await callApi('StopTimelineRecording');
        await fetchAllEvents();
        connectionError = null;
    } finally {
        // Whatever happened on the wire, the panel is no longer recording.
        isRecording = false;
        updateUI();
    }
}

async function clearRecording(): Promise<void> {
    await callApi('ClearTimelineEvents');
    connectionError = null;
    events = [];
    rankedComponents = [];
    selectedEvent = null;
    lastEventId = -1;
    invalidateRenderCaches();
    updateUI();
}

/**
 * Route a failed panel→page call somewhere useful: the stats bar, plus one
 * console.warn. Without this every reload of the inspected page produced
 * "Uncaught (in promise) Error: Could not establish connection" entries in
 * the extension error log.
 */
function reportConnectionError(action: string, err: unknown): void {
    connectionError = `Lost connection to the page while trying to ${action} — ` +
        `is a Blazor app with BlazorDeveloperTools running in the inspected tab?`;
    console.warn(`[BDT Timeline] ${action} failed:`, err instanceof Error ? err.message : err);
    updateStats();
}

async function fetchAllEvents(): Promise<void> {
    events = await callApi<TimelineEvent[]>('GetTimelineEvents');
    rankedComponents = await callApi<ComponentRanking[]>('GetRankedComponents');
    lastEventId = events.length > 0 ? events[events.length - 1].eventId : -1;
}

async function fetchNewEvents(): Promise<boolean> {
    const newEvents = await callApi<TimelineEvent[]>('GetTimelineEventsSince', lastEventId);
    if (newEvents.length === 0) return false;
    events = [...events, ...newEvents];
    lastEventId = newEvents[newEvents.length - 1].eventId;
    rankedComponents = await callApi<ComponentRanking[]>('GetRankedComponents');
    return true;
}

function invalidateRenderCaches(): void {
    renderedSwimlaneKey = '';
    renderedListKey = '';
    timeScaleEventCount = -1;
    commitsCache = null;
    commitsCacheEventCount = -1;
    selectedCommitIndex = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLLING
// ═══════════════════════════════════════════════════════════════════════════════

function startPolling(): void {
    if (refreshInterval) return;
    refreshInterval = window.setInterval(async () => {
        if (!isRecording) return;
        try {
            const changed = await fetchNewEvents();
            consecutivePollFailures = 0;
            connectionError = null;
            // Avoid rebuilding DOM under the user's cursor when nothing changed.
            if (changed) {
                updateUI();
            } else {
                updateStats();
            }
        } catch (err) {
            // The page reloaded, navigated away, or the circuit dropped.
            // Tolerate brief outages (e.g. a reload) before giving up.
            consecutivePollFailures++;
            if (consecutivePollFailures >= MAX_POLL_FAILURES) {
                stopPolling();
                isRecording = false;
                reportConnectionError('record', err);
                updateUI();
            }
        }
    }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function updateUI(): void {
    updateControls();
    updateStats();
    updateViewTabs();

    switch (currentView) {
        case 'events':
            renderEventList();
            break;
        case 'ranked':
            renderRankedView();
            break;
        case 'flamegraph':
            renderFlamegraph();
            break;
        case 'commits':
            renderCommitsView();
            break;
    }

    renderEventDetails();
}

function updateControls(): void {
    const recordBtn = document.getElementById('timeline-record-btn') as HTMLButtonElement;
    const stopBtn = document.getElementById('timeline-stop-btn') as HTMLButtonElement;
    const clearBtn = document.getElementById('timeline-clear-btn') as HTMLButtonElement;

    recordBtn.classList.toggle('active', isRecording);
    recordBtn.classList.toggle('recording', isRecording);
    recordBtn.disabled = isRecording;
    stopBtn.disabled = !isRecording;
    clearBtn.disabled = isRecording || events.length === 0;
}

function updateStats(): void {
    const statsEl = document.getElementById('timeline-stats')!;

    if (connectionError) {
        statsEl.innerHTML = `<span class="stats-error">⚠ ${escapeHtml(connectionError)}</span>`;
        return;
    }

    if (events.length === 0) {
        statsEl.innerHTML = '<span class="stats-empty">Click record to start profiling</span>';
        return;
    }

    const duration = events[events.length - 1].relativeTimestampMs;
    const renderCount = events.filter(e => e.eventType === 'BuildRenderTree').length;
    const componentCount = new Set(events.map(e => e.componentId)).size;

    statsEl.innerHTML = `
        <span class="stat">
            <span class="stat-value">${events.length}</span>
            <span class="stat-label">events</span>
        </span>
        <span class="stat">
            <span class="stat-value">${renderCount}</span>
            <span class="stat-label">renders</span>
        </span>
        <span class="stat">
            <span class="stat-value">${componentCount}</span>
            <span class="stat-label">components</span>
        </span>
        <span class="stat">
            <span class="stat-value">${formatDuration(duration)}</span>
            <span class="stat-label">duration</span>
        </span>
        ${isRecording ? '<span class="recording-indicator">● Recording</span>' : ''}
    `;
}

function updateViewTabs(): void {
    document.querySelectorAll('.timeline-view-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-view') === currentView);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS LIST VIEW
// ─────────────────────────────────────────────────────────────────────────────

function renderEventList(): void {
    const container = document.getElementById('timeline-content')!;

    if (events.length === 0) {
        renderedListKey = '';
        container.innerHTML = `
            <div class="timeline-empty">
                <div class="empty-icon">⏱</div>
                <div class="empty-title">No events recorded</div>
                <div class="empty-hint">Click the record button to start profiling</div>
            </div>
        `;
        return;
    }

    // Skip the rebuild when neither the data nor the selection changed, so
    // in-flight clicks aren't swallowed by innerHTML churn (#47).
    const listKey = `${events.length}:${selectedEvent?.eventId ?? -1}`;
    if (listKey === renderedListKey && container.querySelector('.event-list')) {
        return;
    }
    renderedListKey = listKey;

    const eventsByTime = [...events].sort((a, b) => a.relativeTimestampMs - b.relativeTimestampMs);

    container.innerHTML = `
        <div class="event-list">
            ${eventsByTime.map(event => renderEventRow(event)).join('')}
        </div>
    `;
}

function renderEventRow(event: TimelineEvent): string {
    const color = EVENT_COLORS[event.eventType] || '#888';
    const icon = EVENT_ICONS[event.eventType] || '•';
    const isSelected = selectedEvent?.eventId === event.eventId;

    return `
        <div class="event-row ${isSelected ? 'selected' : ''} ${event.wasSkipped ? 'skipped' : ''}"
             data-event-id="${event.eventId}">
            <span class="event-time">${formatTime(event.relativeTimestampMs)}</span>
            <span class="event-icon" style="color: ${color}">${icon}</span>
            <span class="event-type" style="color: ${color}">${formatEventType(event.eventType)}</span>
            <span class="event-component">${escapeHtml(event.componentName)}</span>
            ${event.durationMs ? `<span class="event-duration">${formatDuration(event.durationMs)}</span>` : ''}
            ${event.isFirstRender ? '<span class="event-badge first">1st</span>' : ''}
            ${event.isAsync ? '<span class="event-badge async">async</span>' : ''}
        </div>
    `;
}

// ─────────────────────────────────────────────────────────────────────────────
// RANKED VIEW
// ─────────────────────────────────────────────────────────────────────────────

function renderRankedView(): void {
    const container = document.getElementById('timeline-content')!;

    if (rankedComponents.length === 0) {
        container.innerHTML = `
            <div class="timeline-empty">
                <div class="empty-icon">📊</div>
                <div class="empty-title">No render data</div>
                <div class="empty-hint">Record some interactions to see ranked components</div>
            </div>
        `;
        return;
    }

    const maxTime = Math.max(...rankedComponents.map(r => r.totalRenderTimeMs));

    container.innerHTML = `
        <div class="ranked-list">
            <div class="ranked-header">
                <span class="ranked-col-component">Component</span>
                <span class="ranked-col-time">Total Time</span>
                <span class="ranked-col-count">Renders</span>
                <span class="ranked-col-avg">Avg</span>
            </div>
            ${rankedComponents.map((r, i) => `
                <div class="ranked-row">
                    <span class="ranked-position">${i + 1}</span>
                    <span class="ranked-component">${escapeHtml(r.componentName)}</span>
                    <div class="ranked-bar-container">
                        <div class="ranked-bar" style="width: ${(r.totalRenderTimeMs / maxTime) * 100}%"></div>
                        <span class="ranked-time">${formatDuration(r.totalRenderTimeMs)}</span>
                    </div>
                    <span class="ranked-count">${r.renderCount}</span>
                    <span class="ranked-avg">${formatDuration(r.averageRenderTimeMs)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLAMEGRAPH VIEW
// ─────────────────────────────────────────────────────────────────────────────

/** Domain of the recording on the real-time axis, with 5% padding. */
function computeDomain(): { startMs: number; endMs: number } {
    const eventTimes = events.map(e => e.relativeTimestampMs);
    const eventEndTimes = events.map(e => e.relativeTimestampMs + (e.durationMs || 0));
    const maxTime = Math.max(...eventEndTimes);
    const positiveTimes = eventTimes.filter(t => t > 0);
    const minTime = positiveTimes.length > 0 ? Math.min(...positiveTimes) : 0;
    const rawRange = maxTime - minTime || 1;
    const padding = rawRange * 0.05;
    return { startMs: Math.max(0, minTime - padding), endMs: maxTime + padding };
}

function getTimeScale(): TimeScale {
    if (
        timeScale &&
        timeScaleEventCount === events.length &&
        timeScaleAxisMode === axisMode
    ) {
        return timeScale;
    }

    if (axisMode === 'sequence') {
        const startTimes = events.map(e => e.relativeTimestampMs);
        const domainEnd = Math.max(...events.map(e => e.relativeTimestampMs + (e.durationMs || 0)));
        timeScale = buildSequenceScale(startTimes, domainEnd);
    } else {
        const { startMs, endMs } = computeDomain();
        const intervals: TimeInterval[] = events.map(e => ({
            startMs: e.relativeTimestampMs,
            endMs: e.relativeTimestampMs + (e.durationMs || 0),
        }));
        timeScale = buildTimeScale(intervals, startMs, endMs, {
            collapseGaps: axisMode === 'time-collapsed',
        });
    }

    timeScaleEventCount = events.length;
    timeScaleAxisMode = axisMode;
    return timeScale;
}

/** Visible window of the virtual axis for the current zoom/pan. */
function getVisibleWindow(scale: TimeScale): { start: number; range: number } {
    const range = scale.virtualTotalMs / zoomLevel;
    const start = panOffset * (scale.virtualTotalMs - range);
    return { start, range };
}

function renderFlamegraph(): void {
    const container = document.getElementById('timeline-content')!;

    const renderEvents = events.filter(e => e.eventType === 'BuildRenderTree' && e.durationMs);
    if (renderEvents.length === 0) {
        renderedSwimlaneKey = '';
        container.innerHTML = `
            <div class="timeline-empty">
                <div class="empty-icon">🔥</div>
                <div class="empty-title">No render data</div>
                <div class="empty-hint">Record some interactions to see the flamegraph</div>
            </div>
        `;
        return;
    }

    const componentNames = [...new Set(events.map(e => e.componentName))];
    const swimlaneKey = componentNames.join('|');

    // Build the skeleton only when the component set changes; zoom/pan/data
    // updates only touch the tracks and axis (see updateFlamegraphView).
    if (swimlaneKey !== renderedSwimlaneKey || !container.querySelector('.swimlane-container')) {
        renderedSwimlaneKey = swimlaneKey;
        container.innerHTML = `
            <div class="swimlane-container">
                <div class="swimlane-toolbar">
                    <div class="zoom-controls">
                        <button class="zoom-btn" id="zoom-out-btn" title="Zoom out">−</button>
                        <span class="zoom-level" id="zoom-level">${zoomLevel.toFixed(1)}x</span>
                        <button class="zoom-btn" id="zoom-in-btn" title="Zoom in">+</button>
                        <button class="zoom-btn" id="zoom-reset-btn" title="Reset">⟲</button>
                    </div>
                    <label class="axis-mode-label" title="Sequence: subway-map view — spacing shows event order, with markers for real pauses. Time: proportional wall-clock axis, optionally with idle stretches cut out.">
                        View
                        <select id="axis-mode-select">
                            <option value="sequence" ${axisMode === 'sequence' ? 'selected' : ''}>Sequence</option>
                            <option value="time" ${axisMode === 'time' ? 'selected' : ''}>Time (linear)</option>
                            <option value="time-collapsed" ${axisMode === 'time-collapsed' ? 'selected' : ''}>Time (idle collapsed)</option>
                        </select>
                    </label>
                    <span class="zoom-hint">Scroll to zoom • Drag to pan</span>
                </div>
                <div class="swimlane-header">
                    <div class="swimlane-label-header">Component</div>
                    <div class="swimlane-time-axis" id="swimlane-time-axis"></div>
                </div>
                <div class="swimlane-body" id="swimlane-body">
                    ${componentNames.slice(0, MAX_SWIMLANES).map(name => `
                        <div class="swimlane-row">
                            <div class="swimlane-label" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                            <div class="swimlane-track" data-component="${escapeHtml(name)}"></div>
                        </div>
                    `).join('')}
                </div>
                <div class="swimlane-footer">
                    <span class="swimlane-stats" id="swimlane-stats"></span>
                </div>
            </div>
        `;
    }

    updateFlamegraphView();
}

/**
 * Redraw only the dynamic parts of the flamegraph (tracks, axis, stats).
 * Called on zoom, pan, gap-toggle, and new-data ticks — never re-attaches
 * listeners (all interaction is delegated in initializeEventHandlers).
 */
function updateFlamegraphView(): void {
    const body = document.getElementById('swimlane-body');
    if (!body) return;

    const scale = getTimeScale();
    const { start: visibleStart, range: visibleRange } = getVisibleWindow(scale);

    // Group events by component once per redraw.
    const eventsByComponent = new Map<string, TimelineEvent[]>();
    for (const e of events) {
        let list = eventsByComponent.get(e.componentName);
        if (!list) {
            list = [];
            eventsByComponent.set(e.componentName, list);
        }
        list.push(e);
    }

    const cutMarkers = renderCutMarkers(scale, visibleStart, visibleRange);
    // Sequence mode draws subway-style events: a fixed-size "station" badge at
    // the event's start plus a thin duration line — the badge never shrinks
    // with the bar. Time modes keep proportional bars with the icon inside.
    const seqClass = axisMode === 'sequence' ? ' seq' : '';

    body.querySelectorAll<HTMLElement>('.swimlane-track').forEach(track => {
        const componentEvents = eventsByComponent.get(track.dataset.component || '') || [];
        track.innerHTML = cutMarkers + componentEvents.map(e => {
            const vStart = scale.toVirtual(e.relativeTimestampMs);
            const vEnd = scale.toVirtual(e.relativeTimestampMs + (e.durationMs || 0));

            // Skip if outside visible range
            if (vEnd < visibleStart || vStart > visibleStart + visibleRange) return '';

            const left = ((vStart - visibleStart) / visibleRange) * 100;
            const width = Math.max(((vEnd - vStart) / visibleRange) * 100, 0.1);
            const color = EVENT_COLORS[e.eventType] || '#888';
            const icon = EVENT_ICONS[e.eventType] || '•';
            const isSelected = selectedEvent?.eventId === e.eventId;

            return `<div class="swimlane-event${seqClass} ${isSelected ? 'selected' : ''}"
                         data-event-id="${e.eventId}"
                         style="left: ${Math.max(0, left)}%; width: ${width}%; background: ${color}"
                         title="${e.eventType}: ${formatDuration(e.durationMs || 0)}">
                         <span class="swimlane-event-icon">${icon}</span>
                    </div>`;
        }).join('');
    });

    const axis = document.getElementById('swimlane-time-axis');
    if (axis) {
        axis.innerHTML =
            generateTimeAxis(scale, visibleStart, visibleRange) +
            renderCutChips(scale, visibleStart, visibleRange);
    }

    const zoomLabel = document.getElementById('zoom-level');
    if (zoomLabel) zoomLabel.textContent = `${zoomLevel.toFixed(1)}x`;

    const stats = document.getElementById('swimlane-stats');
    if (stats) {
        const componentCount = new Set(events.map(e => e.componentName)).size;
        const renderCount = events.filter(e => e.eventType === 'BuildRenderTree' && e.durationMs).length;
        const skipped = scale.gaps.reduce((sum, g) => sum + g.skippedMs, 0);
        let gapNote = '';
        if (scale.gaps.length > 0) {
            gapNote = axisMode === 'time-collapsed'
                ? ` • ${scale.gaps.length} cut${scale.gaps.length === 1 ? '' : 's'} hiding ${formatDuration(skipped)} idle`
                : axisMode === 'sequence'
                    ? ` • ${scale.gaps.length} pause${scale.gaps.length === 1 ? '' : 's'} marked`
                    : '';
        }
        stats.textContent = `${componentCount} components • ${renderCount} renders${gapNote}`;
    }
}

/**
 * Markers where the axis is not wall-clock proportional:
 *  - time-collapsed: hatched full-height "cut" columns where idle time was removed
 *  - sequence:       thin dotted separators where a real pause elapsed
 */
function renderCutMarkers(scale: TimeScale, visibleStart: number, visibleRange: number): string {
    if (axisMode === 'time') return '';
    const cls = axisMode === 'sequence' ? 'swimlane-seq-gap' : 'swimlane-cut';
    return scale.gaps.map(gap => {
        const vEnd = gap.virtualStartMs + gap.virtualWidthMs;
        if (vEnd < visibleStart || gap.virtualStartMs > visibleStart + visibleRange) return '';
        const left = ((gap.virtualStartMs - visibleStart) / visibleRange) * 100;
        const width = Math.max((gap.virtualWidthMs / visibleRange) * 100, 0.3);
        const title = axisMode === 'sequence'
            ? `${formatDuration(gap.skippedMs)} elapsed (${formatTime(gap.realStartMs)} → ${formatTime(gap.realEndMs)})`
            : `✂ ${formatDuration(gap.skippedMs)} of idle time hidden (${formatTime(gap.realStartMs)} → ${formatTime(gap.realEndMs)})`;
        return `<div class="${cls}"
                     style="left: ${Math.max(0, left)}%; width: ${width}%"
                     title="${title}"></div>`;
    }).join('');
}

/** Elapsed-time chips on the time axis: "✂ 1.2s" for cuts, "+1.2s" for sequence pauses. */
function renderCutChips(scale: TimeScale, visibleStart: number, visibleRange: number): string {
    if (axisMode === 'time') return '';
    return scale.gaps.map(gap => {
        const vCenter = gap.virtualStartMs + gap.virtualWidthMs / 2;
        if (vCenter < visibleStart || vCenter > visibleStart + visibleRange) return '';
        const left = ((vCenter - visibleStart) / visibleRange) * 100;
        const label = axisMode === 'sequence'
            ? `+${formatDuration(gap.skippedMs)}`
            : `✂ ${formatDuration(gap.skippedMs)}`;
        const title = axisMode === 'sequence'
            ? `${formatDuration(gap.skippedMs)} elapsed between events`
            : `✂ ${formatDuration(gap.skippedMs)} of idle time hidden`;
        return `<span class="time-cut-chip"
                      style="left: ${left}%"
                      title="${title}">${label}</span>`;
    }).join('');
}

function generateTimeAxis(scale: TimeScale, visibleStart: number, visibleRange: number): string {
    const ticks = 5;
    return Array.from({ length: ticks + 1 }, (_, i) => {
        const virtualTime = visibleStart + (i * visibleRange / ticks);
        const left = (i / ticks) * 100;
        return `<span class="time-tick" style="left: ${left}%">${formatDuration(scale.toReal(virtualTime))}</span>`;
    }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMITS VIEW (React-DevTools-style: one bar per burst of rendering)
// ─────────────────────────────────────────────────────────────────────────────

function getCommits(): Commit[] {
    if (!commitsCache || commitsCacheEventCount !== events.length) {
        commitsCache = deriveCommits(events);
        commitsCacheEventCount = events.length;
    }
    return commitsCache;
}

/** Heat color for a commit relative to the slowest commit in the recording. */
function commitColor(commit: Commit, maxMs: number): string {
    const ratio = maxMs > 0 ? commit.totalRenderMs / maxMs : 0;
    if (ratio > 0.66) return '#ef4444';
    if (ratio > 0.33) return '#f59e0b';
    return '#22c55e';
}

function renderCommitsView(): void {
    const container = document.getElementById('timeline-content')!;
    const commits = getCommits();

    if (commits.length === 0) {
        container.innerHTML = `
            <div class="timeline-empty">
                <div class="empty-icon">📊</div>
                <div class="empty-title">No commits recorded</div>
                <div class="empty-hint">Record some interactions — each burst of rendering becomes a commit</div>
            </div>
        `;
        return;
    }

    if (selectedCommitIndex === null || selectedCommitIndex >= commits.length) {
        selectedCommitIndex = commits.length - 1; // most recent by default
    }

    const maxMs = Math.max(...commits.map(c => c.totalRenderMs));

    container.innerHTML = `
        <div class="commits-container">
            <div class="commit-chart" title="One bar per commit — click to inspect, ←/→ to navigate">
                ${commits.map(c => {
                    const heightPct = Math.max(maxMs > 0 ? (c.totalRenderMs / maxMs) * 100 : 0, 6);
                    const isSelected = c.index === selectedCommitIndex;
                    return `<div class="commit-bar ${isSelected ? 'selected' : ''}"
                                 data-commit="${c.index}"
                                 style="height: ${heightPct}%; background: ${commitColor(c, maxMs)}"
                                 title="Commit ${c.index + 1}: ${c.renderCount} render${c.renderCount === 1 ? '' : 's'}, ${formatDuration(c.totalRenderMs)} at ${formatTime(c.startMs)}"></div>`;
                }).join('')}
            </div>
            <div class="commit-hint">${commits.length} commit${commits.length === 1 ? '' : 's'} • click a bar or use ← → to navigate</div>
            <div class="commit-detail" id="commit-detail">
                ${renderCommitDetail(commits[selectedCommitIndex])}
            </div>
        </div>
    `;
}

function renderCommitDetail(commit: Commit): string {
    const maxComponentMs = Math.max(...commit.components.map(c => c.durationMs), 0.001);
    return `
        <div class="commit-detail-header">
            <span class="commit-detail-title">Commit ${commit.index + 1}</span>
            <span class="commit-detail-meta">
                started ${formatTime(commit.startMs)} into recording •
                ${commit.renderCount} render${commit.renderCount === 1 ? '' : 's'} •
                ${formatDuration(commit.totalRenderMs)} total
            </span>
        </div>
        ${commit.components.map(c => `
            <div class="commit-component-row" data-event-id="${c.firstEventId}"
                 title="Click to inspect this component's render event">
                <span class="commit-component-name">${escapeHtml(c.componentName)}</span>
                <div class="commit-component-bar-container">
                    <div class="commit-component-bar" style="width: ${(c.durationMs / maxComponentMs) * 100}%"></div>
                </div>
                <span class="commit-component-duration">${formatDuration(c.durationMs)}</span>
                ${c.renderCount > 1 ? `<span class="commit-component-count">×${c.renderCount}</span>` : '<span class="commit-component-count"></span>'}
            </div>
        `).join('')}
    `;
}

function selectCommit(index: number): void {
    const commits = getCommits();
    if (commits.length === 0) return;
    selectedCommitIndex = Math.min(Math.max(index, 0), commits.length - 1);
    renderCommitsView();
}

// ─────────────────────────────────────────────────────────────────────────────
// ZOOM & PAN (virtual-time space)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zoom by `factor`, keeping the time under `anchorFraction` (0..1 across the
 * visible track width) stationary — like map/IDE zooming.
 */
function zoomAt(anchorFraction: number, factor: number): void {
    const scale = getTimeScale();
    const oldRange = scale.virtualTotalMs / zoomLevel;
    const anchorTime = panOffset * (scale.virtualTotalMs - oldRange) + anchorFraction * oldRange;

    zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel * factor));

    const newRange = scale.virtualTotalMs / zoomLevel;
    const pannable = scale.virtualTotalMs - newRange;
    const newStart = Math.min(Math.max(anchorTime - anchorFraction * newRange, 0), Math.max(pannable, 0));
    panOffset = pannable > 0 ? newStart / pannable : 0;

    scheduleViewUpdate();
}

function resetZoom(): void {
    zoomLevel = 1;
    panOffset = 0;
    scheduleViewUpdate();
}

/** Coalesce rapid zoom/pan updates into one redraw per animation frame. */
function scheduleViewUpdate(): void {
    if (pendingViewUpdate) return;
    pendingViewUpdate = true;
    requestAnimationFrame(() => {
        pendingViewUpdate = false;
        updateFlamegraphView();
    });
}

/** Fraction (0..1) of the pointer across the swimlane track area. */
function trackFractionFromEvent(e: MouseEvent): number {
    const track = document.querySelector<HTMLElement>('.swimlane-track');
    if (!track) return 0.5;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0.5;
    return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT DETAILS
// ─────────────────────────────────────────────────────────────────────────────

function selectEventById(eventId: number): void {
    selectedEvent = events.find(e => e.eventId === eventId) || null;
    renderedListKey = ''; // selection is part of the list render key
    updateUI();
}

function renderEventDetails(): void {
    const container = document.getElementById('timeline-details')!;

    if (!selectedEvent) {
        container.innerHTML = `
            <div class="details-empty">Select an event to view details</div>
        `;
        return;
    }

    const e = selectedEvent;
    const color = EVENT_COLORS[e.eventType] || '#888';

    container.innerHTML = `
        <div class="event-details">
            <div class="event-details-header" style="border-left-color: ${color}">
                <span class="event-details-icon" style="color: ${color}">${EVENT_ICONS[e.eventType] || '•'}</span>
                <span class="event-details-type">${formatEventType(e.eventType)}</span>
            </div>

            <div class="detail-section">
                <div class="detail-section-title">Component</div>
                <div class="detail-row">
                    <span class="detail-label">Name</span>
                    <span class="detail-value">${escapeHtml(e.componentName)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">ID</span>
                    <span class="detail-value number">${e.componentId}</span>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-section-title">Timing</div>
                <div class="detail-row" title="How long after the recording started this event began">
                    <span class="detail-label">Started at</span>
                    <span class="detail-value">${formatTime(e.relativeTimestampMs)} into recording</span>
                </div>
                ${e.durationMs ? `
                <div class="detail-row">
                    <span class="detail-label">Duration</span>
                    <span class="detail-value">${formatDuration(e.durationMs)}</span>
                </div>
                ` : ''}
            </div>

            ${e.triggerReason !== 'Unknown' ? `
            <div class="detail-section">
                <div class="detail-section-title">Why Did This Render?</div>
                <div class="trigger-reason">
                    <span class="trigger-icon">💡</span>
                    <span class="trigger-text">${formatTriggerReason(e.triggerReason)}</span>
                </div>
                ${e.triggerDetails ? `
                <div class="trigger-details">${escapeHtml(e.triggerDetails)}</div>
                ` : ''}
            </div>
            ` : ''}

            <div class="detail-section">
                <div class="detail-section-title">Flags</div>
                <div class="event-flags">
                    ${e.isFirstRender ? '<span class="flag">First Render</span>' : ''}
                    ${e.isAsync ? '<span class="flag">Async</span>' : ''}
                    ${e.wasSkipped ? '<span class="flag skipped">Skipped</span>' : ''}
                    ${e.isEnhanced ? '<span class="flag enhanced">Enhanced</span>' : ''}
                </div>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '-';
    if (ms < 0.01) return '<0.01ms';
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatEventType(type: string): string {
    // Convert PascalCase to readable format
    return type
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

function formatTriggerReason(reason: string): string {
    const reasons: Record<string, string> = {
        'Unknown': 'Unknown reason',
        'FirstRender': 'This is the component\'s first render',
        'ParameterChanged': 'A parameter value changed',
        'StateHasChangedCalled': 'StateHasChanged() was called',
        'ParentRerendered': 'Parent component re-rendered',
        'EventCallbackInvoked': 'An EventCallback was invoked',
        'CascadingValueChanged': 'A cascading value changed',
        'ExternalTrigger': 'External trigger (e.g., timer, JS interop)',
    };
    return reasons[reason] || reason;
}

function loadAxisModePreference(): AxisMode {
    try {
        const stored = localStorage.getItem(AXIS_MODE_STORAGE_KEY);
        return AXIS_MODES.includes(stored as AxisMode) ? (stored as AxisMode) : 'sequence';
    } catch {
        return 'sequence';
    }
}

function saveAxisModePreference(value: AxisMode): void {
    try {
        localStorage.setItem(AXIS_MODE_STORAGE_KEY, value);
    } catch {
        // Storage unavailable (e.g., privacy mode) — preference just won't persist.
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════
//
// All interaction inside #timeline-content is DELEGATED to the container so
// handlers survive innerHTML rebuilds. Re-attaching listeners per render was
// the source of both the zoom jank (document-level mousemove handlers
// accumulated on every redraw) and unreliable event selection (#47: the
// element under the cursor was destroyed between mousedown and click).
//
// ═══════════════════════════════════════════════════════════════════════════════

function initializeEventHandlers(): void {
    document.getElementById('timeline-record-btn')!.addEventListener('click', async () => {
        if (isRecording) return;
        try {
            await startRecording();
        } catch (err) {
            reportConnectionError('start recording', err);
        }
    });

    document.getElementById('timeline-stop-btn')!.addEventListener('click', async () => {
        if (!isRecording) return;
        try {
            await stopRecording();
        } catch (err) {
            reportConnectionError('stop recording', err);
        }
    });

    document.getElementById('timeline-clear-btn')!.addEventListener('click', async () => {
        try {
            await clearRecording();
        } catch (err) {
            reportConnectionError('clear the recording', err);
        }
    });

    document.querySelectorAll('.timeline-view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentView = tab.getAttribute('data-view') as typeof currentView;
            updateUI();
        });
    });

    const content = document.getElementById('timeline-content')!;

    // Delegated clicks: event rows, swimlane events, zoom buttons.
    content.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        if (dragMoved) return; // A pan gesture just ended — not a click.

        const eventEl = target.closest<HTMLElement>('.event-row, .swimlane-event, .commit-component-row');
        if (eventEl) {
            e.stopPropagation();
            selectEventById(parseInt(eventEl.getAttribute('data-event-id')!, 10));
            return;
        }

        const commitBar = target.closest<HTMLElement>('.commit-bar');
        if (commitBar) {
            e.stopPropagation();
            selectCommit(parseInt(commitBar.getAttribute('data-commit')!, 10));
            return;
        }

        if (target.closest('#zoom-in-btn')) {
            zoomAt(0.5, BUTTON_ZOOM_FACTOR);
        } else if (target.closest('#zoom-out-btn')) {
            zoomAt(0.5, 1 / BUTTON_ZOOM_FACTOR);
        } else if (target.closest('#zoom-reset-btn')) {
            resetZoom();
        }
    });

    // Axis-mode dropdown (Sequence / Time / Time collapsed).
    content.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        if (target.id === 'axis-mode-select' && AXIS_MODES.includes(target.value as AxisMode)) {
            axisMode = target.value as AxisMode;
            saveAxisModePreference(axisMode);
            resetZoom(); // The virtual axis changed shape; a stale window would mislead.
        }
    });

    // Cursor-anchored wheel zoom over the swimlanes.
    content.addEventListener('wheel', (e) => {
        if (!(e.target as HTMLElement).closest('.swimlane-body')) return;
        e.preventDefault();
        zoomAt(trackFractionFromEvent(e), e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR);
    }, { passive: false });

    // Drag to pan. Window-level move/up handlers are attached ONCE, here.
    content.addEventListener('mousedown', (e) => {
        if (!(e.target as HTMLElement).closest('.swimlane-body')) return;
        if (zoomLevel <= 1) return;
        pointerDownX = e.clientX;
        dragStartPan = panOffset;
        dragMoved = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (pointerDownX === null) return;
        const dx = e.clientX - pointerDownX;
        if (!dragMoved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        dragMoved = true;

        const track = document.querySelector<HTMLElement>('.swimlane-track');
        const trackWidth = track?.clientWidth || 500;
        const pannableFraction = 1 - 1 / zoomLevel;
        if (pannableFraction <= 0) return;
        // dx pixels over the track equal dx/trackWidth of the visible window,
        // which is (1/zoom) of the total — convert to a pan-offset delta.
        const delta = (dx / trackWidth) / (zoomLevel * pannableFraction);
        panOffset = Math.min(Math.max(dragStartPan - delta, 0), 1);
        scheduleViewUpdate();
    });

    window.addEventListener('mouseup', () => {
        pointerDownX = null;
        // Keep dragMoved set until after the click event that follows mouseup,
        // so a pan gesture doesn't select whatever ends up under the cursor.
        setTimeout(() => { dragMoved = false; }, 0);
    });

    // ←/→ navigate commits while the commits view is visible (ignored while
    // typing in an input/select so it can't fight the axis-mode dropdown etc).
    document.addEventListener('keydown', (e) => {
        if (currentView !== 'commits') return;
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const current = selectedCommitIndex ?? getCommits().length - 1;
        selectCommit(current + (e.key === 'ArrowRight' ? 1 : -1));
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize the timeline panel. Idempotent: repeated calls are ignored so a
 * host page cannot accidentally double-register handlers.
 *
 * @param api Browser-specific transport used to reach the .NET registry.
 */
export function initializeTimelinePanel(api: CallApi): void {
    if (initialized) return;
    initialized = true;

    callApi = api;
    axisMode = loadAxisModePreference();
    initializeEventHandlers();
    updateUI();
    console.log('[BDT Timeline] Panel initialized');
}

/** Test-only: reset module state between test cases. */
export function __resetForTests(): void {
    stopPolling();
    initialized = false;
    isRecording = false;
    events = [];
    rankedComponents = [];
    selectedEvent = null;
    currentView = 'events';
    lastEventId = -1;
    zoomLevel = 1;
    panOffset = 0;
    axisMode = 'sequence';
    timeScale = null;
    selectedCommitIndex = null;
    invalidateRenderCaches();
    pointerDownX = null;
    dragMoved = false;
    connectionError = null;
    consecutivePollFailures = 0;
}
