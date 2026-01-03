// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - BlazorDevToolsConfig.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Static configuration controlling BlazorDevToolsComponentBase behavior.
//   All settings are static so they apply globally across all component instances.
//
// ARCHITECTURE:
//   This is the "control panel" for the instrumentation system. Developers
//   configure these settings in Program.cs before the app starts, or they
//   can be changed at runtime (e.g., via a debug UI).
//
// USAGE:
//   // In Program.cs
//   BlazorDevToolsConfig.EnableEventPush = true;
//   BlazorDevToolsConfig.MinDurationToReportMs = 5;  // Only slow events
//   BlazorDevToolsConfig.ExcludedComponentTypes = new() { "CascadingValue" };
//   BlazorDevToolsConfig.EventTypeFilter = new()
//   {
//       LifecycleEventType.BuildRenderTree,
//       LifecycleEventType.StateHasChanged
//   };
//
// DESIGN NOTES:
//   - EnableTiming defaults to true in DEBUG, false in RELEASE
//   - EnableEventPush defaults to false (opt-in for JS communication)
//   - Filters allow reducing noise without disabling entirely
//   - MaxBufferedEvents handles prerendering scenarios
//
// ═══════════════════════════════════════════════════════════════════════════════

namespace BlazorDeveloperTools;

/// <summary>
/// Global configuration for BlazorDevToolsComponentBase.
/// </summary>
public static class BlazorDevToolsConfig
{
    // ═══════════════════════════════════════════════════════════════
    // CORE TOGGLES
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Enable/disable lifecycle timing measurement.
    /// When false, Stopwatch overhead is eliminated but metrics won't have timing data.
    /// Default: true in DEBUG, false in RELEASE.
    /// </summary>
    public static bool EnableTiming { get; set; }
#if DEBUG
        = true;
#else
        = false;
#endif
    /// <summary>
    /// Enable/disable pushing events to JavaScript.
    /// When false, events are still collected in Metrics but not pushed to JS.
    /// Default: false (opt-in).
    /// </summary>
    public static bool EnableEventPush { get; set; } = false;

    // ═══════════════════════════════════════════════════════════════
    // JS INTEROP SETTINGS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// JavaScript function to call for events.
    /// The browser extension or app JS should define this function.
    /// Default: "blazorDevTools.onEvent"
    /// </summary>
    public static string JsEventHandler { get; set; } = "blazorDevTools.onEvent";
    /// <summary>
    /// Maximum events to buffer if JS is not ready (e.g., during prerendering).
    /// Buffered events are flushed when JS becomes available.
    /// Set to 0 to disable buffering.
    /// Default: 100
    /// </summary>
    public static int MaxBufferedEvents { get; set; } = 100;

    // ═══════════════════════════════════════════════════════════════
    // FILTERING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Minimum duration (ms) to push an event. Events faster than this are skipped.
    /// Only applies to events with duration > 0 (e.g., BuildRenderTree, OnInitialized).
    /// Useful for reducing noise. Set to 0 to push all events.
    /// Default: 0 (all events)
    /// </summary>
    public static double MinDurationToReportMs { get; set; } = 0;
    /// <summary>
    /// Event types to push. Null = all events.
    /// Use this to focus on specific lifecycle events.
    /// Example: new() { LifecycleEventType.BuildRenderTree, LifecycleEventType.StateHasChanged }
    /// Default: null (all events)
    /// </summary>
    public static HashSet<LifecycleEventType>? EventTypeFilter { get; set; } = null;
    /// <summary>
    /// Component type names to exclude from event push.
    /// Useful for ignoring noisy framework components.
    /// Example: new() { "CascadingValue", "RouteView", "LayoutView" }
    /// Default: null (no exclusions)
    /// </summary>
    public static HashSet<string>? ExcludedComponentTypes { get; set; } = null;
}