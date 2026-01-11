/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/*!*********************************!*\
  !*** ./src/chromium/content.ts ***!
  \*********************************/

// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - content.ts (CSP Compatible)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Content script injected into web pages.
// Bridges between the extension (background/panel) and the page context.
//
// This version loads bridge.js as an external file to comply with CSP.
//
// Message Flow:
//   Panel → Background → Content (this) → Bridge.js → window.blazorDevTools._dotNetRef
//   Panel ← Background ← Content (this) ← Bridge.js ← [response]
//
// ═══════════════════════════════════════════════════════════════════════════════
let bridgeLoaded = false;
let blazorReady = false;
const pendingRequests = new Map();
// ═══════════════════════════════════════════════════════════════════════════════
// INJECT BRIDGE SCRIPT INTO PAGE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════
function injectBridge() {
    if (bridgeLoaded)
        return;
    bridgeLoaded = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('bridge.js');
    script.onload = () => {
        console.log('[BDT Content] Bridge script loaded');
    };
    script.onerror = (e) => {
        console.error('[BDT Content] Failed to load bridge script:', e);
    };
    (document.head || document.documentElement).appendChild(script);
}
// ═══════════════════════════════════════════════════════════════════════════════
// LISTEN FOR MESSAGES FROM BRIDGE (page context)
// ═══════════════════════════════════════════════════════════════════════════════
window.addEventListener('message', (event) => {
    if (event.source !== window)
        return;
    if (event.data?.source !== 'blazor-devtools-bridge')
        return;
    const { type, data } = event.data;
    switch (type) {
        case 'READY':
            blazorReady = true;
            console.log('[BDT Content] Blazor DevTools ready, circuit:', data?.circuitId);
            // Notify background that Blazor is detected
            chrome.runtime.sendMessage({ type: 'BLAZOR_DETECTED', circuitId: data?.circuitId });
            break;
        case 'RESPONSE':
            // Forward response to pending request
            const { id, result, error } = data;
            const callback = pendingRequests.get(id);
            if (callback) {
                pendingRequests.delete(id);
                if (error) {
                    callback({ error });
                }
                else {
                    callback({ data: result });
                }
            }
            break;
    }
});
// ═══════════════════════════════════════════════════════════════════════════════
// LISTEN FOR MESSAGES FROM BACKGROUND (extension context)
// ═══════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PANEL_REQUEST') {
        const { method, args } = message;
        // Generate unique request ID
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        // Store callback for response
        pendingRequests.set(id, sendResponse);
        // Forward to bridge script via postMessage
        window.postMessage({
            source: 'blazor-devtools-content',
            id,
            method,
            args: args || []
        }, '*');
        // Timeout after 5 seconds
        setTimeout(() => {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                sendResponse({ error: 'Request timeout' });
            }
        }, 5000);
        // Return true to indicate we'll send response asynchronously
        return true;
    }
    if (message.type === 'CHECK_READY') {
        sendResponse({ ready: blazorReady });
        return false;
    }
    return false;
});
// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════
// Inject the bridge script immediately
injectBridge();
console.log('[BDT Content] Content script loaded');

/******/ })()
;
//# sourceMappingURL=content.js.map