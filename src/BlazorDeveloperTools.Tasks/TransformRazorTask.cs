using Microsoft.Build.Framework;
using Microsoft.Build.Utilities;
using System;
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
                        // Generate a unique ID for this component
                        string componentId = GenerateComponentId(rel);

                        // Get component name from file
                        string componentName = System.IO.Path.GetFileNameWithoutExtension(fileName);

                        // Build opening and closing markers
                        string openingSnippet = BuildOpeningMarker(
                            componentName: componentName,
                            filesRelativePath: rel.Replace('\\', '/'),
                            componentId: componentId);
                        string closingSnippet = BuildClosingMarker(componentId: componentId);

                        // Find where to insert the opening marker (after directives)
                        int insertIndex = FindDirectiveBlockEndIndex(originalContentOfFile);

                        // Insert opening marker at the beginning and closing marker at the end
                        if (insertIndex >= originalContentOfFile.Length)
                        {
                            toWrite = originalContentOfFile + Environment.NewLine + openingSnippet + Environment.NewLine + closingSnippet;
                        }
                        else
                        {
                            toWrite = originalContentOfFile.Substring(0, insertIndex)
                                    + openingSnippet + Environment.NewLine
                                    + originalContentOfFile.Substring(insertIndex)
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