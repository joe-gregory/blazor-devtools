// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - blazor-bridge.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Manages the connection to .NET via DotNetObjectReference.
// This is the low-level bridge that ComponentService and other modules use.
//
// ═══════════════════════════════════════════════════════════════════════════════

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
export class BlazorBridge {
    private dotNetRef: DotNetObjectReference | null = null;
    private initialized = false;
    private circuitId: string | null = null;

    /**
     * Initialize the bridge with a DotNetObjectReference.
     * Called by .NET BlazorDevToolsRegistry.InitializeJsAsync().
     */
    initialize(dotNetRef: DotNetObjectReference): void {
        this.dotNetRef = dotNetRef;
        this.initialized = true;
        console.log('[BDT] Bridge initialized with .NET registry');

        // Fetch circuit ID for debugging
        this.invoke<string | null>('GetCircuitId')
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
    isReady(): boolean {
        return this.initialized && this.dotNetRef !== null;
    }

    /**
     * Get the current circuit ID (null if not initialized).
     */
    getCircuitId(): string | null {
        return this.circuitId;
    }

    /**
     * Invoke a [JSInvokable] method on the .NET registry.
     * @param methodName The method name (e.g., 'GetAllComponentsDto')
     * @param args Arguments to pass to the method
     * @returns Promise resolving to the method's return value
     * @throws Error if bridge not initialized
     */
    async invoke<T>(methodName: string, ...args: unknown[]): Promise<T> {
        if (!this.isReady()) {
            throw new Error('[BDT] Bridge not initialized. Wait for circuit to connect.');
        }
        return await this.dotNetRef!.invokeMethodAsync<T>(methodName, ...args);
    }

    /**
     * Dispose of the bridge reference.
     * Called when the circuit closes or page unloads.
     */
    dispose(): void {
        this.dotNetRef = null;
        this.initialized = false;
        this.circuitId = null;
        console.log('[BDT] Bridge disposed');
    }
}
