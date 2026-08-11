import { describe, it, expect } from 'vitest';
import { serializeSession, parseSession } from '../src/core/session-io';
import type { TimelineEvent, ComponentRanking } from '../src/core/types';

const EVENTS = [
    { eventId: 0, relativeTimestampMs: 1, componentId: 1, componentName: 'Counter', eventType: 'BuildRenderTree', durationMs: 2 },
    { eventId: 1, relativeTimestampMs: 500, componentId: 2, componentName: 'NavMenu', eventType: 'BuildRenderTree', durationMs: 3 },
] as unknown as TimelineEvent[];

const RANKED = [
    { componentName: 'Counter', componentId: 1, renderCount: 1, totalRenderTimeMs: 2, averageRenderTimeMs: 2 },
] as unknown as ComponentRanking[];

describe('session-io', () => {
    it('round-trips a session', () => {
        const json = serializeSession(EVENTS, RANKED, '1.0.0-beta.6');
        const session = parseSession(json);
        expect(session.events).toEqual(EVENTS);
        expect(session.rankedComponents).toEqual(RANKED);
        expect(session.exportedAt).not.toBe('unknown');
    });

    it('rejects arbitrary JSON', () => {
        expect(() => parseSession('{"foo": 1}')).toThrow(/not a bdt/i);
    });

    it('rejects non-JSON', () => {
        expect(() => parseSession('<html>')).toThrow(/not a valid json/i);
    });

    it('rejects sessions from a newer format version', () => {
        const json = serializeSession(EVENTS, RANKED).replace('"formatVersion": 1', '"formatVersion": 99');
        expect(() => parseSession(json)).toThrow(/newer than this extension/i);
    });

    it('rejects malformed events', () => {
        const json = JSON.stringify({
            format: 'bdt-timeline-session',
            formatVersion: 1,
            exportedAt: 'x',
            events: [{ nope: true }],
            rankedComponents: [],
        });
        expect(() => parseSession(json)).toThrow(/malformed/i);
    });
});
