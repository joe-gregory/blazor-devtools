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
    /// dev-only marker snippets at both the beginning and end of the component,
    /// preserving directory structure.
    /// The build then points Razor to compile these copies instead of the originals.
    /// 
    /// Why: .NET 8/9 use a Razor Source Generator (in-memory). Editing *.razor.g.cs on disk
    /// is too late. Shadow-copying happens *before* Razor runs, so it works on .NET 6–9.
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

                        // Build opening and closing markers
                        string openingSnippet = BuildOpeningMarker(filesRelativePath: relativePathOfOriginalFile.Replace('\\', '/'), componentId: componentId);
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
                        // pass-through for files we shouldn't modify
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
                $"BlazorDevTools: transformed {injectedCount} Razor file(s) with markers into '{IntermediateRoot}'. " +
                $"(Pass-through files: {copiedCount})");

            return true;
        }

        private static bool ShouldInjectMarker(string fileName, string content)
        {
            // Skip files that start with underscore (_Imports.razor, _Layout.razor, etc.)
            if (fileName.StartsWith("_", StringComparison.Ordinal))
                return false;

            // Skip App.razor (contains HTML document structure)
            if (fileName.Equals("App.razor", StringComparison.OrdinalIgnoreCase))
                return false;

            // Skip Routes.razor (router configuration)  
            if (fileName.Equals("Routes.razor", StringComparison.OrdinalIgnoreCase))
                return false;

            // Skip files that contain <!DOCTYPE html> (document root files)
            if (content.IndexOf("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) >= 0)
                return false;

            // Skip files that contain <Router> component (router configuration files)
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
            // Fall back to file name if not under project (unlikely)
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
            // Cheap idempotency check
            if (text.Contains("data-blazordevtools-marker"))
                return true;

            // Or check for the comment header
            if (text.Contains("@* Injected by BlazorDeveloperTools"))
                return true;

            return false;
        }
        /// <summary>
        /// Generates a stable, unique ID based on the file path. 
        /// How does it generate the unique ID? It hashes the file path. 
        /// How is the ComponentId unique? Because file paths are unique within a project.
        /// How is the ComponentId stable? Because the hash is based on the file path, which doesn't change unless the file is moved or renamed.
        /// </summary>
        /// <param name="relativeFilePath"></param>
        /// <returns></returns>
        private static string GenerateComponentId(string relativeFilePath)
        {
            int hash = relativeFilePath.GetHashCode();
            return $"bdt{Math.Abs(hash):x8}";
        }

        private static string BuildOpeningMarker(string filesRelativePath, string componentId)
        {
            string fileAttr = string.IsNullOrEmpty(filesRelativePath) ? "" : $@" data-blazordevtools-file=""{filesRelativePath}""";

            // Opening marker for the browser extension to detect
            return $@"@* Injected by BlazorDeveloperTools (Dev-only) - Open *@
                <span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""@GetType().Name""{fileAttr} style=""display:none!important""></span>";
        }

        private static string BuildClosingMarker(string componentId)
        {
            // Closing marker that matches the opening marker's ID
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

                // Get the line (including newline if present)
                string line = text.Substring(lineStart, lineEnd - lineStart);
                string trimmed = line.TrimStart();

                // Move to next line position
                idx = (lineEnd < len) ? lineEnd + 1 : len;

                // Skip empty lines at the beginning
                if (trimmed.Length == 0)
                    continue;

                // Skip directive lines (starts with @)
                if (trimmed.StartsWith("@", StringComparison.Ordinal))
                    continue;

                // Skip comments
                if (trimmed.StartsWith("@*", StringComparison.Ordinal))
                    continue;

                // Found first non-directive line, insert before it
                return lineStart;
            }
            // If we got here, file is all directives or empty
            return len;
        }
        private string InjectMarkersAroundComponents(string content, string relativeFilePath)
        {
            // Parse the components to skip from the property
            var skipComponents = ComponentsToSkip?.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
                                ?? new string[0];

            // If configured to skip all nested components
            if (ComponentsToSkip == "*")
                return content;

            // First, handle self-closing components
            var selfClosingPattern = @"<([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)(\s[^/>]*)?/>";

            content = Regex.Replace(content, selfClosingPattern, match =>
            {
                var componentName = match.Groups[1].Value;

                if (skipComponents.Contains(componentName) || ShouldSkipComponent(componentName))
                    return match.Value;

                var componentId = GenerateComponentId($"{relativeFilePath}#{componentName}#{match.Index}");

                var openMarker = $@"<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{componentName}"" data-blazordevtools-nested=""true"" style=""display:none!important""></span>";
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