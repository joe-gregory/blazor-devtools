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

import { BlazorBridge } from '../core/blazor-bridge';
import { ComponentService } from '../core/component-service';
import { EventEmitter } from '../core/event-emitter';
import type { LifecycleEvent, ComponentInfo, ComponentCounts } from '../core/types';

// Create singleton instances
const bridge = new BlazorBridge();
const componentService = new ComponentService(bridge);
const eventEmitter = new EventEmitter();

/**
 * Public API exposed on window.blazorDevTools
 */
interface BlazorDevToolsApi {
    // .NET interop (called by BlazorDevToolsRegistry)
    initialize(dotNetRef: unknown): void;
    onEvent(event: LifecycleEvent): void;

    // Query methods
    getAllComponents(): Promise<ComponentInfo[]>;
    getComponent(componentId: number): Promise<ComponentInfo | null>;
    getComponentCount(): Promise<number>;
    getResolvedComponentCount(): Promise<number>;
    getPendingComponentCount(): Promise<number>;
    getCounts(): Promise<ComponentCounts>;
    getCircuitId(): Promise<string | null>;
    getResolvedComponents(): Promise<ComponentInfo[]>;
    getPendingComponents(): Promise<ComponentInfo[]>;
    getEnhancedComponents(): Promise<ComponentInfo[]>;
    findByTypeName(typeName: string): Promise<ComponentInfo[]>;

    // Event methods
    subscribe(handler: (event: LifecycleEvent) => void): { unsubscribe(): void };
    getRecentEvents(count?: number): LifecycleEvent[];

    // Status
    isReady(): boolean;

    // Internal access (for advanced debugging)
    _bridge: BlazorBridge;
    _components: ComponentService;
    _events: EventEmitter;
}

// Build the API object
const api: BlazorDevToolsApi = {
    // .NET interop
    initialize: (dotNetRef: unknown) => {
        bridge.initialize(dotNetRef as Parameters<typeof bridge.initialize>[0]);
    },
    onEvent: (event: LifecycleEvent) => {
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

// Expose on window
declare global {
    interface Window {
        blazorDevTools: BlazorDevToolsApi;
    }
}

window.blazorDevTools = api;

console.log('[BDT] Blazor Developer Tools loaded (standalone mode)');
