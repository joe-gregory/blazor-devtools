// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - timeline-panel.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Timeline profiler panel for recording and visualizing component render events.
// Inspired by React DevTools Profiler with Blazor-specific adaptations.
//
// Features:
//   - Record/Stop/Clear controls
//   - Event timeline with swimlane visualization
//   - Ranked components view (slowest first)
//   - Event details with "Why did this render?"
//   - Real-time stats during recording
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { 
    TimelineEvent, 
    RenderBatch, 
    ComponentRanking, 
    RecordingState,
    TimelineEventType 
} from '../../core/types';

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

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

let isRecording = false;
let events: TimelineEvent[] = [];
let rankedComponents: ComponentRanking[] = [];
let selectedEvent: TimelineEvent | null = null;
let currentView: 'events' | 'ranked' | 'flamegraph' = 'events';
let refreshInterval: number | null = null;
let lastEventId = -1;

// Tab ID we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

// ═══════════════════════════════════════════════════════════════════════════════
// API COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════════

async function callApi<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: 'PANEL_REQUEST',
                tabId: inspectedTabId,
                method,
                args,
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response?.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response?.data);
                }
            }
        );
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE API METHODS
// ═══════════════════════════════════════════════════════════════════════════════

async function startRecording(): Promise<void> {
    await callApi('StartTimelineRecording');
    isRecording = true;
    lastEventId = -1;
    events = [];
    updateUI();
    startPolling();
}

async function stopRecording(): Promise<void> {
    await callApi('StopTimelineRecording');
    isRecording = false;
    stopPolling();
    await fetchAllEvents();
    updateUI();
}

async function clearRecording(): Promise<void> {
    await callApi('ClearTimelineEvents');
    events = [];
    rankedComponents = [];
    selectedEvent = null;
    lastEventId = -1;
    updateUI();
}

async function fetchState(): Promise<RecordingState> {
    return await callApi<RecordingState>('GetTimelineState');
}

async function fetchAllEvents(): Promise<void> {
    events = await callApi<TimelineEvent[]>('GetTimelineEvents');
    rankedComponents = await callApi<ComponentRanking[]>('GetRankedComponents');
    lastEventId = events.length > 0 ? events[events.length - 1].eventId : -1;
}

async function fetchNewEvents(): Promise<void> {
    const newEvents = await callApi<TimelineEvent[]>('GetTimelineEventsSince', lastEventId);
    if (newEvents.length > 0) {
        events = [...events, ...newEvents];
        lastEventId = newEvents[newEvents.length - 1].eventId;
        rankedComponents = await callApi<ComponentRanking[]>('GetRankedComponents');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLLING
// ═══════════════════════════════════════════════════════════════════════════════

function startPolling(): void {
    if (refreshInterval) return;
    refreshInterval = window.setInterval(async () => {
        if (isRecording) {
            await fetchNewEvents();
            updateUI();
        }
    }, 500);
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
    
    if (events.length === 0) {
        statsEl.innerHTML = '<span class="stats-empty">Click record to start profiling</span>';
        return;
    }
    
    const duration = events.length > 0 
        ? events[events.length - 1].relativeTimestampMs 
        : 0;
    
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

function renderEventList(): void {
    const container = document.getElementById('timeline-content')!;
    
    if (events.length === 0) {
        container.innerHTML = `
            <div class="timeline-empty">
                <div class="empty-icon">⏱</div>
                <div class="empty-title">No events recorded</div>
                <div class="empty-hint">Click the record button to start profiling</div>
            </div>
        `;
        return;
    }
    
    // Group events by component for swimlane-style display
    const eventsByTime = [...events].sort((a, b) => a.relativeTimestampMs - b.relativeTimestampMs);
    
    container.innerHTML = `
        <div class="event-list">
            ${eventsByTime.map(event => renderEventRow(event)).join('')}
        </div>
    `;
    
    // Add click handlers
    container.querySelectorAll('.event-row').forEach(row => {
        row.addEventListener('click', () => {
            const eventId = parseInt(row.getAttribute('data-event-id')!, 10);
            selectedEvent = events.find(e => e.eventId === eventId) || null;
            updateUI();
        });
    });
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

function renderFlamegraph(): void {
    const container = document.getElementById('timeline-content')!;
    
    // Group renders by batch/time window for flamegraph
    const renderEvents = events.filter(e => e.eventType === 'BuildRenderTree' && e.durationMs);
    
    if (renderEvents.length === 0) {
        container.innerHTML = `
            <div class="timeline-empty">
                <div class="empty-icon">🔥</div>
                <div class="empty-title">No render data</div>
                <div class="empty-hint">Record some interactions to see the flamegraph</div>
            </div>
        `;
        return;
    }
    
    // Simple swimlane visualization
    const componentNames = [...new Set(events.map(e => e.componentName))];
    const maxTime = Math.max(...events.map(e => e.relativeTimestampMs + (e.durationMs || 0)));
    
    container.innerHTML = `
        <div class="swimlane-container">
            <div class="swimlane-header">
                <div class="swimlane-time-axis">
                    ${generateTimeAxis(maxTime)}
                </div>
            </div>
            <div class="swimlane-body">
                ${componentNames.slice(0, 20).map(name => renderSwimlane(name, maxTime)).join('')}
            </div>
        </div>
    `;
}

function renderSwimlane(componentName: string, maxTime: number): string {
    const componentEvents = events.filter(e => e.componentName === componentName);
    
    return `
        <div class="swimlane-row">
            <div class="swimlane-label">${escapeHtml(componentName)}</div>
            <div class="swimlane-track">
                ${componentEvents.map(e => {
                    const left = (e.relativeTimestampMs / maxTime) * 100;
                    const width = e.durationMs ? Math.max((e.durationMs / maxTime) * 100, 0.5) : 0.5;
                    const color = EVENT_COLORS[e.eventType] || '#888';
                    return `<div class="swimlane-event" 
                                 style="left: ${left}%; width: ${width}%; background: ${color}"
                                 title="${e.eventType}: ${formatDuration(e.durationMs || 0)}"></div>`;
                }).join('')}
            </div>
        </div>
    `;
}

function generateTimeAxis(maxTime: number): string {
    const ticks = 5;
    const tickInterval = maxTime / ticks;
    
    return Array.from({ length: ticks + 1 }, (_, i) => {
        const time = i * tickInterval;
        const left = (time / maxTime) * 100;
        return `<span class="time-tick" style="left: ${left}%">${formatDuration(time)}</span>`;
    }).join('');
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
                <div class="detail-row">
                    <span class="detail-label">Timestamp</span>
                    <span class="detail-value">${formatTime(e.relativeTimestampMs)}</span>
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

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

function initializeEventHandlers(): void {
    // Record button
    document.getElementById('timeline-record-btn')!.addEventListener('click', async () => {
        if (!isRecording) {
            await startRecording();
        }
    });
    
    // Stop button
    document.getElementById('timeline-stop-btn')!.addEventListener('click', async () => {
        if (isRecording) {
            await stopRecording();
        }
    });
    
    // Clear button
    document.getElementById('timeline-clear-btn')!.addEventListener('click', async () => {
        await clearRecording();
    });
    
    // View tabs
    document.querySelectorAll('.timeline-view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentView = tab.getAttribute('data-view') as typeof currentView;
            updateUI();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

export function initializeTimelinePanel(): void {
    initializeEventHandlers();
    updateUI();
    console.log('[BDT Timeline] Panel initialized');
}

// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTimelinePanel);
} else {
    initializeTimelinePanel();
}