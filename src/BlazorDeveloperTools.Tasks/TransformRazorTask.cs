using Microsoft.Build.Framework;
using Microsoft.Build.Utilities;
using System;
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
        [Required]
        public ITaskItem[] Sources { get; set; } = Array.Empty<ITaskItem>();

        [Required]
        public string IntermediateRoot { get; set; } = string.Empty;

        [Required]
        public string ProjectDirectory { get; set; } = string.Empty;

        public bool SkipUnderscoreFiles { get; set; } = true;

        public bool OnlyRazorFiles { get; set; } = true;
        /// <summary>
        /// Semicolon-separated list of component names to skip when injecting nested markers
        /// </summary>
        public string ComponentsToSkip { get; set; } = string.Empty;
        public override bool Execute()
        {
            if (Sources == null || Sources.Length == 0)
            {
                Log.LogMessage(MessageImportance.Low, "BlazorDevTools: TransformRazorTask skipped (no sources).");
                return true;
            }

            int injectedCount = 0;
            int copiedCount = 0;
            int skippedCount = 0;

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
                    // Check if shadow copy already exists and has markers
                    if (System.IO.File.Exists(locationOfShadowCopy))
                    {
                        string shadowContent = System.IO.File.ReadAllText(locationOfShadowCopy);
                        if (IsAlreadyInjected(shadowContent))
                        {
                            Log.LogMessage(MessageImportance.Low, $"BlazorDevTools: Skipping already-injected shadow file for '{src}'");
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

                        // Inject markers around nested components
                        string processedContent = InjectMarkersAroundComponents(contentAfterDirectives, relativePathOfOriginalFile);

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
                // Skip whitespace at the beginning of the line
                while (idx < len && (text[idx] == ' ' || text[idx] == '\t'))
                    idx++;

                if (idx >= len)
                    break;

                // Check if this is the start of a directive or comment
                if (text[idx] == '@')
                {
                    // Check if this is a multi-line comment @* ... *@
                    if (idx + 1 < len && text[idx + 1] == '*')
                    {
                        // Find the closing *@
                        int commentEnd = text.IndexOf("*@", idx + 2);
                        if (commentEnd >= 0)
                        {
                            // Move past the comment
                            idx = commentEnd + 2;

                            // Skip to the next line if we're not already at the end
                            int nextNewline = text.IndexOf('\n', idx);
                            if (nextNewline >= 0)
                                idx = nextNewline + 1;
                            else
                                idx = len;
                        }
                        else
                        {
                            // Unclosed comment, treat rest of file as comment
                            return len;
                        }
                    }
                    else
                    {
                        // Regular directive (like @using, @page, @attribute, @inherits, etc.)
                        // or inline Razor expression - skip to end of line
                        int lineEnd = text.IndexOf('\n', idx);
                        if (lineEnd >= 0)
                            idx = lineEnd + 1;
                        else
                            idx = len;
                    }
                }
                else
                {
                    // This is not a directive or comment, so we've found the end of the directive block
                    // Backtrack to the beginning of this line
                    while (idx > 0 && text[idx - 1] != '\n')
                        idx--;
                    return idx;
                }
            }
            return len;
        }
        private string InjectMarkersAroundComponents(string content, string relativeFilePath)
        {
            // Parse the components to skip from the property
            string[] skipComponents = ComponentsToSkip?.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
                                ?? new string[0];

            // If configured to skip all nested components
            if (ComponentsToSkip == "*")
                return content;

            // First, handle self-closing components
            var selfClosingPattern = @"<([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)(\s[^/>]*)?/>";

            content = Regex.Replace(content, selfClosingPattern, match =>
            {
                string componentName = match.Groups[1].Value;

                if (skipComponents.Contains(componentName) || ShouldSkipComponent(componentName))
                    return match.Value;

                var componentId = GenerateComponentId($"{relativeFilePath}#{componentName}#{match.Index}");

                var openMarker = $@"<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{componentName}"" data-blazordevtools-file=""{relativeFilePath}"" data-blazordevtools-nested=""true"" style=""display:none!important""></span>";
                var closeMarker = $@"<span data-blazordevtools-marker=""close"" data-blazordevtools-id=""{componentId}"" style=""display:none!important""></span>";

                // For self-closing, wrap the entire tag
                return openMarker + match.Value + closeMarker;
            });

            // Then handle paired tags - we need to find the closing tag
            var openingTagPattern = @"<([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)(\s[^/>]*)?>(?!/)";
            var matches = Regex.Matches(content, openingTagPattern);

            // Process in reverse to maintain positions
            for (int i = matches.Count - 1; i >= 0; i--)
            {
                var match = matches[i];
                var componentName = match.Groups[1].Value;

                if (skipComponents.Contains(componentName) || ShouldSkipComponent(componentName))
                    continue;

                // Find the matching closing tag
                var closingTag = $"</{componentName}>";
                var closingIndex = FindMatchingClosingTag(content, match.Index + match.Length, componentName);

                if (closingIndex == -1)
                    continue; // No closing tag found, skip

                var componentId = GenerateComponentId($"{relativeFilePath}#{componentName}#{match.Index}");

                var openMarker = $@"<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{componentName}"" data-blazordevtools-nested=""true"" style=""display:none!important""></span>";
                var closeMarker = $@"<span data-blazordevtools-marker=""close"" data-blazordevtools-id=""{componentId}"" style=""display:none!important""></span>";

                // Insert closing marker AFTER the closing tag
                var closingTagEnd = closingIndex + closingTag.Length;
                content = content.Substring(0, closingTagEnd) + closeMarker + content.Substring(closingTagEnd);

                // Insert opening marker BEFORE the opening tag
                content = content.Substring(0, match.Index) + openMarker + content.Substring(match.Index);
            }

            return content;
        }
        private int FindMatchingClosingTag(string content, int startIndex, string componentName)
        {
            var openingTag = $"<{componentName}";
            var closingTag = $"</{componentName}>";

            int depth = 1;
            int currentIndex = startIndex;

            while (currentIndex < content.Length && depth > 0)
            {
                var nextOpening = content.IndexOf(openingTag, currentIndex);
                var nextClosing = content.IndexOf(closingTag, currentIndex);

                if (nextClosing == -1)
                    return -1; // No closing tag found

                if (nextOpening != -1 && nextOpening < nextClosing)
                {
                    // Check it's not a self-closing tag
                    var selfCloseCheck = content.IndexOf("/>", nextOpening);
                    if (selfCloseCheck == -1 || selfCloseCheck > nextClosing)
                    {
                        // It's a real opening tag
                        depth++;
                    }
                    currentIndex = nextOpening + openingTag.Length;
                }
                else
                {
                    depth--;
                    if (depth == 0)
                    {
                        return nextClosing;
                    }
                    currentIndex = nextClosing + closingTag.Length;
                }
            }

            return -1;
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