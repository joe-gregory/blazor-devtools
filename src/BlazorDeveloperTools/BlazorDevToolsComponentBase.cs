// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - BlazorDevToolsComponentBase.cs
// ═══════════════════════════════════════════════════════════════════════════════
// The guiding principle for the design of this class is: look but don't touch.  
// <see cref="ComponentBase"/> is meant to be replicated with our instrumentation sprinkled in.
//
// PURPOSE:
//   An enhanced replacement for ComponentBase that provides full lifecycle
//   instrumentation with zero reflection overhead. Components that inherit from
//   this class get detailed timing metrics and real-time event push to JavaScript.
//
// ARCHITECTURE:
//   This class implements IComponent, IHandleEvent, and IHandleAfterRender directly
//   (same as ComponentBase) rather than inheriting from ComponentBase. This gives us:
//   - Direct access to private fields without reflection
//   - Ability to wrap ALL lifecycle methods including StateHasChanged
//   - Zero overhead for metrics access
//   - Clean API where developers override standard methods (OnInitialized, not OnInitializedCore)
//
// THREE-PILLAR ARCHITECTURE:
//   Pillar 1: Source Generator - Populates SourceFile/LineNumber (separate project)
//   Pillar 2: Runtime Tracking - This class + BlazorDevToolsRegistry + BlazorDevToolsComponentActivator
//   Pillar 3: JS Interception - Browser extension intercepts render batches
//
// LIFECYCLE FLOW:
//   1. Activator.CreateInstance() → Registry.RegisterPendingComponent(this)
//   2. IComponent.Attach(renderHandle) → Extract componentId from RenderHandle
//   3. SetParametersAsync(parameters) → DI injects Registry, JsRuntime, etc.
//   4. TryResolveWithRegistry() → Registry.ResolveComponentId(this, componentId)
//   5. Lifecycle methods run with timing instrumentation
//   6. Events pushed to JS via IJSRuntime
//
// DATA FLOW:
//   1. Component lifecycle method called (e.g., OnInitialized)
//   2. Stopwatch measures duration
//   3. Metrics object updated
//   4. Event pushed to JS via IJSRuntime (if enabled)
//   5. Browser extension receives event, can record/display
//
// COMPARISON WITH ComponentBase:
//   ┌─────────────────────────┬─────────────────────┬──────────────────────────────┐
//   │ Feature                 │ ComponentBase       │ BlazorDevToolsComponentBase  │
//   ├─────────────────────────┼─────────────────────┼──────────────────────────────┤
//   │ Parameters              │ ✓ (reflection)      │ ✓ (reflection)               │
//   │ Internal State          │ ✓ (reflection)      │ ✓ (direct access)            │
//   │ Lifecycle Timing        │ ✗                   │ ✓                            │
//   │ StateHasChanged Count   │ ✗                   │ ✓                            │
//   │ ShouldRender Tracking   │ ✗                   │ ✓                            │
//   │ EventCallback Timing    │ ✗                   │ ✓                            │
//   │ Real-time JS Events     │ ✗                   │ ✓                            │
//   │ Registry Integration    │ ✗                   │ ✓ (self-registers)           │
//   └─────────────────────────┴─────────────────────┴──────────────────────────────┘
//
// USAGE:
//   // Single component
//   @inherits BlazorDevToolsComponentBase
//
//   // Entire project (_Imports.razor)
//   @inherits BlazorDeveloperTools.BlazorDevToolsComponentBase
//
//   // Conditional compilation
//   #if DEBUG
//   @inherits BlazorDevToolsComponentBase
//   #else
//   @inherits ComponentBase
//   #endif
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.JSInterop;
using System.Diagnostics;

namespace BlazorDeveloperTools;

/// <summary>
/// The guiding principle for the design of this class is: look but don't touch.  
/// <see cref="ComponentBase"/> is meant to be replicated with our instrumentation sprinkled in.
/// 
/// 
/// Enhanced ComponentBase with full lifecycle instrumentation.
/// Provides detailed timing metrics, real-time event push to JavaScript,
/// and automatic registration with the scoped BlazorDevToolsRegistry.
/// </summary>
public abstract class BlazorDevToolsComponentBase : IComponent, IHandleEvent, IHandleAfterRender, IDisposable, IAsyncDisposable
{
    // ═══════════════════════════════════════════════════════════════
    // BLAZOR COMPONENT STATE (mirrors ComponentBase exactly)
    // ═══════════════════════════════════════════════════════════════
    // These fields are identical to ComponentBase. We own them directly
    // instead of inheriting, which allows us to expose them without reflection.
    private readonly RenderFragment _renderFragment;
    private RenderHandle _renderHandle;
    private bool _initialized;
    private bool _hasNeverRendered = true;
    private bool _hasPendingQueuedRender;
    private bool _hasCalledOnAfterRender;

    // ═══════════════════════════════════════════════════════════════
    // PUBLIC READONLY STATE (exposed without reflection)
    // ═══════════════════════════════════════════════════════════════
    // BlazorDevToolsRegistry and JS can read these directly instead of using
    // ComponentReflectionHelper.ExtractComponentBaseState().
    /// <summary>
    /// True until the component has rendered at least once.
    /// </summary>
    public bool HasNeverRendered => _hasNeverRendered;
    /// <summary>
    /// True when StateHasChanged() was called but render hasn't executed yet.
    /// </summary>
    public bool HasPendingQueuedRender => _hasPendingQueuedRender;
    /// <summary>
    /// True after OnAfterRender has been invoked at least once.
    /// </summary>
    public bool HasCalledOnAfterRender => _hasCalledOnAfterRender;
    /// <summary>
    /// True after OnInitialized/OnInitializedAsync has completed.
    /// </summary>
    public bool IsInitialized => _initialized;
    /// <summary>
    /// The Blazor-assigned component ID. Unique within a circuit/session.
    /// Cached locally but sourced from Registry (single source of truth).
    /// Returns 0 if component not yet resolved.
    /// </summary>
    public int ComponentId
    {
        get
        {
            // If we have a cached value, use it
            if (_componentId != 0) return _componentId;

            // Try to get from Registry (single source of truth)
            if (Registry != null)
            {
                _componentId = Registry.GetComponentId(this);
            }
            return _componentId;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // BLAZOR DEVTOOLS: METRICS
    // ═══════════════════════════════════════════════════════════════
    // Each component instance has its own metrics. This is the primary
    // data structure that accumulates timing and count data.
    /// <summary>
    /// Lifecycle metrics for this component instance.
    /// Contains timing data, call counts, and computed statistics.
    /// </summary>
    public LifecycleMetrics Metrics { get; } = new();

    // ═══════════════════════════════════════════════════════════════
    // BLAZOR DEVTOOLS: TIMING
    // ═══════════════════════════════════════════════════════════════
    // Two stopwatches: one for individual method timing, one for
    // tracking total SetParametersAsync duration across methods.
    private readonly Stopwatch _stopwatch = new();
    private readonly Stopwatch _setParametersAsyncStopwatch = new();

    // ═══════════════════════════════════════════════════════════════
    // BLAZOR DEVTOOLS: JS INTEROP
    // ═══════════════════════════════════════════════════════════════
    // IJSRuntime is injected by Blazor DI during SetParametersAsync.
    // We use it to push lifecycle events to the browser extension.
    [Inject]
    private IJSRuntime JsRuntime { get; set; } = default!;

    // ═══════════════════════════════════════════════════════════════
    // BLAZOR DEVTOOLS: REGISTRY (scoped per circuit)
    // ═══════════════════════════════════════════════════════════════
    // The registry tracks all components in the circuit. Nullable because
    // it may not be available in all scenarios (e.g., WASM without server).
    // Injected during SetParametersAsync along with other DI services.
    [Inject]
    private BlazorDevToolsRegistry? Registry { get; set; }

    // ═══════════════════════════════════════════════════════════════
    // BLAZOR DEVTOOLS: COMPONENT IDENTITY
    // ═══════════════════════════════════════════════════════════════
    // ComponentId is cached locally but sourced from Registry (single source of truth)
    private int _componentId;
    private bool _registryResolved;

    // ═══════════════════════════════════════════════════════════════
    // BLAZOR DEVTOOLS: EVENT BUFFERING
    // ═══════════════════════════════════════════════════════════════
    // During prerendering, JS interop is not available. We buffer
    // events and flush them when JS becomes ready.
    private List<LifecycleEvent>? _bufferedEvents;
    private bool _jsReady;

    // ═══════════════════════════════════════════════════════════════
    // BLAZOR DEVTOOLS: DISPOSAL STATE
    // ═══════════════════════════════════════════════════════════════
    private bool _disposed;

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    // The constructor creates a RenderFragment that wraps BuildRenderTree
    // with timing instrumentation. This is identical to ComponentBase except
    // we measure how long BuildRenderTree takes.
    public BlazorDevToolsComponentBase()
    {
        _renderFragment = builder =>
        {
            _hasPendingQueuedRender = false;
            var wasFirstRender = _hasNeverRendered;
            _hasNeverRendered = false;

            if (BlazorDevToolsConfig.EnableTiming)
            {
                _stopwatch.Restart();
                BuildRenderTree(builder);
                _stopwatch.Stop();

                var durationMs = _stopwatch.Elapsed.TotalMilliseconds;

                Metrics.BuildRenderTreeCallCount++;
                Metrics.LastBuildRenderTreeDurationMs = durationMs;
                Metrics.LastBuildRenderTreeAt = DateTime.UtcNow;
                Metrics.TotalBuildRenderTreeDurationMs += durationMs;

                if (Metrics.MaxBuildRenderTreeDurationMs == null || durationMs > Metrics.MaxBuildRenderTreeDurationMs)
                    Metrics.MaxBuildRenderTreeDurationMs = durationMs;

                if (Metrics.MinBuildRenderTreeDurationMs == null || durationMs < Metrics.MinBuildRenderTreeDurationMs)
                    Metrics.MinBuildRenderTreeDurationMs = durationMs;

                if (wasFirstRender)
                {
                    Metrics.TimeToFirstRenderMs = (DateTime.UtcNow - Metrics.CreatedAt).TotalMilliseconds;
                }

                RecordAndPushEvent(
                    TimelineEventType.BuildRenderTree,
                    LifecycleEventType.BuildRenderTree,
                    durationMs: durationMs,
                    isFirstRender: wasFirstRender,
                    jsData: new { isFirstRender = wasFirstRender }
                );
            }
            else
            {
                BuildRenderTree(builder);
                Metrics.BuildRenderTreeCallCount++;
                Metrics.LastBuildRenderTreeAt = DateTime.UtcNow;
            }
        };

        Metrics.CreatedAt = DateTime.UtcNow;
    }

    // ═══════════════════════════════════════════════════════════════
    // PROTECTED PROPERTIES
    // ═══════════════════════════════════════════════════════════════
    // NOTE: RendererInfo, Assets, and AssignedRenderMode are available
    // in ComponentBase for .NET 8+/9+ but require version-specific APIs.
    // Omitted here for multi-target compatibility. Components needing
    // these can access them via the RenderHandle if necessary.

    // ═══════════════════════════════════════════════════════════════
    // VIRTUAL LIFECYCLE METHODS (developers override these)
    // ═══════════════════════════════════════════════════════════════
    // These are identical to ComponentBase. Developers override them
    // normally. The instrumentation happens in the methods that CALL
    // these (e.g., RunInitAndSetParametersAsync calls OnInitialized).
    /// <summary>
    /// Renders the component to the supplied <see cref="RenderTreeBuilder"/>.
    /// </summary>
    protected virtual void BuildRenderTree(RenderTreeBuilder builder)
    {
    }
    /// <summary>
    /// Method invoked when the component is ready to start, having received its
    /// initial parameters from its parent in the render tree.
    /// </summary>
    protected virtual void OnInitialized()
    {
    }
    /// <summary>
    /// Method invoked when the component is ready to start, having received its
    /// initial parameters from its parent in the render tree.
    /// Override this method to perform an asynchronous operation.
    /// </summary>
    protected virtual Task OnInitializedAsync()
        => Task.CompletedTask;
    /// <summary>
    /// Method invoked when the component has received parameters from its parent in
    /// the render tree, and the incoming values have been assigned to properties.
    /// </summary>
    protected virtual void OnParametersSet()
    {
    }
    /// <summary>
    /// Method invoked when the component has received parameters from its parent in
    /// the render tree, and the incoming values have been assigned to properties.
    /// </summary>
    protected virtual Task OnParametersSetAsync()
        => Task.CompletedTask;
    /// <summary>
    /// Returns a flag to indicate whether the component should render.
    /// </summary>
    protected virtual bool ShouldRender()
        => true;
    /// <summary>
    /// Method invoked after each time the component has rendered interactively.
    /// </summary>
    protected virtual void OnAfterRender(bool firstRender)
    {
    }
    /// <summary>
    /// Method invoked after each time the component has been rendered interactively.
    /// </summary>
    protected virtual Task OnAfterRenderAsync(bool firstRender)
        => Task.CompletedTask;

    // ═══════════════════════════════════════════════════════════════
    // STATEHASCHANGED (with instrumentation)
    // ═══════════════════════════════════════════════════════════════
    // This is where we track how often StateHasChanged is called,
    // whether it results in a render, and why not if blocked.
    /// <summary>
    /// Notifies the component that its state has changed. When applicable, this will
    /// cause the component to be re-rendered.
    /// </summary>
    protected void StateHasChanged()
    {
        Metrics.StateHasChangedCallCount++;

        if (_hasPendingQueuedRender)
        {
            Metrics.StateHasChangedPendingIgnoredCount++;
            PushEvent(LifecycleEventType.StateHasChangedIgnored, data: new { reason = "pendingRender" });
            return;
        }

        // IsRenderingOnMetadataUpdate is for hot reload support (.NET 6+)
        bool willRender = _hasNeverRendered
            || CallAndTrackShouldRender()
            || _renderHandle.IsRenderingOnMetadataUpdate;

        if (willRender)
        {
            _hasPendingQueuedRender = true;

            try
            {
                _renderHandle.Render(_renderFragment);
                RecordAndPushEvent(
                    TimelineEventType.StateHasChanged,
                    LifecycleEventType.StateHasChanged
                );
            }
            catch
            {
                _hasPendingQueuedRender = false;
                throw;
            }
        }
        else
        {
            Metrics.StateHasChangedShouldRenderIgnoredCount++;
            RecordAndPushEvent(
                TimelineEventType.StateHasChangedIgnored,
                LifecycleEventType.StateHasChangedIgnored,
                triggerDetails: "Pending render already queued",
                jsData: new { reason = "pendingRender" }
            );
        }
    }
    /// <summary>
    /// Calls ShouldRender() and tracks the result in metrics.
    /// </summary>
    private bool CallAndTrackShouldRender()
    {
        var result = ShouldRender();

        Metrics.LastShouldRenderResult = result;

        if (result)
        {
            Metrics.ShouldRenderTrueCount++;
        }
        else
        {
            Metrics.ShouldRenderFalseCount++;
        }

        RecordAndPushEvent(
            result ? TimelineEventType.ShouldRenderTrue : TimelineEventType.ShouldRenderFalse,
            LifecycleEventType.ShouldRender,
            wasSkipped: !result,
            jsData: new { result }
        );
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // ASYNC HELPERS (same as ComponentBase)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Executes the supplied work item on the associated renderer's synchronization context.
    /// </summary>
    protected Task InvokeAsync(Action workItem)
        => _renderHandle.Dispatcher.InvokeAsync(workItem);
    /// <summary>
    /// Executes the supplied work item on the associated renderer's synchronization context.
    /// </summary>
    protected Task InvokeAsync(Func<Task> workItem)
        => _renderHandle.Dispatcher.InvokeAsync(workItem);
    /// <summary>
    /// Treats the supplied exception as being thrown by this component.
    /// </summary>
    protected Task DispatchExceptionAsync(Exception exception)
        => _renderHandle.DispatchExceptionAsync(exception);

    // ═══════════════════════════════════════════════════════════════
    // IComponent.Attach
    // ═══════════════════════════════════════════════════════════════
    // Called by Blazor when the component is added to the render tree.
    // ComponentId is now resolved via Registry (single source of truth).
    void IComponent.Attach(RenderHandle renderHandle)
    {
        if (_renderHandle.IsInitialized)
        {
            throw new InvalidOperationException(
                $"The render handle is already set. Cannot initialize a {nameof(BlazorDevToolsComponentBase)} more than once.");
        }

        _renderHandle = renderHandle;
        // Note: ComponentId is now retrieved from Registry on-demand
        // No need to extract here - Registry resolves IDs via Renderer sync
        PushEvent(LifecycleEventType.Created);
    }

    // ═══════════════════════════════════════════════════════════════
    // SETPARAMETERSASYNC (entry point for parameter flow)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Sets parameters supplied by the component's parent in the render tree.
    /// </summary>
    public virtual Task SetParametersAsync(ParameterView parameters)
    {
        Metrics.SetParametersAsyncCallCount++;
        _setParametersAsyncStopwatch.Restart();

        parameters.SetParameterProperties(this);

        // After DI injection, resolve this component with the registry.
        // This moves the component from pending to tracked with its componentId.
        TryResolveWithRegistry();

        if (!_initialized)
        {
            _initialized = true;
            return RunInitAndSetParametersAsync();
        }
        else
        {
            return CallOnParametersSetAsync();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // REGISTRY RESOLUTION
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Attempts to resolve this component with the scoped registry.
    /// Called once after DI injection populates the Registry property.
    /// The Registry will resolve the componentId via Renderer sync.
    /// </summary>
    private void TryResolveWithRegistry()
    {
        if (_registryResolved) return;
#if DEBUG
        Console.WriteLine($"[BDT] TryResolveWithRegistry: {GetType().Name} - Registry={Registry != null}");
#endif
        if (Registry == null) return;
        _registryResolved = true;
        // Registry resolves componentId via SynchronizeWithRenderer()
        Registry.ResolveComponentId(this);
#if DEBUG
        Console.WriteLine($"[BDT] Component resolved with registry: {GetType().Name} (ID: {ComponentId})");
#endif
    }

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION FLOW (first SetParametersAsync call only)
    // ═══════════════════════════════════════════════════════════════
    private async Task RunInitAndSetParametersAsync()
    {
        // Time OnInitialized (sync)
        _stopwatch.Restart();
        OnInitialized();
        _stopwatch.Stop();

        Metrics.OnInitializedCallCount++;
        Metrics.OnInitializedDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
        Metrics.TotalOnInitializedDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
        RecordAndPushEvent(
            TimelineEventType.OnInitialized,
            LifecycleEventType.Initialized,
            durationMs: Metrics.OnInitializedDurationMs.Value,
            isFirstRender: true
        );
        // Time OnInitializedAsync
        _stopwatch.Restart();
        var task = OnInitializedAsync();

        if (task.Status != TaskStatus.RanToCompletion && task.Status != TaskStatus.Canceled)
        {
            if (task.Status != TaskStatus.Faulted)
            {
                StateHasChanged();
            }

            try
            {
                await task;
            }
            catch
            {
                if (!task.IsCanceled)
                {
                    throw;
                }
            }
        }

        _stopwatch.Stop();
        Metrics.OnInitializedAsyncDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
        Metrics.TotalOnInitializedAsyncDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
        RecordAndPushEvent(
            TimelineEventType.OnInitializedAsync,
            LifecycleEventType.InitializedAsync,
            durationMs: Metrics.OnInitializedAsyncDurationMs.Value,
            isAsync: true,
            isFirstRender: true
        );
        await CallOnParametersSetAsync();
    }

    // ═══════════════════════════════════════════════════════════════
    // PARAMETERS SET FLOW (every SetParametersAsync call)
    // ═══════════════════════════════════════════════════════════════
    private Task CallOnParametersSetAsync()
    {
        // Time OnParametersSet (sync)
        _stopwatch.Restart();
        OnParametersSet();
        _stopwatch.Stop();

        Metrics.OnParametersSetCallCount++;
        Metrics.OnParametersSetDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
        Metrics.TotalOnParametersSetDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
        RecordAndPushEvent(
            TimelineEventType.OnParametersSet,
            LifecycleEventType.ParametersSet,
            durationMs: Metrics.OnParametersSetDurationMs.Value
        );
        // Time OnParametersSetAsync
        _stopwatch.Restart();
        var task = OnParametersSetAsync();

        var shouldAwaitTask = task.Status != TaskStatus.RanToCompletion &&
            task.Status != TaskStatus.Canceled;

        if (task.Status != TaskStatus.Faulted)
        {
            StateHasChanged();
        }

        if (shouldAwaitTask)
        {
            return CallStateHasChangedOnAsyncCompletion(task);
        }
        else
        {
            _stopwatch.Stop();
            Metrics.OnParametersSetAsyncDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
            Metrics.TotalOnParametersSetAsyncDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
            RecordAndPushEvent(
                TimelineEventType.OnParametersSetAsync,
                LifecycleEventType.ParametersSetAsync,
                durationMs: Metrics.OnParametersSetAsyncDurationMs.Value,
                isAsync: true
            );
            _setParametersAsyncStopwatch.Stop();
            Metrics.SetParametersAsyncDurationMs = _setParametersAsyncStopwatch.Elapsed.TotalMilliseconds;
            Metrics.TotalSetParametersAsyncDurationMs += _setParametersAsyncStopwatch.Elapsed.TotalMilliseconds;

            return Task.CompletedTask;
        }
    }
    private async Task CallStateHasChangedOnAsyncCompletion(Task task)
    {
        try
        {
            await task;
        }
        catch
        {
            if (task.IsCanceled)
            {
                return;
            }

            throw;
        }
        finally
        {
            _stopwatch.Stop();
            Metrics.OnParametersSetAsyncDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
            Metrics.TotalOnParametersSetAsyncDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
            PushEvent(LifecycleEventType.ParametersSetAsync, Metrics.OnParametersSetAsyncDurationMs.Value);

            _setParametersAsyncStopwatch.Stop();
            Metrics.SetParametersAsyncDurationMs = _setParametersAsyncStopwatch.Elapsed.TotalMilliseconds;
            Metrics.TotalSetParametersAsyncDurationMs += _setParametersAsyncStopwatch.Elapsed.TotalMilliseconds;
        }

        StateHasChanged();
    }

    // ═══════════════════════════════════════════════════════════════
    // IHandleEvent (EventCallback handling)
    // ═══════════════════════════════════════════════════════════════
    Task IHandleEvent.HandleEventAsync(EventCallbackWorkItem callback, object? arg)
    {
        Metrics.EventCallbackInvokedCount++;

        _stopwatch.Restart();
        var task = callback.InvokeAsync(arg);

        var shouldAwaitTask = task.Status != TaskStatus.RanToCompletion &&
            task.Status != TaskStatus.Canceled;

        StateHasChanged();

        if (shouldAwaitTask)
        {
            return HandleEventAsyncCompletion(task);
        }
        else
        {
            _stopwatch.Stop();
            RecordEventCallbackDuration(_stopwatch.Elapsed.TotalMilliseconds);
            return Task.CompletedTask;
        }
    }
    private async Task HandleEventAsyncCompletion(Task task)
    {
        try
        {
            await task;
        }
        catch
        {
            if (task.IsCanceled)
            {
                return;
            }

            throw;
        }
        finally
        {
            _stopwatch.Stop();
            RecordEventCallbackDuration(_stopwatch.Elapsed.TotalMilliseconds);
        }

        StateHasChanged();
    }
    private void RecordEventCallbackDuration(double durationMs)
    {
        Metrics.LastEventCallbackDurationMs = durationMs;
        Metrics.TotalEventCallbackDurationMs += durationMs;

        if (Metrics.MaxEventCallbackDurationMs == null || durationMs > Metrics.MaxEventCallbackDurationMs)
        {
            Metrics.MaxEventCallbackDurationMs = durationMs;
        }

        PushEvent(LifecycleEventType.EventCallback, durationMs);
    }

    // ═══════════════════════════════════════════════════════════════
    // IHandleAfterRender (post-render lifecycle)
    // ═══════════════════════════════════════════════════════════════
    Task IHandleAfterRender.OnAfterRenderAsync()
    {
        var firstRender = !_hasCalledOnAfterRender;
        _hasCalledOnAfterRender = true;

        // Time OnAfterRender (sync)
        _stopwatch.Restart();
        OnAfterRender(firstRender);
        _stopwatch.Stop();

        Metrics.OnAfterRenderCallCount++;
        Metrics.OnAfterRenderDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
        Metrics.TotalOnAfterRenderDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
        RecordAndPushEvent(
            TimelineEventType.OnAfterRender,
            LifecycleEventType.AfterRender,
            durationMs: Metrics.OnAfterRenderDurationMs.Value,
            isFirstRender: firstRender,
            jsData: new { firstRender }
        );
        // Time OnAfterRenderAsync
        _stopwatch.Restart();
        var task = OnAfterRenderAsync(firstRender);

        if (task.Status == TaskStatus.RanToCompletion || task.Status == TaskStatus.Canceled)
        {
            _stopwatch.Stop();
            Metrics.OnAfterRenderAsyncDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
            Metrics.TotalOnAfterRenderAsyncDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
            RecordAndPushEvent(
                TimelineEventType.OnAfterRenderAsync,
                LifecycleEventType.AfterRenderAsync,
                durationMs: Metrics.OnAfterRenderAsyncDurationMs.Value,
                isAsync: true,
                isFirstRender: firstRender,
                jsData: new { firstRender }
            );
            return task;
        }

        return OnAfterRenderAsyncCompletion(task, firstRender);
    }
    private async Task OnAfterRenderAsyncCompletion(Task task, bool firstRender)
    {
        try
        {
            await task;
        }
        finally
        {
            _stopwatch.Stop();
            Metrics.OnAfterRenderAsyncDurationMs = _stopwatch.Elapsed.TotalMilliseconds;
            Metrics.TotalOnAfterRenderAsyncDurationMs += _stopwatch.Elapsed.TotalMilliseconds;
            PushEvent(LifecycleEventType.AfterRenderAsync, Metrics.OnAfterRenderAsyncDurationMs.Value, new { firstRender });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // EVENT PUSHING TO JAVASCRIPT
    // ═══════════════════════════════════════════════════════════════
    // Events are pushed to JS for real-time monitoring by the browser
    // extension. Uses LifecycleEventType for compile-time safety.
    // If JS is not ready (prerendering), events are buffered.
    private void PushEvent(LifecycleEventType eventType, double durationMs = 0, object? data = null)
    {
        if (!BlazorDevToolsConfig.EnableEventPush)
        {
            return;
        }

        if (durationMs > 0 && durationMs < BlazorDevToolsConfig.MinDurationToReportMs)
        {
            return;
        }

        if (BlazorDevToolsConfig.EventTypeFilter != null &&
            !BlazorDevToolsConfig.EventTypeFilter.Contains(eventType))
        {
            return;
        }

        var typeName = GetType().Name;
        if (BlazorDevToolsConfig.ExcludedComponentTypes != null &&
            BlazorDevToolsConfig.ExcludedComponentTypes.Contains(typeName))
        {
            return;
        }

        var evt = new LifecycleEvent
        {
            ComponentId = _componentId,
            ComponentType = typeName,
            ComponentFullType = GetType().FullName,
            EventType = eventType,  // Implicit conversion to string
            DurationMs = durationMs,
            TimestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Data = data
        };

        if (!_jsReady && JsRuntime == null)
        {
            BufferEvent(evt);
            return;
        }

        _ = PushEventAsync(evt);
    }
    /// <summary>
    /// Records a timeline event and pushes to JS.
    /// Combines both recording mechanisms.
    /// </summary>
    private void RecordAndPushEvent(
        TimelineEventType timelineEventType,
        LifecycleEventType jsEventType,
        double? durationMs = null,
        bool isAsync = false,
        bool isFirstRender = false,
        bool wasSkipped = false,
        string? triggerDetails = null,
        object? jsData = null)
    {
        // Record to timeline (if recording)
        TimelineRecorder.Instance.RecordEvent(
            componentId: _componentId,
            componentName: GetType().Name,
            eventType: timelineEventType,
            durationMs: durationMs,
            isAsync: isAsync,
            isFirstRender: isFirstRender,
            wasSkipped: wasSkipped,
            isEnhanced: true,
            triggerDetails: triggerDetails
        );

        // Push to JS (existing mechanism)
        PushEvent(jsEventType, durationMs ?? 0, jsData);
    }
    private void BufferEvent(LifecycleEvent evt)
    {
        if (BlazorDevToolsConfig.MaxBufferedEvents <= 0)
        {
            return;
        }

        _bufferedEvents ??= new List<LifecycleEvent>();

        if (_bufferedEvents.Count < BlazorDevToolsConfig.MaxBufferedEvents)
        {
            _bufferedEvents.Add(evt);
        }
    }
    private async Task FlushBufferedEventsAsync()
    {
        if (_bufferedEvents == null || _bufferedEvents.Count == 0)
        {
            return;
        }

        foreach (var evt in _bufferedEvents)
        {
            await PushEventCoreAsync(evt);
        }

        _bufferedEvents.Clear();
    }
    private async Task PushEventAsync(LifecycleEvent evt)
    {
        if (!_jsReady)
        {
            _jsReady = true;
            await FlushBufferedEventsAsync();
        }

        await PushEventCoreAsync(evt);
    }
    private async Task PushEventCoreAsync(LifecycleEvent evt)
    {
        try
        {
            await JsRuntime.InvokeVoidAsync(BlazorDevToolsConfig.JsEventHandler, evt);
        }
        catch (JSDisconnectedException)
        {
            // Circuit disconnected - expected during shutdown
        }
        catch (InvalidOperationException)
        {
            // Prerendering or JS interop not available yet
            _jsReady = false;
            BufferEvent(evt);
        }
        catch
        {
            // Silently ignore other errors - don't crash app for DevTools
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // IDISPOSABLE / IASYNCDISPOSABLE
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Performs application-defined tasks associated with freeing, releasing, or resetting resources.
    /// </summary>
    public void Dispose()
    {
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }
    /// <summary>
    /// Performs application-defined tasks associated with freeing, releasing, or resetting resources asynchronously.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        await DisposeAsyncCore();
        Dispose(disposing: false);
        GC.SuppressFinalize(this);
    }
    /// <summary>
    /// Releases the unmanaged resources used by the component and optionally releases the managed resources.
    /// </summary>
    protected virtual void Dispose(bool disposing)
    {
        if (_disposed)
        {
            return;
        }

        if (disposing)
        {
            Metrics.DisposedAt = DateTime.UtcNow;
            RecordAndPushEvent(
                TimelineEventType.Disposed,
                LifecycleEventType.Disposed
            );            // Unregister from the scoped registry so disposed components don't appear
            Registry?.UnregisterComponent(this);
            _bufferedEvents?.Clear();
            _bufferedEvents = null;
        }

        _disposed = true;
    }
    /// <summary>
    /// Performs application-defined tasks associated with freeing, releasing, or resetting resources asynchronously.
    /// Override this method to perform async cleanup in derived classes.
    /// </summary>
    protected virtual ValueTask DisposeAsyncCore()
    {
        return ValueTask.CompletedTask;
    }
}