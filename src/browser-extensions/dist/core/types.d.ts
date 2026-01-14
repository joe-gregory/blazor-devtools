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
    createdAt: string;
    disposedAt: string | null;
    lifetimeMs: number | null;
    timeToFirstRenderMs: number | null;
    onInitializedDurationMs: number | null;
    onInitializedAsyncDurationMs: number | null;
    onParametersSetDurationMs: number | null;
    onParametersSetAsyncDurationMs: number | null;
    onAfterRenderDurationMs: number | null;
    onAfterRenderAsyncDurationMs: number | null;
    setParametersAsyncDurationMs: number | null;
    totalOnInitializedDurationMs: number;
    totalOnInitializedAsyncDurationMs: number;
    totalOnParametersSetDurationMs: number;
    totalOnParametersSetAsyncDurationMs: number;
    totalOnAfterRenderDurationMs: number;
    totalOnAfterRenderAsyncDurationMs: number;
    totalSetParametersAsyncDurationMs: number;
    averageOnParametersSetDurationMs: number | null;
    averageOnAfterRenderDurationMs: number | null;
    totalBuildRenderTreeDurationMs: number;
    lastBuildRenderTreeDurationMs: number | null;
    maxBuildRenderTreeDurationMs: number | null;
    minBuildRenderTreeDurationMs: number | null;
    averageBuildRenderTreeDurationMs: number | null;
    lastEventCallbackDurationMs: number | null;
    maxEventCallbackDurationMs: number | null;
    totalEventCallbackDurationMs: number;
    averageEventCallbackDurationMs: number | null;
    onInitializedCallCount: number;
    onParametersSetCallCount: number;
    onAfterRenderCallCount: number;
    setParametersAsyncCallCount: number;
    buildRenderTreeCallCount: number;
    stateHasChangedCallCount: number;
    stateHasChangedPendingIgnoredCount: number;
    stateHasChangedShouldRenderIgnoredCount: number;
    stateHasChangedIgnoredCount: number;
    shouldRenderTrueCount: number;
    shouldRenderFalseCount: number;
    lastShouldRenderResult: boolean | null;
    eventCallbackInvokedCount: number;
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
/**
 * Types of events that can be recorded in the timeline.
 * Mirrors TimelineEventType enum in C#.
 */
export type TimelineEventType = 'OnInitialized' | 'OnInitializedAsync' | 'OnParametersSet' | 'OnParametersSetAsync' | 'SetParametersAsync' | 'BuildRenderTree' | 'OnAfterRender' | 'OnAfterRenderAsync' | 'Disposed' | 'ShouldRenderTrue' | 'ShouldRenderFalse' | 'StateHasChanged' | 'StateHasChangedIgnored' | 'EventCallbackInvoked' | 'RenderBatchStarted' | 'RenderBatchCompleted' | 'ComponentRendered' | 'CircuitOpened' | 'CircuitClosed' | 'NavigationStart' | 'NavigationEnd' | 'FirstRender';
/**
 * Reasons why a component rendered.
 * Mirrors RenderTriggerReason enum in C#.
 */
export type RenderTriggerReason = 'Unknown' | 'FirstRender' | 'ParameterChanged' | 'StateHasChangedCalled' | 'ParentRerendered' | 'EventCallbackInvoked' | 'CascadingValueChanged' | 'ExternalTrigger';
/**
 * A single event in the render timeline.
 * Mirrors TimelineEventDto in C#.
 */
export interface TimelineEvent {
    /** Sequential event ID (unique within recording session) */
    eventId: number;
    /** Milliseconds since recording started */
    relativeTimestampMs: number;
    /** Component ID (-1 for app-level events) */
    componentId: number;
    /** Component type name */
    componentName: string;
    /** Type of event */
    eventType: TimelineEventType;
    /** Duration in milliseconds (for events with duration) */
    durationMs: number | null;
    /** End timestamp relative to recording start */
    endRelativeTimestampMs: number | null;
    /** Parent event ID (e.g., the render batch this event belongs to) */
    parentEventId: number | null;
    /** Event ID that triggered this event */
    triggeringEventId: number | null;
    /** Human-readable reason for this event */
    triggerReason: RenderTriggerReason;
    /** Additional trigger details */
    triggerDetails: string | null;
    /** Whether this was an async operation */
    isAsync: boolean;
    /** Whether this is the component's first render */
    isFirstRender: boolean;
    /** Whether this event represents a skipped render */
    wasSkipped: boolean;
    /** Whether this component inherits from BlazorDevToolsComponentBase */
    isEnhanced: boolean;
    /** Render batch ID this event belongs to */
    batchId: number | null;
    /** Additional metadata */
    metadata: Record<string, string> | null;
}
/**
 * A render batch containing multiple component renders.
 * Mirrors RenderBatchDto in C#.
 */
export interface RenderBatch {
    /** Batch ID */
    batchId: number;
    /** Start time relative to recording start (ms) */
    startRelativeMs: number;
    /** End time relative to recording start (ms) */
    endRelativeMs: number | null;
    /** Duration of the batch (ms) */
    durationMs: number | null;
    /** Number of components in this batch */
    componentCount: number;
    /** Component IDs that rendered in this batch */
    componentIds: number[];
    /** What triggered this batch */
    triggerSource: string | null;
}
/**
 * Component ranking by render time.
 * Mirrors ComponentRankingDto in C#.
 */
export interface ComponentRanking {
    /** Component ID */
    componentId: number;
    /** Component type name */
    componentName: string;
    /** Total time spent rendering this component (ms) */
    totalRenderTimeMs: number;
    /** Number of times this component rendered */
    renderCount: number;
    /** Average render time (ms) */
    averageRenderTimeMs: number;
    /** Maximum render time (ms) */
    maxRenderTimeMs: number;
    /** Minimum render time (ms) */
    minRenderTimeMs: number;
}
/**
 * Current state of the timeline recorder.
 * Mirrors RecordingState in C#.
 */
export interface RecordingState {
    /** Whether recording is active */
    isRecording: boolean;
    /** When recording started (ISO string) */
    recordingStartedAt: string | null;
    /** Total recording duration (ms) */
    recordingDurationMs: number;
    /** Number of events recorded */
    eventCount: number;
    /** Number of batches recorded */
    batchCount: number;
    /** Maximum events to retain */
    maxEvents: number;
}
/**
 * Event type metadata for UI rendering.
 */
export interface EventTypeConfig {
    /** Display name */
    label: string;
    /** CSS color class or hex color */
    color: string;
    /** Icon or symbol */
    icon: string;
    /** Category for grouping */
    category: 'lifecycle' | 'render' | 'state' | 'batch' | 'app';
}
/**
 * Configuration for event type display.
 */
export declare const EVENT_TYPE_CONFIG: Record<TimelineEventType, EventTypeConfig>;
//# sourceMappingURL=types.d.ts.map