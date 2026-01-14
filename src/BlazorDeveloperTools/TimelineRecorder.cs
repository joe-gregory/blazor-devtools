// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - TimelineRecorder.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Captures and stores timeline events for the Render Timeline feature.
//   Provides a ring buffer of events with start/stop recording controls.
//
// ARCHITECTURE:
//   - TimelineEvent: Individual event (lifecycle method, render, etc.)
//   - TimelineRecorder: Singleton that manages recording state and storage
//   - Events are captured from BlazorDevToolsComponentBase and RendererInterop
//
// ═══════════════════════════════════════════════════════════════════════════════

using System.Collections.Concurrent;
using System.Diagnostics;

namespace BlazorDeveloperTools;

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Types of events that can be recorded in the timeline.
/// </summary>
public enum TimelineEventType
{
    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle Events (Enhanced components only)
    // ─────────────────────────────────────────────────────────────────────────
    OnInitialized,
    OnInitializedAsync,
    OnParametersSet,
    OnParametersSetAsync,
    SetParametersAsync,
    BuildRenderTree,
    OnAfterRender,
    OnAfterRenderAsync,
    Disposed,
    
    // ─────────────────────────────────────────────────────────────────────────
    // ShouldRender Decisions
    // ─────────────────────────────────────────────────────────────────────────
    ShouldRenderTrue,
    ShouldRenderFalse,
    
    // ─────────────────────────────────────────────────────────────────────────
    // State & Event Triggers
    // ─────────────────────────────────────────────────────────────────────────
    StateHasChanged,
    StateHasChangedIgnored,  // When pending or ShouldRender=false
    EventCallbackInvoked,
    
    // ─────────────────────────────────────────────────────────────────────────
    // Render Batch Events (From Renderer reflection)
    // ─────────────────────────────────────────────────────────────────────────
    RenderBatchStarted,
    RenderBatchCompleted,
    ComponentRendered,  // Non-enhanced component render detected
    
    // ─────────────────────────────────────────────────────────────────────────
    // Circuit/App Level Events
    // ─────────────────────────────────────────────────────────────────────────
    CircuitOpened,
    CircuitClosed,
    NavigationStart,
    NavigationEnd,
    FirstRender,  // Special marker for component's first render
}

/// <summary>
/// Reasons why a component rendered.
/// </summary>
public enum RenderTriggerReason
{
    Unknown,
    FirstRender,
    ParameterChanged,
    StateHasChangedCalled,
    ParentRerendered,
    EventCallbackInvoked,
    CascadingValueChanged,
    ExternalTrigger
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE EVENT
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Represents a single event in the render timeline.
/// </summary>
public class TimelineEvent
{
    /// <summary>
    /// Sequential event ID (unique within recording session).
    /// </summary>
    public long EventId { get; set; }
    
    /// <summary>
    /// Absolute timestamp when event occurred.
    /// </summary>
    public DateTime Timestamp { get; set; }
    
    /// <summary>
    /// Milliseconds since recording started (for timeline positioning).
    /// </summary>
    public double RelativeTimestampMs { get; set; }
    
    /// <summary>
    /// Component ID (-1 for app-level events).
    /// </summary>
    public int ComponentId { get; set; }
    
    /// <summary>
    /// Component type name.
    /// </summary>
    public string ComponentName { get; set; } = string.Empty;
    
    /// <summary>
    /// Type of event.
    /// </summary>
    public TimelineEventType EventType { get; set; }
    
    /// <summary>
    /// Duration in milliseconds (for events with duration like lifecycle methods).
    /// Null for instant events.
    /// </summary>
    public double? DurationMs { get; set; }
    
    /// <summary>
    /// End timestamp relative to recording start (StartMs + DurationMs).
    /// </summary>
    public double? EndRelativeTimestampMs { get; set; }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Correlation & Causation
    // ─────────────────────────────────────────────────────────────────────────
    
    /// <summary>
    /// Parent event ID (e.g., the render batch this event belongs to).
    /// </summary>
    public long? ParentEventId { get; set; }
    
    /// <summary>
    /// Event ID that triggered this event (for "why did this render?" tracking).
    /// </summary>
    public long? TriggeringEventId { get; set; }
    
    /// <summary>
    /// Human-readable reason for this event.
    /// </summary>
    public RenderTriggerReason TriggerReason { get; set; } = RenderTriggerReason.Unknown;
    
    /// <summary>
    /// Additional trigger details (e.g., "Quantity parameter changed").
    /// </summary>
    public string? TriggerDetails { get; set; }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Additional Context
    // ─────────────────────────────────────────────────────────────────────────
    
    /// <summary>
    /// Whether this was an async operation.
    /// </summary>
    public bool IsAsync { get; set; }
    
    /// <summary>
    /// Whether this is the component's first render.
    /// </summary>
    public bool IsFirstRender { get; set; }
    
    /// <summary>
    /// Whether this event represents a skipped render (ShouldRender=false).
    /// </summary>
    public bool WasSkipped { get; set; }
    
    /// <summary>
    /// Whether this component inherits from BlazorDevToolsComponentBase.
    /// </summary>
    public bool IsEnhanced { get; set; }
    
    /// <summary>
    /// Render batch ID this event belongs to (if applicable).
    /// </summary>
    public long? BatchId { get; set; }
    
    /// <summary>
    /// Additional metadata (flexible key-value pairs).
    /// </summary>
    public Dictionary<string, string>? Metadata { get; set; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE EVENT DTO (for JavaScript)
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// DTO for sending timeline events to JavaScript.
/// </summary>
public class TimelineEventDto
{
    public long EventId { get; set; }
    public double RelativeTimestampMs { get; set; }
    public int ComponentId { get; set; }
    public string ComponentName { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;  // String for JS
    public double? DurationMs { get; set; }
    public double? EndRelativeTimestampMs { get; set; }
    public long? ParentEventId { get; set; }
    public long? TriggeringEventId { get; set; }
    public string TriggerReason { get; set; } = string.Empty;
    public string? TriggerDetails { get; set; }
    public bool IsAsync { get; set; }
    public bool IsFirstRender { get; set; }
    public bool WasSkipped { get; set; }
    public bool IsEnhanced { get; set; }
    public long? BatchId { get; set; }
    public Dictionary<string, string>? Metadata { get; set; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER BATCH
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Represents a group of renders that were batched together by Blazor.
/// </summary>
public class RenderBatch
{
    public long BatchId { get; set; }
    public DateTime StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public double StartRelativeMs { get; set; }
    public double? EndRelativeMs { get; set; }
    public double? DurationMs => EndRelativeMs.HasValue ? EndRelativeMs - StartRelativeMs : null;
    public int ComponentCount { get; set; }
    public List<int> ComponentIds { get; set; } = new();
    public string? TriggerSource { get; set; }
}

/// <summary>
/// DTO for render batch.
/// </summary>
public class RenderBatchDto
{
    public long BatchId { get; set; }
    public double StartRelativeMs { get; set; }
    public double? EndRelativeMs { get; set; }
    public double? DurationMs { get; set; }
    public int ComponentCount { get; set; }
    public List<int> ComponentIds { get; set; } = new();
    public string? TriggerSource { get; set; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECORDING STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Current state of the timeline recorder.
/// </summary>
public class RecordingState
{
    public bool IsRecording { get; set; }
    public DateTime? RecordingStartedAt { get; set; }
    public double RecordingDurationMs { get; set; }
    public int EventCount { get; set; }
    public int BatchCount { get; set; }
    public int MaxEvents { get; set; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE RECORDER
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Manages timeline event recording with a ring buffer for storage.
/// Thread-safe singleton per circuit.
/// </summary>
public class TimelineRecorder
{
    // ─────────────────────────────────────────────────────────────────────────
    // Configuration
    // ─────────────────────────────────────────────────────────────────────────
    
    private const int DefaultMaxEvents = 5000;
    private const int DefaultMaxBatches = 500;
    
    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────
    
    private readonly object _lock = new();
    private readonly List<TimelineEvent> _events = new();
    private readonly List<RenderBatch> _batches = new();
    private readonly Stopwatch _stopwatch = new();
    
    private bool _isRecording;
    private DateTime _recordingStartedAt;
    private long _nextEventId;
    private long _nextBatchId;
    private int _maxEvents = DefaultMaxEvents;
    private int _maxBatches = DefaultMaxBatches;
    
    // Track last events per component for "why did this render?" correlation
    private readonly ConcurrentDictionary<int, long> _lastStateHasChangedEvent = new();
    private readonly ConcurrentDictionary<int, long> _lastEventCallbackEvent = new();
    private readonly ConcurrentDictionary<int, long> _lastParameterSetEvent = new();
    
    // Current batch tracking
    private RenderBatch? _currentBatch;
    
    // ─────────────────────────────────────────────────────────────────────────
    // Singleton (per-circuit via DI)
    // ─────────────────────────────────────────────────────────────────────────
    
    // Note: In practice, this would be registered as Scoped in DI for per-circuit isolation
    // For now, we'll use a static instance
    private static TimelineRecorder? _instance;
    public static TimelineRecorder Instance => _instance ??= new TimelineRecorder();
    
    // ─────────────────────────────────────────────────────────────────────────
    // Recording Control
    // ─────────────────────────────────────────────────────────────────────────
    
    /// <summary>
    /// Start recording timeline events.
    /// </summary>
    public void StartRecording()
    {
        lock (_lock)
        {
            if (_isRecording) return;
            
            _isRecording = true;
            _recordingStartedAt = DateTime.UtcNow;
            _stopwatch.Restart();
            _nextEventId = 0;
            _nextBatchId = 0;
            _events.Clear();
            _batches.Clear();
            _lastStateHasChangedEvent.Clear();
            _lastEventCallbackEvent.Clear();
            _lastParameterSetEvent.Clear();
            _currentBatch = null;
        }
    }
    
    /// <summary>
    /// Stop recording timeline events.
    /// </summary>
    public void StopRecording()
    {
        lock (_lock)
        {
            if (!_isRecording) return;
            
            _isRecording = false;
            _stopwatch.Stop();
        }
    }
    
    /// <summary>
    /// Clear all recorded events without stopping recording.
    /// </summary>
    public void ClearEvents()
    {
        lock (_lock)
        {
            _events.Clear();
            _batches.Clear();
            _nextEventId = 0;
            _nextBatchId = 0;
            
            if (_isRecording)
            {
                _recordingStartedAt = DateTime.UtcNow;
                _stopwatch.Restart();
            }
        }
    }
    
    /// <summary>
    /// Get current recording state.
    /// </summary>
    public RecordingState GetState()
    {
        lock (_lock)
        {
            return new RecordingState
            {
                IsRecording = _isRecording,
                RecordingStartedAt = _isRecording ? _recordingStartedAt : null,
                RecordingDurationMs = _isRecording ? _stopwatch.Elapsed.TotalMilliseconds : 0,
                EventCount = _events.Count,
                BatchCount = _batches.Count,
                MaxEvents = _maxEvents
            };
        }
    }
    
    /// <summary>
    /// Configure maximum events to retain (ring buffer size).
    /// </summary>
    public void SetMaxEvents(int maxEvents)
    {
        lock (_lock)
        {
            _maxEvents = Math.Max(100, Math.Min(maxEvents, 50000));
            TrimEventsIfNeeded();
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Event Recording
    // ─────────────────────────────────────────────────────────────────────────
    
    /// <summary>
    /// Record a timeline event.
    /// </summary>
    public long RecordEvent(
        int componentId,
        string componentName,
        TimelineEventType eventType,
        double? durationMs = null,
        bool isAsync = false,
        bool isFirstRender = false,
        bool wasSkipped = false,
        bool isEnhanced = true,
        string? triggerDetails = null,
        Dictionary<string, string>? metadata = null)
    {
        if (!_isRecording) return -1;
        
        lock (_lock)
        {
            var relativeMs = _stopwatch.Elapsed.TotalMilliseconds;
            var eventId = _nextEventId++;
            
            // Determine trigger reason
            var (triggerReason, triggeringEventId) = DetermineTriggerReason(
                componentId, eventType, isFirstRender);
            
            var evt = new TimelineEvent
            {
                EventId = eventId,
                Timestamp = DateTime.UtcNow,
                RelativeTimestampMs = relativeMs,
                ComponentId = componentId,
                ComponentName = componentName,
                EventType = eventType,
                DurationMs = durationMs,
                EndRelativeTimestampMs = durationMs.HasValue ? relativeMs + durationMs : null,
                TriggerReason = triggerReason,
                TriggeringEventId = triggeringEventId,
                TriggerDetails = triggerDetails,
                IsAsync = isAsync,
                IsFirstRender = isFirstRender,
                WasSkipped = wasSkipped,
                IsEnhanced = isEnhanced,
                BatchId = _currentBatch?.BatchId,
                Metadata = metadata
            };
            
            _events.Add(evt);
            
            // Track for correlation
            TrackEventForCorrelation(componentId, eventId, eventType);
            
            TrimEventsIfNeeded();
            
            return eventId;
        }
    }
    
    /// <summary>
    /// Record start of an event that has duration (returns event ID to complete later).
    /// </summary>
    public long RecordEventStart(
        int componentId,
        string componentName,
        TimelineEventType eventType,
        bool isAsync = false,
        bool isFirstRender = false,
        bool isEnhanced = true)
    {
        if (!_isRecording) return -1;
        
        lock (_lock)
        {
            var relativeMs = _stopwatch.Elapsed.TotalMilliseconds;
            var eventId = _nextEventId++;
            
            var (triggerReason, triggeringEventId) = DetermineTriggerReason(
                componentId, eventType, isFirstRender);
            
            var evt = new TimelineEvent
            {
                EventId = eventId,
                Timestamp = DateTime.UtcNow,
                RelativeTimestampMs = relativeMs,
                ComponentId = componentId,
                ComponentName = componentName,
                EventType = eventType,
                IsAsync = isAsync,
                IsFirstRender = isFirstRender,
                IsEnhanced = isEnhanced,
                TriggerReason = triggerReason,
                TriggeringEventId = triggeringEventId,
                BatchId = _currentBatch?.BatchId
            };
            
            _events.Add(evt);
            TrimEventsIfNeeded();
            
            return eventId;
        }
    }
    
    /// <summary>
    /// Complete an event that was started with RecordEventStart.
    /// </summary>
    public void RecordEventEnd(long eventId, double durationMs, string? triggerDetails = null)
    {
        if (!_isRecording || eventId < 0) return;
        
        lock (_lock)
        {
            var evt = _events.FirstOrDefault(e => e.EventId == eventId);
            if (evt != null)
            {
                evt.DurationMs = durationMs;
                evt.EndRelativeTimestampMs = evt.RelativeTimestampMs + durationMs;
                if (triggerDetails != null)
                {
                    evt.TriggerDetails = triggerDetails;
                }
            }
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Render Batch Recording
    // ─────────────────────────────────────────────────────────────────────────
    
    /// <summary>
    /// Record start of a render batch.
    /// </summary>
    public long RecordBatchStart(string? triggerSource = null)
    {
        if (!_isRecording) return -1;
        
        lock (_lock)
        {
            var batchId = _nextBatchId++;
            var relativeMs = _stopwatch.Elapsed.TotalMilliseconds;
            
            _currentBatch = new RenderBatch
            {
                BatchId = batchId,
                StartTime = DateTime.UtcNow,
                StartRelativeMs = relativeMs,
                TriggerSource = triggerSource
            };
            
            _batches.Add(_currentBatch);
            
            // Also record as an event
            RecordEvent(
                componentId: -1,
                componentName: "[RenderBatch]",
                eventType: TimelineEventType.RenderBatchStarted,
                isEnhanced: false,
                metadata: new Dictionary<string, string> { ["batchId"] = batchId.ToString() }
            );
            
            TrimBatchesIfNeeded();
            
            return batchId;
        }
    }
    
    /// <summary>
    /// Record completion of a render batch.
    /// </summary>
    public void RecordBatchEnd(long batchId, List<int> componentIds)
    {
        if (!_isRecording) return;
        
        lock (_lock)
        {
            var batch = _batches.FirstOrDefault(b => b.BatchId == batchId);
            if (batch != null)
            {
                var relativeMs = _stopwatch.Elapsed.TotalMilliseconds;
                batch.EndTime = DateTime.UtcNow;
                batch.EndRelativeMs = relativeMs;
                batch.ComponentIds = componentIds;
                batch.ComponentCount = componentIds.Count;
            }
            
            if (_currentBatch?.BatchId == batchId)
            {
                _currentBatch = null;
            }
            
            // Also record as an event
            RecordEvent(
                componentId: -1,
                componentName: "[RenderBatch]",
                eventType: TimelineEventType.RenderBatchCompleted,
                isEnhanced: false,
                metadata: new Dictionary<string, string>
                {
                    ["batchId"] = batchId.ToString(),
                    ["componentCount"] = componentIds.Count.ToString()
                }
            );
        }
    }
    
    /// <summary>
    /// Record a non-enhanced component render (detected via Renderer reflection).
    /// </summary>
    public void RecordNonEnhancedRender(int componentId, string componentName)
    {
        RecordEvent(
            componentId: componentId,
            componentName: componentName,
            eventType: TimelineEventType.ComponentRendered,
            isEnhanced: false,
            triggerDetails: "Detected via Renderer reflection"
        );
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Data Retrieval
    // ─────────────────────────────────────────────────────────────────────────
    
    /// <summary>
    /// Get all recorded events as DTOs.
    /// </summary>
    public List<TimelineEventDto> GetEvents()
    {
        lock (_lock)
        {
            return _events.Select(MapToDto).ToList();
        }
    }
    
    /// <summary>
    /// Get events after a certain event ID (for incremental updates).
    /// </summary>
    public List<TimelineEventDto> GetEventsSince(long afterEventId)
    {
        lock (_lock)
        {
            return _events
                .Where(e => e.EventId > afterEventId)
                .Select(MapToDto)
                .ToList();
        }
    }
    
    /// <summary>
    /// Get events within a time range.
    /// </summary>
    public List<TimelineEventDto> GetEventsInRange(double startMs, double endMs)
    {
        lock (_lock)
        {
            return _events
                .Where(e => e.RelativeTimestampMs >= startMs && e.RelativeTimestampMs <= endMs)
                .Select(MapToDto)
                .ToList();
        }
    }
    
    /// <summary>
    /// Get events for a specific component.
    /// </summary>
    public List<TimelineEventDto> GetEventsForComponent(int componentId)
    {
        lock (_lock)
        {
            return _events
                .Where(e => e.ComponentId == componentId)
                .Select(MapToDto)
                .ToList();
        }
    }
    
    /// <summary>
    /// Get all render batches as DTOs.
    /// </summary>
    public List<RenderBatchDto> GetBatches()
    {
        lock (_lock)
        {
            return _batches.Select(b => new RenderBatchDto
            {
                BatchId = b.BatchId,
                StartRelativeMs = b.StartRelativeMs,
                EndRelativeMs = b.EndRelativeMs,
                DurationMs = b.DurationMs,
                ComponentCount = b.ComponentCount,
                ComponentIds = b.ComponentIds,
                TriggerSource = b.TriggerSource
            }).ToList();
        }
    }
    
    /// <summary>
    /// Get components ranked by total render time.
    /// </summary>
    public List<ComponentRankingDto> GetRankedComponents()
    {
        lock (_lock)
        {
            return _events
                .Where(e => e.EventType == TimelineEventType.BuildRenderTree && e.DurationMs.HasValue)
                .GroupBy(e => new { e.ComponentId, e.ComponentName })
                .Select(g => new ComponentRankingDto
                {
                    ComponentId = g.Key.ComponentId,
                    ComponentName = g.Key.ComponentName,
                    TotalRenderTimeMs = g.Sum(e => e.DurationMs ?? 0),
                    RenderCount = g.Count(),
                    AverageRenderTimeMs = g.Average(e => e.DurationMs ?? 0),
                    MaxRenderTimeMs = g.Max(e => e.DurationMs ?? 0),
                    MinRenderTimeMs = g.Min(e => e.DurationMs ?? 0)
                })
                .OrderByDescending(r => r.TotalRenderTimeMs)
                .ToList();
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────
    
    private (RenderTriggerReason reason, long? triggeringEventId) DetermineTriggerReason(
        int componentId, TimelineEventType eventType, bool isFirstRender)
    {
        if (isFirstRender)
        {
            return (RenderTriggerReason.FirstRender, null);
        }
        
        // For BuildRenderTree, look at what triggered it
        if (eventType == TimelineEventType.BuildRenderTree)
        {
            // Check if StateHasChanged was called recently
            if (_lastStateHasChangedEvent.TryGetValue(componentId, out var stateEventId))
            {
                return (RenderTriggerReason.StateHasChangedCalled, stateEventId);
            }
            
            // Check if EventCallback was invoked
            if (_lastEventCallbackEvent.TryGetValue(componentId, out var callbackEventId))
            {
                return (RenderTriggerReason.EventCallbackInvoked, callbackEventId);
            }
            
            // Check if parameters were set
            if (_lastParameterSetEvent.TryGetValue(componentId, out var paramEventId))
            {
                return (RenderTriggerReason.ParameterChanged, paramEventId);
            }
            
            // Default to parent re-rendered
            return (RenderTriggerReason.ParentRerendered, null);
        }
        
        return (RenderTriggerReason.Unknown, null);
    }
    
    private void TrackEventForCorrelation(int componentId, long eventId, TimelineEventType eventType)
    {
        switch (eventType)
        {
            case TimelineEventType.StateHasChanged:
                _lastStateHasChangedEvent[componentId] = eventId;
                break;
            case TimelineEventType.EventCallbackInvoked:
                _lastEventCallbackEvent[componentId] = eventId;
                break;
            case TimelineEventType.OnParametersSet:
            case TimelineEventType.OnParametersSetAsync:
                _lastParameterSetEvent[componentId] = eventId;
                break;
            case TimelineEventType.BuildRenderTree:
                // Clear triggers after a render
                _lastStateHasChangedEvent.TryRemove(componentId, out _);
                _lastEventCallbackEvent.TryRemove(componentId, out _);
                _lastParameterSetEvent.TryRemove(componentId, out _);
                break;
        }
    }
    
    private void TrimEventsIfNeeded()
    {
        if (_events.Count > _maxEvents)
        {
            var removeCount = _events.Count - _maxEvents;
            _events.RemoveRange(0, removeCount);
        }
    }
    
    private void TrimBatchesIfNeeded()
    {
        if (_batches.Count > _maxBatches)
        {
            var removeCount = _batches.Count - _maxBatches;
            _batches.RemoveRange(0, removeCount);
        }
    }
    
    private static TimelineEventDto MapToDto(TimelineEvent evt)
    {
        return new TimelineEventDto
        {
            EventId = evt.EventId,
            RelativeTimestampMs = evt.RelativeTimestampMs,
            ComponentId = evt.ComponentId,
            ComponentName = evt.ComponentName,
            EventType = evt.EventType.ToString(),
            DurationMs = evt.DurationMs,
            EndRelativeTimestampMs = evt.EndRelativeTimestampMs,
            ParentEventId = evt.ParentEventId,
            TriggeringEventId = evt.TriggeringEventId,
            TriggerReason = evt.TriggerReason.ToString(),
            TriggerDetails = evt.TriggerDetails,
            IsAsync = evt.IsAsync,
            IsFirstRender = evt.IsFirstRender,
            WasSkipped = evt.WasSkipped,
            IsEnhanced = evt.IsEnhanced,
            BatchId = evt.BatchId,
            Metadata = evt.Metadata
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT RANKING DTO
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Component ranking by render time for the Ranked view.
/// </summary>
public class ComponentRankingDto
{
    public int ComponentId { get; set; }
    public string ComponentName { get; set; } = string.Empty;
    public double TotalRenderTimeMs { get; set; }
    public int RenderCount { get; set; }
    public double AverageRenderTimeMs { get; set; }
    public double MaxRenderTimeMs { get; set; }
    public double MinRenderTimeMs { get; set; }
}
