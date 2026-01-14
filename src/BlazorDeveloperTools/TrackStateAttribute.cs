// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - TrackStateAttribute.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Opt-in attribute for tracking private/internal fields in the DevTools.
//   Allows developers to expose specific state without making it public.
//
// USAGE:
//   public class Counter : ComponentBase  // or BlazorDevToolsComponentBase
//   {
//       [TrackState]
//       private int _currentCount;
//
//       [TrackState]
//       private bool _isLoading;
//   }
//
// ARCHITECTURE:
//   ComponentReflectionHelper scans for this attribute and extracts values.
//   The values appear in the DevTools UI under "Tracked State".
//
// ═══════════════════════════════════════════════════════════════════════════════

namespace BlazorDeveloperTools;

/// <summary>
/// Mark a field to be tracked and displayed in Blazor Developer Tools.
/// Use this for private state that you want to inspect during debugging.
/// </summary>
[AttributeUsage(AttributeTargets.Field, AllowMultiple = false, Inherited = true)]
public sealed class TrackStateAttribute : Attribute
{
    /// <summary>
    /// Optional display name for the field in DevTools.
    /// If not specified, the field name is used.
    /// </summary>
    public string? DisplayName { get; set; }

    /// <summary>
    /// Creates a new TrackStateAttribute.
    /// </summary>
    public TrackStateAttribute()
    {
    }

    /// <summary>
    /// Creates a new TrackStateAttribute with a custom display name.
    /// </summary>
    /// <param name="displayName">The name to show in DevTools.</param>
    public TrackStateAttribute(string displayName)
    {
        DisplayName = displayName;
    }
}