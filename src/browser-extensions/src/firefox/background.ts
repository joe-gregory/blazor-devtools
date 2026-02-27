// ???????????????????????????????????????????????????????????????????????????????
// BLAZOR DEVELOPER TOOLS - background.ts (Firefox)
// ???????????????????????????????????????????????????????????????????????????????
//
// Background script that handles communication between:
// - Content script (page context)
// - DevTools panel
// - Browser action (toolbar icon)
//
// Firefox version uses browser.* APIs with Promise-based callbacks.
//
// ???????????????????????????????????????????????????????????????????????????????

// Track which tabs have Blazor apps
const blazorTabs = new Set<number>();

// Listen for messages
browser.runtime.onMessage.addListener((message, sender) => {
    // Content script messages have sender.tab
    const senderTabId = sender.tab?.id;
    
    // Panel requests include tabId in the message
    const targetTabId = message.tabId || senderTabId;
    
    if (message.type === 'BLAZOR_DETECTED' && senderTabId) {
        blazorTabs.add(senderTabId);
        updateIcon(senderTabId, true);
        console.log(`[BDT Background] Blazor detected in tab ${senderTabId}`);
        // Re-broadcast to panel so it can refresh
        browser.runtime.sendMessage({ type: 'BLAZOR_DETECTED', tabId: senderTabId, circuitId: message.circuitId });
    }
    
    if (message.type === 'BLAZOR_DISCONNECTED' && senderTabId) {
        blazorTabs.delete(senderTabId);
        updateIcon(senderTabId, false);
        console.log(`[BDT Background] Blazor disconnected in tab ${senderTabId}`);
    }
    
    // Forward panel requests to content script
    if (message.type === 'PANEL_REQUEST' && targetTabId) {
        if (!blazorTabs.has(targetTabId)) {
            console.warn(`[BDT Background] No Blazor bridge in tab ${targetTabId}`);
            return Promise.resolve({ error: 'Blazor DevTools not detected in this tab yet.' });
        }

        console.log(`[BDT Background] Forwarding request to tab ${targetTabId}:`, message.method);
        
        return browser.tabs.sendMessage(targetTabId, message)
            .catch((error) => {
                console.error('[BDT Background] Send failed:', error.message);
                return { error: error.message };
            });
    }
    
    return false; // Synchronous response
});

// Update browser action icon
function updateIcon(tabId: number, enabled: boolean): void {
    const iconPath = enabled ? 'assets/icon-48.png' : 'assets/icon-48-disabled.png';
    browser.browserAction.setIcon({
        tabId,
        path: {
            16: enabled ? 'assets/icon-16.png' : 'assets/icon-16-disabled.png',
            48: iconPath,
        },
    }).catch(err => {
        console.warn('[BDT Background] Could not set icon:', err);
    });
}

// Clean up when tab closes
browser.tabs.onRemoved.addListener((tabId) => {
    blazorTabs.delete(tabId);
});

console.log('[BDT Background] Service initialized');

export {};
