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
//   - Pillar 1: Source Generator (compile-time metadata)
//   - Pillar 2: Runtime Tracking (this + BlazorDevToolsRegistry + BlazorDevToolsComponentBase)
//   - Pillar 3: JS Interception (render batch interception)
//
//   The activator sees EVERY component:
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ Blazor Renderer                                                         │
//   │     │                                                                   │
//   │     │ CreateInstance(typeof(Counter))                                   │
//   │     ▼                                                                   │
//   │ BlazorDevToolsComponentActivator                                        │
//   │     │                                                                   │
//   │     ├─► Create component via ObjectFactory                              │
//   │     ├─► Register with BlazorDevToolsRegistry                                       │
//   │     └─► Return to Blazor                                                │
//   │                                                                         │
//   │ Works for:                                                              │
//   │   • ComponentBase (basic tracking, reflection-based)                    │
//   │   • BlazorDevToolsComponentBase (enhanced tracking, direct access)      │
//   │   • Any IComponent implementation                                       │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// WHY IComponentActivator:
//   - It's the ONLY hook into Blazor's component creation pipeline
//   - Called for every component, every time
//   - No user code changes required (works with existing ComponentBase)
//   - Discovered via analysis of Blazor source code (DefaultComponentActivator)
//
// COMPARISON WITH COMPETITORS:
//   - "blazor-why-did-you-render" requires base class inheritance
//   - Our approach works at framework level with zero user code changes
//   - BlazorDevToolsComponentBase is OPTIONAL for enhanced metrics
//
// REGISTRATION:
//   // In Program.cs
//   builder.Services.AddBlazorDevTools();
//
//   // Which does:
//   services.AddSingleton<IComponentActivator, BlazorDevToolsComponentActivator>();
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;

namespace BlazorDeveloperTools;

/// <summary>
/// Custom component activator that intercepts all component creation.
/// Registers every component with BlazorDevToolsRegistry for tracking.
/// </summary>
public class BlazorDevToolsComponentActivator : IComponentActivator
{
    // ═══════════════════════════════════════════════════════════════
    // OBJECT FACTORY CACHE
    // ═══════════════════════════════════════════════════════════════
    // Mirrors Microsoft's DefaultComponentActivator implementation.
    // ObjectFactory is faster than Activator.CreateInstance after first call.
    // Cache is static because component types don't change at runtime.
    private static readonly ConcurrentDictionary<Type, ObjectFactory> _cachedFactories = new();

    // ═══════════════════════════════════════════════════════════════
    // CHAINED ACTIVATOR (optional)
    // ═══════════════════════════════════════════════════════════════
    // If the app already has a custom IComponentActivator, we chain to it
    // instead of replacing it. This maintains compatibility.
    private readonly IComponentActivator? _innerActivator;

    /// <summary>
    /// Creates a new activator that registers components with BlazorDevToolsRegistry.
    /// </summary>
    public BlazorDevToolsComponentActivator()
    {
    }

    /// <summary>
    /// Creates a new activator that chains to an existing activator.
    /// Use this when the app already has a custom IComponentActivator.
    /// </summary>
    /// <param name="innerActivator">The existing activator to chain to.</param>
    public BlazorDevToolsComponentActivator(IComponentActivator innerActivator)
    {
        _innerActivator = innerActivator;
    }

    // ═══════════════════════════════════════════════════════════════
    // IComponentActivator.CreateInstance
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Creates a component instance and registers it with BlazorDevToolsRegistry.
    /// Called by Blazor for every component creation.
    /// </summary>
    /// <param name="componentType">The type of component to create.</param>
    /// <returns>The created component instance.</returns>
    public IComponent CreateInstance(
        [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        // Create the component (either via chained activator or ObjectFactory)
        var component = _innerActivator != null
            ? _innerActivator.CreateInstance(componentType)
            : CreateComponentCore(componentType);

        // Register with BlazorDevToolsRegistry for tracking
        // This works for ALL components: ComponentBase, BlazorDevToolsComponentBase, or custom IComponent
        BlazorDevToolsRegistry.Instance?.RegisterPendingComponent(component);

        return component;
    }

    /// <summary>
    /// Creates a component using cached ObjectFactory (mirrors DefaultComponentActivator).
    /// </summary>
    private static IComponent CreateComponentCore(
        [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        var factory = _cachedFactories.GetOrAdd(componentType, CreateFactory);
        return (IComponent)factory(serviceProvider: null!, arguments: null);
    }

    /// <summary>
    /// Creates an ObjectFactory for the given component type.
    /// </summary>
    private static ObjectFactory CreateFactory(
        [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        return ActivatorUtilities.CreateFactory(componentType, Type.EmptyTypes);
    }
}