// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - blazor-devtools.js
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   JavaScript module that bridges the browser DevTools extension with the
//   .NET BlazorDevToolsRegistry. Receives a DotNetObjectReference from .NET
//   and provides methods to query component data.
//
// ARCHITECTURE:
//   This is part of Pillar 3 (JS Interception). The flow is:
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ .NET Side                           JS Side                             │
//   │ ────────────                        ───────                             │
//   │ CircuitHandler.OnCircuitOpened()                                        │
//   │     │                                                                   │
//   │     └─► Registry.InitializeJsAsync()                                    │
//   │              │                                                          │
//   │              └─► IJSRuntime.InvokeVoidAsync(                            │
//   │                      "blazorDevTools.initialize", dotNetRef)            │
//   │                              │                                          │
//   │                              └─────────────────► initialize(dotNetRef)  │
//   │                                                       │                 │
//   │                                                       └─► Store ref     │
//   │                                                                         │
//   │ Later: Extension queries...                                             │
//   │                                                                         │
//   │              ◄───────────────────────── getAllComponents()              │
//   │                                              │                          │
//   │ [JSInvokable]                                │                          │
//   │ GetAllComponentsDto() ◄──────────────────────┘                          │
//   │     │                        dotNetRef.invokeMethodAsync(...)           │
//   │     └─► Return List<ComponentInfoDto>                                   │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// USAGE:
//   Add to your app's index.html or _Host.cshtml:
//   <script src="_content/BlazorDeveloperTools/blazor-devtools.js"></script>
//
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════
    // DotNetObjectReference to the scoped BlazorDevToolsRegistry.
    // This is set when .NET calls initialize() and allows us to
    // invoke [JSInvokable] methods on the correct circuit's registry.
    let dotNetRegistry = null;
    let isInitialized = false;
    let circuitId = null;

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Called by .NET BlazorDevToolsRegistry.InitializeJsAsync().
     * Stores the DotNetObjectReference for later use.
     * @param {DotNetObjectReference} dotNetRef - Reference to the scoped registry
     */
    function initialize(dotNetRef) {
        dotNetRegistry = dotNetRef;
        isInitialized = true;
        console.log('[BDT-JS] Initialized with .NET registry reference');

        // Fetch circuit ID for debugging
        getCircuitId().then(id => {
            circuitId = id;
            console.log('[BDT-JS] Circuit ID:', circuitId);
        }).catch(err => {
            console.warn('[BDT-JS] Could not get circuit ID:', err);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // QUERY METHODS (call into .NET)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Gets all tracked components from the registry.
     * @returns {Promise<Array>} Array of ComponentInfoDto objects
     */
    async function getAllComponents() {
        ensureInitialized();
        return await dotNetRegistry.invokeMethodAsync('GetAllComponentsDto');
    }

    /**
     * Gets a single component's info by ID.
     * @param {number} componentId - The Blazor component ID
     * @returns {Promise<Object|null>} ComponentInfoDto or null
     */
    async function getComponent(componentId) {
        ensureInitialized();
        return await dotNetRegistry.invokeMethodAsync('GetComponentInfo', componentId);
    }

    /**
     * Gets the circuit ID this registry belongs to.
     * @returns {Promise<string|null>} Circuit ID or null
     */
    async function getCircuitId() {
        ensureInitialized();
        return await dotNetRegistry.invokeMethodAsync('GetCircuitId');
    }

    /**
     * Gets the count of tracked components.
     * @returns {Promise<number>} Component count (resolved + pending)
     */
    async function getComponentCount() {
        ensureInitialized();
        return await dotNetRegistry.invokeMethodAsync('GetComponentCount');
    }

    /**
     * Gets the count of resolved components only (have componentId).
     * These are BlazorDevToolsComponentBase components that self-registered.
     * @returns {Promise<number>} Resolved component count
     */
    async function getResolvedComponentCount() {
        ensureInitialized();
        return await dotNetRegistry.invokeMethodAsync('GetResolvedComponentCount');
    }

    /**
     * Gets the count of pending components (no componentId yet).
     * These are regular ComponentBase components awaiting Pillar 3 resolution.
     * @returns {Promise<number>} Pending component count
     */
    async function getPendingComponentCount() {
        ensureInitialized();
        return await dotNetRegistry.invokeMethodAsync('GetPendingComponentCount');
    }

    // ═══════════════════════════════════════════════════════════════
    // EVENT HANDLING (receives events from .NET)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Called by BlazorDevToolsComponentBase when a lifecycle event occurs.
     * This is the real-time event push from .NET.
     * @param {Object} event - LifecycleEvent object
     */
    function onEvent(event) {
        // For now, just log. Extension will hook into this later.
        console.log('[BDT-JS] Event:', event.eventType, event.componentType,
            event.durationMs > 0 ? `${event.durationMs.toFixed(2)}ms` : '');
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════

    function ensureInitialized() {
        if (!isInitialized || !dotNetRegistry) {
            throw new Error('[BDT-JS] Not initialized. Wait for circuit to connect.');
        }
    }

    /**
     * Check if the JS bridge is initialized.
     * @returns {boolean} True if initialized
     */
    function isReady() {
        return isInitialized && dotNetRegistry !== null;
    }

    // ═══════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════
    // Expose on window.blazorDevTools for .NET interop and extension access.

    window.blazorDevTools = {
        // Called by .NET
        initialize: initialize,
        onEvent: onEvent,

        // Query methods (for extension or console debugging)
        getAllComponents: getAllComponents,
        getComponent: getComponent,
        getCircuitId: getCircuitId,
        getComponentCount: getComponentCount,
        getResolvedComponentCount: getResolvedComponentCount,
        getPendingComponentCount: getPendingComponentCount,
        isReady: isReady,

        // Direct access to state (for debugging)
        get _dotNetRef() { return dotNetRegistry; },
        get _circuitId() { return circuitId; }
    };

    console.log('[BDT-JS] Blazor Developer Tools JS loaded');

})();