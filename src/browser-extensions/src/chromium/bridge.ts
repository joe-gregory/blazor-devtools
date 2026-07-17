// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - bridge.ts (Minimal Page Context Bridge)
// ═══════════════════════════════════════════════════════════════════════════════
//
// This is a minimal script that runs in the page context to access 
// window.blazorDevTools._dotNetRef. It replaces the complex injected.ts.
//
// All it does:
// 1. Listen for requests from content script
// 2. Call .NET methods via dotNetRef
// 3. Send responses back
// 4. Notify when Blazor DevTools is ready
//
// NO Pillar 3 hooks, NO render batch interception, NO complex retry logic.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { startPicker, stopPicker } from '../core/picker';

(function() {
    // Listen for requests from content script
    window.addEventListener('message', async (event) => {
        if (event.source !== window) return;
        if (event.data?.source !== 'blazor-devtools-content') return;

        // Element picker control (runs here in the MAIN world because the
        // DOM→component mapping reads expandos invisible to content scripts).
        if (event.data.type === 'PICKER_CONTROL') {
            if (event.data.action === 'start') {
                startPicker({
                    getComponentLabel: async (componentId) => {
                        const dotNetRef = (window as any).blazorDevTools?._dotNetRef;
                        if (!dotNetRef) return null;
                        const info = await dotNetRef.invokeMethodAsync('GetComponentInfo', componentId);
                        return info?.typeName ?? null;
                    },
                    onPick: (componentId) => postPickerEvent('picked', componentId),
                    onStop: () => postPickerEvent('stopped'),
                });
            } else {
                stopPicker();
            }
            return;
        }

        const { id, method, args } = event.data;

        try {
            const dotNetRef = (window as any).blazorDevTools?._dotNetRef;
            if (!dotNetRef) {
                throw new Error('Not connected to .NET registry');
            }

            // Call the .NET method
            const result = await dotNetRef.invokeMethodAsync(method, ...args);
            
            // Send response back to content script
            window.postMessage({
                source: 'blazor-devtools-bridge',
                type: 'RESPONSE',
                data: { id, result }
            }, '*');
        } catch (error: any) {
            window.postMessage({
                source: 'blazor-devtools-bridge',
                type: 'RESPONSE',
                data: { id, error: error.message || String(error) }
            }, '*');
        }
    });

    function postPickerEvent(pickerEvent: 'picked' | 'stopped', componentId?: number): void {
        window.postMessage({
            source: 'blazor-devtools-bridge',
            type: 'PICKER_EVENT',
            data: { event: pickerEvent, componentId }
        }, '*');
    }

    // Watch for Blazor DevTools to become ready
    function checkBlazorReady(): boolean {
        if ((window as any).blazorDevTools?._dotNetRef) {
            const circuitId = (window as any).blazorDevTools._circuitId || null;
            window.postMessage({
                source: 'blazor-devtools-bridge',
                type: 'READY',
                data: { circuitId }
            }, '*');
            return true;
        }
        return false;
    }

    // Check immediately
    if (!checkBlazorReady()) {
        // Poll for Blazor DevTools to become ready
        let attempts = 0;
        const maxAttempts = 100; // 10 seconds max
        const checkInterval = setInterval(() => {
            attempts++;
            if (checkBlazorReady() || attempts >= maxAttempts) {
                clearInterval(checkInterval);
                if (attempts >= maxAttempts) {
                    console.log('[BDT Bridge] Timed out waiting for Blazor DevTools');
                }
            }
        }, 100);
    }

    // Also listen for the custom event from C# initialization
    window.addEventListener('blazorDevToolsReady', (e: Event) => {
        const detail = (e as CustomEvent).detail || {};
        window.postMessage({
            source: 'blazor-devtools-bridge',
            type: 'READY',
            data: { circuitId: detail.circuitId || (window as any).blazorDevTools?._circuitId }
        }, '*');
    });

    console.log('[BDT Bridge] Initialized');
})();