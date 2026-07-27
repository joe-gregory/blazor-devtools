// Tests for the render-highlighter: poll-and-diff detection plus the fading
// flash overlay. Regions come from the same _blazorEvents_ mapping the picker
// uses (see component-regions.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startHighlighter, stopHighlighter, isHighlighterActive, type ComponentRenderSnapshot } from '../src/core/highlighter';

function stampBlazorEvents(el: Element, componentId: number): void {
    (el as unknown as Record<string, unknown>)['_blazorEvents_2'] = {
        click: { renderingComponentId: componentId },
    };
}

/** A mutable fake registry the fetch callback reads from. */
function makeRegistry(initial: ComponentRenderSnapshot[]) {
    const state = new Map(initial.map(s => [s.componentId, { ...s }]));
    return {
        fetch: async () => Array.from(state.values()).map(s => ({ ...s })),
        render(componentId: number): void {
            const s = state.get(componentId)!;
            s.renderCount++;
            s.lastRenderedAt = `t${s.renderCount}`;
        },
        add(snapshot: ComponentRenderSnapshot): void {
            state.set(snapshot.componentId, { ...snapshot });
        },
    };
}

function flashesFor(componentId: number): number {
    return document.querySelectorAll(`[data-bdt-flash-component="${componentId}"]`).length;
}

describe('highlighter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <div id="card-a"><p>Apples</p><button id="a-btn">+</button></div>
            <div id="card-b"><p>Oranges</p><button id="b-btn">+</button></div>`;
        stampBlazorEvents(document.getElementById('a-btn')!, 1);
        stampBlazorEvents(document.getElementById('b-btn')!, 2);
    });

    afterEach(() => {
        stopHighlighter();
        vi.useRealTimers();
    });

    it('does not flash on the baseline poll', async () => {
        const registry = makeRegistry([
            { componentId: 1, renderCount: 3, lastRenderedAt: 't3' },
            { componentId: 2, renderCount: 1, lastRenderedAt: 't1' },
        ]);
        startHighlighter(registry.fetch);
        await vi.advanceTimersByTimeAsync(50);

        expect(isHighlighterActive()).toBe(true);
        expect(document.querySelectorAll('[data-bdt-flash]')).toHaveLength(0);
    });

    it('flashes only the component whose render count changed', async () => {
        const registry = makeRegistry([
            { componentId: 1, renderCount: 0, lastRenderedAt: null },
            { componentId: 2, renderCount: 0, lastRenderedAt: null },
        ]);
        startHighlighter(registry.fetch);
        await vi.advanceTimersByTimeAsync(50); // baseline

        registry.render(1);
        await vi.advanceTimersByTimeAsync(450); // next poll tick

        expect(flashesFor(1)).toBe(1);
        expect(flashesFor(2)).toBe(0);
    });

    it('removes flashes after the fade completes', async () => {
        const registry = makeRegistry([{ componentId: 1, renderCount: 0, lastRenderedAt: null }]);
        startHighlighter(registry.fetch);
        await vi.advanceTimersByTimeAsync(50);

        registry.render(1);
        await vi.advanceTimersByTimeAsync(450);
        expect(flashesFor(1)).toBe(1);

        await vi.advanceTimersByTimeAsync(1000); // > FLASH_DURATION_MS + margin
        expect(flashesFor(1)).toBe(0);
    });

    it('does not flash components that appear for the first time mid-session', async () => {
        // A newly created component has no baseline entry; flashing it would be
        // noise (it just mounted — the interesting signal is RE-renders).
        const registry = makeRegistry([{ componentId: 1, renderCount: 0, lastRenderedAt: null }]);
        startHighlighter(registry.fetch);
        await vi.advanceTimersByTimeAsync(50);

        registry.add({ componentId: 2, renderCount: 1, lastRenderedAt: 't1' });
        await vi.advanceTimersByTimeAsync(450);

        expect(flashesFor(2)).toBe(0);
    });

    it('keeps polling through transient fetch failures', async () => {
        let failNext = false;
        const registry = makeRegistry([{ componentId: 1, renderCount: 0, lastRenderedAt: null }]);
        const flakyFetch = async () => {
            if (failNext) {
                failNext = false;
                throw new Error('circuit hiccup');
            }
            return registry.fetch();
        };
        startHighlighter(flakyFetch);
        await vi.advanceTimersByTimeAsync(50); // baseline

        failNext = true;
        await vi.advanceTimersByTimeAsync(450); // failing poll — must not kill the loop

        registry.render(1);
        await vi.advanceTimersByTimeAsync(450);
        expect(flashesFor(1)).toBe(1);
    });

    it('stop removes the layer and halts polling', async () => {
        const registry = makeRegistry([{ componentId: 1, renderCount: 0, lastRenderedAt: null }]);
        startHighlighter(registry.fetch);
        await vi.advanceTimersByTimeAsync(50);

        stopHighlighter();
        expect(isHighlighterActive()).toBe(false);
        expect(document.querySelector('[data-bdt-flash-layer]')).toBeNull();

        registry.render(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(document.querySelectorAll('[data-bdt-flash]')).toHaveLength(0);
    });

    it('is idempotent on double start', async () => {
        const registry = makeRegistry([{ componentId: 1, renderCount: 0, lastRenderedAt: null }]);
        startHighlighter(registry.fetch);
        startHighlighter(registry.fetch);
        expect(document.querySelectorAll('[data-bdt-flash-layer]')).toHaveLength(1);
    });
});
