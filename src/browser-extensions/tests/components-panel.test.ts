// Behavior tests for the shared Components panel: tree rendering, search,
// and the hide-framework-components filter — run against the real panel.html
// markup in jsdom with a faked host transport.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
    initializeComponentsPanel,
    __resetComponentsPanelForTests,
    type ComponentsPanelHost,
} from '../src/core/components-panel';
import type { ComponentInfo } from '../src/core/types';

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

function makeComponent(overrides: Partial<ComponentInfo>): ComponentInfo {
    return {
        componentId: 0,
        typeName: 'Component',
        typeFullName: null,
        sourceFile: null,
        lineNumber: null,
        parentComponentId: null,
        renderCount: 0,
        createdAt: '2026-08-04T00:00:00Z',
        lastRenderedAt: null,
        hasEnhancedMetrics: false,
        isPending: false,
        parameters: null,
        trackedState: null,
        internalState: null,
        metrics: null,
        ...overrides,
    } as unknown as ComponentInfo;
}

/**
 * A realistic Blazor Web App tree:
 *   Router #0
 *   └─ CascadingValue`1 #1
 *      └─ MainLayout #2
 *         ├─ NavMenu #3
 *         └─ OrderBuilder #4
 *            ├─ ProductCardBasic #5
 *            └─ ProductCardOptimized #6
 */
const TREE: ComponentInfo[] = [
    makeComponent({ componentId: 0, typeName: 'Router' }),
    makeComponent({ componentId: 1, typeName: 'CascadingValue`1', parentComponentId: 0 }),
    makeComponent({ componentId: 2, typeName: 'MainLayout', parentComponentId: 1 }),
    makeComponent({ componentId: 3, typeName: 'NavMenu', parentComponentId: 2 }),
    makeComponent({ componentId: 4, typeName: 'OrderBuilder', parentComponentId: 2 }),
    makeComponent({ componentId: 5, typeName: 'ProductCardBasic', parentComponentId: 4 }),
    makeComponent({ componentId: 6, typeName: 'ProductCardOptimized', parentComponentId: 4 }),
];

function makeHost(components: ComponentInfo[], packageInfo?: { version: string; capabilities?: string[] }): ComponentsPanelHost {
    return {
        inspectedTabId: 1,
        extensionVersion: '1.0.0-beta.6',
        callApi: async <T>(method: string): Promise<T> => {
            if (method === 'GetAllComponentsDto') return components as unknown as T;
            if (method === 'GetPackageInfo') {
                if (!packageInfo) throw new Error("Method 'GetPackageInfo' not found"); // old package
                return packageInfo as unknown as T;
            }
            return undefined as unknown as T;
        },
        sendMessage: async () => undefined,
        onMessage: () => { },
    };
}

function loadPanelDom(): void {
    const html = readFileSync(path.resolve(__dirname, '../src/shared/panel/panel.html'), 'utf-8');
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, '');
}

async function flushAsync(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function visibleNames(): string[] {
    return [...document.querySelectorAll('.component-node .component-name')]
        .map(el => el.textContent!.trim());
}

function search(query: string): void {
    const input = document.getElementById('tree-search') as HTMLInputElement;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickFilter(): void {
    document.getElementById('filter-btn')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** The tree auto-expands only two levels on load; expand everything. */
function expandAll(): void {
    for (let i = 0; i < 10; i++) {
        const collapsed = [...document.querySelectorAll('.tree-toggle:not(.expanded)')];
        if (collapsed.length === 0) break;
        collapsed.forEach(t => t.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('components panel', () => {
    beforeEach(async () => {
        __resetComponentsPanelForTests();
        loadPanelDom();
        localStorage.clear();
        initializeComponentsPanel(makeHost(TREE));
        await flushAsync();
    });

    afterEach(() => {
        __resetComponentsPanelForTests();
    });

    it('renders the full tree with hierarchy and count', () => {
        expandAll();
        expect(visibleNames()).toHaveLength(TREE.length);
        expect(document.getElementById('component-count')!.textContent).toBe('(7)');
        // Children render nested under their parent container.
        const orderBuilderChildren = document.querySelector('.tree-children[data-parent="4"]')!;
        expect(orderBuilderChildren.textContent).toContain('ProductCardBasic');
        expect(orderBuilderChildren.textContent).toContain('ProductCardOptimized');
    });

    it('selecting a node shows its details', () => {
        expandAll();
        const node = document.querySelector('.component-node[data-id="4"]')!;
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(node.classList.contains('selected')).toBe(true);
        expect(document.getElementById('component-details')!.textContent).toContain('OrderBuilder');
    });

    describe('search', () => {
        it('narrows the tree to matches plus their ancestors, with highlight', () => {
            search('product');

            const names = visibleNames();
            // Matches
            expect(names).toContain('ProductCardBasic');
            expect(names).toContain('ProductCardOptimized');
            // Ancestors kept so hierarchy reads
            expect(names).toContain('OrderBuilder');
            expect(names).toContain('Router');
            // Non-matching siblings dropped
            expect(names).not.toContain('NavMenu');

            expect(document.querySelectorAll('mark.search-match')).toHaveLength(2);
            expect(document.getElementById('component-count')!.textContent).toBe('2 matches');
        });

        it('is case-insensitive', () => {
            search('NAVMENU');
            expect(visibleNames()).toContain('NavMenu');
            expect(document.getElementById('component-count')!.textContent).toBe('1 match');
        });

        it('shows an empty state when nothing matches', () => {
            search('zzz');
            expect(document.querySelector('#component-tree .loading')!.textContent)
                .toContain('No components match');
        });

        it('clearing the query restores the full tree', () => {
            expandAll();
            search('product');
            search('');
            expect(visibleNames()).toHaveLength(TREE.length);
            expect(document.getElementById('component-count')!.textContent).toBe('(7)');
        });
    });

    describe('version handshake', () => {
        it('shows both versions when the package supports GetPackageInfo', async () => {
            __resetComponentsPanelForTests();
            loadPanelDom();
            initializeComponentsPanel(makeHost(TREE, { version: '1.0.0-beta.8', capabilities: ['render-batches'] }));
            await flushAsync();
            await flushAsync(); // handshake resolves after the first refresh

            expect(document.getElementById('version-info')!.textContent)
                .toBe('ext 1.0.0-beta.6 · pkg 1.0.0-beta.8');
        });

        it('degrades gracefully when the package predates the handshake', async () => {
            // Default host throws "method not found" for GetPackageInfo (old package).
            await flushAsync();
            expect(document.getElementById('version-info')!.textContent)
                .toBe('ext 1.0.0-beta.6 · pkg older (no handshake)');
            expect(document.getElementById('version-info')!.title).toContain('dotnet add package');
        });
    });

    describe('hide framework components', () => {
        it('hides framework components and re-parents their children', () => {
            clickFilter();

            const names = visibleNames();
            expect(names).not.toContain('Router');
            expect(names).not.toContain('CascadingValue`1');
            expect(names).toContain('MainLayout');
            // MainLayout is re-parented to root (its ancestors were hidden).
            const mainLayout = document.querySelector('.component-node[data-id="2"]') as HTMLElement;
            expect(mainLayout.style.paddingLeft).toBe('8px'); // depth 0
            expect(document.getElementById('component-count')!.textContent).toBe('(5 of 7)');
        });

        it('persists the preference and shows the button as active', () => {
            clickFilter();
            expect(localStorage.getItem('bdt-components-hide-framework')).toBe('1');
            expect(document.getElementById('filter-btn')!.classList.contains('active')).toBe(true);

            clickFilter();
            expect(localStorage.getItem('bdt-components-hide-framework')).toBe('0');
            expandAll();
            expect(visibleNames()).toHaveLength(TREE.length);
        });

        it('composes with search (search runs over the filtered set)', () => {
            clickFilter();
            search('router');
            expect(document.getElementById('component-count')!.textContent).toBe('0 matches');

            search('main');
            expect(visibleNames()).toEqual(['MainLayout']);
        });
    });
});
