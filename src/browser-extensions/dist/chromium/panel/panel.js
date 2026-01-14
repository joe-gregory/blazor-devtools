/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/chromium/panel/timeline-panel.ts"
/*!**********************************************!*\
  !*** ./src/chromium/panel/timeline-panel.ts ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   initializeTimelinePanel: () => (/* binding */ initializeTimelinePanel)
/* harmony export */ });
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
// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const EVENT_COLORS = {
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
const EVENT_ICONS = {
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
let events = [];
let rankedComponents = [];
let selectedEvent = null;
let currentView = 'events';
let refreshInterval = null;
let lastEventId = -1;
let zoomLevel = 1;
let panOffset = 0;
const MIN_ZOOM = 1;
const MAX_ZOOM = 20;
// Tab ID we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
// ═══════════════════════════════════════════════════════════════════════════════
// API COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════════
async function callApi(method, ...args) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'PANEL_REQUEST',
            tabId: inspectedTabId,
            method,
            args,
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            }
            else if (response?.error) {
                reject(new Error(response.error));
            }
            else {
                resolve(response?.data);
            }
        });
    });
}
// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE API METHODS
// ═══════════════════════════════════════════════════════════════════════════════
async function startRecording() {
    await callApi('StartTimelineRecording');
    isRecording = true;
    lastEventId = -1;
    events = [];
    updateUI();
    startPolling();
}
async function stopRecording() {
    await callApi('StopTimelineRecording');
    isRecording = false;
    stopPolling();
    await fetchAllEvents();
    updateUI();
}
async function clearRecording() {
    await callApi('ClearTimelineEvents');
    events = [];
    rankedComponents = [];
    selectedEvent = null;
    lastEventId = -1;
    updateUI();
}
async function fetchState() {
    return await callApi('GetTimelineState');
}
async function fetchAllEvents() {
    events = await callApi('GetTimelineEvents');
    rankedComponents = await callApi('GetRankedComponents');
    lastEventId = events.length > 0 ? events[events.length - 1].eventId : -1;
}
async function fetchNewEvents() {
    const newEvents = await callApi('GetTimelineEventsSince', lastEventId);
    if (newEvents.length > 0) {
        events = [...events, ...newEvents];
        lastEventId = newEvents[newEvents.length - 1].eventId;
        rankedComponents = await callApi('GetRankedComponents');
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// POLLING
// ═══════════════════════════════════════════════════════════════════════════════
function startPolling() {
    if (refreshInterval)
        return;
    refreshInterval = window.setInterval(async () => {
        if (isRecording) {
            await fetchNewEvents();
            updateUI();
        }
    }, 500);
}
function stopPolling() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// UI RENDERING
// ═══════════════════════════════════════════════════════════════════════════════
function updateUI() {
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
function updateControls() {
    const recordBtn = document.getElementById('timeline-record-btn');
    const stopBtn = document.getElementById('timeline-stop-btn');
    const clearBtn = document.getElementById('timeline-clear-btn');
    recordBtn.classList.toggle('active', isRecording);
    recordBtn.classList.toggle('recording', isRecording);
    recordBtn.disabled = isRecording;
    stopBtn.disabled = !isRecording;
    clearBtn.disabled = isRecording || events.length === 0;
}
function updateStats() {
    const statsEl = document.getElementById('timeline-stats');
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
function updateViewTabs() {
    document.querySelectorAll('.timeline-view-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-view') === currentView);
    });
}
function renderEventList() {
    const container = document.getElementById('timeline-content');
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
            const eventId = parseInt(row.getAttribute('data-event-id'), 10);
            selectedEvent = events.find(e => e.eventId === eventId) || null;
            updateUI();
        });
    });
}
function renderEventRow(event) {
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
function renderRankedView() {
    const container = document.getElementById('timeline-content');
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
function renderFlamegraph() {
    const container = document.getElementById('timeline-content');
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
    const componentNames = [...new Set(events.map(e => e.componentName))];
    // Calculate time range with padding
    const eventTimes = events.map(e => e.relativeTimestampMs);
    const eventEndTimes = events.map(e => e.relativeTimestampMs + (e.durationMs || 0));
    const maxTime = Math.max(...eventEndTimes);
    const minTime = Math.min(...eventTimes.filter(t => t > 0));
    const rawRange = maxTime - minTime || 1;
    const padding = rawRange * 0.05;
    const paddedMinTime = Math.max(0, minTime - padding);
    const timeRange = (maxTime + padding) - paddedMinTime;
    // Calculate visible window based on zoom
    const visibleRange = timeRange / zoomLevel;
    const visibleStart = paddedMinTime + (panOffset * (timeRange - visibleRange));
    container.innerHTML = `
        <div class="swimlane-container">
            <div class="swimlane-toolbar">
                <div class="zoom-controls">
                    <button class="zoom-btn" id="zoom-out-btn" title="Zoom out">−</button>
                    <span class="zoom-level">${zoomLevel.toFixed(1)}x</span>
                    <button class="zoom-btn" id="zoom-in-btn" title="Zoom in">+</button>
                    <button class="zoom-btn" id="zoom-reset-btn" title="Reset">⟲</button>
                </div>
                <span class="zoom-hint">Scroll to zoom • Drag to pan</span>
            </div>
            <div class="swimlane-header">
                <div class="swimlane-label-header">Component</div>
                <div class="swimlane-time-axis">
                    ${generateTimeAxis(visibleStart, visibleStart + visibleRange)}
                </div>
            </div>
            <div class="swimlane-body" id="swimlane-body">
                ${componentNames.slice(0, 30).map(name => renderSwimlane(name, visibleStart, visibleRange)).join('')}
            </div>
            <div class="swimlane-footer">
                <span class="swimlane-stats">${componentNames.length} components • ${renderEvents.length} renders</span>
            </div>
        </div>
    `;
    // Click handlers for events
    container.querySelectorAll('.swimlane-event').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const eventId = parseInt(el.getAttribute('data-event-id'), 10);
            selectedEvent = events.find(ev => ev.eventId === eventId) || null;
            container.querySelectorAll('.swimlane-event').forEach(ev => ev.classList.remove('selected'));
            el.classList.add('selected');
            renderEventDetails();
        });
    });
    // Zoom buttons
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
        zoomLevel = Math.min(MAX_ZOOM, zoomLevel + 0.5);
        renderFlamegraph();
    });
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
        zoomLevel = Math.max(MIN_ZOOM, zoomLevel - 0.5);
        if (zoomLevel <= 1)
            panOffset = 0;
        renderFlamegraph();
    });
    document.getElementById('zoom-reset-btn')?.addEventListener('click', () => {
        zoomLevel = 1;
        panOffset = 0;
        renderFlamegraph();
    });
    // Scroll to zoom
    const swimlaneBody = document.getElementById('swimlane-body');
    swimlaneBody?.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomLevel = e.deltaY < 0
            ? Math.min(MAX_ZOOM, zoomLevel + 0.3)
            : Math.max(MIN_ZOOM, zoomLevel - 0.3);
        if (zoomLevel <= 1)
            panOffset = 0;
        renderFlamegraph();
    }, { passive: false });
    // Drag to pan
    let isDragging = false, dragStartX = 0, dragStartPan = 0;
    swimlaneBody?.addEventListener('mousedown', (e) => {
        if (zoomLevel > 1) {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartPan = panOffset;
        }
    });
    document.addEventListener('mousemove', (e) => {
        if (isDragging && swimlaneBody) {
            const dx = e.clientX - dragStartX;
            const trackWidth = swimlaneBody.querySelector('.swimlane-track')?.clientWidth || 500;
            panOffset = Math.max(0, Math.min(1 - 1 / zoomLevel, dragStartPan - dx / trackWidth));
            renderFlamegraph();
        }
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
}
function renderSwimlane(componentName, visibleStart, visibleRange) {
    const componentEvents = events.filter(e => e.componentName === componentName);
    return `
        <div class="swimlane-row">
            <div class="swimlane-label" title="${escapeHtml(componentName)}">${escapeHtml(componentName)}</div>
            <div class="swimlane-track">
                ${componentEvents.map(e => {
        const eventStart = e.relativeTimestampMs;
        const eventEnd = eventStart + (e.durationMs || 0);
        // Skip if outside visible range
        if (eventEnd < visibleStart || eventStart > visibleStart + visibleRange)
            return '';
        const left = ((eventStart - visibleStart) / visibleRange) * 100;
        const width = e.durationMs ? Math.max((e.durationMs / visibleRange) * 100, 1) : 1;
        const color = EVENT_COLORS[e.eventType] || '#888';
        const icon = EVENT_ICONS[e.eventType] || '•';
        const isSelected = selectedEvent?.eventId === e.eventId;
        return `<div class="swimlane-event ${isSelected ? 'selected' : ''}" 
                                 data-event-id="${e.eventId}"
                                 style="left: ${Math.max(0, left)}%; width: ${Math.max(width, 2)}%; background: ${color}"
                                 title="${e.eventType}: ${formatDuration(e.durationMs || 0)}">
                                 <span class="swimlane-event-icon">${icon}</span>
                            </div>`;
    }).join('')}
            </div>
        </div>
    `;
}
function generateTimeAxis(startTime, endTime) {
    const ticks = 5;
    const range = endTime - startTime;
    return Array.from({ length: ticks + 1 }, (_, i) => {
        const time = startTime + (i * range / ticks);
        const left = (i / ticks) * 100;
        return `<span class="time-tick" style="left: ${left}%">${formatDuration(time)}</span>`;
    }).join('');
}
function renderEventDetails() {
    const container = document.getElementById('timeline-details');
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
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
function formatTime(ms) {
    if (ms < 1000)
        return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
function formatDuration(ms) {
    if (ms === null || ms === undefined)
        return '-';
    if (ms < 0.01)
        return '<0.01ms';
    if (ms < 1)
        return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000)
        return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
function formatEventType(type) {
    // Convert PascalCase to readable format
    return type
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}
function formatTriggerReason(reason) {
    const reasons = {
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
function initializeEventHandlers() {
    // Record button
    document.getElementById('timeline-record-btn').addEventListener('click', async () => {
        if (!isRecording) {
            await startRecording();
        }
    });
    // Stop button
    document.getElementById('timeline-stop-btn').addEventListener('click', async () => {
        if (isRecording) {
            await stopRecording();
        }
    });
    // Clear button
    document.getElementById('timeline-clear-btn').addEventListener('click', async () => {
        await clearRecording();
    });
    // View tabs
    document.querySelectorAll('.timeline-view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentView = tab.getAttribute('data-view');
            updateUI();
        });
    });
}
// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════
function initializeTimelinePanel() {
    initializeEventHandlers();
    updateUI();
    console.log('[BDT Timeline] Panel initialized');
}
// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTimelinePanel);
}
else {
    initializeTimelinePanel();
}


/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Check if module exists (development only)
/******/ 		if (__webpack_modules__[moduleId] === undefined) {
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!*************************************!*\
  !*** ./src/chromium/panel/panel.ts ***!
  \*************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _timeline_panel__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./timeline-panel */ "./src/chromium/panel/timeline-panel.ts");
// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - panel.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// UI logic for the DevTools panel. Communicates with the content script
// via chrome.runtime messaging to query the page's blazorDevTools API.
//
// ═══════════════════════════════════════════════════════════════════════════════

// The tab ID we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
// DOM elements - Components tab
const refreshBtn = document.getElementById('refresh-btn');
const pickerBtn = document.getElementById('picker-btn');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const componentCount = document.getElementById('component-count');
const componentTree = document.getElementById('component-tree');
const componentDetails = document.getElementById('component-details');
// State
let selectedComponentId = null;
let components = [];
let currentTab = 'components';
// ═══════════════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════════════════
function initializeTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            // Update tab buttons
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            // Update tab contents
            tabContents.forEach(content => {
                content.classList.toggle('active', content.getAttribute('data-tab') === tabName);
            });
            currentTab = tabName;
        });
    });
}
// ═══════════════════════════════════════════════════════════════════════════════
// API COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════════
async function callApi(method, ...args) {
    return new Promise((resolve, reject) => {
        // Send message to content script via background, include tabId
        chrome.runtime.sendMessage({
            type: 'PANEL_REQUEST',
            tabId: inspectedTabId,
            method,
            args,
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            }
            else if (response?.error) {
                reject(new Error(response.error));
            }
            else {
                resolve(response?.data);
            }
        });
    });
}
// Export for timeline-panel.ts to use
window.blazorDevToolsCallApi = callApi;
// ═══════════════════════════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════════════════════════
function setStatus(connected, text) {
    statusDot.classList.toggle('connected', connected);
    statusDot.classList.toggle('error', !connected);
    statusText.textContent = text;
}
async function refreshComponents() {
    try {
        setStatus(true, 'Refreshing...');
        components = await callApi('GetAllComponentsDto');
        renderTree();
        componentCount.textContent = `(${components.length})`;
        setStatus(true, 'Connected');
    }
    catch (err) {
        console.error('[BDT Panel] Refresh failed:', err);
        setStatus(false, 'Disconnected');
        componentTree.innerHTML = '<div class="loading">Failed to connect to Blazor DevTools</div>';
    }
}
// Track expanded nodes across renders
let expandedNodes = new Set();
let treeInitialized = false;
function renderTree() {
    if (components.length === 0) {
        componentTree.innerHTML = '<div class="loading">No components found</div>';
        return;
    }
    // Build a map for quick lookup
    const componentMap = new Map();
    components.forEach(c => {
        if (c.componentId !== undefined && c.componentId !== null) {
            componentMap.set(c.componentId, c);
        }
    });
    // Find root components (no parent or parent not in our list)
    const roots = [];
    const childrenMap = new Map();
    components.forEach(c => {
        const parentId = c.parentComponentId;
        if (parentId === null || parentId === undefined || !componentMap.has(parentId)) {
            roots.push(c);
        }
        else {
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId).push(c);
        }
    });
    // Sort roots and children by type name
    const sortByName = (a, b) => a.typeName.localeCompare(b.typeName);
    roots.sort(sortByName);
    childrenMap.forEach(children => children.sort(sortByName));
    // Auto-expand roots and their immediate children on first load
    if (!treeInitialized) {
        treeInitialized = true;
        roots.forEach(root => {
            if (root.componentId !== undefined) {
                expandedNodes.add(root.componentId);
                const children = childrenMap.get(root.componentId) || [];
                children.forEach(child => {
                    if (child.componentId !== undefined) {
                        expandedNodes.add(child.componentId);
                    }
                });
            }
        });
    }
    // Recursive function to render a component and its children
    function renderNode(component, depth) {
        const children = childrenMap.get(component.componentId) || [];
        const hasChildren = children.length > 0;
        const isExpanded = expandedNodes.has(component.componentId);
        const indent = depth * 16; // 16px per level
        let html = `
            <div class="component-node ${component.isPending ? 'pending' : ''} ${component.componentId === selectedComponentId ? 'selected' : ''}"
                 data-id="${component.componentId}"
                 data-index="${components.indexOf(component)}"
                 style="padding-left: ${indent + 8}px;">
                ${hasChildren ? `
                    <span class="tree-toggle ${isExpanded ? 'expanded' : ''}" data-id="${component.componentId}">
                        ${isExpanded ? '▼' : '▶'}
                    </span>
                ` : `
                    <span class="tree-toggle-placeholder"></span>
                `}
                <span class="component-name">${escapeHtml(component.typeName)}</span>
                ${component.hasEnhancedMetrics ? '<span class="component-badge">Enhanced</span>' : ''}
                ${component.isPending ? '<span class="component-badge pending">Pending</span>' : ''}
                <span class="component-id">#${component.componentId}</span>
                ${hasChildren ? `<span class="child-count">(${children.length})</span>` : ''}
            </div>
        `;
        // Render children if expanded
        if (hasChildren && isExpanded) {
            html += `<div class="tree-children" data-parent="${component.componentId}">`;
            children.forEach(child => {
                html += renderNode(child, depth + 1);
            });
            html += `</div>`;
        }
        return html;
    }
    // Render the tree
    let treeHtml = '';
    roots.forEach(root => {
        treeHtml += renderNode(root, 0);
    });
    // Add pending components that don't have IDs yet (at the bottom)
    const pendingWithoutId = components.filter(c => c.isPending && (c.componentId === undefined || c.componentId === null || c.componentId < 0));
    if (pendingWithoutId.length > 0) {
        treeHtml += `<div class="pending-section">
            <div class="pending-header">Pending (${pendingWithoutId.length})</div>
            ${pendingWithoutId.map(c => `
                <div class="component-node pending"
                     data-index="${components.indexOf(c)}"
                     style="padding-left: 8px;">
                    <span class="tree-toggle-placeholder"></span>
                    <span class="component-name">${escapeHtml(c.typeName)}</span>
                    <span class="component-badge pending">Pending</span>
                </div>
            `).join('')}
        </div>`;
    }
    componentTree.innerHTML = treeHtml;
    // Add click handlers for component selection
    componentTree.querySelectorAll('.component-node').forEach(node => {
        node.addEventListener('click', (e) => {
            // Don't select if clicking on toggle
            if (e.target.classList.contains('tree-toggle'))
                return;
            const index = parseInt(node.getAttribute('data-index'), 10);
            if (!isNaN(index) && components[index]) {
                selectComponent(components[index]);
            }
        });
    });
    // Add click handlers for expand/collapse toggles
    componentTree.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(toggle.getAttribute('data-id'), 10);
            if (expandedNodes.has(id)) {
                expandedNodes.delete(id);
            }
            else {
                expandedNodes.add(id);
            }
            // Re-render the tree
            renderTree();
        });
    });
}
function selectComponent(component) {
    selectedComponentId = component.componentId;
    // Update selection in tree
    componentTree.querySelectorAll('.component-node').forEach(node => {
        node.classList.toggle('selected', parseInt(node.getAttribute('data-id'), 10) === selectedComponentId);
    });
    // Render details
    renderDetails(component);
}
function renderDetails(c) {
    let html = '';
    // Identity section
    html += `
        <div class="detail-section">
            <div class="detail-section-title">Identity</div>
            <div class="detail-row">
                <span class="detail-label">Type</span>
                <span class="detail-value">${escapeHtml(c.typeName)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Full Type</span>
                <span class="detail-value">${escapeHtml(c.typeFullName || 'N/A')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Component ID</span>
                <span class="detail-value number">${c.componentId}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="detail-value">${c.isPending ? 'Pending' : 'Resolved'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Enhanced</span>
                <span class="detail-value boolean">${c.hasEnhancedMetrics}</span>
            </div>
        </div>
    `;
    // Render stats
    html += `
        <div class="detail-section">
            <div class="detail-section-title">Render Stats</div>
            <div class="detail-row">
                <span class="detail-label">Render Count</span>
                <span class="detail-value number">${c.renderCount}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Created</span>
                <span class="detail-value">${formatDate(c.createdAt)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Last Rendered</span>
                <span class="detail-value">${c.lastRenderedAt ? formatDate(c.lastRenderedAt) : 'Never'}</span>
            </div>
        </div>
    `;
    // Internal state
    if (c.internalState) {
        html += `
            <div class="detail-section">
                <div class="detail-section-title">Internal State</div>
                <div class="detail-row">
                    <span class="detail-label">Initialized</span>
                    <span class="detail-value boolean">${c.internalState.isInitialized}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Has Never Rendered</span>
                    <span class="detail-value boolean">${c.internalState.hasNeverRendered}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Pending Render</span>
                    <span class="detail-value boolean">${c.internalState.hasPendingQueuedRender}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">After Render Called</span>
                    <span class="detail-value boolean">${c.internalState.hasCalledOnAfterRender}</span>
                </div>
            </div>
        `;
    }
    // Parameters
    if (c.parameters && c.parameters.length > 0) {
        html += `
            <div class="detail-section">
                <div class="detail-section-title">Parameters (${c.parameters.length})</div>
                ${c.parameters.map(p => `
                    <div class="detail-row">
                        <span class="detail-label">${escapeHtml(p.name)}${p.isCascading ? ' (cascading)' : ''}</span>
                        <span class="detail-value">${escapeHtml(p.value || 'null')}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }
    // Lifecycle metrics (enhanced only)
    if (c.metrics) {
        html += renderMetrics(c.metrics);
    }
    componentDetails.innerHTML = html;
}
function renderMetrics(m) {
    return `
        <div class="detail-section">
            <div class="detail-section-title">Lifecycle Metrics</div>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">Time to First Render</div>
                    <div class="metric-value ${getMetricClass(m.timeToFirstRenderMs, 100, 300)}">
                        ${formatMs(m.timeToFirstRenderMs)}
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Render Count</div>
                    <div class="metric-value">${m.buildRenderTreeCallCount}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Avg Render Time</div>
                    <div class="metric-value ${getMetricClass(m.averageBuildRenderTreeDurationMs, 5, 16)}">
                        ${formatMs(m.averageBuildRenderTreeDurationMs)}
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">StateHasChanged</div>
                    <div class="metric-value">${m.stateHasChangedCallCount}</div>
                </div>
            </div>
        </div>
        
        <div class="detail-section">
            <div class="detail-section-title">Timing Details</div>
            <div class="detail-row">
                <span class="detail-label">OnInitialized</span>
                <span class="detail-value">${formatMs(m.onInitializedDurationMs)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">OnInitializedAsync</span>
                <span class="detail-value">${formatMs(m.onInitializedAsyncDurationMs)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">OnParametersSet</span>
                <span class="detail-value">${formatMs(m.onParametersSetDurationMs)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">OnAfterRender</span>
                <span class="detail-value">${formatMs(m.onAfterRenderDurationMs)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Total Render Time</span>
                <span class="detail-value">${formatMs(m.totalBuildRenderTreeDurationMs)}</span>
            </div>
        </div>
    `;
}
// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
function formatDate(dateStr) {
    try {
        const date = new Date(dateStr);
        return date.toLocaleTimeString();
    }
    catch {
        return dateStr;
    }
}
function formatMs(value) {
    if (value === null || value === undefined)
        return 'N/A';
    if (value < 1)
        return `${(value * 1000).toFixed(0)}μs`;
    if (value < 1000)
        return `${value.toFixed(2)}ms`;
    return `${(value / 1000).toFixed(2)}s`;
}
function getMetricClass(value, goodThreshold, badThreshold) {
    if (value === null || value === undefined)
        return '';
    if (value <= goodThreshold)
        return 'good';
    if (value <= badThreshold)
        return 'warning';
    return 'bad';
}
// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════
refreshBtn.addEventListener('click', () => {
    refreshComponents();
});
pickerBtn.addEventListener('click', () => {
    // TODO: Implement element picker
    pickerBtn.classList.toggle('active');
});
// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════
// Initialize tabs
initializeTabs();
// Initialize timeline panel
(0,_timeline_panel__WEBPACK_IMPORTED_MODULE_0__.initializeTimelinePanel)();
// Initial load
refreshComponents();
// Auto-refresh every X seconds (only for components tab)
setInterval(() => {
    if (currentTab === 'components') {
        refreshComponents();
    }
}, 1000);
console.log('[BDT Panel] Panel initialized, inspecting tab:', inspectedTabId);

})();

/******/ })()
;
//# sourceMappingURL=panel.js.map