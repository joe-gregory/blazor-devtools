namespace BlazorDeveloperTools.Tasks
{
    /// <summary>
    /// Centralized constants for the data-* attributes emitted into injected spans.
    /// Keeping these in one place prevents "stringly-typed" drift across the codebase.
    /// </summary>
    internal static class AttributeNames
    {
        /// <summary>
        /// data-blazordevtools-marker : Presence flag that identifies our hidden span.
        /// </summary>
        internal const string Marker = "data-blazordevtools-marker";
        /// <summary>
        /// data-blazordevtools-id : Unique per-instance id (e.g., cmp-...).
        /// </summary>
        internal const string Id = "data-blazordevtools-id";
        /// <summary>
        /// data-blazordevtools-component : CLR component name (e.g., OrdersTable).
        /// </summary>
        internal const string Component = "data-blazordevtools-component";
        /// <summary>
        /// data-blazordevtools-file : Project-relative Razor file path (if discovered).
        /// </summary>
        internal const string File = "data-blazordevtools-file";
        /// <summary>
        /// Inline style that guarantees the span is layout-inert and invisible.
        /// </summary>
        internal const string HiddenStyle = "display:none!important";
    }
}
