/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/*!********************************!*\
  !*** ./src/chromium/bridge.ts ***!
  \********************************/

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
(function () {
    // Listen for requests from content script
    window.addEventListener('message', async (event) => {
        if (event.source !== window)
            return;
        if (event.data?.source !== 'blazor-devtools-content')
            return;
        const { id, method, args } = event.data;
        try {
            const dotNetRef = window.blazorDevTools?._dotNetRef;
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
        }
        catch (error) {
            window.postMessage({
                source: 'blazor-devtools-bridge',
                type: 'RESPONSE',
                data: { id, error: error.message || String(error) }
            }, '*');
        }
    });
    // Watch for Blazor DevTools to become ready
    function checkBlazorReady() {
        if (window.blazorDevTools?._dotNetRef) {
            const circuitId = window.blazorDevTools._circuitId || null;
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
    window.addEventListener('blazorDevToolsReady', (e) => {
        const detail = e.detail || {};
        window.postMessage({
            source: 'blazor-devtools-bridge',
            type: 'READY',
            data: { circuitId: detail.circuitId || window.blazorDevTools?._circuitId }
        }, '*');
    });
    console.log('[BDT Bridge] Initialized');
})();

/******/ })()
;
//# sourceMappingURL=bridge.js.map