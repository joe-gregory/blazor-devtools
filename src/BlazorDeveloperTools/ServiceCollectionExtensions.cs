// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - ServiceCollectionExtensions.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Extension methods for registering Blazor Developer Tools with dependency injection.
//   Provides a simple one-liner for developers to enable component tracking.
//
// USAGE:
//   // In Program.cs
//   builder.Services.AddBlazorDevTools();
//
//   // With options
//   builder.Services.AddBlazorDevTools(options =>
//   {
//       options.EnableEventPush = true;
//       options.MinDurationToReportMs = 5;
//   });
//
// ARCHITECTURE:
//   All services are registered as SCOPED for circuit isolation:
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ Service Registrations                                                   │
//   │                                                                         │
//   │ BlazorDevToolsRegistry (Scoped)                                        │
//   │   └─► Central component tracking, one per circuit                      │
//   │                                                                         │
//   │ BlazorDevToolsComponentActivator (Scoped as IComponentActivator)       │
//   │   └─► Intercepts component creation, registers with scoped registry    │
//   │   └─► Chains to existing activator if one was registered               │
//   │                                                                         │
//   │ BlazorDevToolsCircuitHandler (Scoped as CircuitHandler)                │
//   │   └─► Initializes registry when circuit opens                          │
//   │   └─► Cleans up when circuit closes                                    │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// CHAINING BEHAVIOR:
//   If an IComponentActivator was already registered (by the app or a library),
//   we preserve it and chain to it:
//
//   1. We capture the existing registration
//   2. We remove it from services
//   3. We register our activator, which wraps/chains to the original
//   4. Component creation: OurActivator → TheirActivator → Component
//   5. Registration: OurActivator → Registry
//
//   This ensures compatibility with third-party libraries like Blazorise
//   that use custom activators.
//
// NOTE ON LIFETIMES:
//   The existing activator might be singleton, but our activator is scoped.
//   This is fine - a scoped service can depend on a singleton.
//   We resolve the singleton once per scope and reuse it.
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Server.Circuits;
using Microsoft.Extensions.DependencyInjection;

namespace BlazorDeveloperTools;

/// <summary>
/// Extension methods for adding Blazor Developer Tools to the service collection.
/// </summary>
public static class ServiceCollectionExtensions
{
    // ═══════════════════════════════════════════════════════════════
    // PRIMARY REGISTRATION METHOD
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Adds Blazor Developer Tools component tracking to the service collection.
    /// Registers all required services as scoped for circuit isolation.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddBlazorDevTools(this IServiceCollection services)
    {
        return services.AddBlazorDevTools(_ => { });
    }

    /// <summary>
    /// Adds Blazor Developer Tools component tracking with configuration.
    /// Registers all required services as scoped for circuit isolation.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configure">Action to configure options.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddBlazorDevTools(this IServiceCollection services, Action<BlazorDevToolsOptions> configure)
    {
        // ═══════════════════════════════════════════════════════════
        // APPLY CONFIGURATION
        // ═══════════════════════════════════════════════════════════
        BlazorDevToolsOptions options = new();
        configure(options);
        ApplyOptions(options);

        // ═══════════════════════════════════════════════════════════
        // REGISTER SCOPED REGISTRY
        // ═══════════════════════════════════════════════════════════
        // One registry per circuit. IJSRuntime is also scoped to circuit.
        services.AddScoped<BlazorDevToolsRegistry>();

        // ═══════════════════════════════════════════════════════════
        // REGISTER CIRCUIT HANDLER
        // ═══════════════════════════════════════════════════════════
        // CircuitHandler is additive - all registered handlers receive events.
        // This initializes the JS bridge when circuit opens.
        services.AddScoped<CircuitHandler, BlazorDevToolsCircuitHandler>();

        // ═══════════════════════════════════════════════════════════
        // REGISTER COMPONENT ACTIVATOR (with chaining support)
        // ═══════════════════════════════════════════════════════════
        RegisterComponentActivator(services);

        return services;
    }

    // ═══════════════════════════════════════════════════════════════
    // ACTIVATOR REGISTRATION WITH CHAINING
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Registers the BlazorDevToolsComponentActivator, preserving any existing
    /// IComponentActivator registration by chaining to it.
    /// </summary>
    /// <param name="services">The service collection.</param>
    private static void RegisterComponentActivator(IServiceCollection services)
    {
        // Check if there's an existing IComponentActivator registration
        ServiceDescriptor? existingDescriptor = null;
        foreach (ServiceDescriptor descriptor in services)
        {
            if (descriptor.ServiceType == typeof(IComponentActivator))
            {
                existingDescriptor = descriptor;
                break;
            }
        }

        if (existingDescriptor != null)
        {
            // ═══════════════════════════════════════════════════════
            // CHAINING: Existing activator found
            // ═══════════════════════════════════════════════════════
            // Remove the existing registration and wrap it with ours.
            // We need to resolve the original activator and pass it to ours.
            services.Remove(existingDescriptor);

            // Capture the descriptor for use in the factory closure
            ServiceDescriptor captured = existingDescriptor;

            services.AddScoped<IComponentActivator>(sp =>
            {
                BlazorDevToolsRegistry registry = sp.GetRequiredService<BlazorDevToolsRegistry>();

                // Resolve the original activator based on how it was registered
                IComponentActivator innerActivator = ResolveInnerActivator(sp, captured);

                return new BlazorDevToolsComponentActivator(registry, sp, innerActivator);
            });
        }
        else
        {
            // ═══════════════════════════════════════════════════════
            // NO EXISTING: Register our activator directly
            // ═══════════════════════════════════════════════════════
            services.AddScoped<IComponentActivator>(sp =>
            {
                BlazorDevToolsRegistry registry = sp.GetRequiredService<BlazorDevToolsRegistry>();
                return new BlazorDevToolsComponentActivator(registry, sp);
            });
        }
    }

    /// <summary>
    /// Resolves an IComponentActivator from its service descriptor.
    /// Handles the three ways a service can be registered:
    /// 1. ImplementationInstance (singleton instance)
    /// 2. ImplementationFactory (factory delegate)
    /// 3. ImplementationType (type to construct)
    /// </summary>
    /// <param name="sp">The service provider to resolve from.</param>
    /// <param name="descriptor">The service descriptor to resolve.</param>
    /// <returns>The resolved IComponentActivator instance.</returns>
    private static IComponentActivator ResolveInnerActivator(IServiceProvider sp, ServiceDescriptor descriptor)
    {
        // Case 1: Singleton instance was directly registered
        if (descriptor.ImplementationInstance != null)
        {
            return (IComponentActivator)descriptor.ImplementationInstance;
        }

        // Case 2: Factory delegate was registered
        if (descriptor.ImplementationFactory != null)
        {
            return (IComponentActivator)descriptor.ImplementationFactory(sp);
        }

        // Case 3: Implementation type was registered
        if (descriptor.ImplementationType != null)
        {
            return (IComponentActivator)ActivatorUtilities.CreateInstance(sp, descriptor.ImplementationType);
        }

        // Shouldn't happen, but fallback to null (no chaining)
        throw new InvalidOperationException("Unable to resolve inner IComponentActivator from service descriptor.");
    }

    // ═══════════════════════════════════════════════════════════════
    // OPTIONS APPLICATION
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Applies configuration options to the static BlazorDevToolsConfig.
    /// These are global settings that affect all circuits.
    /// </summary>
    /// <param name="options">The options to apply.</param>
    private static void ApplyOptions(BlazorDevToolsOptions options)
    {
        if (options.EnableTiming.HasValue)
            BlazorDevToolsConfig.EnableTiming = options.EnableTiming.Value;

        if (options.EnableEventPush.HasValue)
            BlazorDevToolsConfig.EnableEventPush = options.EnableEventPush.Value;

        if (options.JsEventHandler != null)
            BlazorDevToolsConfig.JsEventHandler = options.JsEventHandler;

        if (options.MaxBufferedEvents.HasValue)
            BlazorDevToolsConfig.MaxBufferedEvents = options.MaxBufferedEvents.Value;

        if (options.MinDurationToReportMs.HasValue)
            BlazorDevToolsConfig.MinDurationToReportMs = options.MinDurationToReportMs.Value;

        if (options.EventTypeFilter != null)
            BlazorDevToolsConfig.EventTypeFilter = options.EventTypeFilter;

        if (options.ExcludedComponentTypes != null)
            BlazorDevToolsConfig.ExcludedComponentTypes = options.ExcludedComponentTypes;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Options for configuring Blazor Developer Tools.
/// These settings are applied globally and affect all circuits.
/// </summary>
public class BlazorDevToolsOptions
{
    /// <summary>
    /// Enable/disable lifecycle timing measurement.
    /// When enabled, BlazorDevToolsComponentBase tracks method durations.
    /// Default: true in DEBUG, false in RELEASE.
    /// </summary>
    public bool? EnableTiming { get; set; }

    /// <summary>
    /// Enable/disable pushing lifecycle events to JavaScript in real-time.
    /// Only applies to components inheriting BlazorDevToolsComponentBase.
    /// Default: false.
    /// </summary>
    public bool? EnableEventPush { get; set; }

    /// <summary>
    /// JavaScript function path to call for pushed events.
    /// The function receives a LifecycleEvent object.
    /// Default: "blazorDevTools.onEvent"
    /// </summary>
    public string? JsEventHandler { get; set; }

    /// <summary>
    /// Maximum events to buffer if JS is not ready to receive them.
    /// Oldest events are dropped when buffer is full.
    /// Default: 100
    /// </summary>
    public int? MaxBufferedEvents { get; set; }

    /// <summary>
    /// Minimum duration (ms) for an event to be pushed to JS.
    /// Events shorter than this are not pushed (reduces noise).
    /// Default: 0 (all events)
    /// </summary>
    public double? MinDurationToReportMs { get; set; }

    /// <summary>
    /// Event types to push to JS. Null means all events are pushed.
    /// Use to filter to specific lifecycle events of interest.
    /// </summary>
    public HashSet<LifecycleEventType>? EventTypeFilter { get; set; }

    /// <summary>
    /// Component type names to exclude from event pushing.
    /// Useful for filtering out framework components like Router.
    /// </summary>
    public HashSet<string>? ExcludedComponentTypes { get; set; }
}