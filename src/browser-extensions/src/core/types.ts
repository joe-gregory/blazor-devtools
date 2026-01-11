// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - types.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// TypeScript interfaces that mirror the C# DTOs from BlazorDeveloperTools.
// Keep these in sync with ComponentInfoDto.cs and related files.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Component information returned from .NET BlazorDevToolsRegistry.
 * Mirrors ComponentInfoDto.cs
 */
export interface ComponentInfo {
    /** Blazor-assigned component ID. -1 indicates pending (not yet resolved). */
    componentId: number;
    /** Short type name (e.g., "Counter") */
    typeName: string;
    /** Full type name with namespace (e.g., "MyApp.Pages.Counter") */
    typeFullName: string | null;
    /** Source file path (populated by Source Generator, Pillar 1) */
    sourceFile: string | null;
    /** Line number in source file */
    lineNumber: number | null;
    /** Parent component's ID for tree building */
    parentComponentId: number | null;
    /** Number of times this component has rendered */
    renderCount: number;
    /** When the component was created */
    createdAt: string;
    /** When the component last rendered */
    lastRenderedAt: string | null;
    /** True if component inherits from BlazorDevToolsComponentBase */
    hasEnhancedMetrics: boolean;
    /** True if componentId < 0 (regular ComponentBase not yet resolved) */
    isPending: boolean;
    /** Component parameters */
    parameters: ParameterInfo[] | null;
    /** Custom tracked state via [TrackState] attribute */
    trackedState: Record<string, string | null> | null;
    /** Internal ComponentBase state */
    internalState: InternalState | null;
    /** Detailed lifecycle metrics (only for enhanced components) */
    metrics: LifecycleMetrics | null;
}

/**
 * Parameter information.
 * Mirrors ParameterDto.cs
 */
export interface ParameterInfo {
    /** Parameter name */
    name: string;
    /** Parameter type name */
    typeName: string;
    /** String representation of value */
    value: string | null;
    /** True if [CascadingParameter] */
    isCascading: boolean;
}

/**
 * Internal ComponentBase state.
 * Mirrors InternalStateDto.cs
 */
export interface InternalState {
    /** True until first render */
    hasNeverRendered: boolean;
    /** True when StateHasChanged called but render pending */
    hasPendingQueuedRender: boolean;
    /** True after OnAfterRender has been called */
    hasCalledOnAfterRender: boolean;
    /** True after OnInitialized/Async completed */
    isInitialized: boolean;
}

/**
 * Detailed lifecycle metrics for enhanced components.
 * Mirrors LifecycleMetricsDto.cs
 */
export interface LifecycleMetrics {
    // Timestamps
    createdAt: string;
    disposedAt: string | null;
    lifetimeMs: number | null;
    timeToFirstRenderMs: number | null;

    // Duration measurements - Last Call (ms)
    onInitializedDurationMs: number | null;
    onInitializedAsyncDurationMs: number | null;
    onParametersSetDurationMs: number | null;
    onParametersSetAsyncDurationMs: number | null;
    onAfterRenderDurationMs: number | null;
    onAfterRenderAsyncDurationMs: number | null;
    setParametersAsyncDurationMs: number | null;

    // Duration measurements - Cumulative Totals (ms)
    totalOnInitializedDurationMs: number;
    totalOnInitializedAsyncDurationMs: number;
    totalOnParametersSetDurationMs: number;
    totalOnParametersSetAsyncDurationMs: number;
    totalOnAfterRenderDurationMs: number;
    totalOnAfterRenderAsyncDurationMs: number;
    totalSetParametersAsyncDurationMs: number;

    // Duration measurements - Averages (ms)
    averageOnParametersSetDurationMs: number | null;
    averageOnAfterRenderDurationMs: number | null;

    // BuildRenderTree timing
    totalBuildRenderTreeDurationMs: number;
    lastBuildRenderTreeDurationMs: number | null;
    maxBuildRenderTreeDurationMs: number | null;
    minBuildRenderTreeDurationMs: number | null;
    averageBuildRenderTreeDurationMs: number | null;

    // EventCallback timing
    lastEventCallbackDurationMs: number | null;
    maxEventCallbackDurationMs: number | null;
    totalEventCallbackDurationMs: number;
    averageEventCallbackDurationMs: number | null;

    // Call counts
    onInitializedCallCount: number;
    onParametersSetCallCount: number;
    onAfterRenderCallCount: number;
    setParametersAsyncCallCount: number;
    buildRenderTreeCallCount: number;
    stateHasChangedCallCount: number;
    stateHasChangedPendingIgnoredCount: number;
    stateHasChangedShouldRenderIgnoredCount: number;
    stateHasChangedIgnoredCount: number;

    // ShouldRender tracking
    shouldRenderTrueCount: number;
    shouldRenderFalseCount: number;
    lastShouldRenderResult: boolean | null;

    // EventCallback tracking
    eventCallbackInvokedCount: number;

    // Computed metrics
    totalLifecycleTimeMs: number;
    renderEfficiencyPercent: number | null;
    shouldRenderBlockRatePercent: number | null;
    rendersPerMinute: number | null;
}

/**
 * Real-time lifecycle event pushed from .NET.
 * Mirrors LifecycleEvent.cs
 */
export interface LifecycleEvent {
    /** Component ID that generated this event */
    componentId: number;
    /** Short type name */
    componentType: string;
    /** Full type name */
    componentFullType: string | null;
    /** Event type (e.g., "Initialized", "BuildRenderTree") */
    eventType: string;
    /** Duration of the operation in milliseconds */
    durationMs: number;
    /** Unix timestamp in milliseconds */
    timestampMs: number;
    /** Additional event-specific data */
    data: unknown;
}

/**
 * Component counts summary.
 */
export interface ComponentCounts {
    /** Total components (resolved + pending) */
    total: number;
    /** Resolved components (have componentId) */
    resolved: number;
    /** Pending components (awaiting Pillar 3 resolution) */
    pending: number;
}