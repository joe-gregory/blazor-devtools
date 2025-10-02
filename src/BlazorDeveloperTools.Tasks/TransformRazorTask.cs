using Microsoft.Build.Framework;
using Microsoft.Build.Utilities;
using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace BlazorDeveloperTools.Tasks
{
    /// <summary>
    /// Creates shadow copies of Razor component files under obj/.../bdt/, inserting
    /// dev-only marker snippets at both the beginning and end of components AND
    /// around component usages within the markup.
    /// </summary>
    public sealed class TransformRazorTask : Task
    {
        /// <summary>
        /// The Razor input items. Typically @(RazorComponent).
        /// </summary>
        [Required]
        public ITaskItem[] Sources { get; set; } = Array.Empty<ITaskItem>();

        /// <summary>
        /// The root folder (under obj/...) where shadow copies are written, e.g. "obj/Debug/net8.0/bdt".
        /// </summary>
        [Required]
        public string IntermediateRoot { get; set; } = string.Empty;

        /// <summary>
        /// The project directory used to compute relative paths for Sources.
        /// </summary>
        [Required]
        public string ProjectDirectory { get; set; } = string.Empty;

        /// <summary>
        /// When true, skip files whose name starts with '_' (e.g., _Imports.razor).
        /// </summary>
        public bool SkipUnderscoreFiles { get; set; } = true;

        /// <summary>
        /// Optional: only transform files ending in ".razor" (defensive).
        /// </summary>
        public bool OnlyRazorFiles { get; set; } = true;

        // Regex to match component tags (starts with uppercase or contains dots)
        private static readonly Regex ComponentTagRegex = new Regex(
            @"<(?<closing>/)?(?<name>[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*)\b(?<attributes>[^>]*)(?<selfClosing>/)?>");

        // Regex to detect if a tag has Razor expressions that would make it dynamic
        private static readonly Regex RazorExpressionRegex = new Regex(@"@[({]");

        public override bool Execute()
        {
            if (Sources == null || Sources.Length == 0)
            {
                Log.LogMessage(MessageImportance.Low, "BlazorDevTools: TransformRazorTask skipped (no sources).");
                return true;
            }

            int injectedCount = 0;
            int copiedCount = 0;
            int componentUsagesMarked = 0;

            foreach (ITaskItem item in Sources)
            {
                string src = item.ItemSpec;
                if (string.IsNullOrWhiteSpace(src) || !System.IO.File.Exists(src))
                    continue;

                string fileName = System.IO.Path.GetFileName(src);
                bool isRazor = src.EndsWith(".razor", StringComparison.OrdinalIgnoreCase);

                // shadow path from original relative path
                string rel = GetRelativePath(ProjectDirectory, src);
                string dst = System.IO.Path.Combine(IntermediateRoot, rel);

                try
                {
                    // read original source
                    string originalContentOfFile = System.IO.File.ReadAllText(src, DetectEncoding(src, out Encoding readEncoding));

                    // Check for idempotency
                    if (IsAlreadyInjected(originalContentOfFile))
                    {
                        Log.LogMessage(MessageImportance.Low, $"BlazorDevTools: Skipping already-injected file '{src}'");
                        continue;
                    }

                    string toWrite;
                    if (isRazor && ShouldInjectMarker(fileName, originalContentOfFile))
                    {
                        // Generate a unique ID for this component file
                        string componentId = GenerateComponentId(rel);

                        // Build opening and closing markers for the file
                        string openingSnippet = BuildOpeningMarker(filesRelativePath: rel.Replace('\\', '/'), componentId: componentId);
                        string closingSnippet = BuildClosingMarker(componentId: componentId);

                        // Find where to insert the opening marker (after directives)
                        int insertIndex = FindDirectiveBlockEndIndex(originalContentOfFile);

                        // Process component usages within the content
                        string processedContent = ProcessComponentUsages(originalContentOfFile, rel, ref componentUsagesMarked);

                        // Insert file-level markers
                        if (insertIndex >= processedContent.Length)
                        {
                            // File is all directives or empty
                            toWrite = processedContent + Environment.NewLine + openingSnippet + Environment.NewLine + closingSnippet;
                        }
                        else
                        {
                            // Insert opening after directives, closing at the very end
                            toWrite = processedContent.Substring(0, insertIndex)
                                    + openingSnippet + Environment.NewLine
                                    + processedContent.Substring(insertIndex)
                                    + Environment.NewLine + closingSnippet;
                        }
                        injectedCount++;
                    }
                    else
                    {
                        // pass-through for files we shouldn't modify
                        toWrite = originalContentOfFile;
                        copiedCount++;
                    }

                    // ensure directory and write
                    string dir = System.IO.Path.GetDirectoryName(dst);
                    if (!System.IO.Directory.Exists(dir))
                        System.IO.Directory.CreateDirectory(dir);

                    System.IO.File.WriteAllText(dst, toWrite, readEncoding ?? new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                }
                catch (System.Exception ex)
                {
                    Log.LogWarning($"BlazorDevTools: Failed to shadow '{src}': {ex.Message}");
                }
            }

            Log.LogMessage(
                MessageImportance.High,
                $"BlazorDevTools: transformed {injectedCount} Razor file(s) with markers into '{IntermediateRoot}'. " +
                $"Component usages marked: {componentUsagesMarked}. Pass-through files: {copiedCount}");

            return true;
        }

        /// <summary>
        /// Processes the content to add markers around component usages
        /// </summary>
        private string ProcessComponentUsages(string content, string relativeFilePath, ref int usageCount)
        {
            var result = new StringBuilder();
            int lastIndex = 0;

            // Track open components to handle proper nesting
            var openComponents = new Stack<(string name, string id)>();

            foreach (Match match in ComponentTagRegex.Matches(content))
            {
                // Append content before this match
                result.Append(content.Substring(lastIndex, match.Index - lastIndex));

                string componentName = match.Groups["name"].Value;
                bool isClosing = match.Groups["closing"].Success;
                bool isSelfClosing = match.Groups["selfClosing"].Success;
                string attributes = match.Groups["attributes"].Value;

                // Check if this looks like a component (not HTML tag)
                if (IsComponent(componentName))
                {
                    // Check if the component tag contains Razor expressions (dynamic content)
                    bool hasDynamicContent = RazorExpressionRegex.IsMatch(match.Value);

                    if (isSelfClosing)
                    {
                        // Self-closing component
                        string componentId = $"bdt_usage_{componentName}_{usageCount++:x4}";

                        // Wrap the self-closing component with markers
                        result.Append(BuildComponentUsageMarker(componentName, componentId, "open", hasDynamicContent));
                        result.Append(match.Value); // Original component tag
                        result.Append(BuildComponentUsageMarker(componentName, componentId, "close", hasDynamicContent));
                    }
                    else if (!isClosing)
                    {
                        // Opening tag
                        string componentId = $"bdt_usage_{componentName}_{usageCount++:x4}";
                        openComponents.Push((componentName, componentId));

                        // Add opening marker before the component
                        result.Append(BuildComponentUsageMarker(componentName, componentId, "open", hasDynamicContent));
                        result.Append(match.Value);
                    }
                    else
                    {
                        // Closing tag
                        result.Append(match.Value);

                        // Try to match with the most recent open component
                        if (openComponents.Count > 0 && openComponents.Peek().name == componentName)
                        {
                            var (name, id) = openComponents.Pop();
                            // Add closing marker after the component
                            result.Append(BuildComponentUsageMarker(name, id, "close", false));
                        }
                    }
                }
                else
                {
                    // Not a component, just append as-is
                    result.Append(match.Value);
                }

                lastIndex = match.Index + match.Length;
            }

            // Append remaining content
            result.Append(content.Substring(lastIndex));

            // Close any remaining open components (malformed markup)
            while (openComponents.Count > 0)
            {
                var (name, id) = openComponents.Pop();
                result.Append(BuildComponentUsageMarker(name, id, "close", false));
                Log.LogWarning($"BlazorDevTools: Unclosed component '{name}' in file '{relativeFilePath}'");
            }

            return result.ToString();
        }

        /// <summary>
        /// Determines if a tag name represents a component (not an HTML element)
        /// </summary>
        private static bool IsComponent(string tagName)
        {
            // Components start with uppercase or contain dots (namespaced)
            if (string.IsNullOrEmpty(tagName))
                return false;

            // Check if starts with uppercase
            if (char.IsUpper(tagName[0]))
                return true;

            // Check if contains dots (namespaced component)
            if (tagName.Contains("."))
                return true;

            return false;
        }

        /// <summary>
        /// Builds a marker for component usage
        /// </summary>
        private static string BuildComponentUsageMarker(string componentName, string componentId, string markerType, bool isDynamic)
        {
            // Use comments for dynamic content that might interfere with Razor expressions
            if (isDynamic && markerType == "open")
            {
                return $"@* BDT-USAGE-{componentName}-{componentId}-OPEN *@";
            }
            else if (isDynamic && markerType == "close")
            {
                return $"@* BDT-USAGE-{componentName}-{componentId}-CLOSE *@";
            }

            // Use span markers for static content
            return $@"<span data-blazordevtools-marker=""{markerType}"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{componentName}"" data-blazordevtools-usage=""true"" style=""display:none!important""></span>";
        }

        private static bool ShouldInjectMarker(string fileName, string content)
        {
            // Skip files that start with underscore
            if (fileName.StartsWith("_", StringComparison.Ordinal))
                return false;

            // Skip App.razor
            if (fileName.Equals("App.razor", StringComparison.OrdinalIgnoreCase))
                return false;

            // Skip Routes.razor
            if (fileName.Equals("Routes.razor", StringComparison.OrdinalIgnoreCase))
                return false;

            // Skip files that contain <!DOCTYPE html>
            if (content.IndexOf("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) >= 0)
                return false;

            // Skip files that contain <Router> component
            if (content.IndexOf("<Router", StringComparison.OrdinalIgnoreCase) >= 0)
                return false;

            return true;
        }

        private static string GetRelativePath(string root, string fullPath)
        {
            string rootNorm = System.IO.Path.GetFullPath(root).TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar) + System.IO.Path.DirectorySeparatorChar;
            string fullNorm = System.IO.Path.GetFullPath(fullPath);
            if (fullNorm.StartsWith(rootNorm, System.StringComparison.OrdinalIgnoreCase))
                return fullNorm.Substring(rootNorm.Length);
            return System.IO.Path.GetFileName(fullPath);
        }

        private static Encoding DetectEncoding(string path, out Encoding detected)
        {
            byte[] bom = new byte[4];
            using (System.IO.FileStream fs = System.IO.File.OpenRead(path))
            {
                int read = fs.Read(bom, 0, 4);
            }
            // UTF8 BOM
            if (bom.Length >= 3 && bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF)
            {
                detected = new UTF8Encoding(true);
                return detected;
            }
            // Default to UTF8 without BOM
            detected = new UTF8Encoding(false);
            return detected;
        }

        private static bool IsAlreadyInjected(string text)
        {
            // Check for markers
            if (text.Contains("data-blazordevtools-marker"))
                return true;

            // Check for comment headers
            if (text.Contains("@* Injected by BlazorDeveloperTools"))
                return true;

            // Check for usage markers
            if (text.Contains("BDT-USAGE"))
                return true;

            return false;
        }

        private static string GenerateComponentId(string relativeFilePath)
        {
            int hash = relativeFilePath.GetHashCode();
            return $"bdt{Math.Abs(hash):x8}";
        }

        private static string BuildOpeningMarker(string filesRelativePath, string componentId)
        {
            string fileAttr = string.IsNullOrEmpty(filesRelativePath) ? "" : $@" data-blazordevtools-file=""{filesRelativePath}""";

            return $@"@* Injected by BlazorDeveloperTools (Dev-only) - Open *@
<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""@GetType().Name""{fileAttr} style=""display:none!important""></span>";
        }

        private static string BuildClosingMarker(string componentId)
        {
            return $@"<span data-blazordevtools-marker=""close"" data-blazordevtools-id=""{componentId}"" style=""display:none!important""></span>
@* Injected by BlazorDeveloperTools (Dev-only) - Close *@";
        }

        private static int FindDirectiveBlockEndIndex(string text)
        {
            int idx = 0, len = text.Length;
            while (idx < len)
            {
                int lineStart = idx;
                int lineEnd = text.IndexOf('\n', idx);
                if (lineEnd < 0) lineEnd = len;

                string line = text.Substring(lineStart, lineEnd - lineStart);
                string trimmed = line.TrimStart();

                idx = (lineEnd < len) ? lineEnd + 1 : len;

                // Skip empty lines
                if (trimmed.Length == 0)
                    continue;

                // Skip directive lines
                if (trimmed.StartsWith("@", StringComparison.Ordinal))
                    continue;

                // Skip comments
                if (trimmed.StartsWith("@*", StringComparison.Ordinal))
                    continue;

                // Found first non-directive line
                return lineStart;
            }
            return len;
        }
    }
}