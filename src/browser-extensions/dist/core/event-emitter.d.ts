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
export declare class EventEmitter {
    private handlers;
    private nextId;
    private eventLog;
    private maxLogSize;
    /**
     * Emit an event to all subscribers.
     * Called by .NET when a lifecycle event occurs.
     */
    emit(event: LifecycleEvent): void;
    /**
     * Subscribe to all lifecycle events.
     * @param handler Callback to receive events
     * @returns Subscription handle for unsubscribing
     */
    subscribe(handler: EventHandler): Subscription;
    /**
     * Subscribe with a filter function.
     * @param handler Callback to receive events
     * @param filter Function to filter events (return true to receive)
     * @returns Subscription handle for unsubscribing
     */
    subscribeFiltered(handler: EventHandler, filter?: EventFilter): Subscription;
    /**
     * Subscribe to events for a specific component.
     * @param componentId Component ID to filter by
     * @param handler Callback to receive events
     */
    subscribeToComponent(componentId: number, handler: EventHandler): Subscription;
    /**
     * Subscribe to specific event types.
     * @param eventTypes Array of event type names to listen for
     * @param handler Callback to receive events
     */
    subscribeToEventTypes(eventTypes: string[], handler: EventHandler): Subscription;
    /**
     * Get recent events from the log.
     * @param count Number of recent events to return (default: 100)
     */
    getRecentEvents(count?: number): LifecycleEvent[];
    /**
     * Get events for a specific component.
     * @param componentId Component ID to filter by
     */
    getEventsForComponent(componentId: number): LifecycleEvent[];
    /**
     * Clear the event log.
     */
    clearLog(): void;
    /**
     * Set the maximum event log size.
     * @param size Maximum number of events to retain
     */
    setMaxLogSize(size: number): void;
    /**
     * Get the current number of subscribers.
     */
    getSubscriberCount(): number;
}
//# sourceMappingURL=event-emitter.d.ts.map