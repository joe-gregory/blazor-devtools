// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - event-emitter.ts
// ═══════════════════════════════════════════════════════════════════════════════
//
// Handles real-time lifecycle events pushed from .NET BlazorDevToolsComponentBase.
// Provides subscription mechanism for UI components to react to events.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { LifecycleEvent } from './types';

/**
 * Event handler callback type.
 */
export type EventHandler = (event: LifecycleEvent) => void;

/**
 * Filter function for selective event subscription.
 */
export type EventFilter = (event: LifecycleEvent) => boolean;

/**
 * Subscription handle returned when subscribing.
 */
export interface Subscription {
    /** Unsubscribe from events */
    unsubscribe(): void;
}

/**
 * Emitter for lifecycle events pushed from .NET.
 * Allows multiple subscribers with optional filtering.
 */
export class EventEmitter {
    private handlers: Map<number, { handler: EventHandler; filter?: EventFilter }> = new Map();
    private nextId = 0;
    private eventLog: LifecycleEvent[] = [];
    private maxLogSize = 1000;

    /**
     * Emit an event to all subscribers.
     * Called by .NET when a lifecycle event occurs.
     */
    emit(event: LifecycleEvent): void {
        // Log the event
        this.eventLog.push(event);
        if (this.eventLog.length > this.maxLogSize) {
            this.eventLog.shift();
        }

        // Notify subscribers
        for (const { handler, filter } of this.handlers.values()) {
            if (!filter || filter(event)) {
                try {
                    handler(event);
                } catch (err) {
                    console.error('[BDT] Event handler error:', err);
                }
            }
        }
    }

    /**
     * Subscribe to all lifecycle events.
     * @param handler Callback to receive events
     * @returns Subscription handle for unsubscribing
     */
    subscribe(handler: EventHandler): Subscription {
        return this.subscribeFiltered(handler);
    }

    /**
     * Subscribe with a filter function.
     * @param handler Callback to receive events
     * @param filter Function to filter events (return true to receive)
     * @returns Subscription handle for unsubscribing
     */
    subscribeFiltered(handler: EventHandler, filter?: EventFilter): Subscription {
        const id = this.nextId++;
        this.handlers.set(id, { handler, filter });

        return {
            unsubscribe: () => {
                this.handlers.delete(id);
            }
        };
    }

    /**
     * Subscribe to events for a specific component.
     * @param componentId Component ID to filter by
     * @param handler Callback to receive events
     */
    subscribeToComponent(componentId: number, handler: EventHandler): Subscription {
        return this.subscribeFiltered(handler, e => e.componentId === componentId);
    }

    /**
     * Subscribe to specific event types.
     * @param eventTypes Array of event type names to listen for
     * @param handler Callback to receive events
     */
    subscribeToEventTypes(eventTypes: string[], handler: EventHandler): Subscription {
        const typeSet = new Set(eventTypes);
        return this.subscribeFiltered(handler, e => typeSet.has(e.eventType));
    }

    /**
     * Get recent events from the log.
     * @param count Number of recent events to return (default: 100)
     */
    getRecentEvents(count = 100): LifecycleEvent[] {
        return this.eventLog.slice(-count);
    }

    /**
     * Get events for a specific component.
     * @param componentId Component ID to filter by
     */
    getEventsForComponent(componentId: number): LifecycleEvent[] {
        return this.eventLog.filter(e => e.componentId === componentId);
    }

    /**
     * Clear the event log.
     */
    clearLog(): void {
        this.eventLog = [];
    }

    /**
     * Set the maximum event log size.
     * @param size Maximum number of events to retain
     */
    setMaxLogSize(size: number): void {
        this.maxLogSize = size;
        while (this.eventLog.length > this.maxLogSize) {
            this.eventLog.shift();
        }
    }

    /**
     * Get the current number of subscribers.
     */
    getSubscriberCount(): number {
        return this.handlers.size;
    }
}
