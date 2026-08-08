// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - commits.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Commit derivation for the React-DevTools-style profiler view: one "commit"
// per burst of rendering work, so a recording reads as a series of discrete
// updates rather than a soup of events.
//
// The NuGet package's render-batch recording (TimelineRecorder.RecordBatchStart)
// is not wired to the Renderer yet, so events carry no usable BatchId. Instead
// commits are derived CLIENT-SIDE by time-clustering: consecutive events whose
// start lies within GAP_MS of the cluster's end belong to the same commit.
// Blazor completes a render batch in single-digit milliseconds while distinct
// user interactions are spaced by 100ms+, so a small gap threshold separates
// them cleanly. When real BatchIds land in a future package, this module can
// prefer them and keep clustering as the fallback.
//
// Pure logic — no DOM — for unit testing.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { TimelineEvent } from './types';

/** Events that represent actual render work (a component producing output). */
const RENDER_EVENT_TYPES = new Set(['BuildRenderTree', 'ComponentRendered']);

/** New commit when the next event starts more than this after the cluster end. */
export const COMMIT_GAP_MS = 50;

export interface CommitComponent {
    componentId: number;
    componentName: string;
    /** Sum of BuildRenderTree durations for this component in the commit. */
    durationMs: number;
    /** Number of render events for this component in the commit. */
    renderCount: number;
    /** Event id of the component's first render event (for selection). */
    firstEventId: number;
}

export interface Commit {
    /** 0-based position in the recording. */
    index: number;
    startMs: number;
    endMs: number;
    /** Sum of all BuildRenderTree durations in the commit. */
    totalRenderMs: number;
    /** Number of render events in the commit. */
    renderCount: number;
    /** Per-component breakdown, slowest first. */
    components: CommitComponent[];
    /** Every event in the cluster (renders and lifecycle alike). */
    events: TimelineEvent[];
}

/**
 * Derive a recording's commits.
 *
 * Preferred source: real renderer batch ids — packages with the
 * "render-batches" capability stamp `batchId` on events, giving exact
 * boundaries. Falls back to time-clustering when batch ids are absent or
 * sparse (older packages), so the view works against any published NuGet.
 * Clusters containing no render work (only lifecycle noise) are dropped —
 * commits are about output.
 */
export function deriveCommits(events: TimelineEvent[], gapMs: number = COMMIT_GAP_MS): Commit[] {
    if (events.length === 0) return [];

    const renderEvents = events.filter(e => RENDER_EVENT_TYPES.has(e.eventType));
    const withBatchId = renderEvents.filter(e => e.batchId !== null && e.batchId !== undefined);
    if (renderEvents.length > 0 && withBatchId.length >= renderEvents.length * 0.9) {
        return commitsFromBatchIds(events);
    }

    return commitsFromClustering(events, gapMs);
}

/** Group events by the renderer's real batch ids. */
function commitsFromBatchIds(events: TimelineEvent[]): Commit[] {
    const byBatch = new Map<number, TimelineEvent[]>();
    for (const e of events) {
        if (e.batchId === null || e.batchId === undefined) continue;
        let list = byBatch.get(e.batchId);
        if (!list) {
            list = [];
            byBatch.set(e.batchId, list);
        }
        list.push(e);
    }

    const groups = Array.from(byBatch.values())
        .map(group => [...group].sort((a, b) => a.relativeTimestampMs - b.relativeTimestampMs))
        .sort((a, b) => a[0].relativeTimestampMs - b[0].relativeTimestampMs);

    const commits: Commit[] = [];
    for (const group of groups) {
        const commit = buildCommit(group, commits.length);
        if (commit) commits.push(commit);
    }
    return commits;
}

/** Fallback: cluster by time gaps (gap measured from the cluster's end). */
function commitsFromClustering(events: TimelineEvent[], gapMs: number): Commit[] {
    const sorted = [...events].sort((a, b) => a.relativeTimestampMs - b.relativeTimestampMs);

    interface Cluster { events: TimelineEvent[]; endMs: number; }
    const clusters: Cluster[] = [];
    let current: Cluster | null = null;

    for (const e of sorted) {
        const start = e.relativeTimestampMs;
        const end = start + (e.durationMs || 0);
        if (!current || start - current.endMs > gapMs) {
            current = { events: [], endMs: end };
            clusters.push(current);
        }
        current.events.push(e);
        current.endMs = Math.max(current.endMs, end);
    }

    const commits: Commit[] = [];
    for (const cluster of clusters) {
        const commit = buildCommit(cluster.events, commits.length, cluster.endMs);
        if (commit) commits.push(commit);
    }

    return commits;
}

/** Assemble a Commit from a group of events; null when it has no render work. */
function buildCommit(groupEvents: TimelineEvent[], index: number, endMs?: number): Commit | null {
    const renderEvents = groupEvents.filter(e => RENDER_EVENT_TYPES.has(e.eventType));
    if (renderEvents.length === 0) return null; // lifecycle-only noise

    const byComponent = new Map<number, CommitComponent>();
    for (const e of renderEvents) {
        let entry = byComponent.get(e.componentId);
        if (!entry) {
            entry = {
                componentId: e.componentId,
                componentName: e.componentName,
                durationMs: 0,
                renderCount: 0,
                firstEventId: e.eventId,
            };
            byComponent.set(e.componentId, entry);
        }
        entry.renderCount++;
        entry.durationMs += e.durationMs || 0;
    }

    const components = Array.from(byComponent.values())
        .sort((a, b) => b.durationMs - a.durationMs);

    return {
        index,
        startMs: groupEvents[0].relativeTimestampMs,
        endMs: endMs ?? Math.max(...groupEvents.map(e => e.relativeTimestampMs + (e.durationMs || 0))),
        totalRenderMs: components.reduce((sum, c) => sum + c.durationMs, 0),
        renderCount: renderEvents.length,
        components,
        events: groupEvents,
    };
}
