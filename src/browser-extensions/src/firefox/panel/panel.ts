// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - panel.ts (Firefox host)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Thin browser-specific bootstrap: provides the browser.* transport to the
// shared panel modules (core/components-panel.ts, core/timeline-panel.ts),
// which contain all UI logic.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { initializeComponentsPanel } from '../../core/components-panel';
import { initializeTimelinePanel } from '../../core/timeline-panel';

// The tab ID we're inspecting
const inspectedTabId = browser.devtools.inspectedWindow.tabId;

async function callApi<T>(method: string, ...args: unknown[]): Promise<T> {
    const response = await browser.runtime.sendMessage({
        type: 'PANEL_REQUEST',
        tabId: inspectedTabId,
        method,
        args,
    });

    if (response?.error) {
        throw new Error(response.error);
    }

    return response?.data;
}

/** Fire a runtime message; errors come back as { error } instead of rejecting. */
async function sendMessage(message: Record<string, unknown>): Promise<{ error?: string } | undefined> {
    try {
        return await browser.runtime.sendMessage(message);
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}

function onMessage(handler: (message: any) => void): void {
    browser.runtime.onMessage.addListener((message: any) => {
        handler(message);
    });
}

initializeComponentsPanel({ inspectedTabId, callApi, sendMessage, onMessage });
initializeTimelinePanel(callApi);
