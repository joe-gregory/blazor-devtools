// Tests for the element picker's DOM→component mapping and mode lifecycle.
// The mapping reads the `_blazorEvents_<n>` expandos that blazor.web.js's
// EventDelegator stamps on handler-bearing elements (see core/picker.ts).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findOwnerComponentId, startPicker, stopPicker, isPickerActive, lowestCommonAncestor } from '../src/core/picker';

/** Stamp an element the way Blazor's EventDelegator does. */
function stampBlazorEvents(el: Element, componentId: number, shape: 'flat' | 'handlers' | 'map' = 'flat'): void {
    const entry = { renderingComponentId: componentId };
    let value: unknown;
    switch (shape) {
        case 'flat': value = { click: entry }; break;
        case 'handlers': value = { handlers: { click: entry } }; break;
        case 'map': value = new Map([['click', entry]]); break;
    }
    (el as unknown as Record<string, unknown>)['_blazorEvents_2'] = value;
}

describe('findOwnerComponentId', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        stopPicker(false);
    });

    it('reads the componentId from a stamped element', () => {
        const btn = document.createElement('button');
        stampBlazorEvents(btn, 5);
        document.body.appendChild(btn);

        expect(findOwnerComponentId(btn)).toMatchObject({ componentId: 5, element: btn });
    });

    it('climbs to the nearest stamped ancestor', () => {
        document.body.innerHTML = '<div id="outer"><section><span id="inner">text</span></section></div>';
        const outer = document.getElementById('outer')!;
        stampBlazorEvents(outer, 9);

        const result = findOwnerComponentId(document.getElementById('inner'));
        expect(result).toMatchObject({ componentId: 9, element: outer });
    });

    it('prefers the closest stamped element over higher ancestors', () => {
        document.body.innerHTML = '<div id="parent"><button id="child"></button></div>';
        stampBlazorEvents(document.getElementById('parent')!, 1);
        stampBlazorEvents(document.getElementById('child')!, 2);

        expect(findOwnerComponentId(document.getElementById('child'))!.componentId).toBe(2);
    });

    it.each(['flat', 'handlers', 'map'] as const)('tolerates the %s expando shape', (shape) => {
        const el = document.createElement('div');
        stampBlazorEvents(el, 42, shape);
        document.body.appendChild(el);

        expect(findOwnerComponentId(el)!.componentId).toBe(42);
    });

    it('returns null when no ancestor is stamped', () => {
        document.body.innerHTML = '<div><p id="plain">static</p></div>';
        expect(findOwnerComponentId(document.getElementById('plain'))).toBeNull();
    });

    it('ignores unrelated expandos', () => {
        const el = document.createElement('div');
        (el as unknown as Record<string, unknown>)['_someOtherLib_1'] = { renderingComponentId: 99 };
        document.body.appendChild(el);
        expect(findOwnerComponentId(el)).toBeNull();
    });
});

describe('lowestCommonAncestor', () => {
    it('finds the enclosing container of a component\'s handler elements', () => {
        // Mirrors the OrderBuilder card case: a card whose + and − buttons
        // share a componentId should highlight the whole card.
        document.body.innerHTML = `
            <div id="card"><h5>Apples</h5>
                <div class="controls"><button id="minus">−</button><button id="plus">+</button></div>
            </div>`;
        const lca = lowestCommonAncestor([
            document.getElementById('minus')!,
            document.getElementById('plus')!,
        ]);
        expect(lca).toBe(document.querySelector('.controls'));
        const withHeader = lowestCommonAncestor([
            document.getElementById('plus')!,
            document.querySelector('h5')!,
        ]);
        expect(withHeader).toBe(document.getElementById('card'));
    });

    it('returns the element itself for a single-element list', () => {
        document.body.innerHTML = '<button id="only"></button>';
        const only = document.getElementById('only')!;
        expect(lowestCommonAncestor([only])).toBe(only);
    });
});

describe('picker mode lifecycle', () => {
    let target: HTMLElement;

    beforeEach(() => {
        stopPicker(false);
        document.body.innerHTML = '<main><button id="target">Click</button></main>';
        target = document.getElementById('target')!;
        stampBlazorEvents(target, 7);
        // jsdom does not implement elementsFromPoint.
        document.elementsFromPoint = () => [target];
    });

    function captureEl(): HTMLElement {
        return document.querySelector('[data-bdt-picker-capture]') as HTMLElement;
    }

    function mouseMove(): void {
        captureEl().dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
    }

    it('highlights the hovered component and picks it on click', async () => {
        const onPick = vi.fn();
        const onStop = vi.fn();
        startPicker({
            getComponentLabel: async () => 'Counter',
            onPick,
            onStop,
        });
        expect(isPickerActive()).toBe(true);

        mouseMove();
        const overlay = document.querySelector('[data-bdt-picker-overlay]') as HTMLElement;
        const label = document.querySelector('[data-bdt-picker-label]') as HTMLElement;
        expect(overlay.style.display).toBe('block');
        expect(label.textContent).toContain('#7');
        await new Promise(r => setTimeout(r, 0)); // async label enrichment
        expect(label.textContent).toBe('<Counter> #7');

        captureEl().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(onPick).toHaveBeenCalledWith(7);
        expect(onStop).toHaveBeenCalled();
        expect(isPickerActive()).toBe(false);
        expect(document.querySelector('[data-bdt-picker-overlay]')).toBeNull();
    });

    it('exits without picking on Escape', () => {
        const onPick = vi.fn();
        const onStop = vi.fn();
        startPicker({ getComponentLabel: async () => null, onPick, onStop });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        expect(onPick).not.toHaveBeenCalled();
        expect(onStop).toHaveBeenCalled();
        expect(isPickerActive()).toBe(false);
    });

    it('is idempotent: double start does not duplicate overlays', () => {
        const cb = { getComponentLabel: async () => null, onPick: vi.fn(), onStop: vi.fn() };
        startPicker(cb);
        startPicker(cb);
        expect(document.querySelectorAll('[data-bdt-picker-overlay]')).toHaveLength(1);
        stopPicker(false);
    });
});
