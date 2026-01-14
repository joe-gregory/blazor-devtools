// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - LifecycleEventType.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Type-safe enumeration of lifecycle event types using the sealed class pattern.
//   Provides compile-time safety while still serializing to strings for JS.
//
// ARCHITECTURE:
//   BlazorDevToolsComponentBase uses these values when calling PushEvent().
//   The implicit string conversion ensures JS receives clean string values.
//   Compile-time checking prevents typos in event type names.
//
// USAGE:
//   PushEvent(LifecycleEventType.Initialized, durationMs);  // ✅ Compile-time safe
//   PushEvent("initiallized", durationMs);                  // ❌ Won't compile
//
// DESIGN NOTES:
//   - Sealed class prevents inheritance
//   - Private constructor prevents external instantiation
//   - Static readonly fields act as enum values
//   - Implicit string conversion for seamless serialization
//   - All static members for lookup/filtering capabilities
//
// ═══════════════════════════════════════════════════════════════════════════════

namespace BlazorDeveloperTools;

/// <summary>
/// Type-safe lifecycle event type using sealed class pattern.
/// Provides compile-time safety with string serialization for JS.
/// </summary>
public sealed class LifecycleEventType : IEquatable<LifecycleEventType>
{
    // ═══════════════════════════════════════════════════════════════
    // COMPONENT LIFECYCLE
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Component was attached to the renderer (IComponent.Attach called).
    /// </summary>
    public static readonly LifecycleEventType Created = new("created");
    /// <summary>
    /// Component was disposed (IDisposable.Dispose called).
    /// </summary>
    public static readonly LifecycleEventType Disposed = new("disposed");

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION (first SetParametersAsync only)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// OnInitialized() completed.
    /// </summary>
    public static readonly LifecycleEventType Initialized = new("initialized");
    /// <summary>
    /// OnInitializedAsync() completed (includes async wait time).
    /// </summary>
    public static readonly LifecycleEventType InitializedAsync = new("initializedAsync");

    // ═══════════════════════════════════════════════════════════════
    // PARAMETERS (every SetParametersAsync call)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// OnParametersSet() completed.
    /// </summary>
    public static readonly LifecycleEventType ParametersSet = new("parametersSet");
    /// <summary>
    /// OnParametersSetAsync() completed (includes async wait time).
    /// </summary>
    public static readonly LifecycleEventType ParametersSetAsync = new("parametersSetAsync");

    // ═══════════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// ShouldRender() was evaluated. Data contains { result: true/false }.
    /// </summary>
    public static readonly LifecycleEventType ShouldRender = new("shouldRender");
    /// <summary>
    /// BuildRenderTree() completed. Data contains { isFirstRender: true/false }.
    /// </summary>
    public static readonly LifecycleEventType BuildRenderTree = new("buildRenderTree");

    // ═══════════════════════════════════════════════════════════════
    // POST-RENDER
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// OnAfterRender() completed. Data contains { firstRender: true/false }.
    /// </summary>
    public static readonly LifecycleEventType AfterRender = new("afterRender");
    /// <summary>
    /// OnAfterRenderAsync() completed. Data contains { firstRender: true/false }.
    /// </summary>
    public static readonly LifecycleEventType AfterRenderAsync = new("afterRenderAsync");

    // ═══════════════════════════════════════════════════════════════
    // STATE CHANGES
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// StateHasChanged() was called and resulted in a render being queued.
    /// </summary>
    public static readonly LifecycleEventType StateHasChanged = new("stateHasChanged");
    /// <summary>
    /// StateHasChanged() was called but no render occurred.
    /// Data contains { reason: "pendingRender" | "shouldRenderFalse" }.
    /// </summary>
    public static readonly LifecycleEventType StateHasChangedIgnored = new("stateHasChangedIgnored");

    // ═══════════════════════════════════════════════════════════════
    // EVENT CALLBACKS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// An EventCallback was invoked (e.g., button click handler).
    /// </summary>
    public static readonly LifecycleEventType EventCallback = new("eventCallback");

    // ═══════════════════════════════════════════════════════════════
    // ALL VALUES (for iteration/lookup)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// All defined lifecycle event types.
    /// </summary>
    public static readonly IReadOnlyList<LifecycleEventType> All = new[]
    {
        Created,
        Disposed,
        Initialized,
        InitializedAsync,
        ParametersSet,
        ParametersSetAsync,
        ShouldRender,
        BuildRenderTree,
        AfterRender,
        AfterRenderAsync,
        StateHasChanged,
        StateHasChangedIgnored,
        EventCallback
    };

    // ═══════════════════════════════════════════════════════════════
    // INSTANCE MEMBERS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// The string value sent to JavaScript.
    /// </summary>
    public string Value { get; }
    private LifecycleEventType(string value) => Value = value;

    // ═══════════════════════════════════════════════════════════════
    // CONVERSIONS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Implicit conversion to string for serialization and comparisons.
    /// </summary>
    public static implicit operator string(LifecycleEventType type) => type.Value;
    /// <summary>
    /// Returns the string value.
    /// </summary>
    public override string ToString() => Value;

    // ═══════════════════════════════════════════════════════════════
    // EQUALITY
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Type-safe equality comparison.
    /// </summary>
    public bool Equals(LifecycleEventType? other) => other is not null && Value == other.Value;
    /// <summary>
    /// Object equality (required override for Object.Equals contract).
    /// </summary>
    public override bool Equals(object? obj) => obj is LifecycleEventType other && Equals(other);
    /// <summary>
    /// Hash code based on Value.
    /// </summary>
    public override int GetHashCode() => Value.GetHashCode();
    /// <summary>
    /// Equality operator.
    /// </summary>
    public static bool operator ==(LifecycleEventType? left, LifecycleEventType? right) =>
        left is null ? right is null : left.Equals(right);
    /// <summary>
    /// Inequality operator.
    /// </summary>
    public static bool operator !=(LifecycleEventType? left, LifecycleEventType? right) =>
        !(left == right);
}