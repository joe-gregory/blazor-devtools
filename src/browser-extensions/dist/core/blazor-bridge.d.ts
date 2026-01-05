/**
 * DotNetObjectReference interface for invoking .NET methods.
 */
interface DotNetObjectReference {
    invokeMethodAsync<T>(methodName: string, ...args: unknown[]): Promise<T>;
}
/**
 * Bridge to .NET BlazorDevToolsRegistry via DotNetObjectReference.
 * Handles initialization and provides typed method invocation.
 */
export declare class BlazorBridge {
    private dotNetRef;
    private initialized;
    private circuitId;
    /**
     * Initialize the bridge with a DotNetObjectReference.
     * Called by .NET BlazorDevToolsRegistry.InitializeJsAsync().
     */
    initialize(dotNetRef: DotNetObjectReference): void;
    /**
     * Check if the bridge is initialized and ready.
     */
    isReady(): boolean;
    /**
     * Get the current circuit ID (null if not initialized).
     */
    getCircuitId(): string | null;
    /**
     * Invoke a [JSInvokable] method on the .NET registry.
     * @param methodName The method name (e.g., 'GetAllComponentsDto')
     * @param args Arguments to pass to the method
     * @returns Promise resolving to the method's return value
     * @throws Error if bridge not initialized
     */
    invoke<T>(methodName: string, ...args: unknown[]): Promise<T>;
    /**
     * Dispose of the bridge reference.
     * Called when the circuit closes or page unloads.
     */
    dispose(): void;
}
export {};
//# sourceMappingURL=blazor-bridge.d.ts.map