// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - ComponentInfoDto.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Data Transfer Objects for sending component information to JavaScript.
//   These classes are serialized to JSON and consumed by the browser extension.
//
// ARCHITECTURE:
//   BlazorDevToolsRegistry maps TrackedComponent → ComponentInfoDto for JS consumption.
//   The key distinction is HasEnhancedMetrics:
//   - true: BlazorDevToolsComponentBase, Metrics populated
//   - false: ComponentBase, Metrics null
//
// ═══════════════════════════════════════════════════════════════════════════════

namespace BlazorDeveloperTools;

/// <summary>
/// Component information sent to JavaScript.
/// </summary>
public class ComponentInfoDto
{
    // ═══════════════════════════════════════════════════════════════
    // IDENTITY
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Blazor-assigned component ID. -1 indicates a pending component
    /// (regular ComponentBase not yet resolved via Pillar 3).
    /// </summary>
    public int ComponentId { get; set; }
    public string TypeName { get; set; } = null!;
    public string? TypeFullName { get; set; }
    public string? SourceFile { get; set; }
    public int? LineNumber { get; set; }
    public int? ParentComponentId { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // RESOLUTION STATUS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// True if this component is pending (tracked by Activator but not yet
    /// resolved with a componentId). Pending components are regular ComponentBase
    /// instances that haven't been resolved via Pillar 3 (JS render batch interception).
    /// </summary>
    public bool IsPending => ComponentId < 0;

    // ═══════════════════════════════════════════════════════════════
    // RENDER TRACKING
    // ═══════════════════════════════════════════════════════════════
    public int RenderCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastRenderedAt { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // ENHANCED METRICS FLAG
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// True if component inherits from BlazorDevToolsComponentBase.
    /// When true, Metrics will be populated.
    /// </summary>
    public bool HasEnhancedMetrics { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // PARAMETERS & STATE
    // ═══════════════════════════════════════════════════════════════
    public List<ParameterDto>? Parameters { get; set; }
    public Dictionary<string, string?>? TrackedState { get; set; }
    public InternalStateDto? InternalState { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE METRICS (only for BlazorDevToolsComponentBase)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Detailed lifecycle metrics. NULL for regular ComponentBase components.
    /// </summary>
    public LifecycleMetricsDto? Metrics { get; set; }
}

/// <summary>
/// Parameter information for JavaScript.
/// </summary>
public class ParameterDto
{
    public string Name { get; set; } = null!;
    public string TypeName { get; set; } = null!;
    public string? Value { get; set; }
    public bool IsCascading { get; set; }
}

/// <summary>
/// ComponentBase internal state for JavaScript.
/// </summary>
public class InternalStateDto
{
    public bool HasNeverRendered { get; set; }
    public bool HasPendingQueuedRender { get; set; }
    public bool HasCalledOnAfterRender { get; set; }
    public bool IsInitialized { get; set; }
}

/// <summary>
/// Full lifecycle metrics for JavaScript.
/// All timing values are in milliseconds.
/// </summary>
public class LifecycleMetricsDto
{
    // ═══════════════════════════════════════════════════════════════
    // COMPONENT LIFETIME
    // ═══════════════════════════════════════════════════════════════
    public DateTime CreatedAt { get; set; }
    public DateTime? DisposedAt { get; set; }
    public double? LifetimeMs { get; set; }
    public double? TimeToFirstRenderMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE METHOD TIMING (Last Call)
    // ═══════════════════════════════════════════════════════════════
    public double? OnInitializedDurationMs { get; set; }
    public double? OnInitializedAsyncDurationMs { get; set; }
    public double? OnParametersSetDurationMs { get; set; }
    public double? OnParametersSetAsyncDurationMs { get; set; }
    public double? OnAfterRenderDurationMs { get; set; }
    public double? OnAfterRenderAsyncDurationMs { get; set; }
    public double? SetParametersAsyncDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE METHOD TIMING (Cumulative Totals)
    // ═══════════════════════════════════════════════════════════════
    public double TotalOnInitializedDurationMs { get; set; }
    public double TotalOnInitializedAsyncDurationMs { get; set; }
    public double TotalOnParametersSetDurationMs { get; set; }
    public double TotalOnParametersSetAsyncDurationMs { get; set; }
    public double TotalOnAfterRenderDurationMs { get; set; }
    public double TotalOnAfterRenderAsyncDurationMs { get; set; }
    public double TotalSetParametersAsyncDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE METHOD TIMING (Averages)
    // ═══════════════════════════════════════════════════════════════
    public double? AverageOnParametersSetDurationMs { get; set; }
    public double? AverageOnAfterRenderDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // RENDER TIMING
    // ═══════════════════════════════════════════════════════════════
    public double TotalBuildRenderTreeDurationMs { get; set; }
    public double? LastBuildRenderTreeDurationMs { get; set; }
    public double? MaxBuildRenderTreeDurationMs { get; set; }
    public double? MinBuildRenderTreeDurationMs { get; set; }
    public double? AverageBuildRenderTreeDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // EVENT CALLBACK TIMING
    // ═══════════════════════════════════════════════════════════════
    public double? LastEventCallbackDurationMs { get; set; }
    public double? MaxEventCallbackDurationMs { get; set; }
    public double TotalEventCallbackDurationMs { get; set; }
    public double? AverageEventCallbackDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // CALL COUNTS
    // ═══════════════════════════════════════════════════════════════
    public int OnInitializedCallCount { get; set; }
    public int OnParametersSetCallCount { get; set; }
    public int OnAfterRenderCallCount { get; set; }
    public int SetParametersAsyncCallCount { get; set; }
    public int BuildRenderTreeCallCount { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // STATEHASCHANGED TRACKING
    // ═══════════════════════════════════════════════════════════════
    public int StateHasChangedCallCount { get; set; }
    public int StateHasChangedPendingIgnoredCount { get; set; }
    public int StateHasChangedShouldRenderIgnoredCount { get; set; }
    public int StateHasChangedIgnoredCount { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // SHOULDRENDER TRACKING
    // ═══════════════════════════════════════════════════════════════
    public int ShouldRenderTrueCount { get; set; }
    public int ShouldRenderFalseCount { get; set; }
    public bool? LastShouldRenderResult { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // EVENT CALLBACK TRACKING
    // ═══════════════════════════════════════════════════════════════
    public int EventCallbackInvokedCount { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // COMPUTED STATISTICS
    // ═══════════════════════════════════════════════════════════════
    public double TotalLifecycleTimeMs { get; set; }
    public double? RenderEfficiencyPercent { get; set; }
    public double? ShouldRenderBlockRatePercent { get; set; }
    public double? RendersPerMinute { get; set; }
}