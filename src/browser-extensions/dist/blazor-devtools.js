/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/core/blazor-bridge.ts"
/*!***********************************!*\
  !*** ./src/core/blazor-bridge.ts ***!
  \***********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BlazorBridge: () => (/* binding */ BlazorBridge)
/* harmony export */ });
// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - blazor-bridge.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Manages the connection to .NET via DotNetObjectReference.
// This is the low-level bridge that ComponentService and other modules use.
//
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Bridge to .NET BlazorDevToolsRegistry via DotNetObjectReference.
 * Handles initialization and provides typed method invocation.
 */
class BlazorBridge {
    constructor() {
        this.dotNetRef = null;
        this.initialized = false;
        this.circuitId = null;
    }
    /**
     * Initialize the bridge with a DotNetObjectReference.
     * Called by .NET BlazorDevToolsRegistry.InitializeJsAsync().
     */
    initialize(dotNetRef) {
        this.dotNetRef = dotNetRef;
        this.initialized = true;
        console.log('[BDT] Bridge initialized with .NET registry');
        // Fetch circuit ID for debugging
        this.invoke('GetCircuitId')
            .then(id => {
            this.circuitId = id;
            console.log('[BDT] Circuit ID:', this.circuitId);
        })
            .catch(err => {
            console.warn('[BDT] Could not get circuit ID:', err);
        });
    }
    /**
     * Check if the bridge is initialized and ready.
     */
    isReady() {
        return this.initialized && this.dotNetRef !== null;
    }
    /**
     * Get the current circuit ID (null if not initialized).
     */
    getCircuitId() {
        return this.circuitId;
    }
    /**
     * Invoke a [JSInvokable] method on the .NET registry.
     * @param methodName The method name (e.g., 'GetAllComponentsDto')
     * @param args Arguments to pass to the method
     * @returns Promise resolving to the method's return value
     * @throws Error if bridge not initialized
     */
    async invoke(methodName, ...args) {
        if (!this.isReady()) {
            throw new Error('[BDT] Bridge not initialized. Wait for circuit to connect.');
        }
        return await this.dotNetRef.invokeMethodAsync(methodName, ...args);
    }
    /**
     * Dispose of the bridge reference.
     * Called when the circuit closes or page unloads.
     */
    dispose() {
        this.dotNetRef = null;
        this.initialized = false;
        this.circuitId = null;
        console.log('[BDT] Bridge disposed');
    }
}


/***/ },

/***/ "./src/core/component-service.ts"
/*!***************************************!*\
  !*** ./src/core/component-service.ts ***!
  \***************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ComponentService: () => (/* binding */ ComponentService)
/* harmony export */ });
// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - component-service.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Service for querying component data from .NET BlazorDevToolsRegistry.
// Uses BlazorBridge for the actual .NET interop.
//
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Service for querying Blazor component data.
 * Provides a typed API over the raw BlazorBridge.
 */
class ComponentService {
    constructor(bridge) {
        this.bridge = bridge;
    }
    /**
     * Get all tracked components (both resolved and pending).
     * Resolved components have real componentIds.
     * Pending components have componentId = -1.
     */
    async getAllComponents() {
        return await this.bridge.invoke('GetAllComponentsDto');
    }
    /**
     * Get a single component by its ID.
     * @param componentId The Blazor component ID
     * @returns Component info or null if not found
     */
    async getComponent(componentId) {
        return await this.bridge.invoke('GetComponentInfo', componentId);
    }
    /**
     * Get total component count (resolved + pending).
     */
    async getComponentCount() {
        return await this.bridge.invoke('GetComponentCount');
    }
    /**
     * Get count of resolved components only (have real componentId).
     * These are BlazorDevToolsComponentBase instances that self-registered.
     */
    async getResolvedComponentCount() {
        return await this.bridge.invoke('GetResolvedComponentCount');
    }
    /**
     * Get count of pending components (componentId = -1).
     * These are regular ComponentBase instances awaiting Pillar 3 resolution.
     */
    async getPendingComponentCount() {
        return await this.bridge.invoke('GetPendingComponentCount');
    }
    /**
     * Get all component counts in a single call.
     * More efficient than calling individual count methods.
     */
    async getCounts() {
        const [total, resolved, pending] = await Promise.all([
            this.getComponentCount(),
            this.getResolvedComponentCount(),
            this.getPendingComponentCount(),
        ]);
        return { total, resolved, pending };
    }
    /**
     * Get the circuit ID this service is connected to.
     */
    async getCircuitId() {
        return await this.bridge.invoke('GetCircuitId');
    }
    /**
     * Get only resolved components (filters out pending).
     */
    async getResolvedComponents() {
        const all = await this.getAllComponents();
        return all.filter(c => !c.isPending);
    }
    /**
     * Get only pending components.
     */
    async getPendingComponents() {
        const all = await this.getAllComponents();
        return all.filter(c => c.isPending);
    }
    /**
     * Get only enhanced components (inherit from BlazorDevToolsComponentBase).
     */
    async getEnhancedComponents() {
        const all = await this.getAllComponents();
        return all.filter(c => c.hasEnhancedMetrics);
    }
    /**
     * Find components by type name (partial match).
     * @param typeName Type name to search for (case-insensitive)
     */
    async findByTypeName(typeName) {
        const all = await this.getAllComponents();
        const lower = typeName.toLowerCase();
        return all.filter(c => c.typeName.toLowerCase().includes(lower) ||
            c.typeFullName?.toLowerCase().includes(lower));
    }
}


/***/ },

/***/ "./src/core/event-emitter.ts"
/*!***********************************!*\
  !*** ./src/core/event-emitter.ts ***!
  \***********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EventEmitter: () => (/* binding */ EventEmitter)
/* harmony export */ });
// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - event-emitter.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Handles real-time lifecycle events pushed from .NET BlazorDevToolsComponentBase.
// Provides subscription mechanism for UI components to react to events.
//
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Emitter for lifecycle events pushed from .NET.
 * Allows multiple subscribers with optional filtering.
 */
class EventEmitter {
    constructor() {
        this.handlers = new Map();
        this.nextId = 0;
        this.eventLog = [];
        this.maxLogSize = 1000;
    }
    /**
     * Emit an event to all subscribers.
     * Called by .NET when a lifecycle event occurs.
     */
    emit(event) {
        // Log the event
        this.eventLog.push(event);
        if (this.eventLog.length > this.maxLogSize) {
            this.eventLog.shift();
        }
        // Notify subscribers
        for (const { handler, filter } of this.handlers.values()) {
            if (!filter || filter(event)) {
                try {
                    handler(event);
                }
                catch (err) {
                    console.error('[BDT] Event handler error:', err);
                }
            }
        }
    }
    /**
     * Subscribe to all lifecycle events.
     * @param handler Callback to receive events
     * @returns Subscription handle for unsubscribing
     */
    subscribe(handler) {
        return this.subscribeFiltered(handler);
    }
    /**
     * Subscribe with a filter function.
     * @param handler Callback to receive events
     * @param filter Function to filter events (return true to receive)
     * @returns Subscription handle for unsubscribing
     */
    subscribeFiltered(handler, filter) {
        const id = this.nextId++;
        this.handlers.set(id, { handler, filter });
        return {
            unsubscribe: () => {
                this.handlers.delete(id);
            }
        };
    }
    /**
     * Subscribe to events for a specific component.
     * @param componentId Component ID to filter by
     * @param handler Callback to receive events
     */
    subscribeToComponent(componentId, handler) {
        return this.subscribeFiltered(handler, e => e.componentId === componentId);
    }
    /**
     * Subscribe to specific event types.
     * @param eventTypes Array of event type names to listen for
     * @param handler Callback to receive events
     */
    subscribeToEventTypes(eventTypes, handler) {
        const typeSet = new Set(eventTypes);
        return this.subscribeFiltered(handler, e => typeSet.has(e.eventType));
    }
    /**
     * Get recent events from the log.
     * @param count Number of recent events to return (default: 100)
     */
    getRecentEvents(count = 100) {
        return this.eventLog.slice(-count);
    }
    /**
     * Get events for a specific component.
     * @param componentId Component ID to filter by
     */
    getEventsForComponent(componentId) {
        return this.eventLog.filter(e => e.componentId === componentId);
    }
    /**
     * Clear the event log.
     */
    clearLog() {
        this.eventLog = [];
    }
    /**
     * Set the maximum event log size.
     * @param size Maximum number of events to retain
     */
    setMaxLogSize(size) {
        this.maxLogSize = size;
        while (this.eventLog.length > this.maxLogSize) {
            this.eventLog.shift();
        }
    }
    /**
     * Get the current number of subscribers.
     */
    getSubscriberCount() {
        return this.handlers.size;
    }
}


/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Check if module exists (development only)
/******/ 		if (__webpack_modules__[moduleId] === undefined) {
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!*******************************************!*\
  !*** ./src/standalone/blazor-devtools.ts ***!
  \*******************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _core_blazor_bridge__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../core/blazor-bridge */ "./src/core/blazor-bridge.ts");
/* harmony import */ var _core_component_service__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../core/component-service */ "./src/core/component-service.ts");
/* harmony import */ var _core_event_emitter__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../core/event-emitter */ "./src/core/event-emitter.ts");
// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - standalone/blazor-devtools.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Standalone bundle that exposes window.blazorDevTools for:
// 1. .NET interop (initialize, onEvent)
// 2. Console debugging (getAllComponents, etc.)
// 3. Testing without browser extension
//
// Usage: <script src="blazor-devtools.js"></script>
//
// ═══════════════════════════════════════════════════════════════════════════════



// Create singleton instances
const bridge = new _core_blazor_bridge__WEBPACK_IMPORTED_MODULE_0__.BlazorBridge();
const componentService = new _core_component_service__WEBPACK_IMPORTED_MODULE_1__.ComponentService(bridge);
const eventEmitter = new _core_event_emitter__WEBPACK_IMPORTED_MODULE_2__.EventEmitter();
// Build the API object
const api = {
    // .NET interop
    initialize: (dotNetRef) => {
        bridge.initialize(dotNetRef);
    },
    onEvent: (event) => {
        eventEmitter.emit(event);
        // Also log to console for debugging
        const duration = event.durationMs > 0 ? ` (${event.durationMs.toFixed(2)}ms)` : '';
        console.log(`[BDT] ${event.eventType}: ${event.componentType}${duration}`);
    },
    // Query methods (delegate to ComponentService)
    getAllComponents: () => componentService.getAllComponents(),
    getComponent: (id) => componentService.getComponent(id),
    getComponentCount: () => componentService.getComponentCount(),
    getResolvedComponentCount: () => componentService.getResolvedComponentCount(),
    getPendingComponentCount: () => componentService.getPendingComponentCount(),
    getCounts: () => componentService.getCounts(),
    getCircuitId: () => componentService.getCircuitId(),
    getResolvedComponents: () => componentService.getResolvedComponents(),
    getPendingComponents: () => componentService.getPendingComponents(),
    getEnhancedComponents: () => componentService.getEnhancedComponents(),
    findByTypeName: (name) => componentService.findByTypeName(name),
    // Event methods
    subscribe: (handler) => eventEmitter.subscribe(handler),
    getRecentEvents: (count) => eventEmitter.getRecentEvents(count),
    // Status
    isReady: () => bridge.isReady(),
    // Internal access
    _bridge: bridge,
    _components: componentService,
    _events: eventEmitter,
};
window.blazorDevTools = api;
console.log('[BDT] Blazor Developer Tools loaded (standalone mode)');

})();

/******/ })()
;
//# sourceMappingURL=blazor-devtools.js.map