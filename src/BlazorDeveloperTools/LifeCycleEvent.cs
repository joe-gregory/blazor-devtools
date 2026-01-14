// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - LifecycleEvent.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Data transfer object sent to JavaScript when a lifecycle event occurs.
//   This is the payload that the browser extension receives for real-time
//   component monitoring.
//
// ARCHITECTURE:
//   BlazorDevToolsComponentBase creates LifecycleEvent instances and pushes
//   them to JS via IJSRuntime. The browser extension receives these and can:
//   - Display them in real-time
//   - Store them for recording sessions
//   - Analyze performance patterns
//
// DATA FLOW:
//   BlazorDevToolsComponentBase
//       └──► PushEvent(LifecycleEventType.Initialized, ...)
//           └──► Creates LifecycleEvent (LifecycleEventType implicitly converts to string)
//               └──► IJSRuntime.InvokeVoidAsync("blazorDevTools.onEvent", event)
//                   └──► Browser Extension receives JSON:
//                        {
//                            componentId: 5,
//                            componentType: "Counter",
//                            eventType: "initialized",
//                            durationMs: 1.23,
//                            timestampMs: 1705312345678,
//                            data: { isFirstRender: true }
//                        }
//
// DESIGN NOTES:
//   - Uses 'init' properties for immutability after creation
//   - EventType is string for JSON serialization (LifecycleEventType has implicit conversion)
//   - TimestampMs is Unix milliseconds for easy JS Date compatibility
//   - DurationMs is double for sub-millisecond precision
//   - Data is object? to allow flexible event-specific payloads
//
// ═══════════════════════════════════════════════════════════════════════════════

namespace BlazorDeveloperTools;

/// <summary>
/// Event data pushed to JavaScript when a lifecycle event occurs.
/// Designed for efficient JSON serialization.
/// </summary>
public class LifecycleEvent
{
    /// <summary>
    /// Component's Blazor-assigned ID. Unique within a circuit/session.
    /// </summary>
    public int ComponentId { get; init; }
    /// <summary>
    /// Component type name (e.g., "Counter").
    /// </summary>
    public string ComponentType { get; init; } = null!;
    /// <summary>
    /// Full type name including namespace (e.g., "MyApp.Components.Counter").
    /// </summary>
    public string? ComponentFullType { get; init; }
    /// <summary>
    /// Type of lifecycle event (e.g., "initialized", "buildRenderTree").
    /// LifecycleEventType implicitly converts to string when assigned.
    /// </summary>
    public string EventType { get; init; } = null!;
    /// <summary>
    /// Duration in milliseconds (0 for instantaneous events like Created/Disposed).
    /// </summary>
    public double DurationMs { get; init; }
    /// <summary>
    /// Unix timestamp in milliseconds. Use in JS: new Date(timestampMs).
    /// </summary>
    public long TimestampMs { get; init; }
    /// <summary>
    /// Optional additional data specific to the event type.
    /// Examples:
    /// - BuildRenderTree: { isFirstRender: true }
    /// - AfterRender: { firstRender: true }
    /// - ShouldRender: { result: true }
    /// - StateHasChangedIgnored: { reason: "pendingRender" }
    /// </summary>
    public object? Data { get; init; }
}