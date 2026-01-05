/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/*!**********************************!*\
  !*** ./src/chromium/injected.ts ***!
  \**********************************/

// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - injected.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// This script is injected into the page context (not content script context).
// It has direct access to window.blazorDevTools and communicates with the
// content script via window.postMessage.
//
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const PREFIX = '[BDT Injected]';
    // Check for blazorDevTools availability
    function checkReady() {
        const api = window.blazorDevTools;
        if (api && api.isReady()) {
            document.documentElement.setAttribute('data-blazor-devtools', 'ready');
            window.postMessage({ type: 'BLAZOR_DEVTOOLS_READY' }, '*');
            console.log(PREFIX, 'Blazor DevTools ready');
        }
        else if (api) {
            document.documentElement.setAttribute('data-blazor-devtools', 'loaded');
            window.postMessage({ type: 'BLAZOR_DEVTOOLS_LOADED' }, '*');
            console.log(PREFIX, 'Blazor DevTools loaded, waiting for initialization');
            setTimeout(checkReady, 500);
        }
        else {
            // Keep checking
            setTimeout(checkReady, 500);
        }
    }
    // Handle requests from content script
    window.addEventListener('message', async (event) => {
        if (event.source !== window)
            return;
        if (event.data?.type !== 'BLAZOR_DEVTOOLS_REQUEST')
            return;
        const { requestId, method, args } = event.data;
        try {
            const api = window.blazorDevTools;
            if (!api || !api.isReady()) {
                window.postMessage({
                    type: 'BLAZOR_DEVTOOLS_RESPONSE',
                    requestId,
                    error: 'Blazor DevTools not ready'
                }, '*');
                return;
            }
            if (typeof api[method] !== 'function') {
                window.postMessage({
                    type: 'BLAZOR_DEVTOOLS_RESPONSE',
                    requestId,
                    error: `Unknown method: ${method}`
                }, '*');
                return;
            }
            const result = await api[method](...(args || []));
            window.postMessage({
                type: 'BLAZOR_DEVTOOLS_RESPONSE',
                requestId,
                data: result
            }, '*');
        }
        catch (err) {
            window.postMessage({
                type: 'BLAZOR_DEVTOOLS_RESPONSE',
                requestId,
                error: err instanceof Error ? err.message : String(err)
            }, '*');
        }
    });
    // Start checking
    checkReady();
    console.log(PREFIX, 'Script loaded');
})();

/******/ })()
;
//# sourceMappingURL=injected.js.map