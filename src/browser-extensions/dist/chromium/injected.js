/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/*!**********************************!*\
  !*** ./src/chromium/injected.ts ***!
  \**********************************/

// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - Extension injected.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Runs in the PAGE CONTEXT (not extension context) to access window.blazorDevTools.
//   The NuGet package injects minimal JS bootstrap that creates window.blazorDevTools
//   and stores the DotNetObjectReference. This script:
//   1. Waits for the NuGet's bootstrap to be ready
//   2. Provides query methods using the stored dotNetRef
//   3. Implements Pillar 3 render batch interception for hierarchy
//   4. Communicates with content.ts via postMessage
//
// ARCHITECTURE:
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ NuGet Package (C#)                                                      │
//   │   └─► Registry.InitializeJsAsync()                                      │
//   │         └─► eval(bootstrap) → creates window.blazorDevTools             │
//   │         └─► blazorDevTools.initialize(dotNetRef)                        │
//   │               └─► dispatches 'blazorDevToolsReady' event                │
//   └─────────────────────────────────────────────────────────────────────────┘
//                              │
//                              ▼
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ This Script (injected.ts)                                               │
//   │   └─► Listens for 'blazorDevToolsReady'                                 │
//   │   └─► Uses window.blazorDevTools._dotNetRef for queries                 │
//   │   └─► Hooks Blazor._internal for Pillar 3                               │
//   │   └─► Posts results to content.ts via postMessage                       │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════
    let dotNetRef = null;
    let isReady = false;
    // Pillar 3: Component hierarchy tracking
    const componentTree = new Map();
    const parentMap = new Map();
    let pillar3Hooked = false;
    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════
    function initialize() {
        // Check if already ready
        const bdt = window.blazorDevTools;
        if (bdt?._initialized && bdt._dotNetRef) {
            onReady(bdt._dotNetRef);
        }
        // Listen for ready event from NuGet bootstrap
        window.addEventListener('blazorDevToolsReady', ((event) => {
            onReady(event.detail);
        }));
        // Listen for lifecycle events
        window.addEventListener('blazorDevToolsEvent', ((event) => {
            postToContentScript('LIFECYCLE_EVENT', event.detail);
        }));
        // Try to hook Pillar 3
        tryHookPillar3();
        console.log('[BDT Injected] Waiting for Blazor DevTools...');
    }
    function onReady(ref) {
        dotNetRef = ref;
        isReady = true;
        console.log('[BDT Injected] Connected to .NET registry');
        postToContentScript('READY', { circuitId: null });
        // Fetch circuit ID
        dotNetRef.invokeMethodAsync('GetCircuitId').then(id => {
            postToContentScript('READY', { circuitId: id });
            console.log('[BDT Injected] Circuit ID:', id);
        }).catch(() => { });
    }
    // ═══════════════════════════════════════════════════════════════
    // QUERY METHODS (use dotNetRef from NuGet)
    // ═══════════════════════════════════════════════════════════════
    async function getAllComponents() {
        if (!dotNetRef)
            throw new Error('Not connected to .NET registry');
        return await dotNetRef.invokeMethodAsync('GetAllComponentsDto');
    }
    async function getComponent(componentId) {
        if (!dotNetRef)
            throw new Error('Not connected to .NET registry');
        return await dotNetRef.invokeMethodAsync('GetComponentInfo', componentId);
    }
    async function getCircuitId() {
        if (!dotNetRef)
            throw new Error('Not connected to .NET registry');
        return await dotNetRef.invokeMethodAsync('GetCircuitId');
    }
    async function getComponentCount() {
        if (!dotNetRef)
            throw new Error('Not connected to .NET registry');
        return await dotNetRef.invokeMethodAsync('GetComponentCount');
    }
    // ═══════════════════════════════════════════════════════════════
    // PILLAR 3: RENDER BATCH INTERCEPTION
    // ═══════════════════════════════════════════════════════════════
    const FrameType = {
        Element: 1,
        Text: 2,
        Attribute: 3,
        Component: 4,
        Region: 5,
    };
    let pillar3RetryCount = 0;
    const MAX_PILLAR3_RETRIES = 50; // 5 seconds max
    function tryHookPillar3() {
        if (pillar3Hooked)
            return true;
        pillar3RetryCount++;
        const Blazor = window.Blazor;
        if (!Blazor) {
            if (pillar3RetryCount < MAX_PILLAR3_RETRIES) {
                setTimeout(tryHookPillar3, 100);
            }
            else {
                console.warn('[BDT Pillar3] Gave up waiting for Blazor object');
            }
            return false;
        }
        // Log what's available in Blazor for diagnostics
        if (pillar3RetryCount === 1 || pillar3RetryCount % 10 === 0) {
            console.log('[BDT Pillar3] Blazor object found, checking internals...');
            console.log('[BDT Pillar3] Blazor keys:', Object.keys(Blazor));
            if (Blazor._internal) {
                console.log('[BDT Pillar3] Blazor._internal keys:', Object.keys(Blazor._internal));
            }
            else {
                console.log('[BDT Pillar3] Blazor._internal is undefined');
            }
        }
        if (!Blazor._internal) {
            if (pillar3RetryCount < MAX_PILLAR3_RETRIES) {
                setTimeout(tryHookPillar3, 100);
            }
            else {
                console.warn('[BDT Pillar3] Blazor._internal never became available');
            }
            return false;
        }
        // Try to find and hook renderBatch
        let hooked = false;
        // Method 1: Direct renderBatch (older Blazor)
        if (Blazor._internal.renderBatch && typeof Blazor._internal.renderBatch === 'function') {
            const original = Blazor._internal.renderBatch;
            Blazor._internal.renderBatch = function (rendererId, batch) {
                try {
                    processRenderBatch(batch);
                }
                catch (e) {
                    console.error('[BDT Pillar3] Error in renderBatch hook:', e);
                }
                return original.apply(this, arguments);
            };
            console.log('[BDT Pillar3] Hooked Blazor._internal.renderBatch');
            hooked = true;
        }
        // Method 2: navigationManager (Blazor 8+)
        if (Blazor._internal.navigationManager) {
            console.log('[BDT Pillar3] Found navigationManager');
        }
        // Method 3: Check for WebRenderer (Blazor WebAssembly)
        if (window.WebAssembly && Blazor.platform) {
            console.log('[BDT Pillar3] Detected Blazor WebAssembly');
        }
        // Method 4: Hook attachRootComponentToElement
        if (Blazor._internal.attachRootComponentToElement && !hooked) {
            const original = Blazor._internal.attachRootComponentToElement;
            Blazor._internal.attachRootComponentToElement = function (selector, componentId, rendererId) {
                console.log('[BDT Pillar3] Root component attached:', { selector, componentId, rendererId });
                trackRootComponent(componentId);
                return original.apply(this, arguments);
            };
            console.log('[BDT Pillar3] Hooked attachRootComponentToElement');
            hooked = true;
        }
        // Method 5: Try to find the SignalR connection for Blazor Server
        if (Blazor._internal.forceCloseConnection) {
            console.log('[BDT Pillar3] Detected Blazor Server (SignalR)');
        }
        // Method 6: Hook into Blazor.start if not yet started
        if (!hooked && typeof Blazor.start === 'function' && !Blazor._started) {
            const originalStart = Blazor.start;
            Blazor.start = async function (...args) {
                console.log('[BDT Pillar3] Blazor.start called, will retry hooks after');
                const result = await originalStart.apply(this, args);
                setTimeout(tryHookPillar3, 100);
                return result;
            };
            console.log('[BDT Pillar3] Hooked Blazor.start for deferred hook installation');
        }
        if (!hooked) {
            // Keep trying if we haven't found anything
            if (pillar3RetryCount < MAX_PILLAR3_RETRIES) {
                setTimeout(tryHookPillar3, 100);
            }
            else {
                console.warn('[BDT Pillar3] Could not find suitable hook point');
                console.log('[BDT Pillar3] Final Blazor._internal state:', Blazor._internal);
            }
            return false;
        }
        pillar3Hooked = true;
        return true;
    }
    function trackRootComponent(componentId) {
        if (!componentTree.has(componentId)) {
            componentTree.set(componentId, {
                componentId,
                parentComponentId: null,
                typeName: null,
                childComponentIds: [],
                renderCount: 0,
                lastRenderedTimestamp: Date.now()
            });
        }
        parentMap.set(componentId, null);
    }
    function processRenderBatch(batch) {
        const updatedIds = [];
        const disposedIds = [];
        // Try to extract from structured batch (if available)
        try {
            if (batch?.updatedComponents) {
                const reader = batch.updatedComponents;
                const count = typeof reader.count === 'function' ? reader.count() : 0;
                for (let i = 0; i < count; i++) {
                    const item = reader.item(i);
                    if (item?.componentId !== undefined) {
                        updatedIds.push(item.componentId);
                        trackComponentRender(item.componentId);
                    }
                }
            }
            if (batch?.disposedComponentIds) {
                const reader = batch.disposedComponentIds;
                const count = typeof reader.count === 'function' ? reader.count() : 0;
                for (let i = 0; i < count; i++) {
                    const id = reader.item(i);
                    disposedIds.push(id);
                    trackComponentDisposal(id);
                }
            }
            // Process reference frames for hierarchy
            if (batch?.referenceFrames) {
                processReferenceFrames(batch.referenceFrames, updatedIds);
            }
        }
        catch (e) {
            // Batch format varies by Blazor version
        }
        // Send updates to C# registry
        sendUpdatesToRegistry(updatedIds, disposedIds);
    }
    function processReferenceFrames(frames, updatedIds) {
        const componentStack = [];
        try {
            const count = typeof frames.count === 'function' ? frames.count() : 0;
            for (let i = 0; i < count; i++) {
                const frame = frames.item(i);
                const frameType = frame?.frameType ?? frame?.type;
                if (frameType === FrameType.Component) {
                    const childId = frame.componentId;
                    const parentId = componentStack.length > 0
                        ? componentStack[componentStack.length - 1]
                        : null;
                    if (parentId !== null) {
                        setParentChild(parentId, childId);
                    }
                    componentStack.push(childId);
                    if (frame.componentType) {
                        const node = componentTree.get(childId);
                        if (node)
                            node.typeName = frame.componentType;
                    }
                }
            }
        }
        catch (e) {
            // Frame access errors
        }
    }
    function trackComponentRender(componentId) {
        let node = componentTree.get(componentId);
        if (!node) {
            node = {
                componentId,
                parentComponentId: parentMap.get(componentId) ?? null,
                typeName: null,
                childComponentIds: [],
                renderCount: 0,
                lastRenderedTimestamp: 0
            };
            componentTree.set(componentId, node);
        }
        node.renderCount++;
        node.lastRenderedTimestamp = Date.now();
    }
    function trackComponentDisposal(componentId) {
        const parentId = parentMap.get(componentId);
        if (parentId !== null && parentId !== undefined) {
            const parent = componentTree.get(parentId);
            if (parent) {
                parent.childComponentIds = parent.childComponentIds.filter(id => id !== componentId);
            }
        }
        componentTree.delete(componentId);
        parentMap.delete(componentId);
    }
    function setParentChild(parentId, childId) {
        parentMap.set(childId, parentId);
        if (!componentTree.has(parentId)) {
            componentTree.set(parentId, {
                componentId: parentId,
                parentComponentId: parentMap.get(parentId) ?? null,
                typeName: null,
                childComponentIds: [],
                renderCount: 0,
                lastRenderedTimestamp: 0
            });
        }
        if (!componentTree.has(childId)) {
            componentTree.set(childId, {
                componentId: childId,
                parentComponentId: parentId,
                typeName: null,
                childComponentIds: [],
                renderCount: 0,
                lastRenderedTimestamp: 0
            });
        }
        const parent = componentTree.get(parentId);
        if (!parent.childComponentIds.includes(childId)) {
            parent.childComponentIds.push(childId);
        }
        const child = componentTree.get(childId);
        child.parentComponentId = parentId;
    }
    async function sendUpdatesToRegistry(updatedIds, disposedIds) {
        if (!dotNetRef)
            return;
        try {
            // Send hierarchy updates
            for (const componentId of updatedIds) {
                const node = componentTree.get(componentId);
                if (node) {
                    await dotNetRef.invokeMethodAsync('ResolveComponentFromJs', {
                        componentId: node.componentId,
                        parentComponentId: node.parentComponentId,
                        typeName: node.typeName
                    });
                }
            }
            // Send disposals
            for (const componentId of disposedIds) {
                await dotNetRef.invokeMethodAsync('DisposeComponentFromJs', componentId);
            }
            // Send render updates
            for (const componentId of updatedIds) {
                await dotNetRef.invokeMethodAsync('UpdateComponentRenderFromJs', componentId);
            }
        }
        catch (e) {
            // Registry call errors
        }
    }
    // ═══════════════════════════════════════════════════════════════
    // CONTENT SCRIPT COMMUNICATION
    // ═══════════════════════════════════════════════════════════════
    function postToContentScript(type, data) {
        window.postMessage({ source: 'blazor-devtools-injected', type, data }, '*');
    }
    // Listen for requests from content script
    window.addEventListener('message', async (event) => {
        if (event.source !== window)
            return;
        if (event.data?.source !== 'blazor-devtools-content')
            return;
        const { id, method, args } = event.data;
        try {
            let result;
            switch (method) {
                case 'getAllComponents':
                    result = await getAllComponents();
                    break;
                case 'getComponent':
                    result = await getComponent(args[0]);
                    break;
                case 'getCircuitId':
                    result = await getCircuitId();
                    break;
                case 'getComponentCount':
                    result = await getComponentCount();
                    break;
                case 'getComponentTree':
                    result = Array.from(componentTree.values());
                    break;
                case 'getParentMap':
                    result = Object.fromEntries(parentMap);
                    break;
                case 'isReady':
                    result = isReady;
                    break;
                case 'isPillar3Hooked':
                    result = pillar3Hooked;
                    break;
                default:
                    throw new Error(`Unknown method: ${method}`);
            }
            postToContentScript('RESPONSE', { id, result });
        }
        catch (error) {
            postToContentScript('RESPONSE', {
                id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });
    // ═══════════════════════════════════════════════════════════════
    // START
    // ═══════════════════════════════════════════════════════════════
    initialize();
})();

/******/ })()
;
//# sourceMappingURL=injected.js.map