// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - time-scale.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Pure time-axis math for the timeline flamegraph.
//
// Blazor render events are bursty: dozens of events within a few milliseconds,
// followed by seconds of idle time. On a linear axis the bursts collapse into
// unreadable slivers separated by empty space. This module builds piecewise-
// linear mappings between REAL time (ms since recording start) and VIRTUAL time
// (the coordinate space the flamegraph is drawn in):
//
//   - buildTimeScale     — linear wall-clock axis, optionally compressing long
//                          idle gaps down to thin, clearly-marked "cuts"
//   - buildSequenceScale — the "subway map": x-position reflects event ORDER,
//                          not wall-clock distance. Every consecutive pair of
//                          event timestamps gets the same visual spacing, and
//                          notable real pauses are annotated so elapsed time
//                          is still communicated ("+1.2s" markers).
//
// All mappings are strictly monotonic, so zooming, panning, and hit-testing
// operate in virtual space and remain consistent with what is drawn.
//
// This file is intentionally free of DOM/browser dependencies so it can be
// unit-tested in isolation.
//
// ═══════════════════════════════════════════════════════════════════════════════

/** A half-open interval of activity on the real-time axis. */
export interface TimeInterval {
    startMs: number;
    endMs: number;
}

/** An idle gap that has been compressed on the virtual axis. */
export interface CollapsedGap {
    /** Real time at which the gap begins (end of previous activity). */
    realStartMs: number;
    /** Real time at which the gap ends (start of next activity). */
    realEndMs: number;
    /** How much real time the cut hides (realEnd - realStart). */
    skippedMs: number;
    /** Virtual position where the cut begins. */
    virtualStartMs: number;
    /** Width of the cut on the virtual axis. */
    virtualWidthMs: number;
}

export interface TimeScaleOptions {
    /** When false, the scale is the identity mapping (no gaps collapsed). */
    collapseGaps: boolean;
    /** A gap must be at least this long (ms) to be collapsed. */
    minGapMs?: number;
    /** A gap must also span at least this fraction of the domain to be collapsed. */
    minGapDomainFraction?: number;
    /**
     * Virtual width given to each collapsed gap, as a fraction of the total
     * non-collapsed (kept) time. Keeps cuts visible but thin.
     */
    collapsedGapFraction?: number;
}

/** One piece of the piecewise-linear real↔virtual mapping. */
interface ScaleSegment {
    realStartMs: number;
    realEndMs: number;
    virtualStartMs: number;
    virtualEndMs: number;
}

export interface TimeScale {
    domainStartMs: number;
    domainEndMs: number;
    /** Total extent of the virtual axis (equals domain length when nothing is collapsed). */
    virtualTotalMs: number;
    /** Gaps that were collapsed, in ascending time order. */
    gaps: CollapsedGap[];
    /** Map real time → virtual time. Clamps to the domain. */
    toVirtual(realMs: number): number;
    /** Map virtual time → real time. Clamps to the virtual extent. */
    toReal(virtualMs: number): number;
}

// Fixed threshold: any idle stretch longer than this is worth cutting. This is
// deliberately NOT relative to the recording length — on a long recording a
// one-second gap is just as dead as on a short one.
const DEFAULT_MIN_GAP_MS = 300;
const DEFAULT_MIN_GAP_DOMAIN_FRACTION = 0;
const DEFAULT_COLLAPSED_GAP_FRACTION = 0.02;

/** In sequence mode, real pauses at least this long get an elapsed-time marker. */
const DEFAULT_SEQUENCE_GAP_LABEL_MS = 100;

/**
 * Merge possibly-overlapping activity intervals into a sorted, disjoint list.
 */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
    const sorted = intervals
        .filter(i => i.endMs >= i.startMs)
        .slice()
        .sort((a, b) => a.startMs - b.startMs);

    const merged: TimeInterval[] = [];
    for (const interval of sorted) {
        const last = merged[merged.length - 1];
        if (last && interval.startMs <= last.endMs) {
            last.endMs = Math.max(last.endMs, interval.endMs);
        } else {
            merged.push({ ...interval });
        }
    }
    return merged;
}

/**
 * Find the idle gaps between activity intervals that are worth collapsing.
 */
export function findCollapsibleGaps(
    activity: TimeInterval[],
    domainStartMs: number,
    domainEndMs: number,
    minGapMs: number,
): TimeInterval[] {
    const gaps: TimeInterval[] = [];
    for (let i = 0; i < activity.length - 1; i++) {
        const gapStart = activity[i].endMs;
        const gapEnd = activity[i + 1].startMs;
        if (gapEnd - gapStart >= minGapMs && gapStart >= domainStartMs && gapEnd <= domainEndMs) {
            gaps.push({ startMs: gapStart, endMs: gapEnd });
        }
    }
    return gaps;
}

function identityScale(domainStartMs: number, domainEndMs: number): TimeScale {
    const length = Math.max(domainEndMs - domainStartMs, 0);
    return {
        domainStartMs,
        domainEndMs,
        virtualTotalMs: length,
        gaps: [],
        toVirtual: (realMs) => clamp(realMs - domainStartMs, 0, length),
        toReal: (virtualMs) => domainStartMs + clamp(virtualMs, 0, length),
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Build a time scale over [domainStartMs, domainEndMs] that (optionally)
 * compresses idle gaps between the given activity intervals.
 */
export function buildTimeScale(
    intervals: TimeInterval[],
    domainStartMs: number,
    domainEndMs: number,
    options: TimeScaleOptions,
): TimeScale {
    const domainLength = domainEndMs - domainStartMs;
    if (!options.collapseGaps || domainLength <= 0) {
        return identityScale(domainStartMs, domainEndMs);
    }

    const minGapMs = Math.max(
        options.minGapMs ?? DEFAULT_MIN_GAP_MS,
        domainLength * (options.minGapDomainFraction ?? DEFAULT_MIN_GAP_DOMAIN_FRACTION),
    );

    const activity = mergeIntervals(intervals);
    const gapsToCollapse = findCollapsibleGaps(activity, domainStartMs, domainEndMs, minGapMs);
    if (gapsToCollapse.length === 0) {
        return identityScale(domainStartMs, domainEndMs);
    }

    const skippedTotal = gapsToCollapse.reduce((sum, g) => sum + (g.endMs - g.startMs), 0);
    const keptTotal = domainLength - skippedTotal;
    const gapVirtualWidth = Math.max(
        keptTotal * (options.collapsedGapFraction ?? DEFAULT_COLLAPSED_GAP_FRACTION),
        Number.EPSILON,
    );

    // Build alternating kept/collapsed segments covering the whole domain.
    const segments: ScaleSegment[] = [];
    const gaps: CollapsedGap[] = [];
    let realCursor = domainStartMs;
    let virtualCursor = 0;

    for (const gap of gapsToCollapse) {
        // Kept segment before this gap (1:1 mapping).
        if (gap.startMs > realCursor) {
            const length = gap.startMs - realCursor;
            segments.push({
                realStartMs: realCursor,
                realEndMs: gap.startMs,
                virtualStartMs: virtualCursor,
                virtualEndMs: virtualCursor + length,
            });
            virtualCursor += length;
        }
        // The collapsed gap itself (compressed mapping).
        segments.push({
            realStartMs: gap.startMs,
            realEndMs: gap.endMs,
            virtualStartMs: virtualCursor,
            virtualEndMs: virtualCursor + gapVirtualWidth,
        });
        gaps.push({
            realStartMs: gap.startMs,
            realEndMs: gap.endMs,
            skippedMs: gap.endMs - gap.startMs,
            virtualStartMs: virtualCursor,
            virtualWidthMs: gapVirtualWidth,
        });
        virtualCursor += gapVirtualWidth;
        realCursor = gap.endMs;
    }

    // Trailing kept segment.
    if (realCursor < domainEndMs) {
        const length = domainEndMs - realCursor;
        segments.push({
            realStartMs: realCursor,
            realEndMs: domainEndMs,
            virtualStartMs: virtualCursor,
            virtualEndMs: virtualCursor + length,
        });
        virtualCursor += length;
    }

    return makeSegmentedScale(segments, domainStartMs, domainEndMs, gaps);
}

/**
 * Build a "subway map" scale over the given event start times: consecutive
 * distinct timestamps are spaced uniformly, so x-position communicates ORDER
 * rather than wall-clock distance. Real pauses of at least `gapLabelMs` are
 * reported in `gaps` so the UI can annotate elapsed time between bursts.
 *
 * `domainEndMs` should be the end of the last event (start + duration) so
 * trailing durations still fit on the axis.
 */
export function buildSequenceScale(
    startTimesMs: number[],
    domainEndMs: number,
    gapLabelMs: number = DEFAULT_SEQUENCE_GAP_LABEL_MS,
): TimeScale {
    // Knots: distinct event start times, plus the domain end as the final stop.
    const knots = [...new Set(startTimesMs)].sort((a, b) => a - b);
    if (knots.length === 0) {
        return identityScale(0, 0);
    }
    const domainStartMs = knots[0];
    const end = Math.max(domainEndMs, knots[knots.length - 1]);
    if (end > knots[knots.length - 1]) {
        knots.push(end);
    }
    if (knots.length === 1) {
        // Single instant — nothing to space out.
        return identityScale(domainStartMs, domainStartMs);
    }

    // One uniform virtual slot between each pair of consecutive knots.
    const SLOT = 1;
    const segments: ScaleSegment[] = [];
    const gaps: CollapsedGap[] = [];
    for (let i = 0; i < knots.length - 1; i++) {
        const virtualStart = i * SLOT;
        segments.push({
            realStartMs: knots[i],
            realEndMs: knots[i + 1],
            virtualStartMs: virtualStart,
            virtualEndMs: virtualStart + SLOT,
        });

        const elapsed = knots[i + 1] - knots[i];
        if (elapsed >= gapLabelMs) {
            // Annotate the middle fifth of the slot so the marker sits between
            // the two events rather than on top of either.
            gaps.push({
                realStartMs: knots[i],
                realEndMs: knots[i + 1],
                skippedMs: elapsed,
                virtualStartMs: virtualStart + SLOT * 0.4,
                virtualWidthMs: SLOT * 0.2,
            });
        }
    }

    return makeSegmentedScale(segments, domainStartMs, end, gaps);
}

/** Wrap a sorted list of piecewise-linear segments into a TimeScale. */
function makeSegmentedScale(
    segments: ScaleSegment[],
    domainStartMs: number,
    domainEndMs: number,
    gaps: CollapsedGap[],
): TimeScale {
    const virtualTotalMs = segments.length > 0 ? segments[segments.length - 1].virtualEndMs : 0;

    const toVirtual = (realMs: number): number => {
        const t = clamp(realMs, domainStartMs, domainEndMs);
        for (const seg of segments) {
            if (t <= seg.realEndMs) {
                const realSpan = seg.realEndMs - seg.realStartMs;
                const fraction = realSpan > 0 ? (t - seg.realStartMs) / realSpan : 0;
                return seg.virtualStartMs + fraction * (seg.virtualEndMs - seg.virtualStartMs);
            }
        }
        return virtualTotalMs;
    };

    const toReal = (virtualMs: number): number => {
        const v = clamp(virtualMs, 0, virtualTotalMs);
        for (const seg of segments) {
            if (v <= seg.virtualEndMs) {
                const virtualSpan = seg.virtualEndMs - seg.virtualStartMs;
                const fraction = virtualSpan > 0 ? (v - seg.virtualStartMs) / virtualSpan : 0;
                return seg.realStartMs + fraction * (seg.realEndMs - seg.realStartMs);
            }
        }
        return domainEndMs;
    };

    return { domainStartMs, domainEndMs, virtualTotalMs, gaps, toVirtual, toReal };
}
