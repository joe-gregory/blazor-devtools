// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - BlazorDevToolsComponentActivator.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Custom IComponentActivator that intercepts ALL component creation in Blazor.
//   This is the entry point into Blazor's component pipeline, allowing us to
//   track every component regardless of its base class.
//
// ARCHITECTURE:
//   This is Pillar 2 of the three-pillar architecture:
//   - Pillar 1: Source Generator (compile-time metadata) [future]
//   - Pillar 2: Runtime Tracking (this + BlazorDevToolsRegistry + BlazorDevToolsComponentBase)
//   - Pillar 3: JS Interception (render batch interception) [future]
//
//   The activator is SCOPED (one per circuit), matching the registry lifetime.
//   This ensures components are registered to the correct circuit's registry.
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ Component Creation Flow (per circuit)                                   │
//   │                                                                         │
//   │ Blazor Renderer (scoped)                                                │
//   │     │                                                                   │
//   │     │ CreateInstance(typeof(Counter))                                   │
//   │     ▼                                                                   │
//   │ BlazorDevToolsComponentActivator (scoped to same circuit)               │
//   │     │                                                                   │
//   │     ├─► Chain to inner activator (if one existed before us)            │
//   │     │   OR create via ObjectFactory                                     │
//   │     │                                                                   │
//   │     ├─► Register with BlazorDevToolsRegistry (scoped to same circuit)  │
//   │     │                                                                   │
//   │     └─► Return component to Blazor                                      │
//   │                                                                         │
//   │ Result: ALL components tracked, circuit isolation guaranteed            │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// CHAINING:
//   If the application already has a custom IComponentActivator registered,
//   we preserve it and chain to it. This maintains compatibility with:
//   - Third-party component libraries with custom activators
//   - Application-specific component factories
//   - Testing frameworks that intercept component creation
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ Chaining Example                                                        │
//   │                                                                         │
//   │ Original: services.AddSingleton<IComponentActivator, TheirActivator>()  │
//   │                                                                         │
//   │ After AddBlazorDevTools():                                              │
//   │   BlazorDevToolsComponentActivator                                      │
//   │       │                                                                 │
//   │       └─► _innerActivator = TheirActivator (creates component)          │
//   │           │                                                             │
//   │           └─► We register it with our registry                          │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// WHY SCOPED:
//   IComponentActivator CAN be scoped (not just singleton). The Renderer is
//   scoped and resolves the activator from its scoped IServiceProvider.
//   Making it scoped allows injection of the scoped registry directly,
//   eliminating the circuit isolation problem entirely.
//
// REGISTRATION:
//   services.AddScoped<IComponentActivator>(sp => ...);
//   // See ServiceCollectionExtensions for full registration logic
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;

namespace BlazorDeveloperTools;

/// <summary>
/// Custom component activator that intercepts all component creation.
/// Registers every component with the scoped BlazorDevToolsRegistry.
/// Scoped service - one instance per circuit for proper isolation.
/// </summary>
public class BlazorDevToolsComponentActivator : IComponentActivator
{
    // ═══════════════════════════════════════════════════════════════
    // OBJECT FACTORY CACHE (static, shared across all instances)
    // ═══════════════════════════════════════════════════════════════
    // Mirrors Microsoft's DefaultComponentActivator implementation.
    // ObjectFactory is faster than Activator.CreateInstance after first call.
    // Cache is static because component types don't change at runtime.
    private static readonly ConcurrentDictionary<Type, ObjectFactory> _cachedFactories = new();

    // ═══════════════════════════════════════════════════════════════
    // INSTANCE DEPENDENCIES (scoped per circuit)
    // ═══════════════════════════════════════════════════════════════
    private readonly BlazorDevToolsRegistry _registry;
    private readonly IServiceProvider _serviceProvider;
    private readonly IComponentActivator? _innerActivator;

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTORS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Creates a new activator with the scoped registry and service provider.
    /// Used when no prior IComponentActivator was registered.
    /// </summary>
    /// <param name="registry">The scoped registry for this circuit.</param>
    /// <param name="serviceProvider">The scoped service provider for this circuit.</param>
    public BlazorDevToolsComponentActivator(BlazorDevToolsRegistry registry, IServiceProvider serviceProvider)
    {
        _registry = registry;
        _serviceProvider = serviceProvider;
        _innerActivator = null;
    }

    /// <summary>
    /// Creates a new activator that chains to an existing activator.
    /// Used when the application already had a custom IComponentActivator.
    /// The inner activator creates the component, we register it.
    /// </summary>
    /// <param name="registry">The scoped registry for this circuit.</param>
    /// <param name="serviceProvider">The scoped service provider for this circuit.</param>
    /// <param name="innerActivator">The existing activator to chain to.</param>
    public BlazorDevToolsComponentActivator(BlazorDevToolsRegistry registry, IServiceProvider serviceProvider, IComponentActivator innerActivator)
    {
        _registry = registry;
        _serviceProvider = serviceProvider;
        _innerActivator = innerActivator;
    }

    // ═══════════════════════════════════════════════════════════════
    // IComponentActivator.CreateInstance
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Creates a component instance and registers it with the scoped registry.
    /// Called by Blazor's Renderer for every component creation in this circuit.
    /// If an inner activator exists, it handles creation; otherwise we use ObjectFactory.
    /// </summary>
    /// <param name="componentType">The type of component to create.</param>
    /// <returns>The created component instance.</returns>
    public IComponent CreateInstance([DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        // Create the component (either via chained activator or ObjectFactory)
        IComponent component = _innerActivator != null
            ? _innerActivator.CreateInstance(componentType)
            : CreateComponentCore(componentType);
        #if DEBUG
        Console.WriteLine($"[BDT] Component created: {componentType.Name}");
        #endif
        // Register with the scoped registry for tracking.
        // Because both activator and registry are scoped to the same circuit,
        // this component is guaranteed to be tracked in the correct registry.
        _registry.RegisterPendingComponent(component);
        return component;
    }

    // ═══════════════════════════════════════════════════════════════
    // COMPONENT CREATION CORE
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Creates a component using cached ObjectFactory.
    /// Mirrors DefaultComponentActivator implementation for performance.
    /// </summary>
    /// <param name="componentType">The type of component to create.</param>
    /// <returns>The created component instance.</returns>
    private IComponent CreateComponentCore([DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        ObjectFactory factory = _cachedFactories.GetOrAdd(componentType, CreateFactory);
        return (IComponent)factory(_serviceProvider, arguments: null);
    }

    /// <summary>
    /// Creates an ObjectFactory for the given component type.
    /// The factory is cached for reuse across all component instances of this type.
    /// </summary>
    /// <param name="componentType">The type of component to create a factory for.</param>
    /// <returns>An ObjectFactory that can create instances of the component type.</returns>
    private static ObjectFactory CreateFactory([DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        return ActivatorUtilities.CreateFactory(componentType, Type.EmptyTypes);
    }
}