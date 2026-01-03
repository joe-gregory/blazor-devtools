// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - BlazorDevToolsRegistry.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Central registry that tracks all Blazor components in the application.
//   Provides data to JavaScript via [JSInvokable] methods for the browser
//   extension to display component information.
//
// ARCHITECTURE:
//   The registry receives components from BlazorDevToolsComponentActivator and
//   tracks them throughout their lifecycle. It handles TWO types of components:
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ ComponentBase (reflection-based)     BlazorDevToolsComponentBase        │
//   │                                      (direct access)                    │
//   │     │                                        │                          │
//   │     ▼                                        ▼                          │
//   │ ┌─────────────────────────────────────────────────────────────────────┐ │
//   │ │                         BlazorDevToolsRegistry                                 │ │
//   │ │                                                                     │ │
//   │ │  _pendingComponents: ConditionalWeakTable<IComponent, PendingInfo>  │ │
//   │ │  _componentsByInstance: ConditionalWeakTable<IComponent, Tracked>   │ │
//   │ │  _componentsById: ConcurrentDictionary<int, TrackedComponent>       │ │
//   │ │                                                                     │ │
//   │ │  For ComponentBase:                                                 │ │
//   │ │    • ExtractComponentBaseState() via reflection                     │ │
//   │ │    • ExtractParameters() via reflection                             │ │
//   │ │    • Metrics = null (not available)                                 │ │
//   │ │    • HasEnhancedMetrics = false                                     │ │
//   │ │                                                                     │ │
//   │ │  For BlazorDevToolsComponentBase:                                   │ │
//   │ │    • Read .HasNeverRendered, .IsInitialized etc directly            │ │
//   │ │    • Read .Metrics directly                                         │ │
//   │ │    • HasEnhancedMetrics = true                                      │ │
//   │ │                                                                     │ │
//   │ └─────────────────────────────────────────────────────────────────────┘ │
//   │                              │                                          │
//   │                              ▼                                          │
//   │ ┌─────────────────────────────────────────────────────────────────────┐ │
//   │ │ [JSInvokable] Methods                                               │ │
//   │ │                                                                     │ │
//   │ │  • GetAllComponentsDto() → List<ComponentInfoDto>                   │ │
//   │ │  • GetComponentInfo(id) → ComponentInfoDto?                         │ │
//   │ │  • RecordRenderFromJs(id, batchSize) → void                         │ │
//   │ └─────────────────────────────────────────────────────────────────────┘ │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// TWO-PHASE RESOLUTION:
//   Components are created BEFORE they get a componentId (assigned during Attach).
//   We use a two-phase approach:
//   1. RegisterPendingComponent() - called from activator, stores in weak table
//   2. ResolveComponentId() - called after Attach, moves to ID-based lookup
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using System.Collections.Concurrent;
using System.Runtime.CompilerServices;

namespace BlazorDeveloperTools;

/// <summary>
/// Central registry for tracking all Blazor components.
/// </summary>
public class BlazorDevToolsRegistry
{
    // ═══════════════════════════════════════════════════════════════
    // SINGLETON INSTANCE
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Global registry instance. Set during service registration.
    /// </summary>
    public static BlazorDevToolsRegistry? Instance { get; internal set; }

    // ═══════════════════════════════════════════════════════════════
    // COMPONENT STORAGE
    // ═══════════════════════════════════════════════════════════════
    // ConditionalWeakTable allows GC to collect disposed components.
    // ConcurrentDictionary for thread-safe ID-based lookup.
    private readonly ConditionalWeakTable<IComponent, PendingComponent> _pendingComponents = [];
    private readonly ConditionalWeakTable<IComponent, TrackedComponent> _componentsByInstance = [];
    private readonly ConcurrentDictionary<int, TrackedComponent> _componentsById = new();

    // ═══════════════════════════════════════════════════════════════
    // REGISTRATION (called from BlazorDevToolsComponentActivator)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Registers a newly created component (before it has a componentId).
    /// </summary>
    /// <param name="component">The component instance.</param>
    public void RegisterPendingComponent(IComponent component)
    {
        var pending = new PendingComponent
        {
            Instance = component,
            TypeName = component.GetType().Name,
            TypeFullName = component.GetType().FullName,
            CreatedAt = DateTime.UtcNow,
            IsEnhanced = component is BlazorDevToolsComponentBase
        };

        _pendingComponents.AddOrUpdate(component, pending);
    }

    /// <summary>
    /// Resolves a pending component to its componentId (called after IComponent.Attach).
    /// </summary>
    /// <param name="component">The component instance.</param>
    /// <param name="componentId">The Blazor-assigned component ID.</param>
    public void ResolveComponentId(IComponent component, int componentId)
    {
        if (!_pendingComponents.TryGetValue(component, out var pending))
        {
            // Component wasn't registered (shouldn't happen)
            return;
        }

        var tracked = BlazorDevToolsRegistry.CreateTrackedComponent(component, componentId, pending);
        _componentsByInstance.AddOrUpdate(component, tracked);
        _componentsById[componentId] = tracked;
        _pendingComponents.Remove(component);
    }

    // ═══════════════════════════════════════════════════════════════
    // TRACKED COMPONENT CREATION
    // ═══════════════════════════════════════════════════════════════
    private static TrackedComponent CreateTrackedComponent(IComponent component, int componentId, PendingComponent pending)
    {
        var tracked = new TrackedComponent
        {
            Instance = component,
            ComponentId = componentId,
            TypeName = pending.TypeName,
            TypeFullName = pending.TypeFullName,
            CreatedAt = pending.CreatedAt,
            HasEnhancedMetrics = pending.IsEnhanced,
            // Extract parameters via reflection (both types)
            Parameters = ComponentReflectionHelper.ExtractParameters(component),
            TrackedState = ComponentReflectionHelper.ExtractTrackedState(component)
        };

        // Extract internal state differently based on type
        if (component is BlazorDevToolsComponentBase enhanced)
        {
            // Direct access - no reflection needed
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
            // Reflection-based extraction
            tracked.InternalState = ComponentReflectionHelper.ExtractComponentBaseState(component);
            tracked.Metrics = null;  // Not available for regular ComponentBase
        }

        return tracked;
    }

    // ═══════════════════════════════════════════════════════════════
    // RENDER TRACKING (called from JS render batch interception)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Records that a component was rendered (called from JavaScript).
    /// </summary>
    [JSInvokable]
    public static void RecordRenderFromJs(int componentId)
    {
        if (Instance == null) return;
        Instance.RecordRender(componentId);
    }

    private void RecordRender(int componentId)
    {
        if (!_componentsById.TryGetValue(componentId, out var tracked))
        {
            return;
        }

        tracked.RenderCount++;
        tracked.LastRenderedAt = DateTime.UtcNow;

        // Refresh internal state
        BlazorDevToolsRegistry.RefreshInternalState(tracked);
    }

    private static void RefreshInternalState(TrackedComponent tracked)
    {
        if (tracked.Instance is BlazorDevToolsComponentBase enhanced)
        {
            // Direct access
            tracked.InternalState = new ComponentBaseInternalState
            {
                HasNeverRendered = enhanced.HasNeverRendered,
                HasPendingQueuedRender = enhanced.HasPendingQueuedRender,
                HasCalledOnAfterRender = enhanced.HasCalledOnAfterRender,
                IsInitialized = enhanced.IsInitialized
            };
            // Metrics object is shared, no need to reassign
        }
        else
        {
            // Reflection-based refresh
            tracked.InternalState = ComponentReflectionHelper.ExtractComponentBaseState(tracked.Instance);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // JSINVOKABLE QUERY METHODS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Gets all tracked components as DTOs for JavaScript.
    /// </summary>
    [JSInvokable]
    public static List<ComponentInfoDto> GetAllComponentsDto()
    {
        if (Instance == null) return [];
        return Instance.GetAllComponentsDtoCore();
    }

    private List<ComponentInfoDto> GetAllComponentsDtoCore()
    {
        var result = new List<ComponentInfoDto>();
        foreach (var kvp in _componentsById)
        {
            var dto = MapToDto(kvp.Value);
            if (dto != null)
            {
                result.Add(dto);
            }
        }
        return result;
    }

    /// <summary>
    /// Gets a single component's info by ID.
    /// </summary>
    [JSInvokable]
    public static ComponentInfoDto? GetComponentInfo(int componentId)
    {
        if (Instance == null) return null;
        return Instance.GetComponentInfoCore(componentId);
    }

    private ComponentInfoDto? GetComponentInfoCore(int componentId)
    {
        if (!_componentsById.TryGetValue(componentId, out var tracked))
        {
            return null;
        }

        // Refresh state before returning
        BlazorDevToolsRegistry.RefreshInternalState(tracked);

        return MapToDto(tracked);
    }

    /// <summary>
    /// Gets all tracked components (internal use).
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

        var dto = new ComponentInfoDto
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
            InternalState = tracked.InternalState != null
                ? new InternalStateDto
                {
                    HasNeverRendered = tracked.InternalState.HasNeverRendered,
                    HasPendingQueuedRender = tracked.InternalState.HasPendingQueuedRender,
                    HasCalledOnAfterRender = tracked.InternalState.HasCalledOnAfterRender,
                    IsInitialized = tracked.InternalState.IsInitialized
                }
                : null
        };

        // Map metrics only for enhanced components
        if (tracked.HasEnhancedMetrics && tracked.Metrics != null)
        {
            dto.Metrics = new LifecycleMetricsDto
            {
                CreatedAt = tracked.Metrics.CreatedAt,
                DisposedAt = tracked.Metrics.DisposedAt,
                LifetimeMs = tracked.Metrics.LifetimeMs,
                TimeToFirstRenderMs = tracked.Metrics.TimeToFirstRenderMs,
                OnInitializedDurationMs = tracked.Metrics.OnInitializedDurationMs,
                OnInitializedAsyncDurationMs = tracked.Metrics.OnInitializedAsyncDurationMs,
                OnParametersSetDurationMs = tracked.Metrics.OnParametersSetDurationMs,
                OnParametersSetAsyncDurationMs = tracked.Metrics.OnParametersSetAsyncDurationMs,
                OnAfterRenderDurationMs = tracked.Metrics.OnAfterRenderDurationMs,
                OnAfterRenderAsyncDurationMs = tracked.Metrics.OnAfterRenderAsyncDurationMs,
                SetParametersAsyncDurationMs = tracked.Metrics.SetParametersAsyncDurationMs,
                TotalBuildRenderTreeDurationMs = tracked.Metrics.TotalBuildRenderTreeDurationMs,
                LastBuildRenderTreeDurationMs = tracked.Metrics.LastBuildRenderTreeDurationMs,
                MaxBuildRenderTreeDurationMs = tracked.Metrics.MaxBuildRenderTreeDurationMs,
                MinBuildRenderTreeDurationMs = tracked.Metrics.MinBuildRenderTreeDurationMs,
                AverageBuildRenderTreeDurationMs = tracked.Metrics.AverageBuildRenderTreeDurationMs,
                LastEventCallbackDurationMs = tracked.Metrics.LastEventCallbackDurationMs,
                MaxEventCallbackDurationMs = tracked.Metrics.MaxEventCallbackDurationMs,
                OnInitializedCallCount = tracked.Metrics.OnInitializedCallCount,
                OnParametersSetCallCount = tracked.Metrics.OnParametersSetCallCount,
                OnAfterRenderCallCount = tracked.Metrics.OnAfterRenderCallCount,
                SetParametersAsyncCallCount = tracked.Metrics.SetParametersAsyncCallCount,
                BuildRenderTreeCallCount = tracked.Metrics.BuildRenderTreeCallCount,
                StateHasChangedCallCount = tracked.Metrics.StateHasChangedCallCount,
                StateHasChangedPendingIgnoredCount = tracked.Metrics.StateHasChangedPendingIgnoredCount,
                StateHasChangedShouldRenderIgnoredCount = tracked.Metrics.StateHasChangedShouldRenderIgnoredCount,
                StateHasChangedIgnoredCount = tracked.Metrics.StateHasChangedIgnoredCount,
                ShouldRenderTrueCount = tracked.Metrics.ShouldRenderTrueCount,
                ShouldRenderFalseCount = tracked.Metrics.ShouldRenderFalseCount,
                LastShouldRenderResult = tracked.Metrics.LastShouldRenderResult,
                EventCallbackInvokedCount = tracked.Metrics.EventCallbackInvokedCount,
                TotalLifecycleTimeMs = tracked.Metrics.TotalLifecycleTimeMs,
                RenderEfficiencyPercent = tracked.Metrics.RenderEfficiencyPercent,
                ShouldRenderBlockRatePercent = tracked.Metrics.ShouldRenderBlockRatePercent,
                RendersPerMinute = tracked.Metrics.RendersPerMinute
            };
        }

        return dto;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORTING CLASSES
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Temporary storage for component before componentId is known.
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
/// Full component tracking data.
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
/// Internal state extracted from ComponentBase.
/// </summary>
public class ComponentBaseInternalState
{
    public bool HasNeverRendered { get; set; }
    public bool HasPendingQueuedRender { get; set; }
    public bool HasCalledOnAfterRender { get; set; }
    public bool IsInitialized { get; set; }
}

/// <summary>
/// Parameter information.
/// </summary>
public class ParameterValue
{
    public string Name { get; set; } = null!;
    public string TypeName { get; set; } = null!;
    public object? Value { get; set; }
    public bool IsCascading { get; set; }
}