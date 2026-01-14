// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - panel.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// UI logic for the DevTools panel. Communicates with the content script
// via chrome.runtime messaging to query the page's blazorDevTools API.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ComponentInfo, LifecycleMetrics } from '../../core/types';
import { initializeTimelinePanel } from './timeline-panel';

// The tab ID we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

// DOM elements - Components tab
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
let currentTab: string = 'components';

// ═══════════════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════════════════

function initializeTabs(): void {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab')!;
            
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

// Export for timeline-panel.ts to use
(window as any).blazorDevToolsCallApi = callApi;

// ═══════════════════════════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════════════════════════

function setStatus(connected: boolean, text: string): void {
    statusDot.classList.toggle('connected', connected);
    statusDot.classList.toggle('error', !connected);
    statusText.textContent = text;
}

async function refreshComponents(): Promise<void> {
    try {
        setStatus(true, 'Refreshing...');
        components = await callApi<ComponentInfo[]>('GetAllComponentsDto');        renderTree();
        componentCount.textContent = `(${components.length})`;
        setStatus(true, 'Connected');
    } catch (err) {
        console.error('[BDT Panel] Refresh failed:', err);
        setStatus(false, 'Disconnected');
        componentTree.innerHTML = '<div class="loading">Failed to connect to Blazor DevTools</div>';
    }
}

// Track expanded nodes across renders
let expandedNodes = new Set<number>();
let treeInitialized = false;

function renderTree(): void {
    if (components.length === 0) {
        componentTree.innerHTML = '<div class="loading">No components found</div>';
        return;
    }

    // Build a map for quick lookup
    const componentMap = new Map<number, ComponentInfo>();
    components.forEach(c => {
        if (c.componentId !== undefined && c.componentId !== null) {
            componentMap.set(c.componentId, c);
        }
    });

    // Find root components (no parent or parent not in our list)
    const roots: ComponentInfo[] = [];
    const childrenMap = new Map<number, ComponentInfo[]>();

    components.forEach(c => {
        const parentId = c.parentComponentId;
        if (parentId === null || parentId === undefined || !componentMap.has(parentId)) {
            roots.push(c);
        } else {
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId)!.push(c);
        }
    });

    // Sort roots and children by type name
    const sortByName = (a: ComponentInfo, b: ComponentInfo) => a.typeName.localeCompare(b.typeName);
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
    function renderNode(component: ComponentInfo, depth: number): string {
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
            if ((e.target as HTMLElement).classList.contains('tree-toggle')) return;
            
            const index = parseInt(node.getAttribute('data-index')!, 10);
            if (!isNaN(index) && components[index]) {
                selectComponent(components[index]);
            }
        });
    });

    // Add click handlers for expand/collapse toggles
    componentTree.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(toggle.getAttribute('data-id')!, 10);
            
            if (expandedNodes.has(id)) {
                expandedNodes.delete(id);
            } else {
                expandedNodes.add(id);
            }
            
            // Re-render the tree
            renderTree();
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
initializeTimelinePanel();

// Initial load
refreshComponents();

// Auto-refresh every X seconds (only for components tab)
setInterval(() => {
    if (currentTab === 'components') {
        refreshComponents();
    }
}, 1000);

console.log('[BDT Panel] Panel initialized, inspecting tab:', inspectedTabId);