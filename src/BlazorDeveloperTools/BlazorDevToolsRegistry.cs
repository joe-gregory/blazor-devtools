// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - BlazorDevToolsRegistry.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Central registry that tracks all Blazor components within a single circuit.
//   Provides data to JavaScript via [JSInvokable] instance methods through a
//   DotNetObjectReference, ensuring circuit isolation.
//
// ARCHITECTURE:
//   This is the core of Pillar 2 (Runtime Tracking). The registry is SCOPED,
//   meaning each circuit gets its own instance. This solves the multi-circuit
//   isolation problem in Blazor Server.
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ Circuit A (Scope A)                Circuit B (Scope B)                  │
//   │ ┌─────────────────────┐            ┌─────────────────────┐              │
//   │ │ Registry A          │            │ Registry B          │              │
//   │ │ ├─ Circuit.Id: "abc"│            │ ├─ Circuit.Id: "xyz"│              │
//   │ │ ├─ Components: {...}│            │ ├─ Components: {...}│              │
//   │ │ └─ DotNetRef ───────┼──► JS A    │ └─ DotNetRef ───────┼──► JS B      │
//   │ └─────────────────────┘            └─────────────────────┘              │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// LIFECYCLE:
//   1. Circuit opens → BlazorDevToolsCircuitHandler creates scope
//   2. Registry instantiated (scoped) with IJSRuntime injected
//   3. CircuitHandler calls InitializeJsAsync() → JS receives DotNetObjectReference
//   4. Activator registers components → stored in this registry
//   5. JS queries via dotNetRef.invokeMethodAsync() → routed to this instance
//   6. Circuit closes → DotNetObjectReference disposed, registry garbage collected
//
// REGISTRATION:
//   services.AddScoped<BlazorDevToolsRegistry>();
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Server.Circuits;
using Microsoft.JSInterop;
using System.Collections.Concurrent;
using System.Runtime.CompilerServices;

namespace BlazorDeveloperTools;

/// <summary>
/// Central registry for tracking all Blazor components within a circuit.
/// Scoped service - one instance per circuit for proper isolation.
/// </summary>
public class BlazorDevToolsRegistry : IDisposable
{
    // ═══════════════════════════════════════════════════════════════
    // DEPENDENCIES
    // ═══════════════════════════════════════════════════════════════
    private readonly IJSRuntime _js;
    private DotNetObjectReference<BlazorDevToolsRegistry>? _dotNetRef;
    private bool _jsInitialized;
    private bool _disposed;

    // ═══════════════════════════════════════════════════════════════
    // CIRCUIT REFERENCE
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// The Blazor circuit this registry belongs to.
    /// Set by BlazorDevToolsCircuitHandler.OnCircuitOpenedAsync().
    /// Provides access to circuit metadata for debugging and logging.
    /// </summary>
    public Circuit? Circuit { get; internal set; }
    /// <summary>
    /// The unique identifier of the circuit. Null if circuit not yet assigned.
    /// Useful for debugging multi-circuit scenarios.
    /// </summary>
    public string? CircuitId => Circuit?.Id;

    // ═══════════════════════════════════════════════════════════════
    // COMPONENT STORAGE
    // ═══════════════════════════════════════════════════════════════
    // ConditionalWeakTable allows GC to collect disposed components.
    // ConcurrentDictionary for thread-safe ID-based lookup.
    private readonly ConditionalWeakTable<IComponent, PendingComponent> _pendingComponents = new();
    private readonly ConditionalWeakTable<IComponent, TrackedComponent> _componentsByInstance = new();
    private readonly ConcurrentDictionary<int, TrackedComponent> _componentsById = new();

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Creates a new registry instance. IJSRuntime is scoped to the same circuit,
    /// ensuring JS calls are routed to the correct browser tab.
    /// </summary>
    /// <param name="js">The JavaScript runtime for this circuit.</param>
    public BlazorDevToolsRegistry(IJSRuntime js)
    {
        _js = js;
    }

    // ═══════════════════════════════════════════════════════════════
    // JS INITIALIZATION
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Initializes the JavaScript bridge by passing a DotNetObjectReference to JS.
    /// Called by BlazorDevToolsCircuitHandler when the circuit opens.
    /// After this call, JS can invoke [JSInvokable] methods on this specific instance,
    /// ensuring all queries are scoped to the correct circuit.
    /// </summary>
    public async Task InitializeJsAsync()
    {
        if (_jsInitialized) return;
        try
        {
            _dotNetRef = DotNetObjectReference.Create(this);
            await _js.InvokeVoidAsync("blazorDevTools.initialize", _dotNetRef);
            _jsInitialized = true;
#if DEBUG
            Console.WriteLine($"[BDT] JS initialized for circuit: {CircuitId}");
#endif
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT] JS initialization failed: {ex.Message}");
#endif
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // COMPONENT REGISTRATION (called from BlazorDevToolsComponentActivator)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Registers a newly created component before it has a componentId.
    /// Called by BlazorDevToolsComponentActivator.CreateInstance() immediately
    /// after component instantiation. The component is stored in a pending state
    /// until ResolveComponentId() is called after Attach() provides the ID.
    /// </summary>
    /// <param name="component">The component instance just created by the activator.</param>
    public void RegisterPendingComponent(IComponent component)
    {
        PendingComponent pending = new()
        {
            Instance = component,
            TypeName = component.GetType().Name,
            TypeFullName = component.GetType().FullName,
            CreatedAt = DateTime.UtcNow,
            IsEnhanced = component is BlazorDevToolsComponentBase
        };
        _pendingComponents.AddOrUpdate(component, pending);
#if DEBUG
        Console.WriteLine($"[BDT] Registered pending: {pending.TypeName} (Enhanced: {pending.IsEnhanced}, Circuit: {CircuitId})");
#endif
    }

    /// <summary>
    /// Resolves a pending component to its componentId after IComponent.Attach().
    /// For BlazorDevToolsComponentBase, this is called automatically from Attach().
    /// For regular ComponentBase, this would be called via JS render batch interception.
    /// Moves the component from pending storage to full ID-based tracking.
    /// </summary>
    /// <param name="component">The component instance.</param>
    /// <param name="componentId">The Blazor-assigned component ID from RenderHandle.</param>
    public void ResolveComponentId(IComponent component, int componentId)
    {
        if (!_pendingComponents.TryGetValue(component, out PendingComponent? pending)) return;
        TrackedComponent tracked = CreateTrackedComponent(component, componentId, pending);
        _componentsByInstance.AddOrUpdate(component, tracked);
        _componentsById[componentId] = tracked;
        _pendingComponents.Remove(component);
#if DEBUG
        Console.WriteLine($"[BDT] Resolved: {tracked.TypeName} → ID {componentId} (Circuit: {CircuitId})");
#endif
    }

    // ═══════════════════════════════════════════════════════════════
    // TRACKED COMPONENT CREATION
    // ═══════════════════════════════════════════════════════════════
    private TrackedComponent CreateTrackedComponent(IComponent component, int componentId, PendingComponent pending)
    {
        TrackedComponent tracked = new()
        {
            Instance = component,
            ComponentId = componentId,
            TypeName = pending.TypeName,
            TypeFullName = pending.TypeFullName,
            CreatedAt = pending.CreatedAt,
            HasEnhancedMetrics = pending.IsEnhanced
        };
        tracked.Parameters = ComponentReflectionHelper.ExtractParameters(component);
        tracked.TrackedState = ComponentReflectionHelper.ExtractTrackedState(component);
        if (component is BlazorDevToolsComponentBase enhanced)
        {
            tracked.InternalState = new ComponentBaseInternalState
            {
                HasNeverRendered = enhanced.HasNeverRendered,
                HasPendingQueuedRender = enhanced.HasPendingQueuedRender,
                HasCalledOnAfterRender = enhanced.HasCalledOnAfterRender,
                IsInitialized = enhanced.IsInitialized
            };
            tracked.Metrics = enhanced.Metrics;
        }
        else
        {
            tracked.InternalState = ComponentReflectionHelper.ExtractComponentBaseState(component);
            tracked.Metrics = null;
        }
        return tracked;
    }

    // ═══════════════════════════════════════════════════════════════
    // RENDER TRACKING (called from JS render batch interception)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Records that a component was rendered. Called from JavaScript when
    /// render batch interception (Pillar 3) detects a component render.
    /// Updates render count and refreshes internal state snapshot.
    /// </summary>
    /// <param name="componentId">The Blazor component ID that rendered.</param>
    [JSInvokable]
    public void RecordRenderFromJs(int componentId)
    {
        if (!_componentsById.TryGetValue(componentId, out TrackedComponent? tracked)) return;
        tracked.RenderCount++;
        tracked.LastRenderedAt = DateTime.UtcNow;
        RefreshInternalState(tracked);
    }

    private void RefreshInternalState(TrackedComponent tracked)
    {
        if (tracked.Instance is BlazorDevToolsComponentBase enhanced)
        {
            tracked.InternalState = new ComponentBaseInternalState
            {
                HasNeverRendered = enhanced.HasNeverRendered,
                HasPendingQueuedRender = enhanced.HasPendingQueuedRender,
                HasCalledOnAfterRender = enhanced.HasCalledOnAfterRender,
                IsInitialized = enhanced.IsInitialized
            };
        }
        else
        {
            tracked.InternalState = ComponentReflectionHelper.ExtractComponentBaseState(tracked.Instance);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // JSINVOKABLE QUERY METHODS
    // ═══════════════════════════════════════════════════════════════
    // These are INSTANCE methods invoked via DotNetObjectReference,
    // ensuring they execute on the correct circuit's registry.
    // This is how JS queries are routed to the right scoped instance.

    /// <summary>
    /// Gets all tracked components as DTOs for JavaScript.
    /// Called via DotNetObjectReference to ensure circuit isolation.
    /// Returns data for the DevTools panel component tree.
    /// Includes both fully resolved components and pending components.
    /// </summary>
    /// <returns>List of component information for the DevTools UI.</returns>
    [JSInvokable]
    public List<ComponentInfoDto> GetAllComponentsDto()
    {
        List<ComponentInfoDto> result = new();
        // Add fully resolved components (have componentId)
        foreach (KeyValuePair<int, TrackedComponent> kvp in _componentsById)
        {
            ComponentInfoDto? dto = MapToDto(kvp.Value);
            if (dto != null) result.Add(dto);
        }
        // Add pending components (no componentId yet - regular ComponentBase)
        foreach (KeyValuePair<IComponent, PendingComponent> kvp in _pendingComponents)
        {
            ComponentInfoDto dto = MapPendingToDto(kvp.Value);
            result.Add(dto);
        }
        return result;
    }

    /// <summary>
    /// Gets count of all components (resolved + pending).
    /// </summary>
    /// <returns>Total component count.</returns>
    [JSInvokable]
    public int GetComponentCount()
    {
        int pendingCount = 0;
        foreach (KeyValuePair<IComponent, PendingComponent> _ in _pendingComponents)
        {
            pendingCount++;
        }
        return _componentsById.Count + pendingCount;
    }

    /// <summary>
    /// Gets count of resolved components only (have componentId).
    /// </summary>
    /// <returns>Resolved component count.</returns>
    [JSInvokable]
    public int GetResolvedComponentCount()
    {
        return _componentsById.Count;
    }

    /// <summary>
    /// Gets count of pending components (no componentId yet).
    /// These are regular ComponentBase components not yet resolved via Pillar 3.
    /// </summary>
    /// <returns>Pending component count.</returns>
    [JSInvokable]
    public int GetPendingComponentCount()
    {
        int count = 0;
        foreach (KeyValuePair<IComponent, PendingComponent> _ in _pendingComponents)
        {
            count++;
        }
        return count;
    }

    /// <summary>
    /// Gets a single component's detailed info by ID.
    /// Called via DotNetObjectReference to ensure circuit isolation.
    /// Refreshes internal state before returning for accurate snapshot.
    /// </summary>
    /// <param name="componentId">The Blazor component ID.</param>
    /// <returns>Component information or null if not found.</returns>
    [JSInvokable]
    public ComponentInfoDto? GetComponentInfo(int componentId)
    {
        if (!_componentsById.TryGetValue(componentId, out TrackedComponent? tracked)) return null;
        RefreshInternalState(tracked);
        return MapToDto(tracked);
    }

    /// <summary>
    /// Gets the circuit ID this registry belongs to.
    /// Useful for debugging and verifying correct circuit routing in JS.
    /// </summary>
    /// <returns>The circuit ID or null if not yet assigned.</returns>
    [JSInvokable]
    public string? GetCircuitId()
    {
        return CircuitId;
    }

    /// <summary>
    /// Gets all tracked components for internal .NET use.
    /// Not exposed to JS - use GetAllComponentsDto() for that.
    /// </summary>
    public IEnumerable<TrackedComponent> GetAllComponents()
    {
        return _componentsById.Values;
    }

    // ═══════════════════════════════════════════════════════════════
    // DTO MAPPING
    // ═══════════════════════════════════════════════════════════════
    private static ComponentInfoDto? MapToDto(TrackedComponent tracked)
    {
        if (tracked.Instance == null) return null;
        ComponentInfoDto dto = new()
        {
            ComponentId = tracked.ComponentId,
            TypeName = tracked.TypeName,
            TypeFullName = tracked.TypeFullName,
            SourceFile = tracked.SourceFile,
            LineNumber = tracked.LineNumber,
            ParentComponentId = tracked.ParentComponentId,
            RenderCount = tracked.RenderCount,
            CreatedAt = tracked.CreatedAt,
            LastRenderedAt = tracked.LastRenderedAt,
            HasEnhancedMetrics = tracked.HasEnhancedMetrics,
            Parameters = tracked.Parameters?.Select(p => new ParameterDto
            {
                Name = p.Name,
                TypeName = p.TypeName,
                Value = p.Value?.ToString(),
                IsCascading = p.IsCascading
            }).ToList(),
            TrackedState = tracked.TrackedState,
            InternalState = tracked.InternalState != null ? new InternalStateDto
            {
                HasNeverRendered = tracked.InternalState.HasNeverRendered,
                HasPendingQueuedRender = tracked.InternalState.HasPendingQueuedRender,
                HasCalledOnAfterRender = tracked.InternalState.HasCalledOnAfterRender,
                IsInitialized = tracked.InternalState.IsInitialized
            } : null
        };
        if (tracked.HasEnhancedMetrics && tracked.Metrics != null)
        {
            dto.Metrics = MapMetricsToDto(tracked.Metrics);
        }
        return dto;
    }

    /// <summary>
    /// Maps a pending component (no componentId yet) to a DTO.
    /// These are regular ComponentBase components tracked by the Activator
    /// but not yet resolved via Pillar 3 (JS render batch interception).
    /// </summary>
    private static ComponentInfoDto MapPendingToDto(PendingComponent pending)
    {
        return new ComponentInfoDto
        {
            ComponentId = -1,// Sentinel value indicating "pending"
            TypeName = pending.TypeName,
            TypeFullName = pending.TypeFullName,
            SourceFile = null,
            LineNumber = null,
            ParentComponentId = null,
            RenderCount = 0,
            CreatedAt = pending.CreatedAt,
            LastRenderedAt = null,
            HasEnhancedMetrics = pending.IsEnhanced,
            Parameters = null,// Would need reflection to extract
            TrackedState = null,
            InternalState = null,
            Metrics = null
        };
    }

    private static LifecycleMetricsDto MapMetricsToDto(LifecycleMetrics metrics)
    {
        return new LifecycleMetricsDto
        {
            CreatedAt = metrics.CreatedAt,
            DisposedAt = metrics.DisposedAt,
            LifetimeMs = metrics.LifetimeMs,
            TimeToFirstRenderMs = metrics.TimeToFirstRenderMs,
            OnInitializedDurationMs = metrics.OnInitializedDurationMs,
            OnInitializedAsyncDurationMs = metrics.OnInitializedAsyncDurationMs,
            OnParametersSetDurationMs = metrics.OnParametersSetDurationMs,
            OnParametersSetAsyncDurationMs = metrics.OnParametersSetAsyncDurationMs,
            OnAfterRenderDurationMs = metrics.OnAfterRenderDurationMs,
            OnAfterRenderAsyncDurationMs = metrics.OnAfterRenderAsyncDurationMs,
            SetParametersAsyncDurationMs = metrics.SetParametersAsyncDurationMs,
            TotalBuildRenderTreeDurationMs = metrics.TotalBuildRenderTreeDurationMs,
            LastBuildRenderTreeDurationMs = metrics.LastBuildRenderTreeDurationMs,
            MaxBuildRenderTreeDurationMs = metrics.MaxBuildRenderTreeDurationMs,
            MinBuildRenderTreeDurationMs = metrics.MinBuildRenderTreeDurationMs,
            AverageBuildRenderTreeDurationMs = metrics.AverageBuildRenderTreeDurationMs,
            LastEventCallbackDurationMs = metrics.LastEventCallbackDurationMs,
            MaxEventCallbackDurationMs = metrics.MaxEventCallbackDurationMs,
            OnInitializedCallCount = metrics.OnInitializedCallCount,
            OnParametersSetCallCount = metrics.OnParametersSetCallCount,
            OnAfterRenderCallCount = metrics.OnAfterRenderCallCount,
            SetParametersAsyncCallCount = metrics.SetParametersAsyncCallCount,
            BuildRenderTreeCallCount = metrics.BuildRenderTreeCallCount,
            StateHasChangedCallCount = metrics.StateHasChangedCallCount,
            StateHasChangedPendingIgnoredCount = metrics.StateHasChangedPendingIgnoredCount,
            StateHasChangedShouldRenderIgnoredCount = metrics.StateHasChangedShouldRenderIgnoredCount,
            StateHasChangedIgnoredCount = metrics.StateHasChangedIgnoredCount,
            ShouldRenderTrueCount = metrics.ShouldRenderTrueCount,
            ShouldRenderFalseCount = metrics.ShouldRenderFalseCount,
            LastShouldRenderResult = metrics.LastShouldRenderResult,
            EventCallbackInvokedCount = metrics.EventCallbackInvokedCount,
            TotalLifecycleTimeMs = metrics.TotalLifecycleTimeMs,
            RenderEfficiencyPercent = metrics.RenderEfficiencyPercent,
            ShouldRenderBlockRatePercent = metrics.ShouldRenderBlockRatePercent,
            RendersPerMinute = metrics.RendersPerMinute
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // CIRCUIT CLOSED HANDLER
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Called by BlazorDevToolsCircuitHandler when the circuit closes.
    /// Cleans up resources including the DotNetObjectReference to prevent
    /// memory leaks and stale references in JavaScript.
    /// </summary>
    internal void OnCircuitClosed()
    {
#if DEBUG
        Console.WriteLine($"[BDT] Circuit closed: {CircuitId} (Components tracked: {_componentsById.Count})");
#endif
        Dispose();
    }

    // ═══════════════════════════════════════════════════════════════
    // DISPOSAL
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Disposes the registry, releasing the DotNetObjectReference.
    /// Called automatically when the circuit closes.
    /// </summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _dotNetRef?.Dispose();
        _dotNetRef = null;
        _componentsById.Clear();
        GC.SuppressFinalize(this);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORTING CLASSES
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Temporary storage for a component before its componentId is known.
/// Components are created by the Activator before Attach() assigns the ID.
/// Stored in ConditionalWeakTable keyed by component instance.
/// </summary>
public class PendingComponent
{
    public IComponent Instance { get; set; } = null!;
    public string TypeName { get; set; } = null!;
    public string? TypeFullName { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsEnhanced { get; set; }
}

/// <summary>
/// Full tracking data for a resolved component.
/// Created when ResolveComponentId() is called after Attach().
/// Contains all metadata, state snapshots, and optional lifecycle metrics.
/// </summary>
public class TrackedComponent
{
    public IComponent Instance { get; set; } = null!;
    public int ComponentId { get; set; }
    public string TypeName { get; set; } = null!;
    public string? TypeFullName { get; set; }
    public string? SourceFile { get; set; }
    public int? LineNumber { get; set; }
    public int? ParentComponentId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastRenderedAt { get; set; }
    public int RenderCount { get; set; }
    public bool HasEnhancedMetrics { get; set; }
    public List<ParameterValue>? Parameters { get; set; }
    public Dictionary<string, string?>? TrackedState { get; set; }
    public ComponentBaseInternalState? InternalState { get; set; }
    public LifecycleMetrics? Metrics { get; set; }
}

/// <summary>
/// Internal state extracted from ComponentBase via reflection.
/// For BlazorDevToolsComponentBase, these are read directly from public properties.
/// For regular ComponentBase, ComponentReflectionHelper extracts via private fields.
/// </summary>
public class ComponentBaseInternalState
{
    public bool HasNeverRendered { get; set; }
    public bool HasPendingQueuedRender { get; set; }
    public bool HasCalledOnAfterRender { get; set; }
    public bool IsInitialized { get; set; }
}

/// <summary>
/// Parameter information extracted via reflection.
/// Captures both [Parameter] and [CascadingParameter] values.
/// </summary>
public class ParameterValue
{
    public string Name { get; set; } = null!;
    public string TypeName { get; set; } = null!;
    public object? Value { get; set; }
    public bool IsCascading { get; set; }
}