import { describe, it, expect } from 'vitest';
import { deriveCommits } from '../src/core/commits';
import type { TimelineEvent } from '../src/core/types';

function ev(overrides: Partial<TimelineEvent>): TimelineEvent {
    return {
        eventId: 0,
        relativeTimestampMs: 0,
        componentId: 1,
        componentName: 'Counter',
        eventType: 'BuildRenderTree',
        durationMs: 2,
        endRelativeTimestampMs: null,
        parentEventId: null,
        triggeringEventId: null,
        triggerReason: 'Unknown',
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

describe('deriveCommits', () => {
    it('clusters events separated by large gaps into distinct commits', () => {
        const commits = deriveCommits([
            ev({ eventId: 0, relativeTimestampMs: 0, durationMs: 2 }),
            ev({ eventId: 1, relativeTimestampMs: 5, durationMs: 3 }),
            ev({ eventId: 2, relativeTimestampMs: 5000, durationMs: 4 }),
        ]);
        expect(commits).toHaveLength(2);
        expect(commits[0].renderCount).toBe(2);
        expect(commits[0].totalRenderMs).toBe(5);
        expect(commits[1].renderCount).toBe(1);
        expect(commits[1].startMs).toBe(5000);
        expect(commits.map(c => c.index)).toEqual([0, 1]);
    });

    it('keeps events within the gap threshold in one commit', () => {
        // Chained events 40ms apart (< 50ms default gap) stay together.
        const commits = deriveCommits([
            ev({ eventId: 0, relativeTimestampMs: 0, durationMs: 1 }),
            ev({ eventId: 1, relativeTimestampMs: 40, durationMs: 1 }),
            ev({ eventId: 2, relativeTimestampMs: 80, durationMs: 1 }),
        ]);
        expect(commits).toHaveLength(1);
        expect(commits[0].renderCount).toBe(3);
    });

    it('measures the gap from the cluster END, not its start', () => {
        // A 100ms-long render followed 30ms after its end by another event:
        // still one commit even though the starts are 130ms apart.
        const commits = deriveCommits([
            ev({ eventId: 0, relativeTimestampMs: 0, durationMs: 100 }),
            ev({ eventId: 1, relativeTimestampMs: 130, durationMs: 2 }),
        ]);
        expect(commits).toHaveLength(1);
    });

    it('drops clusters containing no render work', () => {
        const commits = deriveCommits([
            ev({ eventId: 0, relativeTimestampMs: 0, durationMs: 2 }),
            // Isolated lifecycle-only cluster: not a commit.
            ev({ eventId: 1, relativeTimestampMs: 5000, eventType: 'StateHasChanged', durationMs: 0 }),
        ]);
        expect(commits).toHaveLength(1);
    });

    it('builds a per-component breakdown sorted slowest-first', () => {
        const commits = deriveCommits([
            ev({ eventId: 0, relativeTimestampMs: 0, componentId: 1, componentName: 'Fast', durationMs: 1 }),
            ev({ eventId: 1, relativeTimestampMs: 2, componentId: 2, componentName: 'Slow', durationMs: 9 }),
            ev({ eventId: 2, relativeTimestampMs: 4, componentId: 1, componentName: 'Fast', durationMs: 1 }),
        ]);
        expect(commits).toHaveLength(1);
        const [slow, fast] = commits[0].components;
        expect(slow).toMatchObject({ componentName: 'Slow', durationMs: 9, renderCount: 1 });
        expect(fast).toMatchObject({ componentName: 'Fast', durationMs: 2, renderCount: 2, firstEventId: 0 });
    });

    it('handles unsorted input and empty input', () => {
        expect(deriveCommits([])).toEqual([]);
        const commits = deriveCommits([
            ev({ eventId: 1, relativeTimestampMs: 5000, durationMs: 1 }),
            ev({ eventId: 0, relativeTimestampMs: 0, durationMs: 1 }),
        ]);
        expect(commits).toHaveLength(2);
        expect(commits[0].startMs).toBe(0);
    });
});
