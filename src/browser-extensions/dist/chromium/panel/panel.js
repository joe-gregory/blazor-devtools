/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	// The require scope
/******/ 	var __webpack_require__ = {};
/******/ 	
/************************************************************************/
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
/*!*************************************!*\
  !*** ./src/chromium/panel/panel.ts ***!
  \*************************************/
__webpack_require__.r(__webpack_exports__);
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
// DOM elements
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
// ═══════════════════════════════════════════════════════════════
// API COMMUNICATION
// ═══════════════════════════════════════════════════════════════
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
// ═══════════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════════
function setStatus(connected, text) {
    statusDot.classList.toggle('connected', connected);
    statusDot.classList.toggle('error', !connected);
    statusText.textContent = text;
}
async function refreshComponents() {
    try {
        setStatus(true, 'Refreshing...');
        components = await callApi('getAllComponents');
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
function renderTree() {
    if (components.length === 0) {
        componentTree.innerHTML = '<div class="loading">No components found</div>';
        return;
    }
    // Sort: resolved first, then by type name
    const sorted = [...components].sort((a, b) => {
        if (a.isPending !== b.isPending)
            return a.isPending ? 1 : -1;
        return a.typeName.localeCompare(b.typeName);
    });
    componentTree.innerHTML = sorted.map(c => `
        <div class="component-node ${c.isPending ? 'pending' : ''} ${c.componentId === selectedComponentId ? 'selected' : ''}"
             data-id="${c.componentId}"
             data-index="${components.indexOf(c)}">
            <span class="component-name">${escapeHtml(c.typeName)}</span>
            ${c.hasEnhancedMetrics ? '<span class="component-badge">Enhanced</span>' : ''}
            ${c.isPending ? '<span class="component-badge pending">Pending</span>' : ''}
            <span class="component-id">#${c.componentId}</span>
        </div>
    `).join('');
    // Add click handlers
    componentTree.querySelectorAll('.component-node').forEach(node => {
        node.addEventListener('click', () => {
            const index = parseInt(node.getAttribute('data-index'), 10);
            selectComponent(components[index]);
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
// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
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
// ═══════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════
refreshBtn.addEventListener('click', () => {
    refreshComponents();
});
pickerBtn.addEventListener('click', () => {
    // TODO: Implement element picker
    pickerBtn.classList.toggle('active');
});
// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════
// Initial load
refreshComponents();
// Auto-refresh every 5 seconds
setInterval(refreshComponents, 5000);
console.log('[BDT Panel] Panel initialized, inspecting tab:', inspectedTabId);


/******/ })()
;
//# sourceMappingURL=panel.js.map