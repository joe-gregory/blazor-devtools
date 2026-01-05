import { BlazorBridge } from './blazor-bridge';
import { ComponentInfo, ComponentCounts } from './types';
/**
 * Service for querying Blazor component data.
 * Provides a typed API over the raw BlazorBridge.
 */
export declare class ComponentService {
    private bridge;
    constructor(bridge: BlazorBridge);
    /**
     * Get all tracked components (both resolved and pending).
     * Resolved components have real componentIds.
     * Pending components have componentId = -1.
     */
    getAllComponents(): Promise<ComponentInfo[]>;
    /**
     * Get a single component by its ID.
     * @param componentId The Blazor component ID
     * @returns Component info or null if not found
     */
    getComponent(componentId: number): Promise<ComponentInfo | null>;
    /**
     * Get total component count (resolved + pending).
     */
    getComponentCount(): Promise<number>;
    /**
     * Get count of resolved components only (have real componentId).
     * These are BlazorDevToolsComponentBase instances that self-registered.
     */
    getResolvedComponentCount(): Promise<number>;
    /**
     * Get count of pending components (componentId = -1).
     * These are regular ComponentBase instances awaiting Pillar 3 resolution.
     */
    getPendingComponentCount(): Promise<number>;
    /**
     * Get all component counts in a single call.
     * More efficient than calling individual count methods.
     */
    getCounts(): Promise<ComponentCounts>;
    /**
     * Get the circuit ID this service is connected to.
     */
    getCircuitId(): Promise<string | null>;
    /**
     * Get only resolved components (filters out pending).
     */
    getResolvedComponents(): Promise<ComponentInfo[]>;
    /**
     * Get only pending components.
     */
    getPendingComponents(): Promise<ComponentInfo[]>;
    /**
     * Get only enhanced components (inherit from BlazorDevToolsComponentBase).
     */
    getEnhancedComponents(): Promise<ComponentInfo[]>;
    /**
     * Find components by type name (partial match).
     * @param typeName Type name to search for (case-insensitive)
     */
    findByTypeName(typeName: string): Promise<ComponentInfo[]>;
}
//# sourceMappingURL=component-service.d.ts.map