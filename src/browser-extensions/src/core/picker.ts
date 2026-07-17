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
    createOverlay();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.documentElement.style.cursor = 'crosshair';
}

export function stopPicker(notify = true): void {
    if (!active) return;
    active = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.documentElement.style.cursor = '';
    overlay?.remove();
    label?.remove();
    overlay = null;
    label = null;
    currentPick = null;
    if (notify) callbacks?.onStop();
    callbacks = null;
}

function createOverlay(): void {
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
    const target = document.elementFromPoint(e.clientX, e.clientY);
    // Ignore our own overlay elements (pointer-events:none should prevent
    // this, but elementFromPoint can still return them in edge cases).
    const start = target?.closest('[data-bdt-picker-overlay],[data-bdt-picker-label]')
        ? null
        : target;

    const pick = findOwnerComponentId(start);
    if (pick?.componentId === currentPick?.componentId && pick?.element === currentPick?.element) return;
    currentPick = pick;

    if (!pick || !overlay || !label) {
        if (overlay) overlay.style.display = 'none';
        if (label) label.style.display = 'none';
        return;
    }

    const rect = pick.element.getBoundingClientRect();
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
