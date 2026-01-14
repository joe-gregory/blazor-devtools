// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - component-service.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Service for querying component data from .NET BlazorDevToolsRegistry.
// Uses BlazorBridge for the actual .NET interop.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { BlazorBridge } from './blazor-bridge';
import { ComponentInfo, ComponentCounts } from './types';

/**
 * Service for querying Blazor component data.
 * Provides a typed API over the raw BlazorBridge.
 */
export class ComponentService {
    constructor(private bridge: BlazorBridge) {}

    /**
     * Get all tracked components (both resolved and pending).
     * Resolved components have real componentIds.
     * Pending components have componentId = -1.
     */
    async getAllComponents(): Promise<ComponentInfo[]> {
        return await this.bridge.invoke<ComponentInfo[]>('GetAllComponentsDto');
    }

    /**
     * Get a single component by its ID.
     * @param componentId The Blazor component ID
     * @returns Component info or null if not found
     */
    async getComponent(componentId: number): Promise<ComponentInfo | null> {
        return await this.bridge.invoke<ComponentInfo | null>('GetComponentInfo', componentId);
    }

    /**
     * Get total component count (resolved + pending).
     */
    async getComponentCount(): Promise<number> {
        return await this.bridge.invoke<number>('GetComponentCount');
    }

    /**
     * Get count of resolved components only (have real componentId).
     * These are BlazorDevToolsComponentBase instances that self-registered.
     */
    async getResolvedComponentCount(): Promise<number> {
        return await this.bridge.invoke<number>('GetResolvedComponentCount');
    }

    /**
     * Get count of pending components (componentId = -1).
     * These are regular ComponentBase instances awaiting Pillar 3 resolution.
     */
    async getPendingComponentCount(): Promise<number> {
        return await this.bridge.invoke<number>('GetPendingComponentCount');
    }

    /**
     * Get all component counts in a single call.
     * More efficient than calling individual count methods.
     */
    async getCounts(): Promise<ComponentCounts> {
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
    async getCircuitId(): Promise<string | null> {
        return await this.bridge.invoke<string | null>('GetCircuitId');
    }

    /**
     * Get only resolved components (filters out pending).
     */
    async getResolvedComponents(): Promise<ComponentInfo[]> {
        const all = await this.getAllComponents();
        return all.filter(c => !c.isPending);
    }

    /**
     * Get only pending components.
     */
    async getPendingComponents(): Promise<ComponentInfo[]> {
        const all = await this.getAllComponents();
        return all.filter(c => c.isPending);
    }

    /**
     * Get only enhanced components (inherit from BlazorDevToolsComponentBase).
     */
    async getEnhancedComponents(): Promise<ComponentInfo[]> {
        const all = await this.getAllComponents();
        return all.filter(c => c.hasEnhancedMetrics);
    }

    /**
     * Find components by type name (partial match).
     * @param typeName Type name to search for (case-insensitive)
     */
    async findByTypeName(typeName: string): Promise<ComponentInfo[]> {
        const all = await this.getAllComponents();
        const lower = typeName.toLowerCase();
        return all.filter(c => 
            c.typeName.toLowerCase().includes(lower) ||
            c.typeFullName?.toLowerCase().includes(lower)
        );
    }
}
