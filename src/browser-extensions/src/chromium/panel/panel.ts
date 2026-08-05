// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - panel.ts (Chromium host)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Thin browser-specific bootstrap: provides the chrome.* transport to the
// shared panel modules (core/components-panel.ts, core/timeline-panel.ts),
// which contain all UI logic.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { initializeComponentsPanel } from '../../core/components-panel';
import { initializeTimelinePanel } from '../../core/timeline-panel';

// The tab ID we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

async function callApi<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => {
        // sendMessage throws synchronously ("Extension context invalidated")
        // when this panel outlived an extension reload — reject instead.
        try {
            chrome.runtime.sendMessage(
                {
                    type: 'PANEL_REQUEST',
                    tabId: inspectedTabId,
                    method,
                    args,
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response?.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response?.data);
                    }
                }
            );
        } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}

/** Fire a runtime message; errors come back as { error } instead of rejecting. */
function sendMessage(message: Record<string, unknown>): Promise<{ error?: string } | undefined> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ error: chrome.runtime.lastError.message });
                } else {
                    resolve(response);
                }
            });
        } catch (err) {
            resolve({ error: err instanceof Error ? err.message : String(err) });
        }
    });
}

function onMessage(handler: (message: any) => void): void {
    chrome.runtime.onMessage.addListener((message) => {
        handler(message);
    });
}

initializeComponentsPanel({ inspectedTabId, callApi, sendMessage, onMessage });
initializeTimelinePanel(callApi);
