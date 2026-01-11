// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - LifecycleMetrics.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Stores all performance metrics collected by BlazorDevToolsComponentBase.
//   Each component instance has its own LifecycleMetrics object that accumulates
//   timing and count data throughout the component's lifetime.
//
// ARCHITECTURE:
//   - BlazorDevToolsComponentBase creates a LifecycleMetrics instance in its constructor
//   - Each lifecycle method updates the relevant metrics
//   - BlazorDevToolsRegistry can read these metrics (Metrics property is public)
//   - JS can poll for metrics via [JSInvokable] methods in BlazorDevToolsRegistry
//   - Real-time events also include duration from these metrics
//
// DATA FLOW:
//   BlazorDevToolsComponentBase.OnInitialized()
//       └──► Stopwatch.Start()
//       └──► base.OnInitialized()
//       └──► Stopwatch.Stop()
//       └──► Metrics.OnInitializedDurationMs = elapsed
//       └──► PushEvent() includes duration
//
// DESIGN NOTES:
//   - All timing values are in milliseconds (double) for JS compatibility
//   - Nullable doubles (double?) indicate "not yet recorded"
//   - Computed properties (e.g., AverageBuildRenderTreeDurationMs) are read-only
//   - This class is ONLY populated for BlazorDevToolsComponentBase components
//   - Regular ComponentBase components have null Metrics in TrackedComponent
//
// ═══════════════════════════════════════════════════════════════════════════════

namespace BlazorDeveloperTools;

/// <summary>
/// Performance metrics collected by BlazorDevToolsComponentBase.
/// All timing values are in milliseconds for easy JS serialization.
/// </summary>
public class LifecycleMetrics
{
    // ═══════════════════════════════════════════════════════════════
    // COMPONENT LIFETIME
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// When this component instance was created (constructor ran).
    /// </summary>
    public DateTime CreatedAt { get; set; }
    /// <summary>
    /// When this component instance was disposed. Null if still alive.
    /// </summary>
    public DateTime? DisposedAt { get; set; }
    /// <summary>
    /// Total lifetime of the component from creation to disposal (ms).
    /// Null if not yet disposed.
    /// </summary>
    public double? LifetimeMs => DisposedAt.HasValue
        ? (DisposedAt.Value - CreatedAt).TotalMilliseconds
        : null;
    /// <summary>
    /// Time from creation to first render (ms).
    /// Measures how long before the component produced visible output.
    /// </summary>
    public double? TimeToFirstRenderMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION TIMING (first SetParametersAsync only)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Most recent OnInitialized() duration (ms).
    /// </summary>
    public double? OnInitializedDurationMs { get; set; }
    /// <summary>
    /// Total accumulated OnInitialized() time (ms). Usually same as last since it's called once.
    /// </summary>
    public double TotalOnInitializedDurationMs { get; set; }
    /// <summary>
    /// Most recent OnInitializedAsync() duration including async work (ms).
    /// </summary>
    public double? OnInitializedAsyncDurationMs { get; set; }
    /// <summary>
    /// Total accumulated OnInitializedAsync() time (ms). Usually same as last since it's called once.
    /// </summary>
    public double TotalOnInitializedAsyncDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // PARAMETER TIMING (every SetParametersAsync call)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Most recent OnParametersSet() duration (ms).
    /// </summary>
    public double? OnParametersSetDurationMs { get; set; }
    /// <summary>
    /// Total accumulated OnParametersSet() time across all calls (ms).
    /// </summary>
    public double TotalOnParametersSetDurationMs { get; set; }
    /// <summary>
    /// Most recent OnParametersSetAsync() duration including async work (ms).
    /// </summary>
    public double? OnParametersSetAsyncDurationMs { get; set; }
    /// <summary>
    /// Total accumulated OnParametersSetAsync() time across all calls (ms).
    /// </summary>
    public double TotalOnParametersSetAsyncDurationMs { get; set; }
    /// <summary>
    /// Most recent SetParametersAsync() total duration (ms).
    /// Includes OnInitialized + OnParametersSet on first call.
    /// </summary>
    public double? SetParametersAsyncDurationMs { get; set; }
    /// <summary>
    /// Total accumulated SetParametersAsync() time across all calls (ms).
    /// </summary>
    public double TotalSetParametersAsyncDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // RENDER TIMING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Total accumulated BuildRenderTree time across all renders (ms).
    /// </summary>
    public double TotalBuildRenderTreeDurationMs { get; set; }
    /// <summary>
    /// Most recent BuildRenderTree duration (ms).
    /// </summary>
    public double? LastBuildRenderTreeDurationMs { get; set; }
    /// <summary>
    /// When BuildRenderTree was last called. Used for "Last Rendered" display.
    /// </summary>
    public DateTime? LastBuildRenderTreeAt { get; set; }
    /// <summary>
    /// Slowest BuildRenderTree call (ms). Useful for spotting outliers.
    /// </summary>
    public double? MaxBuildRenderTreeDurationMs { get; set; }
    /// <summary>
    /// Fastest BuildRenderTree call (ms).
    /// </summary>
    public double? MinBuildRenderTreeDurationMs { get; set; }
    /// <summary>
    /// Average BuildRenderTree duration (ms). Computed from total / count.
    /// </summary>
    public double? AverageBuildRenderTreeDurationMs =>
        BuildRenderTreeCallCount > 0
            ? TotalBuildRenderTreeDurationMs / BuildRenderTreeCallCount
            : null;

    // ═══════════════════════════════════════════════════════════════
    // POST-RENDER TIMING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Most recent OnAfterRender() duration (ms).
    /// </summary>
    public double? OnAfterRenderDurationMs { get; set; }
    /// <summary>
    /// Total accumulated OnAfterRender() time across all calls (ms).
    /// </summary>
    public double TotalOnAfterRenderDurationMs { get; set; }
    /// <summary>
    /// Most recent OnAfterRenderAsync() duration including async work (ms).
    /// </summary>
    public double? OnAfterRenderAsyncDurationMs { get; set; }
    /// <summary>
    /// Total accumulated OnAfterRenderAsync() time across all calls (ms).
    /// </summary>
    public double TotalOnAfterRenderAsyncDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // EVENT CALLBACK TIMING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Most recent EventCallback handler duration (ms).
    /// </summary>
    public double? LastEventCallbackDurationMs { get; set; }
    /// <summary>
    /// Slowest EventCallback handler (ms).
    /// </summary>
    public double? MaxEventCallbackDurationMs { get; set; }
    /// <summary>
    /// Total accumulated EventCallback handler time across all invocations (ms).
    /// </summary>
    public double TotalEventCallbackDurationMs { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE METHOD CALL COUNTS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Number of times OnInitialized() was called. Should be 0 or 1.
    /// </summary>
    public int OnInitializedCallCount { get; set; }
    /// <summary>
    /// Number of times OnParametersSet() was called.
    /// First call is after OnInitialized, subsequent calls when parent re-renders.
    /// </summary>
    public int OnParametersSetCallCount { get; set; }
    /// <summary>
    /// Number of times OnAfterRender() was called.
    /// </summary>
    public int OnAfterRenderCallCount { get; set; }
    /// <summary>
    /// Number of times SetParametersAsync() was called.
    /// </summary>
    public int SetParametersAsyncCallCount { get; set; }
    /// <summary>
    /// Number of times BuildRenderTree() was called (actual renders).
    /// Compare with StateHasChangedCallCount to measure efficiency.
    /// </summary>
    public int BuildRenderTreeCallCount { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // STATEHASCHANGED TRACKING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Total number of times StateHasChanged() was called.
    /// </summary>
    public int StateHasChangedCallCount { get; set; }
    /// <summary>
    /// Number of times StateHasChanged() was ignored because _hasPendingQueuedRender was true.
    /// Indicates rapid successive calls to StateHasChanged.
    /// </summary>
    public int StateHasChangedPendingIgnoredCount { get; set; }
    /// <summary>
    /// Number of times StateHasChanged() was ignored because ShouldRender() returned false.
    /// Indicates effective use of ShouldRender optimization.
    /// </summary>
    public int StateHasChangedShouldRenderIgnoredCount { get; set; }
    /// <summary>
    /// Total ignored StateHasChanged calls (pending + shouldRender).
    /// </summary>
    public int StateHasChangedIgnoredCount =>
        StateHasChangedPendingIgnoredCount + StateHasChangedShouldRenderIgnoredCount;

    // ═══════════════════════════════════════════════════════════════
    // SHOULDRENDER TRACKING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Number of times ShouldRender() returned true (render allowed).
    /// </summary>
    public int ShouldRenderTrueCount { get; set; }
    /// <summary>
    /// Number of times ShouldRender() returned false (render blocked).
    /// </summary>
    public int ShouldRenderFalseCount { get; set; }
    /// <summary>
    /// Most recent ShouldRender() return value.
    /// </summary>
    public bool? LastShouldRenderResult { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // EVENT CALLBACK TRACKING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Number of EventCallbacks invoked on this component (e.g., button clicks).
    /// </summary>
    public int EventCallbackInvokedCount { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // COMPUTED STATISTICS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Total lifecycle time (ms) = cumulative init + params + render + afterRender.
    /// Represents total time spent in all lifecycle methods for this component.
    /// </summary>
    public double TotalLifecycleTimeMs =>
        TotalOnInitializedDurationMs +
        TotalOnInitializedAsyncDurationMs +
        TotalOnParametersSetDurationMs +
        TotalOnParametersSetAsyncDurationMs +
        TotalBuildRenderTreeDurationMs +
        TotalOnAfterRenderDurationMs +
        TotalOnAfterRenderAsyncDurationMs;

    /// <summary>
    /// Average OnParametersSet() duration (ms).
    /// </summary>
    public double? AverageOnParametersSetDurationMs =>
        OnParametersSetCallCount > 0
            ? TotalOnParametersSetDurationMs / OnParametersSetCallCount
            : null;

    /// <summary>
    /// Average OnAfterRender() duration (ms).
    /// </summary>
    public double? AverageOnAfterRenderDurationMs =>
        OnAfterRenderCallCount > 0
            ? TotalOnAfterRenderDurationMs / OnAfterRenderCallCount
            : null;

    /// <summary>
    /// Average EventCallback duration (ms).
    /// </summary>
    public double? AverageEventCallbackDurationMs =>
        EventCallbackInvokedCount > 0
            ? TotalEventCallbackDurationMs / EventCallbackInvokedCount
            : null;
    /// <summary>
    /// Percentage of StateHasChanged calls that resulted in actual renders.
    /// 100% = every call rendered. Lower values indicate either:
    /// - Wasted StateHasChanged calls (bad)
    /// - Effective ShouldRender blocking (good)
    /// Check ShouldRenderFalseCount to distinguish.
    /// </summary>
    public double? RenderEfficiencyPercent =>
        StateHasChangedCallCount > 0
            ? (double)BuildRenderTreeCallCount / StateHasChangedCallCount * 100
            : null;
    /// <summary>
    /// Percentage of ShouldRender calls that returned false.
    /// Higher = more renders blocked. Good if intentional optimization.
    /// </summary>
    public double? ShouldRenderBlockRatePercent
    {
        get
        {
            var total = ShouldRenderTrueCount + ShouldRenderFalseCount;
            return total > 0
                ? (double)ShouldRenderFalseCount / total * 100
                : null;
        }
    }
    /// <summary>
    /// Renders per minute based on elapsed time since creation.
    /// Useful for detecting components that re-render excessively.
    /// </summary>
    public double? RendersPerMinute
    {
        get
        {
            var endTime = DisposedAt ?? DateTime.UtcNow;
            var elapsed = (endTime - CreatedAt).TotalMinutes;
            return elapsed > 0
                ? BuildRenderTreeCallCount / elapsed
                : null;
        }
    }
}