// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - ComponentReflectionHelper.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Reflection utilities for extracting data from regular ComponentBase components.
//   Used by BlazorDevToolsRegistry when the component doesn't inherit from
//   BlazorDevToolsComponentBase.
//
// ARCHITECTURE:
//   This is the "fallback" path for data extraction:
//
//   BlazorDevToolsComponentBase → Direct property access (no reflection)
//   ComponentBase → ComponentReflectionHelper (reflection-based)
//
//   Reflection is slower and more fragile (private field names could change),
//   but it allows tracking ANY component without code changes.
//
// CACHING:
//   All FieldInfo/PropertyInfo objects are cached per-type to minimize
//   reflection overhead on subsequent calls.
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using System.Collections.Concurrent;
using System.Reflection;

namespace BlazorDeveloperTools;

/// <summary>
/// Reflection utilities for extracting data from ComponentBase.
/// </summary>
public static class ComponentReflectionHelper
{
    // ═══════════════════════════════════════════════════════════════
    // CACHED REFLECTION INFO (ComponentBase private fields)
    // ═══════════════════════════════════════════════════════════════
    private static readonly Type ComponentBaseType = typeof(ComponentBase);
    private static readonly FieldInfo? HasNeverRenderedField;
    private static readonly FieldInfo? HasPendingQueuedRenderField;
    private static readonly FieldInfo? HasCalledOnAfterRenderField;
    private static readonly FieldInfo? InitializedField;

    // ═══════════════════════════════════════════════════════════════
    // CACHED PARAMETER INFO PER TYPE
    // ═══════════════════════════════════════════════════════════════
    private static readonly ConcurrentDictionary<Type, List<PropertyInfo>> ParameterPropertiesCache = new();
    private static readonly ConcurrentDictionary<Type, List<PropertyInfo>> CascadingParameterPropertiesCache = new();
    private static readonly ConcurrentDictionary<Type, List<FieldInfo>> TrackedStateFieldsCache = new();

    static ComponentReflectionHelper()
    {
        const BindingFlags privateInstance = BindingFlags.NonPublic | BindingFlags.Instance;

        HasNeverRenderedField = ComponentBaseType.GetField("_hasNeverRendered", privateInstance);
        HasPendingQueuedRenderField = ComponentBaseType.GetField("_hasPendingQueuedRender", privateInstance);
        HasCalledOnAfterRenderField = ComponentBaseType.GetField("_hasCalledOnAfterRender", privateInstance);
        InitializedField = ComponentBaseType.GetField("_initialized", privateInstance);
    }

    // ═══════════════════════════════════════════════════════════════
    // EXTRACT COMPONENTBASE INTERNAL STATE
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Extracts internal state from a ComponentBase instance.
    /// Returns null if component is not a ComponentBase or extraction fails.
    /// </summary>
    public static ComponentBaseInternalState? ExtractComponentBaseState(IComponent component)
    {
        if (component is not ComponentBase)
        {
            return null;
        }

        try
        {
            return new ComponentBaseInternalState
            {
                HasNeverRendered = HasNeverRenderedField?.GetValue(component) is bool hnr && hnr,
                HasPendingQueuedRender = HasPendingQueuedRenderField?.GetValue(component) is bool hpqr && hpqr,
                HasCalledOnAfterRender = HasCalledOnAfterRenderField?.GetValue(component) is bool hcoar && hcoar,
                IsInitialized = InitializedField?.GetValue(component) is bool init && init
            };
        }
        catch
        {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // EXTRACT PARAMETERS
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Extracts [Parameter] and [CascadingParameter] values from a component.
    /// </summary>
    public static List<ParameterValue>? ExtractParameters(IComponent component)
    {
        var componentType = component.GetType();
        var result = new List<ParameterValue>();

        // Get [Parameter] properties
        var parameterProps = ParameterPropertiesCache.GetOrAdd(componentType, t =>
            [.. t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.GetCustomAttribute<ParameterAttribute>() != null)]);

        foreach (var prop in parameterProps)
        {
            try
            {
                result.Add(new ParameterValue
                {
                    Name = prop.Name,
                    TypeName = prop.PropertyType.Name,
                    Value = prop.GetValue(component),
                    IsCascading = false
                });
            }
            catch
            {
                // Skip properties that can't be read
            }
        }

        // Get [CascadingParameter] properties
        var cascadingProps = CascadingParameterPropertiesCache.GetOrAdd(componentType, t =>
            [.. t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.GetCustomAttribute<CascadingParameterAttribute>() != null)]);

        foreach (var prop in cascadingProps)
        {
            try
            {
                result.Add(new ParameterValue
                {
                    Name = prop.Name,
                    TypeName = prop.PropertyType.Name,
                    Value = prop.GetValue(component),
                    IsCascading = true
                });
            }
            catch
            {
                // Skip properties that can't be read
            }
        }

        return result.Count > 0 ? result : null;
    }

    // ═══════════════════════════════════════════════════════════════
    // EXTRACT TRACKED STATE ([TrackState] attribute)
    // ═══════════════════════════════════════════════════════════════
    /// <summary>
    /// Extracts fields marked with [TrackState] attribute.
    /// </summary>
    public static Dictionary<string, string?>? ExtractTrackedState(IComponent component)
    {
        var componentType = component.GetType();

        var trackedFields = TrackedStateFieldsCache.GetOrAdd(componentType, t =>
            [.. t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance).Where(f => f.GetCustomAttribute<TrackStateAttribute>() != null)]);

        if (trackedFields.Count == 0)
        {
            return null;
        }

        var result = new Dictionary<string, string?>();

        foreach (var field in trackedFields)
        {
            try
            {
                var value = field.GetValue(component);
                result[field.Name] = value?.ToString();
            }
            catch
            {
                result[field.Name] = "<error>";
            }
        }

        return result;
    }
}