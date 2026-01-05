/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/*!*********************************!*\
  !*** ./src/chromium/content.ts ***!
  \*********************************/

// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - content.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Content script injected into web pages.
// Bridges between the page's window.blazorDevTools and the extension.
//
// Content scripts run in an isolated world - they can access the DOM but not
// window objects from the page. We inject an external script (injected.js)
// that runs in the page context and communicates via postMessage.
//
// ═══════════════════════════════════════════════════════════════════════════════
const PREFIX = '[BDT Content]';
// Inject the external script that will run in page context
function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => {
        script.remove(); // Clean up after injection
    };
    (document.head || document.documentElement).appendChild(script);
}
// Listen for messages from the injected script
window.addEventListener('message', (event) => {
    if (event.source !== window)
        return;
    if (event.data?.type === 'BLAZOR_DEVTOOLS_READY') {
        chrome.runtime.sendMessage({ type: 'BLAZOR_DETECTED' });
        console.log(PREFIX, 'Blazor DevTools ready');
    }
    if (event.data?.type === 'BLAZOR_DEVTOOLS_LOADED') {
        console.log(PREFIX, 'Blazor DevTools loaded, waiting for initialization');
    }
});
// Pending requests waiting for responses
const pendingRequests = new Map();
// Listen for responses from injected script
window.addEventListener('message', (event) => {
    if (event.source !== window)
        return;
    if (event.data?.type !== 'BLAZOR_DEVTOOLS_RESPONSE')
        return;
    const { requestId, data, error } = event.data;
    const resolver = pendingRequests.get(requestId);
    if (resolver) {
        pendingRequests.delete(requestId);
        if (error) {
            resolver({ error });
        }
        else {
            resolver({ data });
        }
    }
});
// Listen for messages from the panel (via background)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PANEL_REQUEST') {
        const requestId = Math.random().toString(36).slice(2);
        // Set up response handler
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            sendResponse({ error: 'Request timeout' });
        }, 5000);
        pendingRequests.set(requestId, (response) => {
            clearTimeout(timeout);
            sendResponse(response);
        });
        // Send request to injected script
        window.postMessage({
            type: 'BLAZOR_DEVTOOLS_REQUEST',
            requestId,
            method: message.method,
            args: message.args || []
        }, '*');
        return true; // Keep channel open for async response
    }
});
// Inject the script
injectScript();
console.log(PREFIX, 'Content script loaded');

/******/ })()
;
//# sourceMappingURL=content.js.map