// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - picker.ts (shared, PAGE context)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Element picker: DevTools-style "inspect" mode that maps DOM elements back to
// Blazor component instances. Runs in the page's MAIN world (loaded via
// bridge.js), because the mapping relies on expando properties that Blazor's
// runtime attaches to DOM nodes — invisible from a content script's isolated
// world.
//
// HOW THE MAPPING WORKS (no markers, no framework patching):
//   blazor.web.js's EventDelegator stamps every element that has a Blazor
//   event handler (@onclick, @oninput, ...) with a string-keyed expando:
//       element["_blazorEvents_<rendererId>"] = {
//           handlers: { [eventName]: { renderingComponentId, ... } } | flat map
//       }
//   `renderingComponentId` is the per-instance componentId of the component
//   whose render tree declared the handler — exactly what the picker needs.
//   We climb from the hovered element to the nearest ancestor carrying one of
//   these expandos. Components with no event handlers anywhere in their markup
//   resolve to their closest handler-bearing ancestor component (documented
//   MVP limitation; render-tree-frame walking can refine this later).
//
// ═══════════════════════════════════════════════════════════════════════════════

export interface PickResult {
    componentId: number;
    /** The DOM element the componentId was found on (highlight anchor). */
    element: Element;
}

export interface PickerCallbacks {
    /** Resolve a componentId to a display name (may be async via the bridge). */
    getComponentLabel(componentId: number): Promise<string | null>;
    /** User clicked a component in picker mode. */
    onPick(componentId: number): void;
    /** Picker exited (Escape, click, or programmatic stop). */
    onStop(): void;
}

const EVENTS_EXPANDO_PATTERN = /^_blazorEvents_\d+$/;

/**
 * Find the componentId owning `start`, by climbing to the nearest ancestor
 * stamped by Blazor's EventDelegator. Exported for unit testing.
 */
export function findOwnerComponentId(start: Element | null): PickResult | null {
    for (let el: Element | null = start; el; el = el.parentElement) {
        const componentId = readRenderingComponentId(el);
        if (componentId !== null) {
            return { componentId, element: el };
        }
    }
    return null;
}

/** Extract renderingComponentId from an element's _blazorEvents_* expando, if any. */
function readRenderingComponentId(el: Element): number | null {
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

// ─────────────────────────────────────────────────────────────────────────────
// PICKER MODE (overlay + interaction)
// ─────────────────────────────────────────────────────────────────────────────

let active = false;
let callbacks: PickerCallbacks | null = null;
let capture: HTMLDivElement | null = null;
let overlay: HTMLDivElement | null = null;
let label: HTMLDivElement | null = null;
let currentPick: PickResult | null = null;
let labelRequestToken = 0;
// componentId → its handler-bearing elements, scanned lazily once per session.
let componentElements: Map<number, Element[]> | null = null;

export function isPickerActive(): boolean {
    return active;
}

export function startPicker(cb: PickerCallbacks): void {
    if (active) return;
    active = true;
    callbacks = cb;
    componentElements = null;
    createOverlay();
    // All mouse interaction happens on the capture layer, NOT the page. This
    // is how browser devtools pickers work: disabled controls (which suppress
    // mouse events) remain pickable, and the page sees no hover side-effects.
    capture!.addEventListener('mousemove', onMouseMove, true);
    capture!.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
}

export function stopPicker(notify = true): void {
    if (!active) return;
    active = false;
    document.removeEventListener('keydown', onKeyDown, true);
    capture?.remove();
    overlay?.remove();
    label?.remove();
    capture = null;
    overlay = null;
    label = null;
    currentPick = null;
    componentElements = null;
    if (notify) callbacks?.onStop();
    callbacks = null;
}

function createOverlay(): void {
    capture = document.createElement('div');
    capture.setAttribute('data-bdt-picker-capture', '');
    Object.assign(capture.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483645',
        cursor: 'crosshair',
        background: 'transparent',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(capture);

    overlay = document.createElement('div');
    overlay.setAttribute('data-bdt-picker-overlay', '');
    Object.assign(overlay.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483646',
        background: 'rgba(81, 43, 212, 0.18)',
        outline: '2px solid #512bd4',
        borderRadius: '2px',
        display: 'none',
        transition: 'all 0.05s ease-out',
    } as Partial<CSSStyleDeclaration>);

    label = document.createElement('div');
    label.setAttribute('data-bdt-picker-label', '');
    Object.assign(label.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483647',
        background: '#512bd4',
        color: '#fff',
        font: '12px/1.6 Consolas, monospace',
        padding: '1px 8px',
        borderRadius: '3px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        display: 'none',
        maxWidth: '60vw',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);

    document.body.appendChild(overlay);
    document.body.appendChild(label);
}

function onMouseMove(e: MouseEvent): void {
    // Hit-test through our own layers to the page element under the cursor.
    const start = document.elementsFromPoint(e.clientX, e.clientY)
        .find(el => !el.hasAttribute('data-bdt-picker-capture')
            && !el.hasAttribute('data-bdt-picker-overlay')
            && !el.hasAttribute('data-bdt-picker-label')) ?? null;

    const pick = resolvePick(start);
    if (pick?.componentId === currentPick?.componentId && pick?.element === currentPick?.element) return;
    currentPick = pick;

    if (!pick || !overlay || !label) {
        if (overlay) overlay.style.display = 'none';
        if (label) label.style.display = 'none';
        return;
    }

    // Outline the component's whole DOM region, not just the handler-bearing
    // element: the lowest common ancestor of every element owned by this
    // componentId (e.g. a card component highlights the entire card, even
    // though only its buttons carry Blazor handlers).
    const rect = componentExtentElement(pick).getBoundingClientRect();
    Object.assign(overlay.style, {
        display: 'block',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
    });

    label.style.display = 'block';
    label.textContent = `Component #${pick.componentId}`;
    positionLabel(rect);

    // Enrich the label with the component name asynchronously.
    const token = ++labelRequestToken;
    callbacks?.getComponentLabel(pick.componentId).then(name => {
        if (token !== labelRequestToken || !label || !currentPick) return;
        if (name) label.textContent = `<${name}> #${currentPick.componentId}`;
    }).catch(() => { /* bridge unavailable — keep the id-only label */ });
}

/**
 * Resolve the hovered element to a component. Two strategies:
 *  1. Climb to the nearest ancestor stamped by Blazor's EventDelegator.
 *  2. When nothing above is stamped (hovering a card's static text, or a
 *     disabled control that CSS excludes from hit-testing via
 *     pointer-events:none — Bootstrap does this for .btn:disabled), find the
 *     SMALLEST component region that contains the hovered element instead.
 * Exported for unit testing.
 */
export function resolvePick(start: Element | null): PickResult | null {
    if (!start) return null;

    const direct = findOwnerComponentId(start);
    if (direct) return direct;

    let best: { componentId: number; element: Element; depth: number } | null = null;
    for (const [componentId, elements] of Array.from(freshComponentElements())) {
        const extent = lowestCommonAncestor(elements);
        if (!extent || extent === document.body || extent === document.documentElement) continue;
        if (!extent.contains(start)) continue;
        const depth = ancestorDepth(extent);
        if (!best || depth > best.depth) {
            best = { componentId, element: extent, depth };
        }
    }
    return best ? { componentId: best.componentId, element: best.element } : null;
}

function ancestorDepth(el: Element): number {
    let depth = 0;
    for (let cur = el.parentElement; cur; cur = cur.parentElement) depth++;
    return depth;
}

/** The scan cache, rebuilt when re-renders disconnect any of its entries. */
function freshComponentElements(): Map<number, Element[]> {
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

/**
 * The element best representing the component's full DOM extent: the lowest
 * common ancestor of all elements stamped with the same componentId. Falls
 * back to the picked element itself when it is the only one.
 */
function componentExtentElement(pick: PickResult): Element {
    const elements = freshComponentElements().get(pick.componentId);
    if (!elements || elements.length === 0) return pick.element;
    const lca = lowestCommonAncestor(elements) ?? pick.element;
    // Never highlight something smaller than what was actually resolved
    // (fallback picks already carry their extent as the element).
    return lca.contains(pick.element) ? lca : pick.element;
}

/** Lowest common ancestor of a non-empty element list. Exported for testing. */
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

function positionLabel(rect: DOMRect): void {
    if (!label) return;
    const top = rect.top >= 28 ? rect.top - 26 : rect.bottom + 4;
    label.style.left = `${Math.max(4, rect.left)}px`;
    label.style.top = `${top}px`;
}

function onClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const pick = currentPick;
    const cb = callbacks;
    stopPicker(false);
    if (pick && cb) {
        cb.onPick(pick.componentId);
    }
    cb?.onStop();
}

function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopPicker();
    }
}
