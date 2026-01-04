// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - BlazorDevToolsCircuitHandler.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Handles Blazor Server circuit lifecycle events to initialize and cleanup
//   the BlazorDevToolsRegistry. This is the entry point that wires up the
//   scoped registry to its circuit and establishes the JavaScript bridge.
//
// ARCHITECTURE:
//   CircuitHandler is a SCOPED service in Blazor Server - one instance per circuit.
//   Multiple CircuitHandlers can be registered and ALL will receive lifecycle events.
//   This is different from IComponentActivator which replaces the default.
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ Circuit Lifecycle Flow                                                  │
//   │                                                                         │
//   │ 1. User connects to Blazor Server                                       │
//   │    └─► New DI scope created (circuit scope)                            │
//   │                                                                         │
//   │ 2. OnCircuitOpenedAsync(circuit)                                        │
//   │    ├─► Registry.Circuit = circuit (store reference)                    │
//   │    └─► Registry.InitializeJsAsync() (pass DotNetRef to JS)             │
//   │                                                                         │
//   │ 3. Components created and tracked...                                    │
//   │                                                                         │
//   │ 4. OnCircuitClosedAsync(circuit)                                        │
//   │    └─► Registry.OnCircuitClosed() (cleanup DotNetRef)                  │
//   │                                                                         │
//   │ 5. DI scope disposed, all scoped services garbage collected             │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// WHY CIRCUITHANDLER:
//   - Provides the Circuit object with its unique ID
//   - Fires at the right time to initialize JS before components render
//   - Scoped lifetime matches Registry lifetime perfectly
//   - Non-invasive: doesn't replace anything, just listens
//
// REGISTRATION:
//   services.AddScoped<CircuitHandler, BlazorDevToolsCircuitHandler>();
//
// NOTE:
//   This is only used for Blazor Server/Auto Server modes.
//   Blazor WebAssembly doesn't have circuits (single user, single scope).
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components.Server.Circuits;

namespace BlazorDeveloperTools;

/// <summary>
/// Handles circuit lifecycle events to initialize the BlazorDevToolsRegistry.
/// Scoped service - one instance per circuit, receives events for its circuit only.
/// </summary>
/// <remarks>
/// Creates a new circuit handler. Both this handler and the registry
/// are scoped to the same circuit, so they share the same lifetime.
/// </remarks>
/// <param name="registry">The scoped registry for this circuit.</param>
public class BlazorDevToolsCircuitHandler(BlazorDevToolsRegistry registry) : CircuitHandler
{
    // ═══════════════════════════════════════════════════════════════
    // DEPENDENCIES
    // ═══════════════════════════════════════════════════════════════
    private readonly BlazorDevToolsRegistry _registry = registry;

    // ═══════════════════════════════════════════════════════════════
    // CIRCUIT OPENED
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Called when a new circuit is established. This is the first lifecycle
    /// event and the ideal place to initialize the registry with circuit info
    /// and establish the JavaScript bridge via DotNetObjectReference.
    /// </summary>
    /// <param name="circuit">The circuit that was opened, containing the unique ID.</param>
    /// <param name="cancellationToken">Cancellation token for the operation.</param>
    public override async Task OnCircuitOpenedAsync(Circuit circuit, CancellationToken cancellationToken)
    {
        _registry.Circuit = circuit;
        await _registry.InitializeJsAsync();
        await base.OnCircuitOpenedAsync(circuit, cancellationToken);
    }

    // ═══════════════════════════════════════════════════════════════
    // CIRCUIT CLOSED
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Called when a circuit is terminated (user closes tab, disconnects, etc.).
    /// Triggers cleanup of the DotNetObjectReference to prevent memory leaks
    /// and stale references in JavaScript.
    /// </summary>
    /// <param name="circuit">The circuit that was closed.</param>
    /// <param name="cancellationToken">Cancellation token for the operation.</param>
    public override Task OnCircuitClosedAsync(Circuit circuit, CancellationToken cancellationToken)
    {
        _registry.OnCircuitClosed();
        return base.OnCircuitClosedAsync(circuit, cancellationToken);
    }

    // ═══════════════════════════════════════════════════════════════
    // CONNECTION STATE CHANGES (optional, for future use)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Called when the circuit's connection is temporarily lost.
    /// The circuit is still alive but cannot communicate with the client.
    /// Could be used to pause event pushing in the future.
    /// </summary>
    /// <param name="circuit">The circuit with a downed connection.</param>
    /// <param name="cancellationToken">Cancellation token for the operation.</param>
    public override Task OnConnectionDownAsync(Circuit circuit, CancellationToken cancellationToken)
    {
        #if DEBUG
        Console.WriteLine($"[BDT] Connection down for circuit: {circuit.Id}");
        #endif
        return base.OnConnectionDownAsync(circuit, cancellationToken);
    }

    /// <summary>
    /// Called when the circuit's connection is restored after being down.
    /// The circuit can now communicate with the client again.
    /// Could be used to resume event pushing or resync state in the future.
    /// </summary>
    /// <param name="circuit">The circuit with a restored connection.</param>
    /// <param name="cancellationToken">Cancellation token for the operation.</param>
    public override Task OnConnectionUpAsync(Circuit circuit, CancellationToken cancellationToken)
    {
        #if DEBUG
        Console.WriteLine($"[BDT] Connection restored for circuit: {circuit.Id}");
        #endif
        return base.OnConnectionUpAsync(circuit, cancellationToken);
    }
}