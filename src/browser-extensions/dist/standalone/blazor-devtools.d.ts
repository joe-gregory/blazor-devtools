import { BlazorBridge } from '../core/blazor-bridge';
import { ComponentService } from '../core/component-service';
import { EventEmitter } from '../core/event-emitter';
import type { LifecycleEvent, ComponentInfo, ComponentCounts } from '../core/types';
/**
 * Public API exposed on window.blazorDevTools
 */
interface BlazorDevToolsApi {
    initialize(dotNetRef: unknown): void;
    onEvent(event: LifecycleEvent): void;
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
    subscribe(handler: (event: LifecycleEvent) => void): {
        unsubscribe(): void;
    };
    getRecentEvents(count?: number): LifecycleEvent[];
    isReady(): boolean;
    _bridge: BlazorBridge;
    _components: ComponentService;
    _events: EventEmitter;
}
declare global {
    interface Window {
        blazorDevTools: BlazorDevToolsApi;
    }
}
export {};
//# sourceMappingURL=blazor-devtools.d.ts.map