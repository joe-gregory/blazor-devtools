using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;

namespace BlazorDeveloperTools;

/// <summary>
/// Custom component activator that intercepts all Blazor component creation.
/// This is the foundation of Blazor Developer Tools - every component flows through here.
/// </summary>
/// <remarks>
/// <para>
/// <strong>ARCHITECTURE OVERVIEW</strong><br/>
/// This class is Pillar 2 of the Blazor Developer Tools three-pillar architecture:
/// </para>
/// <list type="bullet">
///   <item><description>Pillar 1: Compile-time metadata (Source Generator) - static info about components</description></item>
///   <item><description>Pillar 2: Runtime tracking (this class + BdtRegistry) - live component instances</description></item>
///   <item><description>Pillar 3: Browser-side interception (JavaScript) - render batch monitoring</description></item>
/// </list>
/// <para>
/// <strong>WHY THIS CLASS EXISTS</strong><br/>
/// Blazor's Renderer uses an <see cref="IComponentActivator"/> to instantiate every component.
/// By default, Blazor uses <c>DefaultComponentActivator</c> which simply creates instances.
/// However, if you register your own implementation of <see cref="IComponentActivator"/> in services collection,
/// Blazor renderer will use that instead of the default implementation.
/// By registering our own implementation, we can observe all component creation without
/// requiring any changes to user components - no base class inheritance, no attributes,
/// no code modifications whatsoever.
/// </para>
/// <para>
/// <strong>DESIGN DECISION: REIMPLEMENTING DefaultComponentActivator</strong><br/>
/// Rather than just wrapping the default activator, we reimplement its functionality.
/// This is because:
/// <list type="number">
///   <item><description>DefaultComponentActivator is internal - we can't access it directly</description></item>
///   <item><description>We need the IServiceProvider anyway for the ObjectFactory pattern</description></item>
///   <item><description>Reimplementing gives us full control and understanding of the creation process</description></item>
/// </list>
/// Our implementation mirrors Microsoft's DefaultComponentActivator exactly, then adds
/// our tracking on top. See the original at:
/// https://github.com/dotnet/aspnetcore/blob/main/src/Components/Components/src/DefaultComponentActivator.cs
/// </para>
/// <para>
/// <strong>THE componentId TIMING PROBLEM</strong><br/>
/// When this activator's CreateInstance method is called, we have:
/// <list type="bullet">
///   <item><description>✓ The component Type (e.g., typeof(Counter))</description></item>
///   <item><description>✓ The component instance (the actual object)</description></item>
///   <item><description>✗ The componentId - NOT YET ASSIGNED</description></item>
/// </list>
/// The componentId is assigned by the Renderer AFTER CreateInstance returns.
/// The BdtRegistry handles this via "lazy resolution" - we track instances here,
/// and extract their componentIds later via reflection when JavaScript queries us.
/// </para>
/// </remarks>
/// <param name="serviceProvider">
/// The application's service provider, needed for the ObjectFactory pattern.
/// Even though Blazor components use property injection (not constructor injection),
/// the ObjectFactory delegate signature requires an IServiceProvider.
/// </param>
/// <param name="innerActivator">
/// Optional inner activator to chain to. This enables compatibility with other libraries
/// that also register custom activators (e.g., bUnit for testing). When present, we
/// delegate component creation to the inner activator instead of creating ourselves.
/// </param>
public class BdtComponentActivator(IServiceProvider serviceProvider, IComponentActivator? innerActivator = null) : IComponentActivator
{
    // =========================================================================================
    // STATIC FACTORY CACHE
    // =========================================================================================
    //
    // This cache is the key performance optimization, identical to Microsoft's implementation.
    //
    // WHY CACHE?
    // ----------
    // Creating objects via reflection is expensive. Each call to Activator.CreateInstance()
    // must:
    //   1. Look up the type's constructor metadata
    //   2. Validate parameters
    //   3. Invoke the constructor via reflection
    //
    // For an app with 50 component types rendering frequently, this adds up.
    //
    // THE SOLUTION: ObjectFactory
    // ---------------------------
    // ActivatorUtilities.CreateFactory() analyzes a type's constructor ONCE and returns
    // a compiled delegate (ObjectFactory) that can create instances without reflection.
    // We cache these delegates by Type, so each component type pays the reflection cost
    // only once, ever.
    //
    // WHY ConcurrentDictionary?
    // -------------------------
    // Blazor Server apps handle multiple users concurrently. Each user's circuit runs
    // on a thread pool thread, potentially creating components simultaneously.
    // ConcurrentDictionary provides thread-safe read/write without explicit locking.
    //
    // WHAT IS ObjectFactory?
    // ----------------------
    // It's a delegate type defined as: delegate object ObjectFactory(IServiceProvider sp, object[] args)
    // Think of it as a pre-compiled "new Counter()" that we can invoke without reflection.
    //
    private static readonly ConcurrentDictionary<Type, ObjectFactory> _cachedFactories = new();

    private readonly IServiceProvider _serviceProvider = serviceProvider;
    private readonly IComponentActivator? _innerActivator = innerActivator;

    /// <summary>
    /// Called by Blazor's Renderer for every component instantiation in the application.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <strong>WHEN IS THIS CALLED?</strong><br/>
    /// Every time Blazor needs to create a component - whether from your .razor files,
    /// framework components (Router, RouteView), or third-party libraries (MudBlazor, etc.).
    /// </para>
    /// <para>
    /// <strong>WHAT IS DynamicallyAccessedMembers?</strong><br/>
    /// This attribute is a hint to the .NET IL Trimmer, which removes unused code when
    /// publishing Blazor WebAssembly apps to reduce download size.
    /// </para>
    /// <para>
    /// The problem: The trimmer analyzes your code statically. It sees that Counter's
    /// constructor is never called directly in code (we use reflection), so it might
    /// remove it as "unused". Then at runtime, CreateInstance fails.
    /// </para>
    /// <para>
    /// The solution: This attribute says "whatever Type flows into this parameter,
    /// preserve its PublicConstructors - we need them at runtime."
    /// </para>
    /// <para>
    /// <strong>THE CREATION FLOW</strong><br/>
    /// <code>
    /// Blazor Renderer
    ///       │
    ///       ▼
    /// ComponentFactory.InstantiateComponent(typeof(Counter))
    ///       │
    ///       ▼
    /// IComponentActivator.CreateInstance(typeof(Counter))  ◄── WE ARE HERE
    ///       │
    ///       ▼
    /// Returns new Counter instance
    ///       │
    ///       ▼
    /// Renderer assigns componentId (we can't see this yet)
    ///       │
    ///       ▼
    /// Renderer calls IComponent.Attach(renderHandle)
    ///       │
    ///       ▼
    /// Component lifecycle begins (SetParametersAsync, etc.)
    /// </code>
    /// </para>
    /// </remarks>
    /// <param name="componentType">The type of component to create (e.g., typeof(Counter))</param>
    /// <returns>A new instance of the component, ready for the Renderer to initialize</returns>
    /// <exception cref="ArgumentException">Thrown if componentType doesn't implement IComponent</exception>
    public IComponent CreateInstance(
        [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        // =================================================================================
        // STEP 1: Validate the type implements IComponent
        // =================================================================================
        //
        // This is a safety check copied from Microsoft's DefaultComponentActivator.
        //
        // What does IsAssignableFrom mean?
        // ---------------------------------
        // It asks: "Can an instance of componentType be assigned to a variable of type IComponent?"
        //
        // In C# terms, it checks if this would compile:
        //   IComponent x = new [componentType]();
        //
        // Examples:
        //   typeof(IComponent).IsAssignableFrom(typeof(Counter))
        //     → true, because Counter : ComponentBase : IComponent
        //
        //   typeof(IComponent).IsAssignableFrom(typeof(string))
        //     → false, because string doesn't implement IComponent
        //
        // Why check this?
        // ----------------
        // The Renderer should only ever pass IComponent types, but defensive programming
        // catches bugs early with clear error messages rather than cryptic cast failures.
        //
        if (!typeof(IComponent).IsAssignableFrom(componentType))
        {
            throw new ArgumentException(
                $"The type {componentType.FullName} does not implement {nameof(IComponent)}.",
                nameof(componentType));
        }

        // =================================================================================
        // STEP 2: Create the component instance
        // =================================================================================
        IComponent instance;

        if (_innerActivator != null)
        {
            // ---------------------------------------------------------------------------------
            // PATH A: Delegate to inner activator (chaining scenario)
            // ---------------------------------------------------------------------------------
            //
            // Another library (like bUnit) registered their own IComponentActivator before us.
            // To maintain compatibility, we let them handle the actual creation.
            // Our ServiceCollectionExtensions.AddBlazorDevTools() sets this up.
            //
            // This is rare in practice - almost no libraries use IComponentActivator.
            //
            instance = _innerActivator.CreateInstance(componentType);
        }
        else
        {
            // ---------------------------------------------------------------------------------
            // PATH B: Create using cached factory (standard path)
            // ---------------------------------------------------------------------------------
            //
            // This is the normal case - we create the component ourselves.
            //
            // Why not just: (IComponent)Activator.CreateInstance(componentType) ?
            // -------------------------------------------------------------------
            // Performance. Activator.CreateInstance uses reflection on every call.
            // The ObjectFactory pattern does reflection ONCE, caches the result,
            // and subsequent calls are just fast delegate invocations.
            //
            // For a component that renders 1000 times, that's 999 reflection calls saved.
            //
            ObjectFactory factory = GetOrCreateFactory(componentType);

            // Invoke the factory to create the instance.
            // 
            // Parameters:
            //   _serviceProvider - Required by ObjectFactory signature, used for DI if needed
            //   []               - Constructor arguments (empty - Blazor components have parameterless ctors)
            //
            // Blazor components use PROPERTY injection via [Inject] attribute, not constructor injection.
            // The Renderer handles property injection separately, after we return the instance.
            //
            instance = (IComponent)factory(_serviceProvider, []);
        }

        // =================================================================================
        // STEP 3: BDT Tracking - This is where Blazor Developer Tools does its work
        // =================================================================================
        //
        // At this point we have:
        //   ✓ componentType - The Type (e.g., typeof(Counter))
        //   ✓ instance      - The actual live object
        //   ✗ componentId   - NOT YET AVAILABLE (assigned after we return)
        //
        // The componentId is stored in a private field (_renderHandle) on ComponentBase.
        // It gets set when the Renderer calls IComponent.Attach() after we return.
        //
        // How do we correlate instance → componentId later?
        // --------------------------------------------------
        // BdtRegistry uses "lazy resolution":
        //   1. Here: Store instance in a "pending" collection (we have Type + instance)
        //   2. Later: When JavaScript asks about componentId X, scan pending instances,
        //             extract their componentIds via reflection, find the match
        //
        // This is handled by BdtRegistry.TrackPendingInstance() (coming in Step 2).
        //

        // Temporary logging to prove interception is working
        Debug.WriteLine($"[BDT] Component created: {componentType.FullName}");
        Console.WriteLine($"[BDT] Component created: {componentType.FullName}");

        // TODO: Track instance in BdtRegistry (Step 2)
        // _registry.TrackPendingInstance(instance, componentType);

        return instance;
    }

    /// <summary>
    /// Gets a cached factory for the component type, or creates and caches one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <strong>WHY NOT USE GetOrAdd?</strong><br/>
    /// ConcurrentDictionary has a convenient GetOrAdd method that would simplify this to:
    /// <code>
    /// return _cachedFactories.GetOrAdd(componentType, 
    ///     type => ActivatorUtilities.CreateFactory(type, Type.EmptyTypes));
    /// </code>
    /// 
    /// However, the [DynamicallyAccessedMembers] attribute doesn't flow through to the
    /// lambda callback. The IL Trimmer would see the lambda accessing constructors
    /// but wouldn't know to preserve them, causing trimmer warnings (IL2072).
    /// </para>
    /// <para>
    /// <strong>IS THIS THREAD-SAFE?</strong><br/>
    /// Yes. ConcurrentDictionary handles concurrent access internally. The worst case
    /// is two threads creating the same factory simultaneously - one will "win" the
    /// TryAdd, and the other's factory gets discarded. This is harmless because:
    /// <list type="bullet">
    ///   <item><description>ObjectFactory delegates are cheap, stateless objects</description></item>
    ///   <item><description>This only happens once per type, ever</description></item>
    ///   <item><description>Both factories would produce identical results</description></item>
    /// </list>
    /// </para>
    /// <para>
    /// <strong>WHAT IS Type.EmptyTypes?</strong><br/>
    /// It's equivalent to <c>new Type[0]</c> - an empty array indicating we want
    /// a parameterless constructor. Blazor components MUST have parameterless constructors;
    /// dependency injection happens via property injection ([Inject] attribute) after
    /// construction, not via constructor parameters.
    /// </para>
    /// </remarks>
    /// <param name="componentType">The component type to get/create a factory for</param>
    /// <returns>An ObjectFactory that can efficiently create instances of the type</returns>
    private static ObjectFactory GetOrCreateFactory(
        [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)] Type componentType)
    {
        // Try to get existing factory from cache
        if (!_cachedFactories.TryGetValue(componentType, out ObjectFactory? factory))
        {
            // Cache miss - create a new factory
            //
            // ActivatorUtilities.CreateFactory does the heavy lifting:
            //   1. Analyzes componentType's constructors via reflection
            //   2. Finds the best matching constructor (parameterless for Blazor components)
            //   3. Compiles a delegate that invokes that constructor efficiently
            //
            // This reflection cost is paid ONCE per type, then cached forever.
            //
            factory = ActivatorUtilities.CreateFactory(componentType, Type.EmptyTypes);

            // Store in cache for future use
            // TryAdd is safe even if another thread added it simultaneously
            _cachedFactories.TryAdd(componentType, factory);
        }

        return factory;
    }

    /// <summary>
    /// Clears the cached factories. Called during hot reload when component types may have changed.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <strong>WHY IS THIS NEEDED?</strong><br/>
    /// During development with hot reload enabled, component classes can be modified
    /// and recompiled while the app is running. The cached ObjectFactory delegates
    /// point to the OLD constructor metadata. Clearing the cache forces new factories
    /// to be created that reflect the updated types.
    /// </para>
    /// <para>
    /// Microsoft's DefaultComponentActivator subscribes to HotReloadManager.OnDeltaApplied
    /// to clear its cache automatically. We may want to do the same in the future.
    /// </para>
    /// </remarks>
    internal static void ClearCache() => _cachedFactories.Clear();
}