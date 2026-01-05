// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - devtools.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Creates the "Blazor" panel in Chrome/Edge DevTools.
// This script runs in the DevTools context.
//
// ═══════════════════════════════════════════════════════════════════════════════

// Create the Blazor panel in DevTools
chrome.devtools.panels.create(
    'Blazor',                    // Panel title
    'assets/icon-16.png',        // Icon
    'panel/panel.html',          // Panel HTML
    (panel) => {
        console.log('[BDT] Blazor DevTools panel created');
        
        // Panel lifecycle events
        panel.onShown.addListener((window) => {
            console.log('[BDT] Panel shown');
            // Could notify panel.ts to refresh data
        });
        
        panel.onHidden.addListener(() => {
            console.log('[BDT] Panel hidden');
        });
    }
);
