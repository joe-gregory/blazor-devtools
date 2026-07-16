// Behavior tests for the shared timeline panel, run against the real
// panel.html markup in jsdom with a faked extension transport.
//
// These cover the regressions reported in GitHub issues:
//   #47 — selecting an event must render its details

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { initializeTimelinePanel, __resetForTests, type CallApi } from '../src/core/timeline-panel';
import type { TimelineEvent } from '../src/core/types';

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/** Events shaped exactly like TimelineEventDto from the NuGet package. */
function makeEvent(overrides: Partial<TimelineEvent>): TimelineEvent {
    return {
        eventId: 0,
        relativeTimestampMs: 0,
        componentId: 1,
        componentName: 'Counter',
        eventType: 'BuildRenderTree',
        durationMs: 2.5,
        endRelativeTimestampMs: null,
        parentEventId: null,
        triggeringEventId: null,
        triggerReason: 'StateHasChangedCalled',
        triggerDetails: null,
        isAsync: false,
        isFirstRender: false,
        wasSkipped: false,
        isEnhanced: false,
        batchId: null,
        metadata: null,
        ...overrides,
    } as TimelineEvent;
}

/** A bursty recording: activity around 0-15ms and around 5000ms — with a big idle gap. */
const BURSTY_EVENTS: TimelineEvent[] = [
    makeEvent({ eventId: 0, relativeTimestampMs: 1, componentName: 'Counter', eventType: 'OnInitialized', durationMs: 0.5, isFirstRender: true, triggerReason: 'FirstRender' }),
    makeEvent({ eventId: 1, relativeTimestampMs: 3, componentName: 'Counter', durationMs: 4 }),
    makeEvent({ eventId: 2, relativeTimestampMs: 8, componentName: 'NavMenu', componentId: 2, durationMs: 3 }),
    makeEvent({ eventId: 3, relativeTimestampMs: 5000, componentName: 'Counter', durationMs: 5, triggerDetails: 'count parameter changed' }),
    makeEvent({ eventId: 4, relativeTimestampMs: 5010, componentName: 'NavMenu', componentId: 2, durationMs: 2 }),
];

const RANKED = [
    { componentName: 'Counter', componentId: 1, renderCount: 3, totalRenderTimeMs: 9.5, averageRenderTimeMs: 3.17, maxRenderTimeMs: 5, minRenderTimeMs: 0.5 },
];

function makeFakeApi(events: TimelineEvent[]): { api: CallApi; calls: string[] } {
    const calls: string[] = [];
    const api: CallApi = async <T>(method: string, ..._args: unknown[]): Promise<T> => {
        calls.push(method);
        switch (method) {
            case 'GetTimelineEvents': return events as unknown as T;
            case 'GetTimelineEventsSince': return [] as unknown as T;
            case 'GetRankedComponents': return RANKED as unknown as T;
            default: return undefined as unknown as T;
        }
    };
    return { api, calls };
}

/** Load the real timeline markup from the shared panel.html. */
function loadPanelDom(): void {
    const html = readFileSync(path.resolve(__dirname, '../src/shared/panel/panel.html'), 'utf-8');
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
    document.body.innerHTML = bodyMatch![1].replace(/<script[\s\S]*?<\/script>/g, '');
}

function click(el: Element): void {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function flushAsync(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

/** Record → stop, so the panel holds the fixture events. */
async function recordAndStop(): Promise<void> {
    click(document.getElementById('timeline-record-btn')!);
    await flushAsync();
    click(document.getElementById('timeline-stop-btn')!);
    await flushAsync();
}

function switchToView(view: string): void {
    click(document.querySelector(`.timeline-view-tab[data-view="${view}"]`)!);
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('timeline panel', () => {
    beforeEach(() => {
        __resetForTests();
        loadPanelDom();
        localStorage.clear();
    });

    it('renders recorded events in the events view', async () => {
        initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
        await recordAndStop();

        const rows = document.querySelectorAll('.event-row');
        expect(rows).toHaveLength(BURSTY_EVENTS.length);
        expect(document.getElementById('timeline-stats')!.textContent).toContain('events');
    });

    it('shows event details when a row is clicked (#47)', async () => {
        initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
        await recordAndStop();

        const row = document.querySelector('.event-row[data-event-id="3"]')!;
        click(row);

        const details = document.getElementById('timeline-details')!;
        expect(details.textContent).not.toContain('Select an event to view details');
        expect(details.textContent).toContain('Counter');
        expect(details.textContent).toContain('Why Did This Render?');
        expect(details.textContent).toContain('count parameter changed');
        expect(row.classList.contains('selected') ||
            document.querySelector('.event-row[data-event-id="3"]')!.classList.contains('selected')).toBe(true);
    });

    it('shows event details when a flamegraph event is clicked (#47)', async () => {
        initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
        await recordAndStop();
        switchToView('flamegraph');

        const eventEl = document.querySelector('.swimlane-event[data-event-id="1"]')!;
        click(eventEl);

        const details = document.getElementById('timeline-details')!;
        expect(details.textContent).toContain('Build Render Tree');
        expect(details.textContent).toContain('Counter');
    });

    describe('disconnected page handling', () => {
        // Regression: page reloads/navigations made every panel->page call an
        // "Uncaught (in promise) Could not establish connection" entry in the
        // extension error log.

        it('shows a connection warning instead of throwing when record fails', async () => {
            const failingApi: CallApi = async () => {
                throw new Error('Could not establish connection. Receiving end does not exist.');
            };
            initializeTimelinePanel(failingApi);

            click(document.getElementById('timeline-record-btn')!);
            await flushAsync();

            expect(document.getElementById('timeline-stats')!.textContent).toContain('Lost connection');
            // Panel did not get stuck in a recording state.
            expect((document.getElementById('timeline-stop-btn') as HTMLButtonElement).disabled).toBe(true);
        });

        it('stops recording after repeated poll failures', async () => {
            vi.useFakeTimers();
            try {
                let polls = 0;
                const api: CallApi = async <T>(method: string): Promise<T> => {
                    if (method === 'GetTimelineEventsSince') {
                        polls++;
                        throw new Error('Receiving end does not exist.');
                    }
                    if (method === 'GetTimelineEvents') return [] as unknown as T;
                    if (method === 'GetRankedComponents') return [] as unknown as T;
                    return undefined as unknown as T;
                };
                initializeTimelinePanel(api);

                click(document.getElementById('timeline-record-btn')!);
                await vi.advanceTimersByTimeAsync(0); // let startRecording resolve
                expect((document.getElementById('timeline-stop-btn') as HTMLButtonElement).disabled).toBe(false);

                await vi.advanceTimersByTimeAsync(2500); // > MAX_POLL_FAILURES * 500ms

                expect(polls).toBeGreaterThanOrEqual(4);
                expect(document.getElementById('timeline-stats')!.textContent).toContain('Lost connection');
                expect((document.getElementById('timeline-stop-btn') as HTMLButtonElement).disabled).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    it('does not double-register handlers when initialized twice', async () => {
        const { api, calls } = makeFakeApi(BURSTY_EVENTS);
        initializeTimelinePanel(api);
        initializeTimelinePanel(api); // second call must be a no-op

        click(document.getElementById('timeline-record-btn')!);
        await flushAsync();

        expect(calls.filter(c => c === 'StartTimelineRecording')).toHaveLength(1);
    });

    describe('flamegraph axis modes', () => {
        function selectAxisMode(mode: string): void {
            const select = document.getElementById('axis-mode-select') as HTMLSelectElement;
            select.value = mode;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        it('defaults to the sequence (subway) view with elapsed-pause markers', async () => {
            initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
            await recordAndStop();
            switchToView('flamegraph');

            expect(document.querySelector('.swimlane-container')).not.toBeNull();
            const select = document.getElementById('axis-mode-select') as HTMLSelectElement;
            expect(select.value).toBe('sequence');
            // The ~5s pause between bursts gets separator markers and a "+" chip.
            expect(document.querySelectorAll('.swimlane-seq-gap').length).toBeGreaterThan(0);
            const chip = document.querySelector('.time-cut-chip')!;
            expect(chip.textContent).toMatch(/^\+/);
            expect(document.getElementById('swimlane-stats')!.textContent).toContain('pause');
            // No hatched cuts in sequence mode.
            expect(document.querySelectorAll('.swimlane-cut')).toHaveLength(0);
        });

        it('spaces bursty events uniformly in sequence mode', async () => {
            initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
            await recordAndStop();
            switchToView('flamegraph');

            // Events at 1ms and 5000ms are consecutive stops on the subway map:
            // their x-positions must be commensurate, not 3 orders of magnitude apart.
            const lefts = [...document.querySelectorAll<HTMLElement>('.swimlane-event')]
                .map(el => parseFloat(el.style.left));
            const max = Math.max(...lefts);
            const nonZero = lefts.filter(l => l > 0);
            expect(max).toBeGreaterThan(50); // late events sit well across the axis
            expect(Math.min(...nonZero)).toBeGreaterThan(10); // early events are not crushed at 0
        });

        it('renders fixed-size station badges in sequence mode only', async () => {
            initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
            await recordAndStop();
            switchToView('flamegraph');

            // Sequence (default): events carry the subway styling class.
            expect(document.querySelectorAll('.swimlane-event.seq').length).toBeGreaterThan(0);

            selectAxisMode('time');
            await vi.waitFor(() => {
                expect(document.querySelectorAll('.swimlane-event.seq')).toHaveLength(0);
            });
            // Time mode still renders the events, just without subway styling.
            expect(document.querySelectorAll('.swimlane-event').length).toBeGreaterThan(0);
        });

        it('switches to hatched cuts in time-collapsed mode and persists the preference', async () => {
            initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
            await recordAndStop();
            switchToView('flamegraph');

            selectAxisMode('time-collapsed');
            await vi.waitFor(() => {
                expect(document.querySelectorAll('.swimlane-cut').length).toBeGreaterThan(0);
            });
            expect(document.querySelectorAll('.swimlane-seq-gap')).toHaveLength(0);
            expect(document.getElementById('swimlane-stats')!.textContent).toContain('idle');
            expect(localStorage.getItem('bdt-timeline-axis-mode')).toBe('time-collapsed');
        });

        it('renders a plain proportional axis in time mode', async () => {
            initializeTimelinePanel(makeFakeApi(BURSTY_EVENTS).api);
            await recordAndStop();
            switchToView('flamegraph');

            selectAxisMode('time');
            await vi.waitFor(() => {
                expect(document.querySelectorAll('.swimlane-seq-gap')).toHaveLength(0);
            });
            expect(document.querySelectorAll('.swimlane-cut')).toHaveLength(0);
            expect(document.querySelectorAll('.time-cut-chip')).toHaveLength(0);
        });

        it('marks no pauses when events are dense', async () => {
            const dense = BURSTY_EVENTS.map((e, i) => ({ ...e, relativeTimestampMs: i * 10 }));
            initializeTimelinePanel(makeFakeApi(dense).api);
            await recordAndStop();
            switchToView('flamegraph');

            expect(document.querySelector('.swimlane-container')).not.toBeNull();
            expect(document.querySelectorAll('.swimlane-seq-gap')).toHaveLength(0);
            expect(document.querySelectorAll('.time-cut-chip')).toHaveLength(0);
        });
    });
});
