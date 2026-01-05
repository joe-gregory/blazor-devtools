// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - content.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Content script injected into web pages.
// Bridges between the injected.js (page context) and the extension (background/panel).
//
// Content scripts run in an isolated world - they can access the DOM but not
// window objects from the page. We inject injected.js to access window.blazorDevTools.
//
// Message Flow:
//   Panel → Background → Content (this) → Injected → window.blazorDevTools._dotNetRef
//   Panel ← Background ← Content (this) ← Injected ← [response]
//
// ═══════════════════════════════════════════════════════════════════════════════

let injectedScriptLoaded = false;
let blazorReady = false;
const pendingRequests = new Map<string, (response: unknown) => void>();

// ═══════════════════════════════════════════════════════════════════════════════
// INJECT THE INJECTED.JS SCRIPT
// ═══════════════════════════════════════════════════════════════════════════════

function injectScript(): void {
    if (injectedScriptLoaded) return;
    
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => {
        console.log('[BDT Content] Injected script loaded');
        injectedScriptLoaded = true;
    };
    script.onerror = (e) => {
        console.error('[BDT Content] Failed to load injected script:', e);
    };
    (document.head || document.documentElement).appendChild(script);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LISTEN FOR MESSAGES FROM INJECTED SCRIPT (page context)
// ═══════════════════════════════════════════════════════════════════════════════

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'blazor-devtools-injected') return;

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
                } else {
                    callback({ data: result });
                }
            }
            break;

        case 'LIFECYCLE_EVENT':
            // Forward lifecycle events to background for panel
            chrome.runtime.sendMessage({ type: 'LIFECYCLE_EVENT', event: data });
            break;
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LISTEN FOR MESSAGES FROM BACKGROUND (extension context)
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PANEL_REQUEST') {
        const { method, args } = message;
        
        // Generate unique request ID
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        
        // Store callback for response
        pendingRequests.set(id, sendResponse);
        
        // Forward to injected script via postMessage
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
});

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

// Inject the script immediately
injectScript();

console.log('[BDT Content] Content script loaded');