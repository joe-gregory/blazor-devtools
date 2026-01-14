// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - RendererInterop.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Extracts component hierarchy and metadata from Blazor's internal Renderer.
//   Since the Renderer is internal, we use reflection to access its state.
//
// ARCHITECTURE:
//   Blazor's Renderer maintains all component state internally:
//   - _componentStateById: Dictionary<int, ComponentState>
//   - ComponentState contains: Component, ParentComponentState, ComponentId, etc.
//
//   We access this via reflection to build the component tree without requiring
//   any JS-side render batch interception (which isn't available in Blazor 8+).
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │ Renderer (Microsoft.AspNetCore.Components.RenderTree)                   │
//   │ ┌─────────────────────────────────────────────────────────────────────┐ │
//   │ │ _componentStateById: Dictionary<int, ComponentState>                │ │
//   │ │   ├─ 0: ComponentState { Component=Router, Parent=null }           │ │
//   │ │   ├─ 1: ComponentState { Component=RouteView, Parent=0 }           │ │
//   │ │   ├─ 2: ComponentState { Component=MainLayout, Parent=1 }          │ │
//   │ │   └─ 3: ComponentState { Component=Counter, Parent=2 }             │ │
//   │ └─────────────────────────────────────────────────────────────────────┘ │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// USAGE:
//   Called by BlazorDevToolsRegistry to resolve pending components and
//   establish parent-child relationships after components are attached.
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.RenderTree;
using System.Collections.Concurrent;
using System.Reflection;

namespace BlazorDeveloperTools;

/// <summary>
/// Provides reflection-based access to Blazor Renderer internals for extracting
/// component hierarchy. This is the C#-side replacement for JS Pillar 3.
/// </summary>
public static class RendererInterop
{
    // ═══════════════════════════════════════════════════════════════
    // REFLECTION CACHE
    // ═══════════════════════════════════════════════════════════════
    // Cache FieldInfo/PropertyInfo to avoid repeated reflection lookups.
    // These are type-level metadata so static caching is correct.

    private static readonly object _lock = new();
    private static bool _initialized;
    private static bool _isSupported;

    // Renderer fields
    private static FieldInfo? _componentStateByIdField;

    // ComponentState properties/fields
    private static Type? _componentStateType;
    private static PropertyInfo? _componentStateComponentProperty;
    private static PropertyInfo? _componentStateComponentIdProperty;
    private static PropertyInfo? _componentStateParentComponentStateProperty;
    private static FieldInfo? _componentStateCurrentRenderTreeField;

    // RenderTreeBuilder for tracking render state
    private static Type? _renderTreeFrameType;

    /// <summary>
    /// Whether reflection-based renderer access is supported.
    /// May be false if internal APIs changed in newer Blazor versions.
    /// </summary>
    public static bool IsSupported
    {
        get
        {
            EnsureInitialized();
            return _isSupported;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    private static void EnsureInitialized()
    {
        if (_initialized) return;
        lock (_lock)
        {
            if (_initialized) return;
            Initialize();
            _initialized = true;
        }
    }

    private static void Initialize()
    {
        try
        {
            // Get the Renderer type from the RenderTree assembly
            Type? rendererType = typeof(Renderer);

#if DEBUG
            Console.WriteLine("[BDT RendererInterop] Examining Renderer type for component state dictionary...");
            Console.WriteLine("[BDT RendererInterop] All private instance fields:");
            foreach (FieldInfo f in rendererType.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
            {
                Console.WriteLine($"  - {f.Name}: {f.FieldType.Name}");
            }
#endif

            // Find _componentStateById field - try multiple possible names
            string[] possibleFieldNames = new[]
            {
                "_componentStateById",
                "_componentStateByComponentId",
                "_componentStates",
                "_components"
            };

            foreach (string fieldName in possibleFieldNames)
            {
                _componentStateByIdField = rendererType.GetField(
                    fieldName,
                    BindingFlags.NonPublic | BindingFlags.Instance
                );
                if (_componentStateByIdField != null)
                {
#if DEBUG
                    Console.WriteLine($"[BDT RendererInterop] Found field by name: {fieldName}");
#endif
                    break;
                }
            }

            // If not found by name, look for any Dictionary<int, ?> field
            if (_componentStateByIdField == null)
            {
                foreach (FieldInfo field in rendererType.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    if (field.FieldType.IsGenericType &&
                       field.FieldType.GetGenericTypeDefinition() == typeof(Dictionary<,>) &&
                       field.FieldType.GetGenericArguments()[0] == typeof(int))
                    {
                        _componentStateByIdField = field;
#if DEBUG
                        Console.WriteLine($"[BDT RendererInterop] Found dictionary field: {field.Name} ({field.FieldType.Name})");
#endif
                        break;
                    }
                }
            }

            if (_componentStateByIdField == null)
            {
#if DEBUG
                Console.WriteLine("[BDT RendererInterop] Could not find _componentStateById field");
#endif
                _isSupported = false;
                return;
            }

            // Get the ComponentState type from the dictionary's value type
            Type dictType = _componentStateByIdField.FieldType;
            if (dictType.IsGenericType)
            {
                _componentStateType = dictType.GetGenericArguments()[1];
#if DEBUG
                Console.WriteLine($"[BDT RendererInterop] ComponentState type: {_componentStateType.FullName}");
#endif
            }

            if (_componentStateType == null)
            {
#if DEBUG
                Console.WriteLine("[BDT RendererInterop] Could not determine ComponentState type");
#endif
                _isSupported = false;
                return;
            }

#if DEBUG
            Console.WriteLine("[BDT RendererInterop] ComponentState properties:");
            foreach (PropertyInfo p in _componentStateType.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                Console.WriteLine($"  - {p.Name}: {p.PropertyType.Name}");
            }
#endif

            // Get ComponentState properties
            _componentStateComponentProperty = _componentStateType.GetProperty(
                "Component",
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance
            );

            _componentStateComponentIdProperty = _componentStateType.GetProperty(
                "ComponentId",
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance
            );

            _componentStateParentComponentStateProperty = _componentStateType.GetProperty(
                "ParentComponentState",
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance
            );

            // Check if we got the essential properties
            if (_componentStateComponentProperty == null ||
               _componentStateComponentIdProperty == null ||
               _componentStateParentComponentStateProperty == null)
            {
#if DEBUG
                Console.WriteLine("[BDT RendererInterop] Missing essential ComponentState properties:");
                Console.WriteLine($"  Component: {_componentStateComponentProperty != null}");
                Console.WriteLine($"  ComponentId: {_componentStateComponentIdProperty != null}");
                Console.WriteLine($"  ParentComponentState: {_componentStateParentComponentStateProperty != null}");
#endif
                _isSupported = false;
                return;
            }

            _isSupported = true;
#if DEBUG
            Console.WriteLine("[BDT RendererInterop] Initialized successfully - IsSupported=true");
#endif
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT RendererInterop] Initialization failed: {ex.Message}");
#endif
            _isSupported = false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // COMPONENT STATE EXTRACTION
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Component information extracted from the Renderer's internal state.
    /// </summary>
    public class ComponentStateInfo
    {
        public int ComponentId { get; set; }
        public int? ParentComponentId { get; set; }
        public IComponent? Component { get; set; }
        public string? TypeName { get; set; }
        public string? TypeFullName { get; set; }
    }

    /// <summary>
    /// Extracts all component states from a Renderer instance.
    /// </summary>
    /// <param name="renderer">The Renderer to extract from.</param>
    /// <returns>Dictionary of componentId → ComponentStateInfo, or null if extraction failed.</returns>
    public static Dictionary<int, ComponentStateInfo>? GetAllComponentStates(Renderer renderer)
    {
        EnsureInitialized();
        if (!_isSupported || _componentStateByIdField == null) return null;

        try
        {
            object? dictObj = _componentStateByIdField.GetValue(renderer);
            if (dictObj == null) return null;

            // The dictionary is Dictionary<int, ComponentState>
            // We need to enumerate it via reflection since ComponentState is internal
            System.Collections.IEnumerable? enumerable = dictObj as System.Collections.IEnumerable;
            if (enumerable == null) return null;

            Dictionary<int, ComponentStateInfo> result = new();

            foreach (object kvp in enumerable)
            {
                // kvp is KeyValuePair<int, ComponentState>
                Type kvpType = kvp.GetType();
                PropertyInfo? keyProp = kvpType.GetProperty("Key");
                PropertyInfo? valueProp = kvpType.GetProperty("Value");

                if (keyProp == null || valueProp == null) continue;

                int componentId = (int)(keyProp.GetValue(kvp) ?? -1);
                object? componentState = valueProp.GetValue(kvp);

                if (componentState == null) continue;

                ComponentStateInfo info = ExtractComponentStateInfo(componentId, componentState);
                result[componentId] = info;
            }

            return result;
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT RendererInterop] GetAllComponentStates failed: {ex.Message}");
#endif
            return null;
        }
    }

    /// <summary>
    /// Gets the parent componentId for a specific component.
    /// </summary>
    /// <param name="renderer">The Renderer instance.</param>
    /// <param name="componentId">The component to find the parent of.</param>
    /// <returns>Parent componentId, or null if no parent or extraction failed.</returns>
    public static int? GetParentComponentId(Renderer renderer, int componentId)
    {
        EnsureInitialized();
        if (!_isSupported || _componentStateByIdField == null) return null;

        try
        {
            object? dictObj = _componentStateByIdField.GetValue(renderer);
            if (dictObj == null) return null;

            // Try to get the ComponentState for this componentId
            // Dictionary<int, ComponentState>.TryGetValue
            MethodInfo? tryGetMethod = dictObj.GetType().GetMethod("TryGetValue");
            if (tryGetMethod == null) return null;

            object?[] args = new object?[] { componentId, null };
            bool found = (bool)(tryGetMethod.Invoke(dictObj, args) ?? false);

            if (!found || args[1] == null) return null;

            object componentState = args[1];

            // Get ParentComponentState
            object? parentState = _componentStateParentComponentStateProperty?.GetValue(componentState);
            if (parentState == null) return null;

            // Get ComponentId from parent
            int? parentId = (int?)_componentStateComponentIdProperty?.GetValue(parentState);
            return parentId;
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT RendererInterop] GetParentComponentId failed: {ex.Message}");
#endif
            return null;
        }
    }

    /// <summary>
    /// Gets the componentId for a component instance from the Renderer.
    /// </summary>
    /// <param name="renderer">The Renderer instance.</param>
    /// <param name="component">The component instance to find.</param>
    /// <returns>ComponentId, or null if not found.</returns>
    public static int? GetComponentId(Renderer renderer, IComponent component)
    {
        Dictionary<int, ComponentStateInfo>? states = GetAllComponentStates(renderer);
        if (states == null) return null;

        foreach (KeyValuePair<int, ComponentStateInfo> kvp in states)
        {
            if (ReferenceEquals(kvp.Value.Component, component))
            {
                return kvp.Key;
            }
        }
        return null;
    }

    private static ComponentStateInfo ExtractComponentStateInfo(int componentId, object componentState)
    {
        ComponentStateInfo info = new() { ComponentId = componentId };

        try
        {
            // Get Component
            IComponent? component = _componentStateComponentProperty?.GetValue(componentState) as IComponent;
            info.Component = component;

            if (component != null)
            {
                Type componentType = component.GetType();
                info.TypeName = componentType.Name;
                info.TypeFullName = componentType.FullName;
            }

            // Get ParentComponentState and extract its ComponentId
            object? parentState = _componentStateParentComponentStateProperty?.GetValue(componentState);
            if (parentState != null)
            {
                info.ParentComponentId = (int?)_componentStateComponentIdProperty?.GetValue(parentState);
            }
        }
        catch
        {
            // Ignore extraction errors for individual components
        }

        return info;
    }

    // ═══════════════════════════════════════════════════════════════
    // RENDERER RESOLUTION
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Attempts to get the Renderer instance from a RenderHandle.
    /// The RenderHandle contains a reference to its Renderer.
    /// </summary>
    /// <param name="renderHandle">The RenderHandle to extract from.</param>
    /// <returns>The Renderer instance, or null if extraction failed.</returns>
    public static Renderer? GetRendererFromHandle(RenderHandle renderHandle)
    {
        try
        {
            // RenderHandle has a _renderer field
            FieldInfo? rendererField = typeof(RenderHandle).GetField(
                "_renderer",
                BindingFlags.NonPublic | BindingFlags.Instance
            );

            if (rendererField == null)
            {
                // Try alternative names
                rendererField = typeof(RenderHandle).GetField(
                    "Renderer",
                    BindingFlags.NonPublic | BindingFlags.Instance
                );
            }

            if (rendererField != null)
            {
                return rendererField.GetValue(renderHandle) as Renderer;
            }

#if DEBUG
            Console.WriteLine("[BDT RendererInterop] Could not find _renderer field on RenderHandle");
            Console.WriteLine("[BDT RendererInterop] Available fields:");
            foreach (FieldInfo f in typeof(RenderHandle).GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
            {
                Console.WriteLine($"  - {f.Name}: {f.FieldType}");
            }
#endif
            return null;
        }
        catch (Exception ex)
        {
#if DEBUG
            Console.WriteLine($"[BDT RendererInterop] GetRendererFromHandle failed: {ex.Message}");
#endif
            return null;
        }
    }
}