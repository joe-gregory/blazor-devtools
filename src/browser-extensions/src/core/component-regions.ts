// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - component-regions.ts (shared, PAGE context)
// ═══════════════════════════════════════════════════════════════════════════════
//
// DOM ↔ Blazor-component mapping shared by the element picker and the
// render-highlighter. Must run in the page's MAIN world, because the mapping
// relies on expando properties Blazor's runtime attaches to DOM nodes —
// invisible from a content script's isolated world.
//
// HOW THE MAPPING WORKS (no markers, no framework patching):
//   blazor.web.js's EventDelegator stamps every element that has a Blazor
//   event handler (@onclick, @oninput, ...) with a string-keyed expando:
//       element["_blazorEvents_<rendererId>"] = {
//           handlers: { [eventName]: { renderingComponentId, ... } } | flat map
//       }
//   `renderingComponentId` is the per-instance componentId of the component
//   whose render tree declared the handler. Components with no event handlers
//   anywhere in their markup resolve to their closest handler-bearing ancestor
//   component (documented limitation; render-tree-frame walking can refine
//   this later).
//
// ═══════════════════════════════════════════════════════════════════════════════

export interface OwnedElement {
    componentId: number;
    /** The DOM element the componentId was found on. */
    element: Element;
}

const EVENTS_EXPANDO_PATTERN = /^_blazorEvents_\d+$/;

// componentId → its handler-bearing elements, scanned lazily and rebuilt when
// re-renders disconnect any cached entry.
let componentElements: Map<number, Element[]> | null = null;

/** Drop the scan cache (call when entering/leaving a mode that uses regions). */
export function invalidateRegionCache(): void {
    componentElements = null;
}

/**
 * Find the componentId owning `start`, by climbing to the nearest ancestor
 * stamped by Blazor's EventDelegator.
 */
export function findOwnerComponentId(start: Element | null): OwnedElement | null {
    for (let el: Element | null = start; el; el = el.parentElement) {
        const componentId = readRenderingComponentId(el);
        if (componentId !== null) {
            return { componentId, element: el };
        }
    }
    return null;
}

/** Extract renderingComponentId from an element's _blazorEvents_* expando, if any. */
export function readRenderingComponentId(el: Element): number | null {
    for (const key of Object.getOwnPropertyNames(el)) {
        if (!EVENTS_EXPANDO_PATTERN.test(key)) continue;
        const found = deepFindRenderingComponentId((el as unknown as Record<string, unknown>)[key], 0);
        if (found !== null) return found;
    }
    return null;
}

/**
 * The EventDelegator's expando shape has shifted across framework versions
 * (nested per-event-name maps, .handlers wrappers, ...). Rather than pin one
 * shape, search shallowly for the well-known `renderingComponentId` field.
 */
function deepFindRenderingComponentId(value: unknown, depth: number): number | null {
    if (value === null || typeof value !== 'object' || depth > 3) return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.renderingComponentId === 'number') return obj.renderingComponentId;
    for (const key of Object.keys(obj)) {
        const found = deepFindRenderingComponentId(obj[key], depth + 1);
        if (found !== null) return found;
    }
    if (value instanceof Map) {
        for (const entry of value.values()) {
            const found = deepFindRenderingComponentId(entry, depth + 1);
            if (found !== null) return found;
        }
    }
    return null;
}

/** Lowest common ancestor of a non-empty element list. */
export function lowestCommonAncestor(elements: Element[]): Element | null {
    let lca: Element = elements[0];
    for (const el of elements.slice(1)) {
        while (!lca.contains(el)) {
            if (!lca.parentElement) return null;
            lca = lca.parentElement;
        }
    }
    return lca;
}

/** The scan cache, rebuilt when re-renders disconnect any of its entries. */
export function freshComponentElements(): Map<number, Element[]> {
    if (!componentElements || isScanStale(componentElements)) {
        componentElements = scanComponentElements();
    }
    return componentElements;
}

function isScanStale(map: Map<number, Element[]>): boolean {
    for (const elements of Array.from(map.values())) {
        if (elements.some(el => !el.isConnected)) return true;
    }
    return false;
}

/** One pass over the DOM grouping handler-bearing elements by componentId. */
function scanComponentElements(): Map<number, Element[]> {
    const map = new Map<number, Element[]>();
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const componentId = readRenderingComponentId(el);
        if (componentId !== null) {
            let list = map.get(componentId);
            if (!list) {
                list = [];
                map.set(componentId, list);
            }
            list.push(el);
        }
    }
    return map;
}

/**
 * The element best representing a component's full DOM extent: the lowest
 * common ancestor of all elements stamped with its componentId. Null when the
 * component has no stamped elements on the page.
 */
export function componentRegion(componentId: number): Element | null {
    const elements = freshComponentElements().get(componentId);
    if (!elements || elements.length === 0) return null;
    return lowestCommonAncestor(elements);
}
