// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - highlighter.ts (shared, PAGE context)
// ═══════════════════════════════════════════════════════════════════════════════
//
// "Highlight updates": flash a fading outline over components' DOM regions as
// they re-render, React-DevTools style. Makes wasted renders visible while the
// developer uses the app — the ShouldRender lesson as a light show.
//
// Detection: polls the registry (via a fetch callback the bridge supplies)
// for each component's (renderCount, lastRenderedAt) and flashes every
// component whose pair changed since the previous poll. Runs entirely in the
// page context — no extension messaging on the hot path.
//
// DOM regions come from component-regions.ts (shared with the picker).
//
// ═══════════════════════════════════════════════════════════════════════════════

import { componentRegion, invalidateRegionCache } from './component-regions';

/** The subset of ComponentInfoDto the highlighter needs. */
export interface ComponentRenderSnapshot {
    componentId: number;
    renderCount: number;
    lastRenderedAt: string | null;
}

export type FetchSnapshots = () => Promise<ComponentRenderSnapshot[]>;

const POLL_INTERVAL_MS = 400;
const FLASH_DURATION_MS = 700;

let active = false;
let timer: number | null = null;
let polling = false;
let baseline: Map<number, string> | null = null;
let fetchSnapshots: FetchSnapshots | null = null;
let flashLayer: HTMLDivElement | null = null;

export function isHighlighterActive(): boolean {
    return active;
}

export function startHighlighter(fetch: FetchSnapshots): void {
    if (active) return;
    active = true;
    fetchSnapshots = fetch;
    baseline = null;
    invalidateRegionCache();

    flashLayer = document.createElement('div');
    flashLayer.setAttribute('data-bdt-flash-layer', '');
    Object.assign(flashLayer.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '2147483644',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(flashLayer);

    timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll(); // establish the baseline immediately
}

export function stopHighlighter(): void {
    if (!active) return;
    active = false;
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
    flashLayer?.remove();
    flashLayer = null;
    baseline = null;
    fetchSnapshots = null;
    invalidateRegionCache();
}

async function poll(): Promise<void> {
    if (!active || !fetchSnapshots || polling) return;
    polling = true;
    try {
        const snapshots = await fetchSnapshots();
        if (!active) return;

        const next = new Map<number, string>();
        for (const s of snapshots) {
            next.set(s.componentId, `${s.renderCount}|${s.lastRenderedAt ?? ''}`);
        }

        const prev = baseline;
        baseline = next;
        if (!prev) return; // first poll only establishes the baseline

        for (const [componentId, key] of Array.from(next)) {
            if (prev.has(componentId) && prev.get(componentId) !== key) {
                flashComponent(componentId);
            }
        }
    } catch {
        // Transient bridge/page hiccup — keep the loop alive; the panel's own
        // connection handling covers persistent failures.
    } finally {
        polling = false;
    }
}

/** Paint one fading flash over the component's DOM region. */
function flashComponent(componentId: number): void {
    if (!flashLayer) return;
    const region = componentRegion(componentId);
    if (!region) return;

    const rect = region.getBoundingClientRect();
    const flash = document.createElement('div');
    flash.setAttribute('data-bdt-flash', '');
    flash.setAttribute('data-bdt-flash-component', String(componentId));
    Object.assign(flash.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        outline: '2px solid #22c55e',
        outlineOffset: '-1px',
        background: 'rgba(34, 197, 94, 0.10)',
        borderRadius: '2px',
        pointerEvents: 'none',
        opacity: '1',
        transition: `opacity ${FLASH_DURATION_MS}ms ease-out`,
    } as Partial<CSSStyleDeclaration>);
    flashLayer.appendChild(flash);

    // Fade on the next frame, then remove.
    requestAnimationFrame(() => {
        flash.style.opacity = '0';
    });
    window.setTimeout(() => flash.remove(), FLASH_DURATION_MS + 100);
}
