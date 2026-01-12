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

// Zoom state for flamegraph
let zoomLevel = 1; // 1 = fit all, higher = zoomed in
let panOffset = 0; // Horizontal pan offset (0-1 range, percentage of total)
const MIN_ZOOM = 1;
const MAX_ZOOM = 20;

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
                <span class="ranked-col-pos">#</span>
                <span class="ranked-col-component">Component</span>
                <span class="ranked-col-time">Total Time</span>
                <span class="ranked-col-count">Renders</span>
                <span class="ranked-col-avg">Avg</span>
            </div>
            ${rankedComponents.map((r, i) => `
                <div class="ranked-row" data-component="${escapeHtml(r.componentName)}" title="Click to see events for ${escapeHtml(r.componentName)}">
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
    
    // Add click handlers to show component's events in details
    container.querySelectorAll('.ranked-row').forEach(row => {
        row.addEventListener('click', () => {
            const componentName = row.getAttribute('data-component')!;
            // Find the first render event for this component
            const componentEvent = events.find(e => 
                e.componentName === componentName && e.eventType === 'BuildRenderTree'
            );
            if (componentEvent) {
                selectedEvent = componentEvent;
                
                // Update selection visual
                container.querySelectorAll('.ranked-row').forEach(r => r.classList.remove('selected'));
                row.classList.add('selected');
                
                renderEventDetails();
            }
        });
    });
}

function renderFlamegraph(): void {
    const container = document.getElementById('timeline-content')!;
    
    // Debug: Log all events to console
    console.log('[BDT Timeline] All events:', events);
    console.log('[BDT Timeline] Event types:', [...new Set(events.map(e => e.eventType))]);
    console.log('[BDT Timeline] Component IDs:', [...new Set(events.map(e => e.componentId))]);
    console.log('[BDT Timeline] Component names:', [...new Set(events.map(e => e.componentName))]);
    
    // Debug: Show what event types we have
    const allEventTypes = [...new Set(events.map(e => e.eventType))];
    console.log('[BDT Timeline] All event types in data:', allEventTypes);
    
    // For debugging, let's be more inclusive - show any event that has a componentId
    // This helps us see ALL component activity
    const renderEvents = events.filter(e => 
        e.componentId >= 0 && (
            e.eventType === 'BuildRenderTree' || 
            e.eventType === 'OnParametersSet' ||
            e.eventType === 'OnParametersSetAsync' ||
            e.eventType === 'OnAfterRender' ||
            e.eventType === 'OnAfterRenderAsync' ||
            e.eventType === 'StateHasChanged' ||
            e.eventType === 'StateHasChangedIgnored' ||
            e.eventType === 'EventCallbackInvoked' ||
            e.eventType === 'ShouldRenderTrue' ||
            e.eventType === 'ShouldRenderFalse' ||
            e.eventType === 'SetParametersAsync' ||
            e.eventType === 'OnInitialized' ||
            e.eventType === 'OnInitializedAsync'
        )
    );
    
    console.log('[BDT Timeline] Filtered render events:', renderEvents.length);
    console.log('[BDT Timeline] Filtered event types:', [...new Set(renderEvents.map(e => e.eventType))]);
    
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
    
    // Get unique component INSTANCES (by componentId)
    // Registry is now single source of truth, so IDs should be correct
    const componentInstances = new Map<number, { id: number; name: string }>();
    renderEvents.forEach(e => {
        if (!componentInstances.has(e.componentId)) {
            componentInstances.set(e.componentId, { 
                id: e.componentId, 
                name: e.componentName 
            });
        }
    });
    
    console.log('[BDT Timeline] Component instances found:', [...componentInstances.values()]);
    
    // Sort by component name, then by ID for consistent ordering
    const sortedInstances = [...componentInstances.values()].sort((a, b) => {
        const nameCompare = a.name.localeCompare(b.name);
        return nameCompare !== 0 ? nameCompare : a.id - b.id;
    });
    
    console.log('[BDT Timeline] Sorted instances:', sortedInstances);
    
    // Calculate time range from render events only (not circuit events at time 0)
    const eventTimes = renderEvents.map(e => e.relativeTimestampMs);
    const eventEndTimes = renderEvents.map(e => e.relativeTimestampMs + (e.durationMs || 0));
    const maxTime = Math.max(...eventEndTimes);
    const minTime = Math.min(...eventTimes);
    
    // Add some padding (5% on each side) so events aren't at the very edge
    const rawRange = maxTime - minTime || 1;
    const padding = rawRange * 0.05;
    const paddedMinTime = Math.max(0, minTime - padding);
    const paddedMaxTime = maxTime + padding;
    const timeRange = paddedMaxTime - paddedMinTime;
    
    // Calculate visible time window based on zoom and pan
    const visibleRange = timeRange / zoomLevel;
    const visibleStart = paddedMinTime + (panOffset * (timeRange - visibleRange));
    const visibleEnd = visibleStart + visibleRange;
    
    container.innerHTML = `
        <div class="swimlane-container">
            <div class="swimlane-toolbar">
                <div class="zoom-controls">
                    <button class="zoom-btn" id="zoom-out-btn" title="Zoom out (or scroll down)">−</button>
                    <span class="zoom-level" id="zoom-level">${zoomLevel.toFixed(1)}x</span>
                    <button class="zoom-btn" id="zoom-in-btn" title="Zoom in (or scroll up)">+</button>
                    <button class="zoom-btn" id="zoom-reset-btn" title="Reset zoom to fit all">⟲</button>
                </div>
                <span class="zoom-hint">Scroll to zoom • Drag to pan when zoomed • Time: ${formatDuration(minTime)} - ${formatDuration(maxTime)}</span>
            </div>
            <div class="swimlane-header">
                <div class="swimlane-label-header">Component Instance</div>
                <div class="swimlane-time-axis">
                    ${generateTimeAxis(visibleStart, visibleEnd)}
                </div>
            </div>
            <div class="swimlane-body" id="swimlane-body">
                ${sortedInstances.slice(0, 50).map(inst => renderSwimlaneInstance(inst.id, inst.name, visibleStart, visibleRange, renderEvents)).join('')}
            </div>
            <div class="swimlane-footer">
                <span class="swimlane-stats">
                    ${sortedInstances.length} instances • ${renderEvents.length} events • ${formatDuration(rawRange)} span
                    ${zoomLevel > 1 ? ` • Viewing ${formatDuration(visibleRange)}` : ''}
                </span>
            </div>
        </div>
    `;
    
    // Add click handlers to swimlane events
    container.querySelectorAll('.swimlane-event').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const eventId = parseInt(el.getAttribute('data-event-id')!, 10);
            selectedEvent = events.find(ev => ev.eventId === eventId) || null;
            
            // Update selection visual
            container.querySelectorAll('.swimlane-event').forEach(ev => ev.classList.remove('selected'));
            el.classList.add('selected');
            
            renderEventDetails();
        });
    });
    
    // Zoom button handlers
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => zoomIn());
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => zoomOut());
    document.getElementById('zoom-reset-btn')?.addEventListener('click', () => resetZoom());
    
    // Mouse wheel zoom on swimlane body
    const swimlaneBody = document.getElementById('swimlane-body');
    swimlaneBody?.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) {
            zoomIn(0.3);
        } else {
            zoomOut(0.3);
        }
    }, { passive: false });
    
    // Drag to pan when zoomed
    let isDragging = false;
    let dragStartX = 0;
    let dragStartPan = 0;
    
    swimlaneBody?.addEventListener('mousedown', (e) => {
        if (zoomLevel > 1) {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartPan = panOffset;
            swimlaneBody.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });
    
    const handleMouseMove = (e: MouseEvent) => {
        if (isDragging && swimlaneBody) {
            const dx = e.clientX - dragStartX;
            const trackWidth = swimlaneBody.querySelector('.swimlane-track')?.clientWidth || 500;
            const panDelta = -dx / trackWidth;
            panOffset = Math.max(0, Math.min(1 - 1/zoomLevel, dragStartPan + panDelta));
            renderFlamegraph();
        }
    };
    
    const handleMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            if (swimlaneBody) {
                swimlaneBody.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
            }
        }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Set cursor based on zoom level
    if (swimlaneBody && zoomLevel > 1) {
        swimlaneBody.style.cursor = 'grab';
    }
}

function zoomIn(amount: number = 0.5): void {
    zoomLevel = Math.min(MAX_ZOOM, zoomLevel + amount);
    panOffset = Math.min(panOffset, Math.max(0, 1 - 1/zoomLevel));
    renderFlamegraph();
}

function zoomOut(amount: number = 0.5): void {
    zoomLevel = Math.max(MIN_ZOOM, zoomLevel - amount);
    if (zoomLevel <= 1) {
        zoomLevel = 1;
        panOffset = 0;
    } else {
        panOffset = Math.min(panOffset, 1 - 1/zoomLevel);
    }
    renderFlamegraph();
}

function resetZoom(): void {
    zoomLevel = 1;
    panOffset = 0;
    renderFlamegraph();
}

function renderSwimlaneInstance(componentId: number, componentName: string, visibleStart: number, visibleRange: number, renderEvents: TimelineEvent[]): string {
    // Get events for this specific component INSTANCE
    const instanceEvents = renderEvents.filter(e => e.componentId === componentId);
    
    // Create label with instance ID
    const label = `${componentName} #${componentId}`;
    
    return `
        <div class="swimlane-row">
            <div class="swimlane-label" title="${escapeHtml(label)}">${escapeHtml(componentName)} <span class="swimlane-id">#${componentId}</span></div>
            <div class="swimlane-track">
                ${instanceEvents.map(e => {
                    // Calculate position relative to visible window
                    const eventStart = e.relativeTimestampMs;
                    const eventEnd = eventStart + (e.durationMs || 0);
                    
                    // Skip events completely outside visible range
                    if (eventEnd < visibleStart || eventStart > visibleStart + visibleRange) {
                        return '';
                    }
                    
                    const left = ((eventStart - visibleStart) / visibleRange) * 100;
                    const width = e.durationMs ? Math.max((e.durationMs / visibleRange) * 100, 1) : 1;
                    const color = EVENT_COLORS[e.eventType] || '#888';
                    const icon = EVENT_ICONS[e.eventType] || '•';
                    const isSelected = selectedEvent?.eventId === e.eventId;
                    
                    // Larger minimum width when zoomed in for easier clicking
                    const minWidth = zoomLevel > 2 ? 3 : 2;
                    
                    return `<div class="swimlane-event ${isSelected ? 'selected' : ''}" 
                                 data-event-id="${e.eventId}"
                                 style="left: ${Math.max(0, left)}%; width: ${Math.max(width, minWidth)}%; background: ${color}"
                                 title="${formatEventType(e.eventType)}: ${formatDuration(e.durationMs || 0)}">
                                 <span class="swimlane-event-icon">${icon}</span>
                            </div>`;
                }).join('')}
            </div>
        </div>
    `;
}

function generateTimeAxis(minTime: number, maxTime: number): string {
    const timeRange = maxTime - minTime || 1;
    const ticks = 5;
    const tickInterval = timeRange / ticks;
    
    return Array.from({ length: ticks + 1 }, (_, i) => {
        const time = minTime + (i * tickInterval);
        const left = (i / ticks) * 100;
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