import { describe, it, expect } from 'vitest';
import { buildTimeScale, buildSequenceScale, mergeIntervals, findCollapsibleGaps, type TimeInterval } from '../src/core/time-scale';

const collapse = { collapseGaps: true };
const noCollapse = { collapseGaps: false };

describe('mergeIntervals', () => {
    it('merges overlapping and adjacent intervals', () => {
        const merged = mergeIntervals([
            { startMs: 0, endMs: 10 },
            { startMs: 5, endMs: 20 },
            { startMs: 20, endMs: 30 },
            { startMs: 100, endMs: 110 },
        ]);
        expect(merged).toEqual([
            { startMs: 0, endMs: 30 },
            { startMs: 100, endMs: 110 },
        ]);
    });

    it('sorts unordered input', () => {
        const merged = mergeIntervals([
            { startMs: 50, endMs: 60 },
            { startMs: 0, endMs: 10 },
        ]);
        expect(merged.map(m => m.startMs)).toEqual([0, 50]);
    });

    it('drops inverted intervals', () => {
        expect(mergeIntervals([{ startMs: 10, endMs: 5 }])).toEqual([]);
    });
});

describe('findCollapsibleGaps', () => {
    it('finds only gaps meeting the threshold', () => {
        const activity: TimeInterval[] = [
            { startMs: 0, endMs: 10 },
            { startMs: 100, endMs: 110 },   // 90ms gap
            { startMs: 5000, endMs: 5010 }, // 4890ms gap
        ];
        const gaps = findCollapsibleGaps(activity, 0, 6000, 500);
        expect(gaps).toEqual([{ startMs: 110, endMs: 5000 }]);
    });
});

describe('buildTimeScale', () => {
    // A bursty recording: activity at 0-10ms, 5000-5015ms, 10000-10005ms.
    const bursts: TimeInterval[] = [
        { startMs: 0, endMs: 10 },
        { startMs: 5000, endMs: 5015 },
        { startMs: 10000, endMs: 10005 },
    ];

    it('is the identity when collapsing is disabled', () => {
        const scale = buildTimeScale(bursts, 0, 10005, noCollapse);
        expect(scale.gaps).toHaveLength(0);
        expect(scale.virtualTotalMs).toBe(10005);
        expect(scale.toVirtual(5000)).toBe(5000);
        expect(scale.toReal(5000)).toBe(5000);
    });

    it('is the identity when there are no qualifying gaps', () => {
        const dense: TimeInterval[] = [
            { startMs: 0, endMs: 100 },
            { startMs: 110, endMs: 200 },
        ];
        const scale = buildTimeScale(dense, 0, 200, collapse);
        expect(scale.gaps).toHaveLength(0);
        expect(scale.virtualTotalMs).toBe(200);
    });

    it('collapses large idle gaps and shrinks the virtual axis', () => {
        const scale = buildTimeScale(bursts, 0, 10005, collapse);
        expect(scale.gaps).toHaveLength(2);
        expect(scale.gaps[0].skippedMs).toBe(4990); // 10 → 5000
        expect(scale.gaps[1].skippedMs).toBe(4985); // 5015 → 10000
        // Kept time is 30ms of activity; virtual total must be far below real total.
        expect(scale.virtualTotalMs).toBeLessThan(10005 * 0.05);
    });

    it('maps activity 1:1 within kept regions', () => {
        const scale = buildTimeScale(bursts, 0, 10005, collapse);
        // Distances inside a burst are preserved exactly.
        expect(scale.toVirtual(5010) - scale.toVirtual(5005)).toBeCloseTo(5, 6);
    });

    it('is monotonic and invertible on kept regions', () => {
        const scale = buildTimeScale(bursts, 0, 10005, collapse);
        const samples = [0, 5, 10, 5000, 5007, 5015, 10000, 10005];
        let prev = -Infinity;
        for (const t of samples) {
            const v = scale.toVirtual(t);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
            expect(scale.toReal(v)).toBeCloseTo(t, 6);
        }
    });

    it('maps a collapsed gap onto a thin virtual band', () => {
        const scale = buildTimeScale(bursts, 0, 10005, collapse);
        const gap = scale.gaps[0];
        // Halfway through the real gap lands inside the virtual band.
        const midGapVirtual = scale.toVirtual((gap.realStartMs + gap.realEndMs) / 2);
        expect(midGapVirtual).toBeGreaterThanOrEqual(gap.virtualStartMs);
        expect(midGapVirtual).toBeLessThanOrEqual(gap.virtualStartMs + gap.virtualWidthMs);
        // The band is a small fraction of the axis.
        expect(gap.virtualWidthMs).toBeLessThan(scale.virtualTotalMs * 0.1);
    });

    it('clamps out-of-domain inputs', () => {
        const scale = buildTimeScale(bursts, 0, 10005, collapse);
        expect(scale.toVirtual(-100)).toBe(0);
        expect(scale.toVirtual(99999)).toBe(scale.virtualTotalMs);
        expect(scale.toReal(-5)).toBe(0);
        expect(scale.toReal(scale.virtualTotalMs + 5)).toBe(10005);
    });

    it('handles an empty recording without dividing by zero', () => {
        const scale = buildTimeScale([], 0, 0, collapse);
        expect(scale.virtualTotalMs).toBe(0);
        expect(scale.toVirtual(0)).toBe(0);
        expect(scale.toReal(0)).toBe(0);
    });

    it('collapses a 1s gap regardless of recording length (fixed threshold)', () => {
        // Regression: the old threshold scaled with the domain (4%), so on a
        // 60s recording a 1s gap was never collapsed.
        const longRecording: TimeInterval[] = [
            { startMs: 0, endMs: 10 },
            { startMs: 1010, endMs: 1020 },      // 1s gap after burst 1
            { startMs: 60000, endMs: 60010 },    // most of the minute idle
        ];
        const scale = buildTimeScale(longRecording, 0, 60010, collapse);
        expect(scale.gaps.map(g => g.skippedMs)).toEqual([1000, 58980]);
    });
});

describe('buildSequenceScale', () => {
    // Bursts at 0/2/5ms, then 5000/5010ms — sequence view should space these evenly.
    const startTimes = [0, 2, 5, 5000, 5010];

    it('spaces consecutive event times uniformly', () => {
        const scale = buildSequenceScale(startTimes, 5015);
        const positions = startTimes.map(t => scale.toVirtual(t));
        // 5 start knots + final end knot -> uniform unit steps between starts.
        expect(positions).toEqual([0, 1, 2, 3, 4]);
        expect(scale.virtualTotalMs).toBe(5); // trailing segment to domain end
    });

    it('annotates real pauses above the label threshold', () => {
        const scale = buildSequenceScale(startTimes, 5015, 100);
        expect(scale.gaps).toHaveLength(1);
        expect(scale.gaps[0].skippedMs).toBe(4995); // 5 -> 5000
        // Marker sits between the two events' virtual positions.
        expect(scale.gaps[0].virtualStartMs).toBeGreaterThan(2);
        expect(scale.gaps[0].virtualStartMs + scale.gaps[0].virtualWidthMs).toBeLessThan(3);
    });

    it('is monotonic and maps ticks back to real station times', () => {
        const scale = buildSequenceScale(startTimes, 5015);
        let prev = -Infinity;
        for (let v = 0; v <= scale.virtualTotalMs; v += 0.25) {
            const t = scale.toReal(v);
            expect(t).toBeGreaterThanOrEqual(prev);
            prev = t;
            // Round-trip through the piecewise mapping is exact.
            expect(scale.toVirtual(t)).toBeCloseTo(v, 6);
        }
        expect(scale.toReal(3)).toBe(5000);
    });

    it('deduplicates identical timestamps', () => {
        const scale = buildSequenceScale([10, 10, 20], 20);
        expect(scale.toVirtual(10)).toBe(0);
        expect(scale.toVirtual(20)).toBe(1);
        expect(scale.virtualTotalMs).toBe(1);
    });

    it('handles empty and single-instant input', () => {
        expect(buildSequenceScale([], 0).virtualTotalMs).toBe(0);
        const single = buildSequenceScale([42], 42);
        expect(single.virtualTotalMs).toBe(0);
        expect(single.toReal(0)).toBe(42);
    });
});
