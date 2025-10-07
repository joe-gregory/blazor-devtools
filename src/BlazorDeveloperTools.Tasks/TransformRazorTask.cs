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
    /// dev-only HTML comment markers at both the beginning and end of the component AND
    /// around component usages within the markup.
    /// Uses HTML comments throughout since they survive Blazor compilation to the browser.
    /// </summary>
    public sealed class TransformRazorTask : Task
    {
        private const string VERSION = "0.9.12";

        [Required]
        public ITaskItem[] Sources { get; set; } = Array.Empty<ITaskItem>();

        [Required]
        public string IntermediateRoot { get; set; } = string.Empty;

        [Required]
        public string ProjectDirectory { get; set; } = string.Empty;

        public bool SkipUnderscoreFiles { get; set; } = true;

        public bool OnlyRazorFiles { get; set; } = true;

        // Regex to match component tags (starts with uppercase or contains dots)
        private static readonly Regex ComponentTagRegex = new Regex(
            @"<(?<closing>/)?(?<name>[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*)\b(?<attributes>[^>]*)(?<selfClosing>/)?>");

        public override bool Execute()
        {
            Log.LogMessage(MessageImportance.High,
                $"BlazorDevTools Task Version: {VERSION}");

            if (Sources == null || Sources.Length == 0)
            {
                Log.LogMessage(MessageImportance.Low, "BlazorDevTools: TransformRazorTask skipped (no sources).");
                return true;
            }

            int injectedCount = 0;
            int copiedCount = 0;
            int skippedCount = 0;
            int componentUsagesMarked = 0;

            foreach (ITaskItem item in Sources)
            {
                string src = item.ItemSpec;
                if (string.IsNullOrWhiteSpace(src) || !System.IO.File.Exists(src))
                    continue;

                string fileName = System.IO.Path.GetFileName(src);
                bool isRazor = src.EndsWith(".razor", StringComparison.OrdinalIgnoreCase);

                string rel = GetRelativePath(ProjectDirectory, src);
                string dst = System.IO.Path.Combine(IntermediateRoot, rel);

                try
                {
                    // IMPORTANT: Check if shadow copy already exists and has markers
                    if (System.IO.File.Exists(dst))
                    {
                        string existingShadowContent = System.IO.File.ReadAllText(dst);
                        if (IsAlreadyInjected(existingShadowContent))
                        {
                            Log.LogMessage(MessageImportance.Low, $"BlazorDevTools: Shadow copy already has markers: '{dst}'");
                            skippedCount++;
                            continue;
                        }
                    }

                    // Read the ORIGINAL source file (never the shadow)
                    string originalContentOfFile = System.IO.File.ReadAllText(src, DetectEncoding(src, out Encoding readEncoding));

                    // Also check if original has markers (shouldn't happen, but defensive)
                    if (IsAlreadyInjected(originalContentOfFile))
                    {
                        Log.LogMessage(MessageImportance.Low, $"BlazorDevTools: Original file already has markers: '{src}'");

                        // Copy as-is to shadow location
                        string dir = System.IO.Path.GetDirectoryName(dst);
                        if (!System.IO.Directory.Exists(dir))
                            System.IO.Directory.CreateDirectory(dir);

                        System.IO.File.WriteAllText(dst, originalContentOfFile, readEncoding ?? new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                        skippedCount++;
                        continue;
                    }

                    string toWrite;
                    if (isRazor && ShouldInjectMarker(fileName, originalContentOfFile))
                    {
                        // Generate a unique ID for this component file
                        string componentId = GenerateComponentId(rel);

                        // Get component name from file
                        string componentName = System.IO.Path.GetFileNameWithoutExtension(fileName);

                        // Process component usages within the content FIRST
                        string processedContent = ProcessComponentUsages(originalContentOfFile, rel, ref componentUsagesMarked);

                        // Build opening and closing markers for the file using HTML comments
                        string openingSnippet = BuildFileOpeningMarker(
                            componentName: componentName,
                            filesRelativePath: rel.Replace('\\', '/'),
                            componentId: componentId);
                        string closingSnippet = BuildFileClosingMarker(componentId: componentId);

                        // Find where to insert the opening marker (after directives)
                        int insertIndex = FindDirectiveBlockEndIndex(processedContent);

                        // Insert file-level markers
                        if (insertIndex >= processedContent.Length)
                        {
                            toWrite = processedContent + Environment.NewLine + openingSnippet + Environment.NewLine + closingSnippet;
                        }
                        else
                        {
                            toWrite = processedContent.Substring(0, insertIndex)
                                    + openingSnippet + Environment.NewLine
                                    + processedContent.Substring(insertIndex)
                                    + Environment.NewLine + closingSnippet;
                        }
                        injectedCount++;
                    }
                    else
                    {
                        toWrite = originalContentOfFile;
                        copiedCount++;
                    }

                    // Ensure directory and write
                    string directory = System.IO.Path.GetDirectoryName(dst);
                    if (!System.IO.Directory.Exists(directory))
                        System.IO.Directory.CreateDirectory(directory);

                    System.IO.File.WriteAllText(dst, toWrite, readEncoding ?? new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                }
                catch (System.Exception ex)
                {
                    Log.LogWarning($"BlazorDevTools: Failed to shadow '{src}': {ex.Message}");
                }
            }

            Log.LogMessage(
                MessageImportance.High,
                $"BlazorDevTools: Transformed {injectedCount} file(s), skipped {skippedCount} already-processed, " +
                $"copied {copiedCount} others. Component usages marked: {componentUsagesMarked}");

            return true;
        }

        /// <summary>
        /// Processes the content to add HTML comment markers around component usages
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

                // Check if this looks like a component (not HTML tag)
                if (IsComponent(componentName))
                {
                    if (isSelfClosing)
                    {
                        // Self-closing component
                        string componentId = $"bdt_usage_{componentName}_{usageCount++:x4}";

                        // HTML comment before
                        result.Append(BuildComponentUsageMarker(componentName, componentId, "open"));
                        result.Append(match.Value);
                        // HTML comment after
                        result.Append(BuildComponentUsageMarker(componentName, componentId, "close"));
                    }
                    else if (!isClosing)
                    {
                        // Opening tag
                        string componentId = $"bdt_usage_{componentName}_{usageCount++:x4}";
                        openComponents.Push((componentName, componentId));

                        // HTML comment before the opening tag
                        result.Append(BuildComponentUsageMarker(componentName, componentId, "open"));
                        result.Append(match.Value);
                    }
                    else
                    {
                        // Closing tag
                        result.Append(match.Value);

                        // Try to match with the most recent open component
                        if (openComponents.Count > 0)
                        {
                            var tempStack = new Stack<(string name, string id)>();
                            bool found = false;

                            while (openComponents.Count > 0)
                            {
                                var component = openComponents.Pop();
                                if (component.name == componentName && !found)
                                {
                                    // Found matching component - add closing marker
                                    result.Append(BuildComponentUsageMarker(component.name, component.id, "close"));
                                    found = true;
                                    break;
                                }
                                else
                                {
                                    // Not matching - save for later
                                    tempStack.Push(component);
                                }
                            }

                            // Restore non-matching components back to the stack
                            while (tempStack.Count > 0)
                            {
                                openComponents.Push(tempStack.Pop());
                            }

                            if (!found)
                            {
                                Log.LogWarning($"BlazorDevTools: Unmatched closing tag for '{componentName}' in file '{relativeFilePath}'");
                            }
                        }
                        else
                        {
                            Log.LogWarning($"BlazorDevTools: Unexpected closing tag for '{componentName}' in file '{relativeFilePath}'");
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
                result.Append(BuildComponentUsageMarker(name, id, "close"));
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
        /// Builds an HTML comment marker for component usage
        /// These survive compilation and appear in the browser DOM
        /// </summary>
        private static string BuildComponentUsageMarker(string componentName, string componentId, string markerType)
        {
            return $"<!--blazor-dev-tools:usage:{markerType}:{componentId}:{componentName}-->";
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
            if (bom.Length >= 3 && bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF)
            {
                detected = new UTF8Encoding(true);
                return detected;
            }
            detected = new UTF8Encoding(false);
            return detected;
        }

        private static bool IsAlreadyInjected(string text)
        {
            // Check for our HTML comment markers
            if (text.Contains("<!--blazor-dev-tools:"))
                return true;

            // Legacy checks for span-based markers (in case of migration)
            if (text.Contains("data-blazordevtools-marker"))
                return true;

            if (text.Contains("@* Injected by BlazorDeveloperTools"))
                return true;

            return false;
        }

        private static string GenerateComponentId(string relativeFilePath)
        {
            int hash = relativeFilePath.GetHashCode();
            return $"bdt{Math.Abs(hash):x8}";
        }

        private static string BuildFileOpeningMarker(string componentName, string filesRelativePath, string componentId)
        {
            // Using HTML comments for file-level markers too
            return $@"<!--blazor-dev-tools:file:open:{componentId}:{componentName}:{filesRelativePath}-->";
        }

        private static string BuildFileClosingMarker(string componentId)
        {
            return $@"<!--blazor-dev-tools:file:close:{componentId}-->";
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

                if (trimmed.Length == 0)
                    continue;

                if (trimmed.StartsWith("@", StringComparison.Ordinal))
                    continue;

                if (trimmed.StartsWith("@*", StringComparison.Ordinal))
                    continue;

                return lineStart;
            }
            return len;
        }
    }
}