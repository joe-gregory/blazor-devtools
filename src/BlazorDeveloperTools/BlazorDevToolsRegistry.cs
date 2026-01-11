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
//   │ ┌─────────────────────┐            ┌─────────────────────┐             │
//   │ │ Registry A          │            │ Registry B          │             │
//   │ │ ├─ Circuit.Id: "abc"│            │ ├─ Circuit.Id: "xyz"│             │
//   │ │ ├─ Components: {...}│            │ ├─ Components: {...}│             │
//   │ │ └─ DotNetRef ───────┼──► JS A    │ └─ DotNetRef ───────┼──► JS B    │
//   │ └─────────────────────┘            └─────────────────────┘             │
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
using Microsoft.AspNetCore.Components.RenderTree;
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
    // RENDERER REFERENCE (for C#-side hierarchy tracking)
    // ═══════════════════════════════════════════════════════════════
    // The Renderer contains the authoritative component tree.
    // We access it via reflection through RendererInterop.
    private Renderer? _renderer;
    private DateTime _lastRendererSync = DateTime.MinValue;
    private static readonly TimeSpan RendererSyncInterval = TimeSpan.FromMilliseconds(100);

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
    // RENDERER REGISTRATION
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Sets the Renderer reference for this registry.
    /// Called by BlazorDevToolsComponentBase.Attach() which has access to RenderHandle.
    /// The Renderer is needed to extract component hierarchy via reflection.
    /// </summary>
    /// <param name="renderer">The Renderer instance for this circuit.</param>
    internal void SetRenderer(Renderer renderer)
    {
        if (_renderer == null)
        {
            _renderer = renderer;
#if DEBUG
            Console.WriteLine($"[BDT] Renderer set for circuit: {CircuitId}");
#endif
        }
    }

    /// <summary>
    /// Sets the Renderer from a RenderHandle (extracts via reflection).
    /// Called by BlazorDevToolsComponentBase.Attach().
    /// </summary>
    /// <param name="renderHandle">The RenderHandle from IComponent.Attach().</param>
    internal void SetRendererFromHandle(RenderHandle renderHandle)
    {
        if (_renderer != null) return;
        Renderer? renderer = RendererInterop.GetRendererFromHandle(renderHandle);
        if (renderer != null)
        {
            SetRenderer(renderer);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // RENDERER SYNC (C#-side Pillar 3 replacement)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Synchronizes registry state with the Renderer's authoritative component tree.
    /// This resolves pending components, establishes hierarchy, and removes disposed.
    /// Called automatically before returning component data to JS.
    /// </summary>
    public void SyncWithRenderer()
    {
#if DEBUG
        Console.WriteLine($"[BDT] SyncWithRenderer called - Renderer={_renderer != null}, IsSupported={RendererInterop.IsSupported}");
#endif
        if (_renderer == null)
        {
#if DEBUG
            Console.WriteLine("[BDT] SyncWithRenderer: No renderer available");
#endif
            return;
        }

        if (!RendererInterop.IsSupported)
        {
#if DEBUG
            Console.WriteLine("[BDT] SyncWithRenderer: RendererInterop not supported");
#endif
            return;
        }

        // Throttle sync to avoid excessive reflection
        DateTime now = DateTime.UtcNow;
        if (now - _lastRendererSync < RendererSyncInterval) return;
        _lastRendererSync = now;

        try
        {
            Dictionary<int, RendererInterop.ComponentStateInfo>? rendererState =
                RendererInterop.GetAllComponentStates(_renderer);

            if (rendererState == null)
            {
#if DEBUG
                Console.WriteLine("[BDT] SyncWithRenderer: GetAllComponentStates returned null");
#endif
                return;
            }

#if DEBUG
            Console.WriteLine($"[BDT] SyncWithRenderer: Got {rendererState.Count} components from Renderer");
#endif

            // Track which componentIds exist in the Renderer
            HashSet<int> activeComponentIds = new(rendererState.Keys);

            // 1. Resolve pending components that now exist in Renderer
            ResolvePendingFromRenderer(rendererState);

            // 2. Update parent relationships for all tracked components
            UpdateHierarchyFromRenderer(rendererState);

            // 3. Add any components in Renderer that we don't know about
            AddMissingComponentsFromRenderer(rendererState);

            // 4. Remove disposed components (in our registry but not in Renderer)
            RemoveDisposedComponents(activeComponentIds);

#if DEBUG
            Console.WriteLine($"[BDT] Renderer sync complete: {_componentsById.Count} resolved, {CountPending()} pending");
#endif
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT] Renderer sync failed: {ex.Message}");
#endif
        }
    }

    private int CountPending()
    {
        int count = 0;
        foreach (KeyValuePair<IComponent, PendingComponent> _ in _pendingComponents) count++;
        return count;
    }

    private void ResolvePendingFromRenderer(Dictionary<int, RendererInterop.ComponentStateInfo> rendererState)
    {
        // Find pending components that match components in the Renderer
        List<(IComponent instance, PendingComponent pending, int componentId)> toResolve = new();

        foreach (KeyValuePair<IComponent, PendingComponent> kvp in _pendingComponents)
        {
            IComponent instance = kvp.Key;
            PendingComponent pending = kvp.Value;

            // Find this component in the Renderer by instance reference
            foreach (KeyValuePair<int, RendererInterop.ComponentStateInfo> rs in rendererState)
            {
                if (ReferenceEquals(rs.Value.Component, instance))
                {
                    toResolve.Add((instance, pending, rs.Key));
                    break;
                }
            }
        }

        // Resolve each matched pending component
        foreach ((IComponent instance, PendingComponent pending, int componentId) item in toResolve)
        {
            RendererInterop.ComponentStateInfo? stateInfo = null;
            rendererState.TryGetValue(item.componentId, out stateInfo);

            TrackedComponent tracked = new()
            {
                Instance = item.instance,
                ComponentId = item.componentId,
                TypeName = item.pending.TypeName,
                TypeFullName = item.pending.TypeFullName,
                CreatedAt = item.pending.CreatedAt,
                ParentComponentId = stateInfo?.ParentComponentId,
                HasEnhancedMetrics = item.pending.IsEnhanced,
                RenderCount = 1,
                LastRenderedAt = DateTime.UtcNow
            };

            // If it's an enhanced component, link the metrics
            if (item.instance is BlazorDevToolsComponentBase enhanced)
            {
                tracked.Metrics = enhanced.Metrics;
            }

            _componentsByInstance.AddOrUpdate(item.instance, tracked);
            _componentsById[item.componentId] = tracked;
            _pendingComponents.Remove(item.instance);

#if DEBUG
            Console.WriteLine($"[BDT] Resolved via Renderer: {tracked.TypeName} → ID {item.componentId} (Parent: {tracked.ParentComponentId})");
#endif
        }
    }

    private void UpdateHierarchyFromRenderer(Dictionary<int, RendererInterop.ComponentStateInfo> rendererState)
    {
        foreach (KeyValuePair<int, TrackedComponent> kvp in _componentsById)
        {
            if (rendererState.TryGetValue(kvp.Key, out RendererInterop.ComponentStateInfo? stateInfo))
            {
                // Update parent relationship
                kvp.Value.ParentComponentId = stateInfo.ParentComponentId;

                // Note: We intentionally do NOT update LastRenderedAt here.
                // For non-enhanced components, we don't have accurate render timestamps.
                // The Renderer only tells us the component exists, not when it last rendered.
                // For accurate render tracking, use BlazorDevToolsComponentBase (enhanced).
            }
        }
    }

    private void AddMissingComponentsFromRenderer(Dictionary<int, RendererInterop.ComponentStateInfo> rendererState)
    {
        foreach (KeyValuePair<int, RendererInterop.ComponentStateInfo> kvp in rendererState)
        {
            int componentId = kvp.Key;
            RendererInterop.ComponentStateInfo stateInfo = kvp.Value;

            // Skip if we already track this component
            if (_componentsById.ContainsKey(componentId)) continue;

            // Check if we have it as pending (by instance)
            bool isPending = false;
            if (stateInfo.Component != null)
            {
                foreach (KeyValuePair<IComponent, PendingComponent> p in _pendingComponents)
                {
                    if (ReferenceEquals(p.Key, stateInfo.Component))
                    {
                        isPending = true;
                        break;
                    }
                }
            }
            if (isPending) continue;// Will be resolved in ResolvePendingFromRenderer

            // This is a component we didn't see through the Activator
            // (might happen with certain component types)
            TrackedComponent tracked = new()
            {
                Instance = stateInfo.Component!,
                ComponentId = componentId,
                TypeName = stateInfo.TypeName ?? stateInfo.Component?.GetType().Name ?? "Unknown",
                TypeFullName = stateInfo.TypeFullName ?? stateInfo.Component?.GetType().FullName,
                CreatedAt = DateTime.UtcNow,
                ParentComponentId = stateInfo.ParentComponentId,
                HasEnhancedMetrics = stateInfo.Component is BlazorDevToolsComponentBase,
                RenderCount = 1,
                LastRenderedAt = DateTime.UtcNow
            };

            if (stateInfo.Component is BlazorDevToolsComponentBase enhanced)
            {
                tracked.Metrics = enhanced.Metrics;
            }

            if (stateInfo.Component != null)
            {
                _componentsByInstance.AddOrUpdate(stateInfo.Component, tracked);
            }
            _componentsById[componentId] = tracked;

#if DEBUG
            Console.WriteLine($"[BDT] Added from Renderer: {tracked.TypeName} ID {componentId} (Parent: {tracked.ParentComponentId})");
#endif
        }
    }

    private void RemoveDisposedComponents(HashSet<int> activeComponentIds)
    {
        // Find components in our registry that no longer exist in Renderer
        List<int> toRemove = new();
        foreach (int componentId in _componentsById.Keys)
        {
            if (!activeComponentIds.Contains(componentId))
            {
                toRemove.Add(componentId);
            }
        }

        foreach (int componentId in toRemove)
        {
            if (_componentsById.TryRemove(componentId, out TrackedComponent? tracked))
            {
                if (tracked.Instance != null)
                {
                    _componentsByInstance.Remove(tracked.Instance);
                }
#if DEBUG
                Console.WriteLine($"[BDT] Removed disposed: {tracked.TypeName} ID {componentId}");
#endif
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // JS INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Minimal JavaScript bootstrap code injected at runtime.
    /// Creates window.blazorDevTools with initialize/onEvent methods.
    /// The browser extension enhances this with Pillar 3 render interception.
    /// </summary>
    private const string JsBootstrap = @"
(function(){
    if(window.blazorDevTools&&window.blazorDevTools._initialized)return;
    window.blazorDevTools=window.blazorDevTools||{};
    window.blazorDevTools.initialize=function(ref){
        window.blazorDevTools._dotNetRef=ref;
        window.blazorDevTools._initialized=true;
        window.dispatchEvent(new CustomEvent('blazorDevToolsReady',{detail:ref}));
        console.log('[BDT] Bridge initialized');
    };
    window.blazorDevTools.onEvent=function(e){
        window.dispatchEvent(new CustomEvent('blazorDevToolsEvent',{detail:e}));
    };
})();";

    /// <summary>
    /// Initializes the JavaScript bridge by injecting minimal bootstrap code and
    /// passing a DotNetObjectReference to JS. Called by BlazorDevToolsCircuitHandler
    /// when the circuit opens. No external JS files required - everything is injected.
    /// After this call, JS can invoke [JSInvokable] methods on this specific instance,
    /// ensuring all queries are scoped to the correct circuit.
    /// </summary>
    public async Task InitializeJsAsync()
    {
        if (_jsInitialized) return;
        try
        {
            // Inject minimal JS bootstrap (idempotent - safe to call multiple times)
            await _js.InvokeVoidAsync("eval", JsBootstrap);
            // Create and pass DotNetObjectReference to JS
            _dotNetRef = DotNetObjectReference.Create(this);
            await _js.InvokeVoidAsync("blazorDevTools.initialize", _dotNetRef);
            _jsInitialized = true;
#if DEBUG
            Console.WriteLine($"[BDT] JS initialized for circuit: {CircuitId}");
#endif
        }
        catch (JSDisconnectedException)
        {
            // Circuit disconnected during init - expected during shutdown
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
        TrackedComponent tracked = BlazorDevToolsRegistry.CreateTrackedComponent(component, componentId, pending);
        _componentsByInstance.AddOrUpdate(component, tracked);
        _componentsById[componentId] = tracked;
        _pendingComponents.Remove(component);
#if DEBUG
        Console.WriteLine($"[BDT] Resolved: {tracked.TypeName} → ID {componentId} (Circuit: {CircuitId})");
#endif
    }

    /// <summary>
    /// Unregisters a component when it is disposed.
    /// Called from BlazorDevToolsComponentBase.Dispose() to ensure the registry
    /// doesn't hold references to disposed components. Also removes from pending
    /// if the component was never resolved (e.g., early disposal).
    /// </summary>
    /// <param name="component">The component instance being disposed.</param>
    public void UnregisterComponent(IComponent component)
    {
        // Try to remove from resolved components
        if (_componentsByInstance.TryGetValue(component, out TrackedComponent? tracked))
        {
            _componentsById.TryRemove(tracked.ComponentId, out _);
            _componentsByInstance.Remove(component);
#if DEBUG
            Console.WriteLine($"[BDT] Unregistered: {tracked.TypeName} ID {tracked.ComponentId} (Circuit: {CircuitId})");
#endif
            return;
        }
        // Also check pending (component disposed before Attach)
        if (_pendingComponents.TryGetValue(component, out PendingComponent? pending))
        {
            _pendingComponents.Remove(component);
#if DEBUG
            Console.WriteLine($"[BDT] Unregistered pending: {pending.TypeName} (Circuit: {CircuitId})");
#endif
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // TRACKED COMPONENT CREATION
    // ═══════════════════════════════════════════════════════════════
    private static TrackedComponent CreateTrackedComponent(IComponent component, int componentId, PendingComponent pending)
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
        BlazorDevToolsRegistry.RefreshInternalState(tracked);
    }

    private static void RefreshInternalState(TrackedComponent tracked)
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
    /// Syncs with Renderer first to ensure accurate hierarchy.
    /// </summary>
    /// <returns>List of component information for the DevTools UI.</returns>
    [JSInvokable]
    public List<ComponentInfoDto> GetAllComponentsDto()
    {
        // Sync with Renderer to resolve pending components and update hierarchy
        SyncWithRenderer();

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

    // ═══════════════════════════════════════════════════════════════
    // PILLAR 3: JS RENDER BATCH INTERCEPTION METHODS
    // ═══════════════════════════════════════════════════════════════
    // These methods are called by blazor-render-interceptor.js to provide
    // component hierarchy and render tracking for all components.

    /// <summary>
    /// Called by JS when a component is first seen in a render batch.
    /// Updates pending components with their real componentId and parent relationship.
    /// </summary>
    /// <param name="info">Component info from JS including componentId and parentComponentId.</param>
    [JSInvokable]
    public void ResolveComponentFromJs(JsComponentInfo info)
    {
        // Try to find a pending component that matches this componentId
        // First, check if we already have it resolved
        if (_componentsById.ContainsKey(info.ComponentId))
        {
            // Already resolved (likely BlazorDevToolsComponentBase), just update parent
            if (info.ParentComponentId.HasValue)
            {
                TrackedComponent existing = _componentsById[info.ComponentId];
                existing.ParentComponentId = info.ParentComponentId;
            }
            return;
        }
        // Look for a pending component that might match
        // This is tricky because pending components don't have IDs yet
        // We match by type name if available
        PendingComponent? matchingPending = null;
        IComponent? matchingInstance = null;
        if (!string.IsNullOrEmpty(info.TypeName))
        {
            foreach (KeyValuePair<IComponent, PendingComponent> kvp in _pendingComponents)
            {
                if (kvp.Value.TypeName == info.TypeName && !kvp.Value.IsEnhanced)
                {
                    matchingPending = kvp.Value;
                    matchingInstance = kvp.Key;
                    break;
                }
            }
        }
        if (matchingPending != null && matchingInstance != null)
        {
            // Found a matching pending component - promote it
            TrackedComponent tracked = new()
            {
                Instance = matchingInstance,
                ComponentId = info.ComponentId,
                TypeName = matchingPending.TypeName,
                TypeFullName = matchingPending.TypeFullName,
                CreatedAt = matchingPending.CreatedAt,
                ParentComponentId = info.ParentComponentId,
                HasEnhancedMetrics = false,
                RenderCount = 1,
                LastRenderedAt = DateTime.UtcNow
            };
            _componentsByInstance.AddOrUpdate(matchingInstance, tracked);
            _componentsById[info.ComponentId] = tracked;
            _pendingComponents.Remove(matchingInstance);
#if DEBUG
            Console.WriteLine($"[BDT Pillar3] Resolved from JS: {tracked.TypeName} → ID {info.ComponentId} (Parent: {info.ParentComponentId}, Circuit: {CircuitId})");
#endif
        }
        else
        {
            // No matching pending found - create a minimal tracked entry
            // This happens when JS sees components before C# activator
            TrackedComponent tracked = new()
            {
                Instance = null!,// Will be updated if we see it later
                ComponentId = info.ComponentId,
                TypeName = info.TypeName ?? "Unknown",
                TypeFullName = null,
                CreatedAt = DateTime.UtcNow,
                ParentComponentId = info.ParentComponentId,
                HasEnhancedMetrics = false,
                RenderCount = 1,
                LastRenderedAt = DateTime.UtcNow
            };
            _componentsById[info.ComponentId] = tracked;
#if DEBUG
            Console.WriteLine($"[BDT Pillar3] New from JS: {tracked.TypeName} ID {info.ComponentId} (Parent: {info.ParentComponentId}, Circuit: {CircuitId})");
#endif
        }
    }

    /// <summary>
    /// Called by JS when a component is disposed via render batch.
    /// </summary>
    /// <param name="componentId">The componentId being disposed.</param>
    [JSInvokable]
    public void DisposeComponentFromJs(int componentId)
    {
        if (_componentsById.TryRemove(componentId, out TrackedComponent? tracked))
        {
            if (tracked.Instance != null)
            {
                _componentsByInstance.Remove(tracked.Instance);
            }
#if DEBUG
            Console.WriteLine($"[BDT Pillar3] Disposed from JS: {tracked.TypeName} ID {componentId} (Circuit: {CircuitId})");
#endif
        }
    }

    /// <summary>
    /// Called by JS when a component renders (for non-enhanced components).
    /// Updates render count and timestamp.
    /// </summary>
    /// <param name="componentId">The componentId that rendered.</param>
    [JSInvokable]
    public void UpdateComponentRenderFromJs(int componentId)
    {
        if (_componentsById.TryGetValue(componentId, out TrackedComponent? tracked))
        {
            // Only update for non-enhanced components (enhanced ones track themselves)
            if (!tracked.HasEnhancedMetrics)
            {
                tracked.RenderCount++;
                tracked.LastRenderedAt = DateTime.UtcNow;
            }
        }
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
        BlazorDevToolsRegistry.RefreshInternalState(tracked);
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

    // ═══════════════════════════════════════════════════════════════
    // TIMELINE RECORDING API (exposed to JavaScript)
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Start recording timeline events.
    /// </summary>
    [JSInvokable]
    public void StartTimelineRecording()
    {
        TimelineRecorder.Instance.StartRecording();
    }

    /// <summary>
    /// Stop recording timeline events.
    /// </summary>
    [JSInvokable]
    public void StopTimelineRecording()
    {
        TimelineRecorder.Instance.StopRecording();
    }

    /// <summary>
    /// Clear all recorded timeline events.
    /// </summary>
    [JSInvokable]
    public void ClearTimelineEvents()
    {
        TimelineRecorder.Instance.ClearEvents();
    }

    /// <summary>
    /// Get current recording state.
    /// </summary>
    [JSInvokable]
    public RecordingState GetTimelineState()
    {
        return TimelineRecorder.Instance.GetState();
    }

    /// <summary>
    /// Get all recorded timeline events.
    /// </summary>
    [JSInvokable]
    public List<TimelineEventDto> GetTimelineEvents()
    {
        return TimelineRecorder.Instance.GetEvents();
    }

    /// <summary>
    /// Get timeline events recorded after a specific event ID (for incremental updates).
    /// </summary>
    [JSInvokable]
    public List<TimelineEventDto> GetTimelineEventsSince(long afterEventId)
    {
        return TimelineRecorder.Instance.GetEventsSince(afterEventId);
    }

    /// <summary>
    /// Get timeline events within a time range.
    /// </summary>
    [JSInvokable]
    public List<TimelineEventDto> GetTimelineEventsInRange(double startMs, double endMs)
    {
        return TimelineRecorder.Instance.GetEventsInRange(startMs, endMs);
    }

    /// <summary>
    /// Get timeline events for a specific component.
    /// </summary>
    [JSInvokable]
    public List<TimelineEventDto> GetTimelineEventsForComponent(int componentId)
    {
        return TimelineRecorder.Instance.GetEventsForComponent(componentId);
    }

    /// <summary>
    /// Get all render batches.
    /// </summary>
    [JSInvokable]
    public List<RenderBatchDto> GetTimelineBatches()
    {
        return TimelineRecorder.Instance.GetBatches();
    }

    /// <summary>
    /// Get components ranked by total render time (for Ranked view).
    /// </summary>
    [JSInvokable]
    public List<ComponentRankingDto> GetRankedComponents()
    {
        return TimelineRecorder.Instance.GetRankedComponents();
    }

    /// <summary>
    /// Set maximum events to retain in the ring buffer.
    /// </summary>
    [JSInvokable]
    public void SetTimelineMaxEvents(int maxEvents)
    {
        TimelineRecorder.Instance.SetMaxEvents(maxEvents);
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
        // For enhanced components, use Metrics.BuildRenderTreeCallCount as the authoritative render count
        // For regular components, fall back to tracked.RenderCount (updated via Pillar 3)
        int renderCount = tracked.HasEnhancedMetrics && tracked.Metrics != null
            ? tracked.Metrics.BuildRenderTreeCallCount
            : tracked.RenderCount;
        // Similarly, LastRenderedAt should come from Metrics for enhanced components
        DateTime? lastRendered = tracked.HasEnhancedMetrics && tracked.Metrics != null && tracked.Metrics.BuildRenderTreeCallCount > 0
            ? tracked.Metrics.LastBuildRenderTreeAt
            : tracked.LastRenderedAt;
        // For enhanced components, read internal state directly from the live component
        // rather than from cached InternalState which may be stale
        InternalStateDto? internalState = null;
        if (tracked.Instance is BlazorDevToolsComponentBase enhanced)
        {
            internalState = new InternalStateDto
            {
                HasNeverRendered = enhanced.HasNeverRendered,
                HasPendingQueuedRender = enhanced.HasPendingQueuedRender,
                HasCalledOnAfterRender = enhanced.HasCalledOnAfterRender,
                IsInitialized = enhanced.IsInitialized
            };
        }
        else if (tracked.InternalState != null)
        {
            internalState = new InternalStateDto
            {
                HasNeverRendered = tracked.InternalState.HasNeverRendered,
                HasPendingQueuedRender = tracked.InternalState.HasPendingQueuedRender,
                HasCalledOnAfterRender = tracked.InternalState.HasCalledOnAfterRender,
                IsInitialized = tracked.InternalState.IsInitialized
            };
        }
        ComponentInfoDto dto = new()
        {
            ComponentId = tracked.ComponentId,
            TypeName = tracked.TypeName,
            TypeFullName = tracked.TypeFullName,
            SourceFile = tracked.SourceFile,
            LineNumber = tracked.LineNumber,
            ParentComponentId = tracked.ParentComponentId,
            RenderCount = renderCount,
            CreatedAt = tracked.CreatedAt,
            LastRenderedAt = lastRendered,
            HasEnhancedMetrics = tracked.HasEnhancedMetrics,
            Parameters = tracked.Parameters?.Select(p => new ParameterDto
            {
                Name = p.Name,
                TypeName = p.TypeName,
                Value = p.Value?.ToString(),
                IsCascading = p.IsCascading
            }).ToList(),
            TrackedState = tracked.TrackedState,
            InternalState = internalState
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

            // Last call durations
            OnInitializedDurationMs = metrics.OnInitializedDurationMs,
            OnInitializedAsyncDurationMs = metrics.OnInitializedAsyncDurationMs,
            OnParametersSetDurationMs = metrics.OnParametersSetDurationMs,
            OnParametersSetAsyncDurationMs = metrics.OnParametersSetAsyncDurationMs,
            OnAfterRenderDurationMs = metrics.OnAfterRenderDurationMs,
            OnAfterRenderAsyncDurationMs = metrics.OnAfterRenderAsyncDurationMs,
            SetParametersAsyncDurationMs = metrics.SetParametersAsyncDurationMs,

            // Cumulative totals
            TotalOnInitializedDurationMs = metrics.TotalOnInitializedDurationMs,
            TotalOnInitializedAsyncDurationMs = metrics.TotalOnInitializedAsyncDurationMs,
            TotalOnParametersSetDurationMs = metrics.TotalOnParametersSetDurationMs,
            TotalOnParametersSetAsyncDurationMs = metrics.TotalOnParametersSetAsyncDurationMs,
            TotalOnAfterRenderDurationMs = metrics.TotalOnAfterRenderDurationMs,
            TotalOnAfterRenderAsyncDurationMs = metrics.TotalOnAfterRenderAsyncDurationMs,
            TotalSetParametersAsyncDurationMs = metrics.TotalSetParametersAsyncDurationMs,

            // Averages
            AverageOnParametersSetDurationMs = metrics.AverageOnParametersSetDurationMs,
            AverageOnAfterRenderDurationMs = metrics.AverageOnAfterRenderDurationMs,

            // Render timing
            TotalBuildRenderTreeDurationMs = metrics.TotalBuildRenderTreeDurationMs,
            LastBuildRenderTreeDurationMs = metrics.LastBuildRenderTreeDurationMs,
            MaxBuildRenderTreeDurationMs = metrics.MaxBuildRenderTreeDurationMs,
            MinBuildRenderTreeDurationMs = metrics.MinBuildRenderTreeDurationMs,
            AverageBuildRenderTreeDurationMs = metrics.AverageBuildRenderTreeDurationMs,

            // EventCallback timing
            LastEventCallbackDurationMs = metrics.LastEventCallbackDurationMs,
            MaxEventCallbackDurationMs = metrics.MaxEventCallbackDurationMs,
            TotalEventCallbackDurationMs = metrics.TotalEventCallbackDurationMs,
            AverageEventCallbackDurationMs = metrics.AverageEventCallbackDurationMs,

            // Call counts
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

/// <summary>
/// Component info received from JavaScript via Pillar 3 render batch interception.
/// Contains minimal data needed to establish component identity and hierarchy.
/// </summary>
public class JsComponentInfo
{
    /// <summary>
    /// The Blazor componentId extracted from render batch.
    /// </summary>
    public int ComponentId { get; set; }
    /// <summary>
    /// Parent componentId if known from render batch hierarchy.
    /// Null for root components.
    /// </summary>
    public int? ParentComponentId { get; set; }
    /// <summary>
    /// Type name extracted from render batch if available.
    /// May be null for some component types.
    /// </summary>
    public string? TypeName { get; set; }
}