// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - panel.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// UI logic for the DevTools panel. Communicates with the content script
// via chrome.runtime messaging to query the page's blazorDevTools API.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ComponentInfo, LifecycleMetrics } from '../../core/types';

// Ensure parentComponentId is recognized (added by C# Renderer sync)
// If your types.ts doesn't have this, add: parentComponentId: number | null;
declare module '../../core/types' {
    interface ComponentInfo {
        parentComponentId?: number | null;
    }
}

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
        setStatus(true, 'Refreshing...');
        components = await callApi<ComponentInfo[]>('getAllComponents');
        renderTree();
        componentCount.textContent = `(${components.length})`;
        setStatus(true, 'Connected');
    } catch (err) {
        console.error('[BDT Panel] Refresh failed:', err);
        setStatus(false, 'Disconnected');
        componentTree.innerHTML = '<div class="loading">Failed to connect to Blazor DevTools</div>';
    }
}

// Tree node with children
interface TreeNode extends ComponentInfo {
    children: TreeNode[];
    depth: number;
}

/**
 * Filter out prerender/SSR duplicate components.
 * In Blazor 8+ with Auto/Server mode and prerendering, components are created twice:
 * 1. During SSR (often with componentId 0 or low IDs, no parent)
 * 2. When circuit connects (higher IDs, proper parent hierarchy)
 * 
 * We filter out the SSR instances to avoid confusing duplicates.
 */
function filterPrerenderDuplicates(components: ComponentInfo[]): ComponentInfo[] {
    // Group by typeName
    const byType = new Map<string, ComponentInfo[]>();
    components.forEach(c => {
        const list = byType.get(c.typeName) || [];
        list.push(c);
        byType.set(c.typeName, list);
    });

    const filtered: ComponentInfo[] = [];
    
    byType.forEach((instances, typeName) => {
        if (instances.length === 1) {
            // Only one instance - keep it
            filtered.push(instances[0]);
        } else {
            // Multiple instances - filter out prerender duplicates
            // Keep instances that have a parent (part of real hierarchy)
            // Or keep the one with the highest componentId (most recent)
            
            const withParent = instances.filter(c => c.parentComponentId !== null);
            const orphans = instances.filter(c => c.parentComponentId === null);
            
            // Always keep instances with parents (they're in the real tree)
            filtered.push(...withParent);
            
            // For orphans, only keep if there's no equivalent with a parent
            // This handles cases like Routes/Router which are legitimately root components
            if (withParent.length === 0) {
                // No instances with parents - keep all orphans (they might be legitimate roots)
                filtered.push(...orphans);
            } else {
                // There are instances with parents - orphans are likely SSR duplicates
                // But keep orphans that have enhanced metrics and the parented ones don't
                orphans.forEach(orphan => {
                    const hasBetterVersion = withParent.some(p => 
                        p.hasEnhancedMetrics || !orphan.hasEnhancedMetrics
                    );
                    if (!hasBetterVersion) {
                        filtered.push(orphan);
                    }
                });
            }
        }
    });

    return filtered;
}

function buildComponentTree(components: ComponentInfo[]): TreeNode[] {
    // Filter out prerender duplicates first
    const filtered = filterPrerenderDuplicates(components);
    
    // Create lookup map
    const nodeMap = new Map<number, TreeNode>();
    filtered.forEach(c => {
        nodeMap.set(c.componentId, { ...c, children: [], depth: 0 });
    });

    // Build parent-child relationships
    const roots: TreeNode[] = [];
    nodeMap.forEach(node => {
        if (node.parentComponentId !== null && nodeMap.has(node.parentComponentId)) {
            const parent = nodeMap.get(node.parentComponentId)!;
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    });

    // Calculate depths and sort children
    function processNode(node: TreeNode, depth: number) {
        node.depth = depth;
        node.children.sort((a, b) => a.componentId - b.componentId);
        node.children.forEach(child => processNode(child, depth + 1));
    }
    roots.sort((a, b) => a.componentId - b.componentId);
    roots.forEach(root => processNode(root, 0));

    return roots;
}

function renderTreeNode(container: HTMLElement, node: TreeNode): void {
    const hasChildren = node.children.length > 0;
    const indent = node.depth * 16;
    
    // Component row
    const div = document.createElement('div');
    div.className = `component-node ${node.isPending ? 'pending' : ''} ${node.componentId === selectedComponentId ? 'selected' : ''}`;
    div.setAttribute('data-id', String(node.componentId));
    div.style.paddingLeft = `${indent + 8}px`;

    // Arrow for expandable nodes
    const arrow = hasChildren 
        ? `<span class="tree-arrow" data-expanded="true">▼</span>` 
        : `<span class="tree-arrow-spacer"></span>`;

    div.innerHTML = `
        ${arrow}
        <span class="component-name">${escapeHtml(node.typeName)}</span>
        ${node.hasEnhancedMetrics ? '<span class="component-badge enhanced">Enhanced</span>' : ''}
        ${node.isPending ? '<span class="component-badge pending">Pending</span>' : ''}
        <span class="component-id">#${node.componentId}</span>
        ${node.renderCount > 1 ? `<span class="render-badge">${node.renderCount}x</span>` : ''}
    `;

    // Click handler for selection
    div.addEventListener('click', (e) => {
        // Don't select if clicking the arrow
        if ((e.target as HTMLElement).classList.contains('tree-arrow')) return;
        const comp = components.find(c => c.componentId === node.componentId);
        if (comp) selectComponent(comp);
    });

    // Toggle children on arrow click
    const arrowEl = div.querySelector('.tree-arrow');
    if (arrowEl) {
        arrowEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = arrowEl.getAttribute('data-expanded') === 'true';
            arrowEl.setAttribute('data-expanded', String(!isExpanded));
            arrowEl.textContent = isExpanded ? '▶' : '▼';
            
            // Toggle children visibility
            const childContainer = div.nextElementSibling;
            if (childContainer?.classList.contains('children-container')) {
                (childContainer as HTMLElement).style.display = isExpanded ? 'none' : 'block';
            }
        });
    }

    container.appendChild(div);

    // Children container
    if (hasChildren) {
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'children-container';
        node.children.forEach(child => renderTreeNode(childrenDiv, child));
        container.appendChild(childrenDiv);
    }
}

function renderTree(): void {
    if (components.length === 0) {
        componentTree.innerHTML = '<div class="loading">No components found</div>';
        return;
    }

    // Build hierarchical tree from parentComponentId
    const tree = buildComponentTree(components);
    
    // Render tree recursively
    componentTree.innerHTML = '';
    tree.forEach(node => renderTreeNode(componentTree, node));
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

// Listen for component update events from the page
// These are pushed by enhanced components via C# → JS bridge
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'COMPONENT_UPDATE' && sender.tab?.id === inspectedTabId) {
        console.log('[BDT Panel] Component update received:', message.data);
        
        // If the updated component is currently selected, refresh its details
        if (message.data?.componentId === selectedComponentId) {
            // Refresh just the selected component's details
            const component = components.find(c => c.componentId === selectedComponentId);
            if (component) {
                // Re-fetch to get updated metrics
                refreshComponents();
            }
        } else {
            // Otherwise do a full refresh
            refreshComponents();
        }
    }
});

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

// Initial load
refreshComponents();

// Auto-refresh every 1 second for responsive updates
// This is a dev tool, so responsiveness > performance
setInterval(refreshComponents, 1000);

console.log('[BDT Panel] Panel initialized, inspecting tab:', inspectedTabId);