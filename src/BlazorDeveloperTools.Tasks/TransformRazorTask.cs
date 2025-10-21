using Microsoft.Build.Framework;
using Microsoft.Build.Utilities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace BlazorDeveloperTools.Tasks
{
    /// <summary>
    /// Creates shadow copies of Razor component files under obj/.../bdt/, inserting
    /// dev-only marker snippets at both the beginning and end of the component.
    /// Properly handles idempotency by checking the shadow copy if it exists.
    /// </summary>
    public sealed class TransformRazorTask : Task
    {
        [Required] public ITaskItem[] Sources { get; set; } = Array.Empty<ITaskItem>();
        [Required] public string IntermediateRoot { get; set; } = string.Empty;
        [Required] public string ProjectDirectory { get; set; } = string.Empty;
        public bool SkipUnderscoreFiles { get; set; } = true;
        public bool OnlyRazorFiles { get; set; } = true;
        /// <summary>
        /// Semicolon-separated list of component names to skip when injecting nested markers
        /// </summary>
        public string ComponentsToSkip { get; set; } = string.Empty;
        public bool Verbose { get; set; } = false;

        private static readonly Lazy<Task> Logger = new Lazy<Task>(() => new TransformRazorTask());

        public override bool Execute()
        {
            if (Sources == null || Sources.Length == 0)
            {
                Log.LogMessage(MessageImportance.Low, "BlazorDevTools: TransformRazorTask skipped (no sources).");
                return true;
            }

            // FIRST PASS: Build a map of all components and their RenderFragment parameters
            var componentRenderFragmentMap = BuildComponentRenderFragmentMap(Sources);

            Log.LogMessage(MessageImportance.High,
                $"BlazorDevTools: Discovered {componentRenderFragmentMap.Count} components with RenderFragment parameters.");

            int injectedCount = 0;
            int copiedCount = 0;
            int skippedCount = 0;

            // SECOND PASS: Transform files with knowledge of all RenderFragment parameters
            foreach (ITaskItem item in Sources)
            {
                string src = item.ItemSpec;
                if (string.IsNullOrWhiteSpace(src) || !System.IO.File.Exists(src))
                    continue;

                string fileName = System.IO.Path.GetFileName(src);
                bool isRazor = src.EndsWith(".razor", StringComparison.OrdinalIgnoreCase);

                // shadow path from originalContentOfFile relative path
                string relativePathOfOriginalFile = GetRelativePath(ProjectDirectory, src);
                string locationOfShadowCopy = System.IO.Path.Combine(IntermediateRoot, relativePathOfOriginalFile);

                try
                {
                    // Check if shadow copy already exists and has markers. We can do this because we clear the folders on each build.
                    if (System.IO.File.Exists(locationOfShadowCopy))
                    {
                        string shadowContent = System.IO.File.ReadAllText(locationOfShadowCopy);
                        if (IsAlreadyInjected(shadowContent))
                        {
                            Log.LogMessage(MessageImportance.Low, $"BlazorDevTools: Skipping already-injected shadow file for '{src}'");
                            skippedCount++;
                            continue;
                        }
                    }
                    // read originalContentOfFile source (never read prior shadow)
                    string originalContentOfFile = System.IO.File.ReadAllText(src, DetectEncoding(src, out Encoding readEncoding));

                    string toWrite;
                    if (isRazor && ShouldInjectMarker(fileName, originalContentOfFile))
                    {
                        // Generate a unique ID for this component to link start and end markers
                        string componentId = GenerateComponentId(relativePathOfOriginalFile);

                        // Get component name from file
                        string componentName = System.IO.Path.GetFileNameWithoutExtension(fileName);

                        // Build opening and closing markers
                        string openingSnippet = BuildOpeningMarker(filesRelativePath: relativePathOfOriginalFile.Replace('\\', '/'), componentId: componentId, componentName: componentName);
                        string closingSnippet = BuildClosingMarker(componentId: componentId);

                        // Find where to insert the opening marker (after directives)
                        int insertIndex = FindDirectiveBlockEndIndex(originalContentOfFile);

                        string contentAfterDirectives;
                        string directivesSection;

                        if (insertIndex >= originalContentOfFile.Length)
                        {
                            directivesSection = originalContentOfFile;
                            contentAfterDirectives = "";
                        }
                        else
                        {
                            directivesSection = originalContentOfFile.Substring(0, insertIndex);
                            contentAfterDirectives = originalContentOfFile.Substring(insertIndex);
                        }

                        // Inject markers around nested components, using our complete map
                        string processedContent = InjectMarkersAroundComponents(contentAfterDirectives, relativePathOfOriginalFile, componentRenderFragmentMap);

                        // Combine everything
                        toWrite = directivesSection
                                + openingSnippet + Environment.NewLine
                                + processedContent
                                + Environment.NewLine + closingSnippet;

                        injectedCount++;
                    }
                    else
                    {
                        toWrite = originalContentOfFile;
                        copiedCount++;
                    }

                    // ensure directory and write (overwrite if exists)
                    string dir = System.IO.Path.GetDirectoryName(locationOfShadowCopy);
                    if (!System.IO.Directory.Exists(dir))
                        System.IO.Directory.CreateDirectory(dir);

                    System.IO.File.WriteAllText(locationOfShadowCopy, toWrite, readEncoding ?? new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                }
                catch (System.Exception ex)
                {
                    Log.LogWarning($"BlazorDevTools: Failed to shadow '{src}': {ex.Message}");
                }
            }

            Log.LogMessage(
                MessageImportance.High,
                $"BlazorDevTools: Transformed {injectedCount} file(s), skipped {skippedCount} already-processed, copied {copiedCount} others.");

            return true;
        }

        /// <summary>
        /// First pass: Build a map of all components and their RenderFragment parameters
        /// </summary>
        private Dictionary<string, HashSet<string>> BuildComponentRenderFragmentMap(ITaskItem[] sources)
        {
            var map = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

            if (Verbose) Log.LogMessage(MessageImportance.High, $"BlazorDevTools: === BUILDING RENDERFRAGMENT MAP ===");

            foreach (ITaskItem item in sources)
            {
                string src = item.ItemSpec;
                if (string.IsNullOrWhiteSpace(src) || !System.IO.File.Exists(src))
                    continue;

                if (!src.EndsWith(".razor", StringComparison.OrdinalIgnoreCase))
                    continue;

                string componentName = System.IO.Path.GetFileNameWithoutExtension(src);

                try
                {
                    string content = System.IO.File.ReadAllText(src);
                    var renderFragments = ExtractRenderFragmentParameters(content, src);

                    if (renderFragments.Count > 0)
                    {
                        map[componentName] = renderFragments;

                        if (Verbose)
                        {
                            // DETAILED LOGGING
                            Log.LogMessage(MessageImportance.High,
                                $"BlazorDevTools: Component '{componentName}' ({src}):");
                            foreach (var rf in renderFragments)
                            {
                                Log.LogMessage(MessageImportance.High,
                                    $"BlazorDevTools:   - RenderFragment: {rf}");
                            }
                        }
                    }
                    else
                    {
                        if (Verbose) Log.LogMessage(MessageImportance.High, $"BlazorDevTools: Component '{componentName}' has NO RenderFragments");
                    }
                }
                catch (System.Exception ex)
                {
                    if (Verbose) Log.LogMessage(MessageImportance.High, $"BlazorDevTools: ERROR scanning '{src}': {ex.Message}");
                }
            }

            if (Verbose) Log.LogMessage(MessageImportance.High, $"BlazorDevTools: === MAP COMPLETE: {map.Count} components with RenderFragments ===");

            return map;
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
            // Check for any of our markers
            if (text.Contains("data-blazordevtools-marker"))
                return true;

            if (text.Contains("@* Injected by BlazorDeveloperTools"))
                return true;

            if (text.Contains("data-blazordevtools-usage"))
                return true;

            if (text.Contains("data-blazordevtools-id"))
                return true;

            return false;
        }

        private static string GenerateComponentId(string relativeFilePath)
        {
            int hash = relativeFilePath.GetHashCode();
            return $"bdt{Math.Abs(hash):x8}";
        }

        private static string BuildOpeningMarker(string componentName, string filesRelativePath, string componentId)
        {
            string fileAttr = string.IsNullOrEmpty(filesRelativePath) ? "" : $@" data-blazordevtools-file=""{filesRelativePath}""";

            // Using component name directly, not @GetType().Name
            return $@"@* Injected by BlazorDeveloperTools (Dev-only) - Open *@
<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{componentName}""{fileAttr} style=""display:none!important""></span>";
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

                // Move to next line for the next iteration
                idx = (lineEnd < len) ? lineEnd + 1 : len;

                // Empty line, continue
                if (trimmed.Length == 0)
                    continue;

                // Check if this line starts with a directive
                if (trimmed.StartsWith("@", StringComparison.Ordinal))
                {
                    // Check if this is a multi-line comment @* ... *@
                    if (trimmed.StartsWith("@*", StringComparison.Ordinal))
                    {
                        // Find the closing *@ - could be many lines away
                        int commentStart = lineStart + (line.Length - trimmed.Length); // actual position of @*
                        int commentEnd = text.IndexOf("*@", commentStart + 2);

                        if (commentEnd >= 0)
                        {
                            // Move past the entire comment block
                            commentEnd += 2; // Include the *@ itself

                            // Find the next line after the comment
                            int nextLineStart = text.IndexOf('\n', commentEnd);
                            if (nextLineStart >= 0)
                                idx = nextLineStart + 1;
                            else
                                idx = len;
                        }
                        else
                        {
                            // Unclosed comment - treat rest of file as comment
                            return len;
                        }
                    }
                    // Otherwise it's a normal directive like @using, @page, etc.
                    // Continue to next line (already done by idx update above)
                }
                else
                {
                    // Found non-directive content - this is where we insert
                    return lineStart;
                }
            }
            return len;
        }

        private HashSet<string> ExtractRenderFragmentParameters(string razorContent, string filePath)
        {
            var renderFragments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var componentName = System.IO.Path.GetFileNameWithoutExtension(filePath);

            // Extract all the content of the file to search for RenderFragment parameters
            // They could be in @code blocks or in the markup itself

            // Method 1: Look for @code block and extract properly with brace counting
            int codeStart = razorContent.IndexOf("@code");
            string codeContent = "";

            if (codeStart >= 0)
            {
                int braceStart = razorContent.IndexOf('{', codeStart);
                if (braceStart >= 0)
                {
                    // Count braces to find the matching closing brace
                    int braceCount = 1;
                    int pos = braceStart + 1;
                    while (pos < razorContent.Length && braceCount > 0)
                    {
                        if (razorContent[pos] == '{')
                            braceCount++;
                        else if (razorContent[pos] == '}')
                            braceCount--;
                        pos++;
                    }

                    if (braceCount == 0)
                    {
                        codeContent = razorContent.Substring(braceStart + 1, pos - braceStart - 2);

                        if (Verbose)
                        {
                            Log.LogMessage(MessageImportance.High,
                                $"BlazorDevTools: Extracted @code block of {codeContent.Length} chars from {componentName}");
                        }
                    }
                }
            }

            // Method 2: Also search the entire file content in case parameters are defined elsewhere
            string searchContent = string.IsNullOrEmpty(codeContent) ? razorContent : codeContent;

            // Look for all [Parameter] RenderFragment patterns
            // This pattern handles multiline definitions and various formats
            var pattern = @"\[Parameter\][\s\S]*?public\s+RenderFragment\??\s+(\w+)";
            var matches = Regex.Matches(searchContent, pattern);

            foreach (Match match in matches)
            {
                var fragmentName = match.Groups[1].Value;
                renderFragments.Add(fragmentName);

                if (Verbose)
                {
                    Log.LogMessage(MessageImportance.High,
                        $"BlazorDevTools:   Found RenderFragment: {fragmentName}");
                }
            }

            // Method 3: Also check for .razor.cs file
            var csFilePath = filePath + ".cs";
            if (System.IO.File.Exists(csFilePath))
            {
                try
                {
                    var csContent = System.IO.File.ReadAllText(csFilePath);
                    var csMatches = Regex.Matches(csContent, pattern);

                    foreach (Match match in csMatches)
                    {
                        var fragmentName = match.Groups[1].Value;
                        if (!renderFragments.Contains(fragmentName))
                        {
                            renderFragments.Add(fragmentName);
                            if (Verbose)
                            {
                                Log.LogMessage(MessageImportance.High,
                                    $"BlazorDevTools:   Found RenderFragment: {fragmentName} (from .cs file)");
                            }
                        }
                    }
                }
                catch
                {
                    // Continue if can't read .cs file
                }
            }

            // Always add ChildContent as it's a special Blazor convention
            renderFragments.Add("ChildContent");

            return renderFragments;
        }

        private string InjectMarkersAroundComponents(string content, string relativeFilePath, Dictionary<string, HashSet<string>> componentRenderFragmentMap)
        {
            // Parse the components to skip from the property
            string[] skipComponents = ComponentsToSkip?.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
                                ?? new string[0];

            // If configured to skip all nested components
            if (ComponentsToSkip == "*")
                return content;

            // Process all components, keeping track of their parent-child relationships
            var result = new StringBuilder();
            int lastIndex = 0;

            // Find all component-like tags (opening, closing, and self-closing)
            var allTagsPattern = @"<(/?)([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)(\s[^>]*)?(/)?>";
            var matches = Regex.Matches(content, allTagsPattern);

            // Stack to track which component we're currently inside
            var componentStack = new Stack<ComponentUsage>();

            // Track which RenderFragment parameters we're currently inside
            var renderFragmentDepth = 0;

            foreach (Match match in matches)
            {
                // Append content before this match
                result.Append(content.Substring(lastIndex, match.Index - lastIndex));

                bool isClosing = match.Groups[1].Value == "/";
                string tagName = match.Groups[2].Value;
                bool isSelfClosing = match.Groups[4].Value == "/";

                // Check if this tag is a RenderFragment parameter
                bool isRenderFragment = false;

                if (!isClosing && componentStack.Count > 0)
                {
                    var parentComponent = componentStack.Peek();
                    string parentComponentName = parentComponent.Name;

                    // Check if parent component has this as a RenderFragment parameter
                    if (componentRenderFragmentMap.ContainsKey(parentComponentName))
                    {
                        var parentRenderFragments = componentRenderFragmentMap[parentComponentName];
                        if (parentRenderFragments.Contains(tagName))
                        {
                            isRenderFragment = true;
                            if (!isSelfClosing)
                            {
                                renderFragmentDepth++;
                            }

                            if (Verbose)
                            {
                                Log.LogMessage(MessageImportance.High,
                                    $"BlazorDevTools: Skipping RenderFragment '{tagName}' of component '{parentComponentName}'");
                            }
                        }
                    }
                }
                else if (isClosing && renderFragmentDepth > 0)
                {
                    // Check if this is the closing tag of a RenderFragment
                    // We need to verify this matches an opening RenderFragment
                    if (componentStack.Count > 0)
                    {
                        var parentComponent = componentStack.Peek();
                        if (componentRenderFragmentMap.ContainsKey(parentComponent.Name))
                        {
                            var parentRenderFragments = componentRenderFragmentMap[parentComponent.Name];
                            if (parentRenderFragments.Contains(tagName))
                            {
                                isRenderFragment = true;
                                renderFragmentDepth--;
                            }
                        }
                    }
                }

                // Determine if we should skip this component entirely
                bool shouldSkip = isRenderFragment ||
                                 renderFragmentDepth > 0 || // Skip everything inside a RenderFragment
                                 ShouldSkipComponent(tagName) ||
                                 skipComponents.Contains(tagName);

                if (shouldSkip)
                {
                    // Just add the original tag without any markers
                    result.Append(match.Value);
                }
                else
                {
                    // This is a real component that needs markers
                    if (isSelfClosing)
                    {
                        // Self-closing component - wrap with markers
                        var componentId = GenerateComponentId($"{relativeFilePath}#{tagName}#{match.Index}");
                        var openMarker = $@"<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{tagName}"" data-blazordevtools-file=""{relativeFilePath.Replace('\\', '/')}"" data-blazordevtools-nested=""true"" style=""display:none!important""></span>";
                        var closeMarker = $@"<span data-blazordevtools-marker=""close"" data-blazordevtools-id=""{componentId}"" style=""display:none!important""></span>";

                        result.Append(openMarker);
                        result.Append(match.Value);
                        result.Append(closeMarker);
                    }
                    else if (!isClosing)
                    {
                        // Opening tag of a real component
                        var usage = new ComponentUsage(
                            tagName,
                            match.Index,
                            -1,
                            match,
                            false,
                            componentStack.Count > 0 ? componentStack.Peek() : null
                        );
                        componentStack.Push(usage);

                        var componentId = GenerateComponentId($"{relativeFilePath}#{tagName}#{match.Index}");
                        var openMarker = $@"<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{tagName}"" data-blazordevtools-file=""{relativeFilePath.Replace('\\', '/')}"" data-blazordevtools-nested=""true"" style=""display:none!important""></span>";

                        result.Append(openMarker);
                        result.Append(match.Value);
                    }
                    else
                    {
                        // Closing tag of a real component
                        if (componentStack.Count > 0 && componentStack.Peek().Name == tagName)
                        {
                            componentStack.Pop();
                        }

                        var componentId = GenerateComponentId($"{relativeFilePath}#{tagName}#close{match.Index}");
                        var closeMarker = $@"<span data-blazordevtools-marker=""close"" data-blazordevtools-id=""{componentId}"" style=""display:none!important""></span>";

                        result.Append(match.Value);
                        result.Append(closeMarker);
                    }
                }

                lastIndex = match.Index + match.Length;
            }

            // Append any remaining content
            result.Append(content.Substring(lastIndex));

            return result.ToString();
        }

        private static bool ShouldSkipComponent(string componentName)
        {
            // Skip framework/routing components that shouldn't be marked
            var skipList = new[] {
                "Router", "RouteView", "CascadingAuthenticationState",
                "AuthorizeView", "NotAuthorized", "Authorized",
                "PageTitle", "HeadContent", "HeadOutlet", "SectionContent",
                "CascadingValue", "ErrorBoundary", "FocusOnNavigate"
            };

            return skipList.Contains(componentName);
        }
    }
}