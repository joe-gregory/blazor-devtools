// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - components-panel.ts (shared)
// ═══════════════════════════════════════════════════════════════════════════════
//
// The Components tab of the DevTools panel: tree, details, search, filters,
// element picker + highlight-updates toggles. Browser-agnostic — all extension
// messaging is injected via a small host adapter so the same code drives the
// Chromium and Firefox panels (same pattern as timeline-panel.ts).
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { ComponentInfo, LifecycleMetrics } from './types';

/** Browser-specific plumbing injected by the host panel. */
export interface ComponentsPanelHost {
    /** The tab this DevTools instance inspects. */
    inspectedTabId: number;
    /** The extension's own version (from the manifest). */
    extensionVersion: string;
    /** Invoke a [JSInvokable] registry method in the inspected page. */
    callApi<T>(method: string, ...args: unknown[]): Promise<T>;
    /**
     * Send a runtime message to the background worker. Never rejects: errors
     * are surfaced as `{ error }` in the resolved value.
     */
    sendMessage(message: Record<string, unknown>): Promise<{ error?: string } | undefined>;
    /** Subscribe to runtime messages broadcast to the panel. */
    onMessage(handler: (message: any) => void): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Framework/plumbing components hidden by the filter toggle. Matched on the
 * type name with any generic arity stripped (CascadingValue`1 → CascadingValue).
 */
const FRAMEWORK_COMPONENTS = new Set([
    'Router',
    'RouteView',
    'LayoutView',
    'FocusOnNavigate',
    'CascadingValue',
    'CascadingAuthenticationState',
    'AuthorizeRouteView',
    'HeadOutlet',
    'HeadContent',
    'SectionOutlet',
    'SectionContent',
]);

const HIDE_FRAMEWORK_STORAGE_KEY = 'bdt-components-hide-framework';
const AUTO_REFRESH_MS = 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

let host: ComponentsPanelHost;

// DOM references (resolved during initialize)
let refreshBtn: HTMLElement;
let pickerBtn: HTMLElement;
let highlightBtn: HTMLElement;
let filterBtn: HTMLElement;
let searchInput: HTMLInputElement;
let statusDot: Element;
let statusText: Element;
let componentCount: HTMLElement;
let componentTree: HTMLElement;
let componentDetails: HTMLElement;

let components: ComponentInfo[] = [];
let selectedComponentId: number | null = null;
let currentTab = 'components';
let searchQuery = '';
let hideFramework = false;

let expandedNodes = new Set<number>();
let treeInitialized = false;
let lastRenderedDetailsJson = '';

let pickerActive = false;
let highlightActive = false;

let autoRefreshId: number | null = null;
let initialized = false;

// ═══════════════════════════════════════════════════════════════════════════════
// PACKAGE HANDSHAKE (feature detection)
// ═══════════════════════════════════════════════════════════════════════════════
//
// The extension auto-updates; the NuGet package is pinned per-project — skew
// is normal. GetPackageInfo() exists only on newer packages, so it is
// feature-detected: failure means "older package", not an error. The result
// drives the version display and lets features gate on capabilities instead
// of breaking against old packages.

export interface PackageInfo {
    version: string;
    capabilities?: string[];
}

/** null = not yet fetched · 'unavailable' = package predates the handshake */
let packageInfo: PackageInfo | 'unavailable' | null = null;

/** Whether the connected package advertises a named capability. */
export function packageHasCapability(name: string): boolean {
    return packageInfo !== null && packageInfo !== 'unavailable'
        && (packageInfo.capabilities ?? []).includes(name);
}

async function fetchPackageInfoOnce(): Promise<void> {
    if (packageInfo !== null) return;
    try {
        const info = await host.callApi<PackageInfo>('GetPackageInfo');
        packageInfo = info?.version ? info : 'unavailable';
    } catch {
        packageInfo = 'unavailable'; // method not found ⇒ package < handshake version
    }
    renderVersionInfo();
}

function renderVersionInfo(): void {
    const el = document.getElementById('version-info');
    if (!el) return;
    const pkg = packageInfo === null ? '…'
        : packageInfo === 'unavailable' ? 'older (no handshake)'
            : packageInfo.version;
    el.textContent = `ext ${host.extensionVersion} · pkg ${pkg}`;
    el.title = packageInfo === 'unavailable'
        ? 'Extension and BlazorDeveloperTools NuGet versions. Your package predates the version handshake — updating it is recommended: dotnet add package BlazorDeveloperTools --prerelease'
        : 'Extension and BlazorDeveloperTools NuGet versions. Keeping both up to date is recommended.';
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════════════════

function initializeTabs(): void {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab')!;

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            tabContents.forEach(content => {
                content.classList.toggle('active', content.getAttribute('data-tab') === tabName);
            });

            currentTab = tabName;
        });
    });
}

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
        const result = await host.callApi<ComponentInfo[]>('GetAllComponentsDto');
        components = Array.isArray(result) ? result : [];
        renderTree();
        refreshSelectedDetails();
        setStatus(true, 'Connected');
        void fetchPackageInfoOnce();
    } catch (err) {
        // This panel outlived an extension reload: nothing here can work
        // anymore. Stop polling and tell the developer to reopen DevTools.
        if (err instanceof Error && /context invalidated/i.test(err.message)) {
            stopAutoRefresh();
            setStatus(false, 'Extension was reloaded — close and reopen DevTools');
            return;
        }
        console.error('[BDT Panel] Refresh failed:', err);
        setStatus(false, 'Disconnected');
        componentTree.innerHTML = '<div class="loading">Failed to connect to Blazor DevTools</div>';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILTERING & SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

/** Type name with generic arity stripped: "CascadingValue`1" → "CascadingValue". */
function baseTypeName(typeName: string): string {
    const tick = typeName.indexOf('`');
    return tick >= 0 ? typeName.slice(0, tick) : typeName;
}

function isFrameworkComponent(c: ComponentInfo): boolean {
    return FRAMEWORK_COMPONENTS.has(baseTypeName(c.typeName));
}

function isHidden(c: ComponentInfo): boolean {
    return hideFramework && isFrameworkComponent(c);
}

function matchesSearch(c: ComponentInfo): boolean {
    return c.typeName.toLowerCase().includes(searchQuery);
}

/** Type name as HTML, with the matched substring highlighted while searching. */
function renderComponentName(typeName: string): string {
    if (!searchQuery) return escapeHtml(typeName);
    const index = typeName.toLowerCase().indexOf(searchQuery);
    if (index < 0) return escapeHtml(typeName);
    return escapeHtml(typeName.slice(0, index))
        + `<mark class="search-match">${escapeHtml(typeName.slice(index, index + searchQuery.length))}</mark>`
        + escapeHtml(typeName.slice(index + searchQuery.length));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TREE RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function renderTree(): void {
    if (components.length === 0) {
        componentTree.innerHTML = '<div class="loading">No components found</div>';
        componentCount.textContent = '';
        return;
    }

    const componentMap = new Map<number, ComponentInfo>();
    components.forEach(c => {
        if (c.componentId !== undefined && c.componentId !== null) {
            componentMap.set(c.componentId, c);
        }
    });

    // Components surviving the framework filter.
    const visible = components.filter(c => !isHidden(c));
    const hiddenCount = components.length - visible.length;
    const visibleIds = new Set(visible.map(c => c.componentId));

    // Nearest non-hidden ancestor: children of hidden components re-parent to
    // it so the tree stays connected when framework layers are filtered out.
    function visibleParentId(c: ComponentInfo): number | null {
        let parentId = c.parentComponentId;
        while (parentId !== null && parentId !== undefined && componentMap.has(parentId)) {
            if (visibleIds.has(parentId)) return parentId;
            parentId = componentMap.get(parentId)!.parentComponentId;
        }
        return null;
    }

    // While searching, keep matches AND their ancestors (so hierarchy reads),
    // with everything force-expanded.
    let searchKept: Set<number> | null = null;
    let matchCount = 0;
    if (searchQuery) {
        searchKept = new Set<number>();
        for (const c of visible) {
            if (!matchesSearch(c)) continue;
            matchCount++;
            let cursor: ComponentInfo | undefined = c;
            while (cursor && !searchKept.has(cursor.componentId)) {
                if (visibleIds.has(cursor.componentId)) searchKept.add(cursor.componentId);
                const parentId = visibleParentId(cursor);
                cursor = parentId !== null ? componentMap.get(parentId) : undefined;
            }
        }
    }

    const shown = searchKept
        ? visible.filter(c => searchKept!.has(c.componentId))
        : visible;

    // Build the (re-parented) tree over the shown set.
    const shownIds = new Set(shown.map(c => c.componentId));
    const roots: ComponentInfo[] = [];
    const childrenMap = new Map<number, ComponentInfo[]>();

    shown.forEach(c => {
        let parentId = visibleParentId(c);
        if (parentId !== null && !shownIds.has(parentId)) parentId = null;
        if (parentId === null) {
            roots.push(c);
        } else {
            if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
            childrenMap.get(parentId)!.push(c);
        }
    });

    const sortByName = (a: ComponentInfo, b: ComponentInfo) => a.typeName.localeCompare(b.typeName);
    roots.sort(sortByName);
    childrenMap.forEach(children => children.sort(sortByName));

    // Auto-expand roots and their immediate children on first load
    if (!treeInitialized) {
        treeInitialized = true;
        roots.forEach(root => {
            if (root.componentId !== undefined) {
                expandedNodes.add(root.componentId);
                (childrenMap.get(root.componentId) || []).forEach(child => {
                    if (child.componentId !== undefined) expandedNodes.add(child.componentId);
                });
            }
        });
    }

    function renderNode(component: ComponentInfo, depth: number): string {
        const children = childrenMap.get(component.componentId) || [];
        const hasChildren = children.length > 0;
        // Search results are always fully expanded so matches are visible.
        const isExpanded = searchQuery ? true : expandedNodes.has(component.componentId);
        const indent = depth * 16;

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
                <span class="component-name">${renderComponentName(component.typeName)}</span>
                ${component.hasEnhancedMetrics ? '<span class="component-badge">Enhanced</span>' : ''}
                ${component.isPending ? '<span class="component-badge pending">Pending</span>' : ''}
                <span class="component-id">#${component.componentId}</span>
                ${hasChildren ? `<span class="child-count">(${children.length})</span>` : ''}
            </div>
        `;

        if (hasChildren && isExpanded) {
            html += `<div class="tree-children" data-parent="${component.componentId}">`;
            children.forEach(child => {
                html += renderNode(child, depth + 1);
            });
            html += `</div>`;
        }

        return html;
    }

    let treeHtml = '';
    roots.forEach(root => {
        treeHtml += renderNode(root, 0);
    });

    if (searchQuery && matchCount === 0) {
        treeHtml = '<div class="loading">No components match the search</div>';
    }

    // Pending components without IDs (skipped while searching)
    const pendingWithoutId = searchQuery ? [] : components.filter(c =>
        c.isPending && (c.componentId === undefined || c.componentId === null || c.componentId < 0));
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

    // Toolbar count: matches while searching, hidden note while filtering.
    componentCount.textContent = searchQuery
        ? `${matchCount} match${matchCount === 1 ? '' : 'es'}`
        : hiddenCount > 0
            ? `(${visible.length} of ${components.length})`
            : `(${components.length})`;

    componentTree.querySelectorAll('.component-node').forEach(node => {
        node.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).classList.contains('tree-toggle')) return;
            const index = parseInt(node.getAttribute('data-index')!, 10);
            if (!isNaN(index) && components[index]) {
                selectComponent(components[index]);
            }
        });
    });

    componentTree.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(toggle.getAttribute('data-id')!, 10);
            if (expandedNodes.has(id)) {
                expandedNodes.delete(id);
            } else {
                expandedNodes.add(id);
            }
            renderTree();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTION & DETAILS
// ═══════════════════════════════════════════════════════════════════════════════

// Keep the open details pane in sync with the auto-refresh: parameters and
// metrics change between refreshes (e.g. a bound Quantity parameter), but
// renderDetails only runs on selection otherwise.
function refreshSelectedDetails(): void {
    if (selectedComponentId === null) return;
    const selected = components.find(c => c.componentId === selectedComponentId);
    if (!selected) return;
    const json = JSON.stringify(selected);
    if (json === lastRenderedDetailsJson) return; // avoid pointless DOM churn
    lastRenderedDetailsJson = json;
    renderDetails(selected);
}

function selectComponent(component: ComponentInfo): void {
    selectedComponentId = component.componentId;

    componentTree.querySelectorAll('.component-node').forEach(node => {
        node.classList.toggle('selected',
            parseInt(node.getAttribute('data-id')!, 10) === selectedComponentId);
    });

    lastRenderedDetailsJson = JSON.stringify(component);
    renderDetails(component);
}

function renderDetails(c: ComponentInfo): void {
    let html = '';

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
// PICKER & HIGHLIGHTER TOGGLES
// ═══════════════════════════════════════════════════════════════════════════════

function setPickerActive(value: boolean): void {
    pickerActive = value;
    pickerBtn.classList.toggle('active', value);
}

async function togglePicker(): Promise<void> {
    const next = !pickerActive;
    setPickerActive(next);
    const response = await host.sendMessage({
        type: 'PICKER_CONTROL',
        tabId: host.inspectedTabId,
        action: next ? 'start' : 'stop',
    });
    if (response?.error) {
        setPickerActive(false);
        setStatus(false, 'Picker unavailable — is the page connected?');
    }
}

async function toggleHighlight(): Promise<void> {
    const next = !highlightActive;
    highlightActive = next;
    highlightBtn.classList.toggle('active', next);
    const response = await host.sendMessage({
        type: 'HIGHLIGHT_CONTROL',
        tabId: host.inspectedTabId,
        action: next ? 'start' : 'stop',
    });
    if (response?.error) {
        highlightActive = false;
        highlightBtn.classList.remove('active');
        setStatus(false, 'Highlighting unavailable — is the page connected?');
    }
}

async function selectPickedComponent(componentId: number): Promise<void> {
    let component = components.find(c => c.componentId === componentId);
    if (!component) {
        await refreshComponents();
        component = components.find(c => c.componentId === componentId);
    }
    if (component) {
        selectComponent(component);
        componentTree.querySelector('.component-node.selected')?.scrollIntoView({ block: 'nearest' });
    }
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

function loadHideFrameworkPreference(): boolean {
    try {
        return localStorage.getItem(HIDE_FRAMEWORK_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function saveHideFrameworkPreference(value: boolean): void {
    try {
        localStorage.setItem(HIDE_FRAMEWORK_STORAGE_KEY, value ? '1' : '0');
    } catch {
        // Storage unavailable — preference just won't persist.
    }
}

function stopAutoRefresh(): void {
    if (autoRefreshId !== null) {
        clearInterval(autoRefreshId);
        autoRefreshId = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize the Components tab (and the panel's tab bar). Idempotent.
 */
export function initializeComponentsPanel(panelHost: ComponentsPanelHost): void {
    if (initialized) return;
    initialized = true;
    host = panelHost;

    refreshBtn = document.getElementById('refresh-btn')!;
    pickerBtn = document.getElementById('picker-btn')!;
    highlightBtn = document.getElementById('highlight-btn')!;
    filterBtn = document.getElementById('filter-btn')!;
    searchInput = document.getElementById('tree-search') as HTMLInputElement;
    statusDot = document.querySelector('.status-dot')!;
    statusText = document.querySelector('.status-text')!;
    componentCount = document.getElementById('component-count')!;
    componentTree = document.getElementById('component-tree')!;
    componentDetails = document.getElementById('component-details')!;

    hideFramework = loadHideFrameworkPreference();
    filterBtn.classList.toggle('active', hideFramework);

    renderVersionInfo();
    initializeTabs();

    refreshBtn.addEventListener('click', () => void refreshComponents());
    pickerBtn.addEventListener('click', () => void togglePicker());
    highlightBtn.addEventListener('click', () => void toggleHighlight());

    filterBtn.addEventListener('click', () => {
        hideFramework = !hideFramework;
        filterBtn.classList.toggle('active', hideFramework);
        saveHideFrameworkPreference(hideFramework);
        renderTree();
    });

    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        renderTree();
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchInput.value) {
            e.stopPropagation();
            searchInput.value = '';
            searchQuery = '';
            renderTree();
        }
    });

    // Picker events pushed from the page (via content script → background).
    host.onMessage((message) => {
        if (message?.type !== 'CONTENT_EVENT' || message.event !== 'picker') return;
        if (message.tabId !== undefined && message.tabId !== host.inspectedTabId) return;

        setPickerActive(false);
        if (message.data?.event === 'picked' && typeof message.data.componentId === 'number') {
            void selectPickedComponent(message.data.componentId);
        }
    });

    void refreshComponents();

    autoRefreshId = window.setInterval(() => {
        if (currentTab === 'components') {
            void refreshComponents();
        }
    }, AUTO_REFRESH_MS);

    console.log('[BDT Panel] Components panel initialized, inspecting tab:', host.inspectedTabId);
}

/** Test-only: reset module state between test cases. */
export function __resetComponentsPanelForTests(): void {
    stopAutoRefresh();
    initialized = false;
    components = [];
    selectedComponentId = null;
    currentTab = 'components';
    searchQuery = '';
    hideFramework = false;
    expandedNodes = new Set();
    treeInitialized = false;
    lastRenderedDetailsJson = '';
    pickerActive = false;
    highlightActive = false;
    packageInfo = null;
}
