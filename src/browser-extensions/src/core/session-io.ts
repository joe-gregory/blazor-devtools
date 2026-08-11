// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - session-io.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Export/import of timeline profiling sessions as JSON, React-DevTools style:
// record once, save the session, attach it to a bug report or open it on a
// colleague's machine. Pure serialize/parse logic — no DOM — for unit testing.
//
// ═══════════════════════════════════════════════════════════════════════════════

import type { TimelineEvent, ComponentRanking } from './types';

/** Distinguishes BDT session files from arbitrary JSON. */
const FORMAT = 'bdt-timeline-session';
/** Bump when the session shape changes incompatibly; parse checks <= current. */
const FORMAT_VERSION = 1;

export interface SessionFile {
    format: typeof FORMAT;
    formatVersion: number;
    exportedAt: string;
    extensionVersion?: string;
    events: TimelineEvent[];
    rankedComponents: ComponentRanking[];
}

export interface SessionData {
    events: TimelineEvent[];
    rankedComponents: ComponentRanking[];
    exportedAt: string;
}

export function serializeSession(
    events: TimelineEvent[],
    rankedComponents: ComponentRanking[],
    extensionVersion?: string,
): string {
    const file: SessionFile = {
        format: FORMAT,
        formatVersion: FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        extensionVersion,
        events,
        rankedComponents,
    };
    return JSON.stringify(file, null, 2);
}

/**
 * Parse and validate a session file. Throws an Error with a user-presentable
 * message on anything that isn't a valid BDT session.
 */
export function parseSession(json: string): SessionData {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        throw new Error('Not a valid JSON file');
    }

    const file = raw as Partial<SessionFile>;
    if (file?.format !== FORMAT) {
        throw new Error('Not a BDT timeline session file');
    }
    if (typeof file.formatVersion !== 'number' || file.formatVersion > FORMAT_VERSION) {
        throw new Error(`Session format v${file.formatVersion} is newer than this extension supports — update the extension`);
    }
    if (!Array.isArray(file.events)) {
        throw new Error('Session file has no events');
    }
    for (const e of file.events) {
        if (typeof e?.eventId !== 'number' || typeof e?.relativeTimestampMs !== 'number' || typeof e?.eventType !== 'string') {
            throw new Error('Session file contains malformed events');
        }
    }

    return {
        events: file.events,
        rankedComponents: Array.isArray(file.rankedComponents) ? file.rankedComponents : [],
        exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : 'unknown',
    };
}
