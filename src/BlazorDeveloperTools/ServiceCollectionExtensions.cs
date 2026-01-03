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
//   This registers:
//   - BlazorDevToolsRegistry (Singleton) - Central component tracking
//   - BlazorDevToolsComponentActivator (Singleton) - Intercepts component creation
//
//   The activator chains to any existing IComponentActivator, so it works with
//   custom activators (e.g., third-party libraries).
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BlazorDeveloperTools;

/// <summary>
/// Extension methods for adding Blazor Developer Tools to the service collection.
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Adds Blazor Developer Tools component tracking to the service collection.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddBlazorDevTools(this IServiceCollection services)
    {
        return services.AddBlazorDevTools(_ => { });
    }

    /// <summary>
    /// Adds Blazor Developer Tools component tracking with configuration.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configure">Action to configure options.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddBlazorDevTools(
        this IServiceCollection services,
        Action<BlazorDevToolsOptions> configure)
    {
        // Apply configuration
        var options = new BlazorDevToolsOptions();
        configure(options);
        ApplyOptions(options);

        // Register BlazorDevToolsRegistry (Singleton)
        services.AddSingleton<BlazorDevToolsRegistry>(sp =>
        {
            var registry = new BlazorDevToolsRegistry();
            BlazorDevToolsRegistry.Instance = registry;
            return registry;
        });

        // Register BlazorDevToolsComponentActivator
        // Check if there's an existing IComponentActivator to chain to
        var existingActivator = services.FirstOrDefault(d => d.ServiceType == typeof(IComponentActivator));

        if (existingActivator != null)
        {
            // Chain to existing activator
            services.Remove(existingActivator);
            services.AddSingleton<IComponentActivator>(sp =>
            {
                var inner = (IComponentActivator?)existingActivator.ImplementationInstance
                    ?? (existingActivator.ImplementationFactory != null
                        ? (IComponentActivator)existingActivator.ImplementationFactory(sp)
                        : (IComponentActivator)ActivatorUtilities.CreateInstance(sp, existingActivator.ImplementationType!));

                return new BlazorDevToolsComponentActivator(inner);
            });
        }
        else
        {
            // No existing activator, register ours directly
            services.AddSingleton<IComponentActivator, BlazorDevToolsComponentActivator>();
        }

        return services;
    }

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

/// <summary>
/// Options for configuring Blazor Developer Tools.
/// </summary>
public class BlazorDevToolsOptions
{
    /// <summary>
    /// Enable/disable lifecycle timing measurement.
    /// Default: true in DEBUG, false in RELEASE.
    /// </summary>
    public bool? EnableTiming { get; set; }
    /// <summary>
    /// Enable/disable pushing events to JavaScript.
    /// Default: false.
    /// </summary>
    public bool? EnableEventPush { get; set; }
    /// <summary>
    /// JavaScript function to call for events.
    /// Default: "blazorDevTools.onEvent"
    /// </summary>
    public string? JsEventHandler { get; set; }
    /// <summary>
    /// Maximum events to buffer if JS is not ready.
    /// Default: 100
    /// </summary>
    public int? MaxBufferedEvents { get; set; }
    /// <summary>
    /// Minimum duration (ms) to push an event.
    /// Default: 0 (all events)
    /// </summary>
    public double? MinDurationToReportMs { get; set; }
    /// <summary>
    /// Event types to push. Null = all events.
    /// </summary>
    public HashSet<LifecycleEventType>? EventTypeFilter { get; set; }
    /// <summary>
    /// Component type names to exclude from event push.
    /// </summary>
    public HashSet<string>? ExcludedComponentTypes { get; set; }
}