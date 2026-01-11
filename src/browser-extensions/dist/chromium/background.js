/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/*!************************************!*\
  !*** ./src/chromium/background.ts ***!
  \************************************/

// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - background.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Service worker that handles communication between:
// - Content script (page context)
// - DevTools panel
// - Browser action (toolbar icon)
//
// ═══════════════════════════════════════════════════════════════════════════════
// Track which tabs have Blazor apps
const blazorTabs = new Set();
// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Content script messages have sender.tab
    const senderTabId = sender.tab?.id;
    // Panel requests include tabId in the message
    const targetTabId = message.tabId || senderTabId;
    if (message.type === 'BLAZOR_DETECTED' && senderTabId) {
        blazorTabs.add(senderTabId);
        updateIcon(senderTabId, true);
        console.log(`[BDT Background] Blazor detected in tab ${senderTabId}`);
        // Re-broadcast to panel so it can refresh
        chrome.runtime.sendMessage({ type: 'BLAZOR_DETECTED', tabId: senderTabId, circuitId: message.circuitId });
    }
    if (message.type === 'BLAZOR_DISCONNECTED' && senderTabId) {
        blazorTabs.delete(senderTabId);
        updateIcon(senderTabId, false);
        console.log(`[BDT Background] Blazor disconnected in tab ${senderTabId}`);
    }
    // Forward panel requests to content script
    if (message.type === 'PANEL_REQUEST' && targetTabId) {
        console.log(`[BDT Background] Forwarding request to tab ${targetTabId}:`, message.method);
        chrome.tabs.sendMessage(targetTabId, message, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[BDT Background] Send failed:', chrome.runtime.lastError.message);
                sendResponse({ error: chrome.runtime.lastError.message });
            }
            else {
                sendResponse(response);
            }
        });
        return true; // Keep channel open for async response
    }
    // Forward events from content script to any listeners (panel)
    if (message.type === 'CONTENT_EVENT') {
        // Re-broadcast to panel
        chrome.runtime.sendMessage(message);
    }
});
// Update toolbar icon based on Blazor detection
function updateIcon(tabId, active) {
    const path = active
        ? { '16': 'assets/icon-16.png', '48': 'assets/icon-48.png' }
        : { '16': 'assets/icon-inactive-16.png', '48': 'assets/icon-inactive-48.png' };
    chrome.action.setIcon({ tabId, path }).catch(() => {
        // Icon files might not exist, ignore
    });
}
// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
    blazorTabs.delete(tabId);
});
// Detect navigation to reset Blazor state
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && blazorTabs.has(tabId)) {
        // Page is navigating - Blazor will need to re-initialize
        blazorTabs.delete(tabId);
        updateIcon(tabId, false);
        console.log(`[BDT Background] Tab ${tabId} navigating, clearing Blazor state`);
    }
});
console.log('[BDT Background] Service worker started');

/******/ })()
;
//# sourceMappingURL=background.js.map