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
//   │    ├─► Try to capture Renderer via reflection                          │
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
using Microsoft.AspNetCore.Components.RenderTree;
using System.Reflection;

namespace BlazorDeveloperTools;

/// <summary>
/// Handles circuit lifecycle events to initialize the BlazorDevToolsRegistry.
/// Scoped service - one instance per circuit, receives events for its circuit only.
/// </summary>
public class BlazorDevToolsCircuitHandler : CircuitHandler
{
    // ═══════════════════════════════════════════════════════════════
    // DEPENDENCIES
    // ═══════════════════════════════════════════════════════════════
    private readonly BlazorDevToolsRegistry _registry;

    // ═══════════════════════════════════════════════════════════════
    // REFLECTION CACHE (for Renderer extraction)
    // ═══════════════════════════════════════════════════════════════
    private static bool _reflectionInitialized;
    private static FieldInfo? _circuitHostField;
    private static FieldInfo? _rendererField;

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Creates a new circuit handler. Both this handler and the registry
    /// are scoped to the same circuit, so they share the same lifetime.
    /// </summary>
    /// <param name="registry">The scoped registry for this circuit.</param>
    public BlazorDevToolsCircuitHandler(BlazorDevToolsRegistry registry)
    {
        _registry = registry;
        InitializeReflection();
    }

    private static void InitializeReflection()
    {
        if (_reflectionInitialized) return;
        _reflectionInitialized = true;

        try
        {
            // Circuit has a private _circuitHost field (or similar)
            // CircuitHost has the RemoteRenderer
            Type circuitType = typeof(Circuit);

            // Look for CircuitHost field on Circuit
            _circuitHostField = circuitType.GetField(
                "_circuitHost",
                BindingFlags.NonPublic | BindingFlags.Instance
            );

            if (_circuitHostField == null)
            {
                // Try alternative names
                foreach (FieldInfo field in circuitType.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    if (field.FieldType.Name.Contains("CircuitHost"))
                    {
                        _circuitHostField = field;
#if DEBUG
                        Console.WriteLine($"[BDT CircuitHandler] Found CircuitHost field: {field.Name}");
#endif
                        break;
                    }
                }
            }

            if (_circuitHostField != null)
            {
                // Now find the Renderer field on CircuitHost
                Type circuitHostType = _circuitHostField.FieldType;
                foreach (FieldInfo field in circuitHostType.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    if (typeof(Renderer).IsAssignableFrom(field.FieldType) ||
                       field.FieldType.Name.Contains("Renderer"))
                    {
                        _rendererField = field;
#if DEBUG
                        Console.WriteLine($"[BDT CircuitHandler] Found Renderer field: {field.Name} ({field.FieldType.Name})");
#endif
                        break;
                    }
                }
            }

#if DEBUG
            if (_circuitHostField == null)
            {
                Console.WriteLine("[BDT CircuitHandler] Could not find CircuitHost field on Circuit");
                Console.WriteLine("[BDT CircuitHandler] Available fields on Circuit:");
                foreach (FieldInfo f in circuitType.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    Console.WriteLine($"  - {f.Name}: {f.FieldType.Name}");
                }
            }
            else if (_rendererField == null)
            {
                Console.WriteLine("[BDT CircuitHandler] Could not find Renderer field on CircuitHost");
                Type circuitHostType = _circuitHostField.FieldType;
                Console.WriteLine($"[BDT CircuitHandler] Available fields on {circuitHostType.Name}:");
                foreach (FieldInfo f in circuitHostType.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    Console.WriteLine($"  - {f.Name}: {f.FieldType.Name}");
                }
            }
#endif
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT CircuitHandler] Reflection init failed: {ex.Message}");
#endif
        }
    }

    /// <summary>
    /// Attempts to extract the Renderer from a Circuit via reflection.
    /// Path: Circuit → CircuitHost → RemoteRenderer
    /// </summary>
    private Renderer? TryGetRendererFromCircuit(Circuit circuit)
    {
        if (_circuitHostField == null || _rendererField == null) return null;

        try
        {
            object? circuitHost = _circuitHostField.GetValue(circuit);
            if (circuitHost == null) return null;

            object? renderer = _rendererField.GetValue(circuitHost);
            return renderer as Renderer;
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT CircuitHandler] Failed to get Renderer from Circuit: {ex.Message}");
#endif
            return null;
        }
    }

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

        // Try to capture Renderer via reflection
        Renderer? renderer = TryGetRendererFromCircuit(circuit);
        if (renderer != null)
        {
            _registry.SetRenderer(renderer);
#if DEBUG
            Console.WriteLine($"[BDT CircuitHandler] Captured Renderer from Circuit: {circuit.Id}");
#endif
        }

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