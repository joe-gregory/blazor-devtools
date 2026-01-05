// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - RendererDiagnostics.cs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Diagnostic utility to explore Renderer internals and find RenderBatch
//   interception points. This is research code to determine the best approach.
//
// RUN THIS: Add to your test app and check console output on startup.
//
// ═══════════════════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Components.RenderTree;
using System.Reflection;

namespace BlazorDeveloperTools.Diagnostics;

public static class RendererDiagnostics
{
    /// <summary>
    /// Dumps all information about Renderer types to help find interception points.
    /// Call this from Program.cs or a test component.
    /// </summary>
    public static void DumpRendererInfo()
    {
        Console.WriteLine("\n" + new string('═', 80));
        Console.WriteLine("BLAZOR RENDERER DIAGNOSTICS");
        Console.WriteLine(new string('═', 80));

        // 1. Examine Renderer base class
        Type rendererType = typeof(Renderer);
        Console.WriteLine($"\n[Renderer Base Class: {rendererType.FullName}]");
        Console.WriteLine($"  Assembly: {rendererType.Assembly.FullName}");
        Console.WriteLine($"  IsAbstract: {rendererType.IsAbstract}");
        Console.WriteLine($"  IsSealed: {rendererType.IsSealed}");

        // Methods (especially virtual/abstract ones we could override)
        Console.WriteLine("\n  Methods:");
        foreach (MethodInfo method in rendererType.GetMethods(
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            string modifiers = "";
            if (method.IsAbstract) modifiers += "abstract ";
            if (method.IsVirtual && !method.IsAbstract) modifiers += "virtual ";
            if (method.IsPrivate) modifiers += "private ";
            else if (method.IsFamily) modifiers += "protected ";
            else if (method.IsPublic) modifiers += "public ";

            // Check if it involves RenderBatch
            bool involvesBatch = method.GetParameters().Any(p =>
                p.ParameterType.Name.Contains("RenderBatch") ||
                p.ParameterType.Name.Contains("RenderTree"));

            string marker = involvesBatch ? " ← RENDER BATCH!" : "";
            Console.WriteLine($"    {modifiers}{method.ReturnType.Name} {method.Name}(...){marker}");
        }

        // Events (hookable?)
        Console.WriteLine("\n  Events:");
        foreach (EventInfo evt in rendererType.GetEvents(
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
        {
            Console.WriteLine($"    {evt.EventHandlerType?.Name} {evt.Name}");
        }

        // 2. Find all Renderer implementations in loaded assemblies
        Console.WriteLine("\n[Searching for Renderer implementations...]");
        foreach (Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            try
            {
                foreach (Type type in asm.GetTypes())
                {
                    if (type != rendererType && rendererType.IsAssignableFrom(type))
                    {
                        Console.WriteLine($"\n  Found: {type.FullName}");
                        Console.WriteLine($"    Assembly: {asm.GetName().Name}");
                        Console.WriteLine($"    IsSealed: {type.IsSealed}");
                        Console.WriteLine($"    IsInternal: {!type.IsPublic}");

                        // Check for UpdateDisplayAsync override
                        MethodInfo? updateDisplay = type.GetMethod(
                            "UpdateDisplayAsync",
                            BindingFlags.NonPublic | BindingFlags.Instance);
                        if (updateDisplay != null)
                        {
                            Console.WriteLine($"    Has UpdateDisplayAsync: YES");
                        }
                    }
                }
            }
            catch
            {
                // Skip assemblies that can't be reflected
            }
        }

        // 3. Examine RenderBatch struct
        Type batchType = typeof(RenderBatch);
        Console.WriteLine($"\n[RenderBatch Struct: {batchType.FullName}]");
        Console.WriteLine("  Properties:");
        foreach (PropertyInfo prop in batchType.GetProperties())
        {
            Console.WriteLine($"    {prop.PropertyType.Name} {prop.Name}");
        }

        // 4. Examine RenderTreeFrame
        Type frameType = typeof(RenderTreeFrame);
        Console.WriteLine($"\n[RenderTreeFrame Struct: {frameType.FullName}]");
        Console.WriteLine("  Properties:");
        foreach (PropertyInfo prop in frameType.GetProperties())
        {
            Console.WriteLine($"    {prop.PropertyType.Name} {prop.Name}");
        }

        // 5. Check for any diagnostic/event sources
        Console.WriteLine("\n[Looking for diagnostic hooks...]");

        // Check if there's a DiagnosticSource for Blazor
        Type? diagnosticType = Type.GetType(
            "Microsoft.AspNetCore.Components.RenderTree.Renderer+RenderBatchBuilder, Microsoft.AspNetCore.Components");
        if (diagnosticType != null)
        {
            Console.WriteLine($"  Found RenderBatchBuilder: {diagnosticType.FullName}");
        }

        // 6. Check for IComponentRenderMode (new in .NET 8)
        Console.WriteLine("\n[Checking .NET 8+ render mode infrastructure...]");
        Type? renderModeType = Type.GetType(
            "Microsoft.AspNetCore.Components.IComponentRenderMode, Microsoft.AspNetCore.Components");
        if (renderModeType != null)
        {
            Console.WriteLine($"  IComponentRenderMode exists: {renderModeType.FullName}");
        }

        // Check for WebRenderer
        foreach (Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            try
            {
                Type? webRenderer = asm.GetTypes()
                    .FirstOrDefault(t => t.Name.Contains("WebRenderer"));
                if (webRenderer != null)
                {
                    Console.WriteLine($"  Found WebRenderer: {webRenderer.FullName}");
                    Console.WriteLine($"    IsPublic: {webRenderer.IsPublic}");
                }
            }
            catch { }
        }

        Console.WriteLine("\n" + new string('═', 80));
        Console.WriteLine("END DIAGNOSTICS");
        Console.WriteLine(new string('═', 80) + "\n");
    }

    /// <summary>
    /// Attempts to hook into Renderer events if any exist.
    /// Returns true if successful.
    /// </summary>
    public static bool TryHookRendererEvents(Renderer renderer)
    {
        Type rendererType = renderer.GetType();
        Console.WriteLine($"[RendererDiagnostics] Examining renderer: {rendererType.FullName}");

        // Look for any events
        EventInfo[] events = rendererType.GetEvents(
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

        if (events.Length > 0)
        {
            Console.WriteLine($"[RendererDiagnostics] Found {events.Length} events:");
            foreach (EventInfo evt in events)
            {
                Console.WriteLine($"  - {evt.Name}: {evt.EventHandlerType?.Name}");
            }
            return true;
        }

        Console.WriteLine("[RendererDiagnostics] No hookable events found on Renderer");
        return false;
    }

    /// <summary>
    /// Examines what methods are called during a render cycle.
    /// </summary>
    public static void ExamineRenderCycle(Renderer renderer)
    {
        Type rendererType = renderer.GetType();

        // Key methods involved in rendering
        string[] methodsToCheck = new[]
        {
            "ProcessPendingRender",
            "RenderInExistingBatch",
            "UpdateDisplayAsync",
            "AddToRenderQueue",
            "ProcessRenderQueue",
            "RenderRootComponent"
        };

        Console.WriteLine("\n[Render Cycle Methods]");
        foreach (string methodName in methodsToCheck)
        {
            MethodInfo? method = rendererType.GetMethod(
                methodName,
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

            if (method != null)
            {
                Console.WriteLine($"  ✓ {methodName} - {(method.IsVirtual ? "VIRTUAL" : "non-virtual")}");
            }
            else
            {
                // Check base class
                method = typeof(Renderer).GetMethod(
                    methodName,
                    BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                if (method != null)
                {
                    Console.WriteLine($"  ✓ {methodName} (base) - {(method.IsVirtual ? "VIRTUAL" : "non-virtual")}");
                }
                else
                {
                    Console.WriteLine($"  ✗ {methodName} - not found");
                }
            }
        }
    }
}