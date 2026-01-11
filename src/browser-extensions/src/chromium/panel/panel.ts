// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - panel.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// UI logic for the DevTools panel. Communicates with the content script
// via chrome.runtime messaging to query the page's blazorDevTools API.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ComponentInfo, LifecycleMetrics } from '../../core/types';

// The tab ID we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

// DOM elements
const refreshBtn = document.getElementById('refresh-btn')!;
const pickerBtn = document.getElementById('picker-btn')!;
const statusDot = document.querySelector('.status-dot')!;
const statusText = document.querySelector('.status-text')!;
const componentCount = document.getElementById('component-count')!;
const componentTree = document.getElementById('component-tree')!;
const componentDetails = document.getElementById('component-details')!;

// State
let selectedComponentId: number | null = null;
let components: ComponentInfo[] = [];
let connectionState: 'connected' | 'connecting' | 'disconnected' = 'connecting';
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_DISCONNECT = 3;

// ═══════════════════════════════════════════════════════════════
// API COMMUNICATION
// ═══════════════════════════════════════════════════════════════

async function callApi<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => {
        // Send message to content script via background, include tabId
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

// ═══════════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════════

function setStatus(connected: boolean, text: string): void {
    statusDot.classList.toggle('connected', connected);
    statusDot.classList.toggle('error', !connected);
    statusText.textContent = text;
}

async function refreshComponents(): Promise<void> {
    try {
        if (connectionState === 'disconnected') {
            setStatus(false, 'Reconnecting...');
        } else if (connectionState === 'connecting') {
            setStatus(false, 'Connecting...');
        } else {
            setStatus(true, 'Refreshing...');
        }
        
        components = await callApi<ComponentInfo[]>('GetAllComponentsDto');
        
        // Success - reset failure count and mark connected
        consecutiveFailures = 0;
        connectionState = 'connected';
        
        renderTree();
        componentCount.textContent = `(${components.length})`;
        setStatus(true, 'Connected');
        
        // Also refresh details panel if a component is selected
        if (selectedComponentId !== null) {
            const selectedComponent = components.find(c => c.componentId === selectedComponentId);
            if (selectedComponent) {
                renderDetails(selectedComponent);
            }
        }
    } catch (err) {
        consecutiveFailures++;
        console.error('[BDT Panel] Refresh failed:', err, `(attempt ${consecutiveFailures})`);
        
        // Only show disconnected after multiple failures
        if (consecutiveFailures >= MAX_FAILURES_BEFORE_DISCONNECT) {
            connectionState = 'disconnected';
            setStatus(false, 'Disconnected');
            componentTree.innerHTML = '<div class="loading">Waiting for Blazor DevTools...</div>';
        } else {
            // Still trying to connect
            connectionState = 'connecting';
            setStatus(false, `Connecting... (attempt ${consecutiveFailures})`);
        }
    }
}

function renderTree(): void {
    if (components.length === 0) {
        componentTree.innerHTML = '<div class="loading">No components found</div>';
        return;
    }

    // Build parent-child map
    const childrenMap = new Map<number | null, ComponentInfo[]>();
    
    // Initialize with empty arrays
    childrenMap.set(null, []); // Root components (no parent)
    
    for (const c of components) {
        // Add to parent's children list
        const parentId = c.parentComponentId ?? null;
        if (!childrenMap.has(parentId)) {
            childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(c);
        
        // Ensure this component has an entry for its children
        if (!childrenMap.has(c.componentId)) {
            childrenMap.set(c.componentId, []);
        }
    }

    // Sort children at each level by type name
    for (const children of childrenMap.values()) {
        children.sort((a, b) => {
            // Pending last
            if (a.isPending !== b.isPending) return a.isPending ? 1 : -1;
            return a.typeName.localeCompare(b.typeName);
        });
    }

    // Recursive function to render a node and its children
    function renderNode(c: ComponentInfo, depth: number): string {
        const children = childrenMap.get(c.componentId) || [];
        const hasChildren = children.length > 0;
        const indent = depth * 16; // 16px per level
        
        let html = `
            <div class="component-node ${c.isPending ? 'pending' : ''} ${c.componentId === selectedComponentId ? 'selected' : ''}"
                 data-id="${c.componentId}"
                 data-index="${components.indexOf(c)}"
                 style="padding-left: ${indent}px;">
                ${hasChildren ? '<span class="tree-toggle">▼</span>' : '<span class="tree-spacer"></span>'}
                <span class="component-name">${escapeHtml(c.typeName)}</span>
                ${c.hasEnhancedMetrics ? '<span class="component-badge">Enhanced</span>' : ''}
                ${c.isPending ? '<span class="component-badge pending">Pending</span>' : ''}
                <span class="component-id">#${c.componentId}</span>
            </div>`;
        
        // Render children
        for (const child of children) {
            html += renderNode(child, depth + 1);
        }
        
        return html;
    }

    // Find root components (those whose parent is not in our list, or parent is null)
    const knownIds = new Set(components.map(c => c.componentId));
    const rootComponents = components.filter(c => 
        c.parentComponentId === null || 
        c.parentComponentId === undefined ||
        !knownIds.has(c.parentComponentId)
    );
    
    // Sort root components
    rootComponents.sort((a, b) => {
        if (a.isPending !== b.isPending) return a.isPending ? 1 : -1;
        return a.typeName.localeCompare(b.typeName);
    });

    // Render tree starting from roots
    let html = '';
    for (const root of rootComponents) {
        html += renderNode(root, 0);
    }

    componentTree.innerHTML = html;

    // Add click handlers
    componentTree.querySelectorAll('.component-node').forEach(node => {
        node.addEventListener('click', () => {
            const index = parseInt(node.getAttribute('data-index')!, 10);
            selectComponent(components[index]);
        });
    });
}

function selectComponent(component: ComponentInfo): void {
    selectedComponentId = component.componentId;
    
    // Update selection in tree
    componentTree.querySelectorAll('.component-node').forEach(node => {
        node.classList.toggle('selected', 
            parseInt(node.getAttribute('data-id')!, 10) === selectedComponentId);
    });
    
    // Render details
    renderDetails(component);
}

function renderDetails(c: ComponentInfo): void {
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

function renderMetrics(m: LifecycleMetrics): string {
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
            <div class="detail-section-title">Render Timing</div>
            <div class="detail-row">
                <span class="detail-label">Last Render</span>
                <span class="detail-value">${formatMs(m.lastBuildRenderTreeDurationMs)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Total Render Time</span>
                <span class="detail-value">${formatMs(m.totalBuildRenderTreeDurationMs)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Min / Max</span>
                <span class="detail-value">${formatMs(m.minBuildRenderTreeDurationMs)} / ${formatMs(m.maxBuildRenderTreeDurationMs)}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <div class="detail-section-title">Lifecycle Timing</div>
            <table class="timing-table">
                <thead>
                    <tr>
                        <th>Method</th>
                        <th>Last</th>
                        <th>Total</th>
                        <th>Calls</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>OnInitialized</td>
                        <td>${formatMs(m.onInitializedDurationMs)}</td>
                        <td>${formatMs(m.totalOnInitializedDurationMs)}</td>
                        <td>${m.onInitializedCallCount}</td>
                    </tr>
                    <tr>
                        <td>OnInitializedAsync</td>
                        <td>${formatMs(m.onInitializedAsyncDurationMs)}</td>
                        <td>${formatMs(m.totalOnInitializedAsyncDurationMs)}</td>
                        <td>-</td>
                    </tr>
                    <tr>
                        <td>OnParametersSet</td>
                        <td>${formatMs(m.onParametersSetDurationMs)}</td>
                        <td>${formatMs(m.totalOnParametersSetDurationMs)}</td>
                        <td>${m.onParametersSetCallCount}</td>
                    </tr>
                    <tr>
                        <td>OnParametersSetAsync</td>
                        <td>${formatMs(m.onParametersSetAsyncDurationMs)}</td>
                        <td>${formatMs(m.totalOnParametersSetAsyncDurationMs)}</td>
                        <td>-</td>
                    </tr>
                    <tr>
                        <td>BuildRenderTree</td>
                        <td>${formatMs(m.lastBuildRenderTreeDurationMs)}</td>
                        <td>${formatMs(m.totalBuildRenderTreeDurationMs)}</td>
                        <td>${m.buildRenderTreeCallCount}</td>
                    </tr>
                    <tr>
                        <td>OnAfterRender</td>
                        <td>${formatMs(m.onAfterRenderDurationMs)}</td>
                        <td>${formatMs(m.totalOnAfterRenderDurationMs)}</td>
                        <td>${m.onAfterRenderCallCount}</td>
                    </tr>
                    <tr>
                        <td>OnAfterRenderAsync</td>
                        <td>${formatMs(m.onAfterRenderAsyncDurationMs)}</td>
                        <td>${formatMs(m.totalOnAfterRenderAsyncDurationMs)}</td>
                        <td>-</td>
                    </tr>
                    <tr>
                        <td>EventCallbacks</td>
                        <td>${formatMs(m.lastEventCallbackDurationMs)}</td>
                        <td>${formatMs(m.totalEventCallbackDurationMs)}</td>
                        <td>${m.eventCallbackInvokedCount}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <td><strong>Total</strong></td>
                        <td>-</td>
                        <td><strong>${formatMs(m.totalLifecycleTimeMs)}</strong></td>
                        <td>-</td>
                    </tr>
                </tfoot>
            </table>
        </div>
        
        <div class="detail-section">
            <div class="detail-section-title">ShouldRender Stats</div>
            <div class="detail-row">
                <span class="detail-label">True / False</span>
                <span class="detail-value">${m.shouldRenderTrueCount} / ${m.shouldRenderFalseCount}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Block Rate</span>
                <span class="detail-value">${m.shouldRenderBlockRatePercent !== null ? m.shouldRenderBlockRatePercent.toFixed(1) + '%' : 'N/A'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Ignored (Pending)</span>
                <span class="detail-value">${m.stateHasChangedPendingIgnoredCount}</span>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        return date.toLocaleTimeString();
    } catch {
        return dateStr;
    }
}

function formatMs(value: number | null | undefined): string {
    if (value === null || value === undefined) return 'N/A';
    if (value < 1) return `${(value * 1000).toFixed(0)}μs`;
    if (value < 1000) return `${value.toFixed(2)}ms`;
    return `${(value / 1000).toFixed(2)}s`;
}

function getMetricClass(value: number | null | undefined, goodThreshold: number, badThreshold: number): string {
    if (value === null || value === undefined) return '';
    if (value <= goodThreshold) return 'good';
    if (value <= badThreshold) return 'warning';
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

// Listen for tab updates (navigation, refresh)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === inspectedTabId && changeInfo.status === 'loading') {
        console.log('[BDT Panel] Page navigating, resetting connection state');
        connectionState = 'connecting';
        consecutiveFailures = 0;
        components = [];
        componentTree.innerHTML = '<div class="loading">Waiting for Blazor to load...</div>';
        setStatus(false, 'Page loading...');
    }
});

// Listen for messages from background (e.g., Blazor detected)
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'BLAZOR_DETECTED') {
        console.log('[BDT Panel] Blazor detected, refreshing...');
        consecutiveFailures = 0;
        connectionState = 'connecting';
        refreshComponents();
    }
});

// Initial load
refreshComponents();

// Auto-refresh every X seconds
setInterval(refreshComponents, 1000);

console.log('[BDT Panel] Panel initialized, inspecting tab:', inspectedTabId);