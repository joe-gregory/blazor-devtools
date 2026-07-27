// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - picker.ts (shared, PAGE context)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Element picker: DevTools-style "inspect" mode that maps DOM elements back to
// Blazor component instances. Runs in the page's MAIN world (loaded via
// bridge.js). The DOM↔component mapping lives in component-regions.ts, shared
// with the render-highlighter.
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
    type OwnedElement,
    findOwnerComponentId,
    freshComponentElements,
    invalidateRegionCache,
    lowestCommonAncestor,
} from './component-regions';

export { findOwnerComponentId, lowestCommonAncestor } from './component-regions';

export type PickResult = OwnedElement;

export interface PickerCallbacks {
    /** Resolve a componentId to a display name (may be async via the bridge). */
    getComponentLabel(componentId: number): Promise<string | null>;
    /** User clicked a component in picker mode. */
    onPick(componentId: number): void;
    /** Picker exited (Escape, click, or programmatic stop). */
    onStop(): void;
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

export function isPickerActive(): boolean {
    return active;
}

export function startPicker(cb: PickerCallbacks): void {
    if (active) return;
    active = true;
    callbacks = cb;
    invalidateRegionCache();
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
    invalidateRegionCache();
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
    // element (e.g. a card component highlights the entire card, even though
    // only its buttons carry Blazor handlers).
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

/**
 * The element best representing the component's full DOM extent. Never
 * highlights something smaller than what was actually resolved (fallback
 * picks already carry their extent as the element).
 */
function componentExtentElement(pick: PickResult): Element {
    const elements = freshComponentElements().get(pick.componentId);
    if (!elements || elements.length === 0) return pick.element;
    const lca = lowestCommonAncestor(elements) ?? pick.element;
    return lca.contains(pick.element) ? lca : pick.element;
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
