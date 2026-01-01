using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;

namespace BlazorDeveloperTools;

/// <summary>
/// Extension methods for registering Blazor Developer Tools services.
/// </summary>
/// <remarks>
/// <para>
/// This is a static class containing extension methods. Extension methods allow you to
/// "add" methods to existing types without modifying them. The 'this' keyword before
/// the first parameter makes it callable as if it were an instance method:
/// </para>
/// <code>
/// // These two calls are equivalent:
/// builder.Services.AddBlazorDevTools();
/// ServiceCollectionExtensions.AddBlazorDevTools(builder.Services);
/// </code>
/// </remarks>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Adds Blazor Developer Tools services to the application.
    /// This enables component tracking and DevTools integration.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <strong>What is Dependency Injection (DI)?</strong><br/>
    /// DI is a pattern where objects receive their dependencies from an external source
    /// rather than creating them directly. The <see cref="IServiceCollection"/> is where
    /// you register services that can later be "injected" into classes that need them.
    /// </para>
    /// <para>
    /// <strong>What is IComponentActivator?</strong><br/>
    /// Blazor uses an <see cref="IComponentActivator"/> to create every component instance.
    /// By registering our own implementation, we can intercept all component creation
    /// for tracking and debugging purposes.
    /// </para>
    /// <para>
    /// <strong>How does Blazor find our activator?</strong><br/>
    /// In Blazor's Renderer.cs, there's a method called GetComponentActivatorOrDefault:
    /// <code>
    /// private static IComponentActivator GetComponentActivatorOrDefault(IServiceProvider serviceProvider)
    /// {
    ///     return serviceProvider.GetService&lt;IComponentActivator&gt;()
    ///         ?? DefaultComponentActivator.Instance;
    /// }
    /// </code>
    /// If we register an IComponentActivator in DI, Blazor uses ours. If not, it uses the default.
    /// This is the "open window" into Blazor's internals that makes BDT possible.
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection to register services with</param>
    /// <returns>
    /// The same service collection, enabling fluent chaining like:
    /// <code>
    /// builder.Services
    ///     .AddBlazorDevTools()
    ///     .AddOtherService();
    /// </code>
    /// </returns>
    public static IServiceCollection AddBlazorDevTools(this IServiceCollection services)
    {
        // ===================================================================================
        // STEP 1: Check if another IComponentActivator is already registered
        // ===================================================================================
        // 
        // The service collection is a list of ServiceDescriptor objects. Each descriptor
        // contains metadata about a registered service: what interface it implements,
        // and how to create an instance of it.
        //
        // We search through all registrations to find one where ServiceType matches
        // IComponentActivator. Another library (like bUnit for testing) might have 
        // already registered their own activator.
        // 
        ServiceDescriptor? existingActivator = services.FirstOrDefault(d => d.ServiceType == typeof(IComponentActivator));

        if (existingActivator != null)
        {
            // ===================================================================================
            // STEP 2a: Chain to the existing activator (decorator pattern)
            // ===================================================================================
            //
            // Another library already registered an IComponentActivator. We want to play nice
            // and not break their functionality, so we:
            //   1. Remove their registration
            //   2. Re-register with OUR activator that wraps THEIRS
            //
            // This way both activators run: ours first, then theirs.
            //
            services.Remove(existingActivator);

            // ----------------------------------------------------------------------------------
            // Register using a factory delegate
            // ----------------------------------------------------------------------------------
            //
            // AddSingleton<T>(Func<IServiceProvider, T> factory) accepts a delegate (function pointer)
            // that the DI container will call when it needs to create the service.
            //
            // The lambda syntax:
            //   sp => { ... }
            //
            // Is shorthand for:
            //   IComponentActivator CreateService(IServiceProvider sp) { ... }
            //
            // 'sp' is the IServiceProvider, passed by the DI container when it invokes our factory.
            // We can use it to resolve other services if needed.
            //
            // Why use a factory instead of AddSingleton<IComponentActivator, BdtComponentActivator>()?
            // Because the generic form would try to resolve constructor parameters from DI,
            // and we need explicit control over what gets passed to the constructor.
            //
            services.AddSingleton<IComponentActivator>(sp =>
            {
                // ----------------------------------------------------------------------------------
                // Resolve the existing activator based on how it was registered
                // ----------------------------------------------------------------------------------
                //
                // A ServiceDescriptor can hold registration info in three different ways,
                // depending on how the original library registered their service:
                //
                IComponentActivator? inner = null;

                //
                // CASE 1: ImplementationInstance
                // The service was registered with a pre-created instance:
                //   services.AddSingleton<IComponentActivator>(new TheirActivator());
                // The descriptor holds the actual object, ready to use.
                //
                if (existingActivator.ImplementationInstance != null)
                {
                    inner = existingActivator.ImplementationInstance as IComponentActivator;
                }
                //
                // CASE 2: ImplementationType
                // The service was registered with just a type:
                //   services.AddSingleton<IComponentActivator, TheirActivator>();
                // The descriptor holds typeof(TheirActivator). We must instantiate it ourselves
                // using ActivatorUtilities, which handles constructor injection.
                //
                else if (existingActivator.ImplementationType != null)
                {
                    inner = ActivatorUtilities.CreateInstance(sp, existingActivator.ImplementationType) as IComponentActivator;
                }
                //
                // CASE 3: ImplementationFactory
                // The service was registered with a factory delegate:
                //   services.AddSingleton<IComponentActivator>(sp => new TheirActivator());
                // The descriptor holds the delegate. We must invoke it ourselves.
                //
                else if (existingActivator.ImplementationFactory != null)
                {
                    inner = existingActivator.ImplementationFactory(sp) as IComponentActivator;
                }

                // Wrap their activator with ours. When Blazor creates components,
                // our BdtComponentActivator runs first, then delegates to theirs.
                //
                // Constructor: BdtComponentActivator(IServiceProvider, IComponentActivator?)
                //   - sp: Needed for the ObjectFactory pattern (cached component creation)
                //   - inner: The existing activator we're wrapping (or null if none)
                //
                return new BdtComponentActivator(sp, inner);
            });
        }
        else
        {
            // ===================================================================================
            // STEP 2b: No existing activator - register ours directly
            // ===================================================================================
            //
            // No other library has registered an IComponentActivator, so we register ours
            // with null as the inner activator. BdtComponentActivator will handle component
            // creation itself using the cached ObjectFactory pattern.
            //
            // Why do we pass 'sp' (IServiceProvider)?
            // ----------------------------------------
            // BdtComponentActivator uses ActivatorUtilities.CreateFactory to create components.
            // This returns an ObjectFactory delegate with signature:
            //   delegate object ObjectFactory(IServiceProvider serviceProvider, object[] arguments)
            //
            // Even though Blazor components use property injection (not constructor injection),
            // the ObjectFactory pattern requires an IServiceProvider to be passed when invoked.
            //
            // Why use the factory pattern (sp => ...) instead of AddSingleton<TService, TImpl>()?
            // ------------------------------------------------------------------------------------
            // If we used: services.AddSingleton<IComponentActivator, BdtComponentActivator>();
            //
            // The DI container would try to resolve ALL constructor parameters from DI:
            //   - IServiceProvider: Would be resolved (good)
            //   - IComponentActivator?: Would try to resolve... and create a circular dependency!
            //
            // By using a factory, we control exactly what gets passed to the constructor.
            //
            services.AddSingleton<IComponentActivator>(sp => new BdtComponentActivator(sp, null));
        }

        // TODO: Add BdtRegistry (Step 2)
        // services.AddSingleton<BdtRegistry>();

        // Return the service collection to enable fluent chaining
        return services;
    }
}