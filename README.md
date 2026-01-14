![](https://i.imgur.com/H4eojC5.png)
 
## [Docs & Live Demo](https://blazordevelopertools.com/)

# Blazor Developer Tools

The first visual DevTools for Blazor. See your component tree, profile renders, understand why components re-render. No more console.log debugging.
<img width="1649" height="852" alt="BDT beta 1 screenshot - 1" src="https://github.com/user-attachments/assets/b4723732-091a-48a8-aee4-dd775d4066a7" />

[![NuGet](https://img.shields.io/nuget/v/BlazorDeveloperTools.svg)](https://www.nuget.org/packages/BlazorDeveloperTools/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## What's New in v1.0.0-beta.1

This release is a complete architectural rewrite with powerful new features:

- 🧩 **Component Tree** - Visualize your entire Blazor component hierarchy
- ⏱️ **Timeline Profiler** - Record and analyze component renders with a visual flamegraph
- 💡 **"Why Did This Render?"** - Click any render event to see exactly what triggered it
- 📊 **Ranked View** - See which components render most often and take the longest
- 🔧 **Works With Any Component** - No code changes required for basic tracking
- ⚡ **Enhanced Metrics** - Opt-in to `BlazorDevToolsComponentBase` for deep lifecycle timing

## Features

- 🔍 **Component Tree Visualization** - See your Blazor component hierarchy in Chrome/Edge DevTools
- 🎯 **Element Picker** - Click any element on the page to identify its Blazor component
- 📁 **File Path Display** - See which .razor file each component comes from
- ⏱️ **Timeline Profiler** - Record, analyze, and visualize component render performance
- 🔥 **Flamegraph View** - Visual swimlane timeline of all component events
- 📈 **Performance Rankings** - Identify your slowest components at a glance
- 🎨 **CSS Isolation Support** - Full support for Blazor CSS isolation

## Installation

### 1. Install the NuGet Package

```bash
dotnet add package BlazorDeveloperTools
```

### 2. Install the Browser Extension

- **Chrome**: [Chrome Web Store](https://chromewebstore.google.com/detail/blazor-developer-tools/pfddbenemjnlceffaemllejnjbobadhp)
- **Edge**: [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/blazor-developer-tools/pdggeigaaicabckehkeldfpfikihgcdj)

### 3. That's it!

Open your Blazor app, press F12, and look for the **"Blazor"** tab in DevTools.

## Installation by Render Mode

| Render Mode | Installation |
|-------------|--------------|
| **WebAssembly Standalone** | Install in your main project |
| **Server** | Install in your main project |
| **Auto (WebAssembly Global)** | Install in your `.Client` project |
| **Auto (Server + Client)** | Install in **both** projects |

## Usage

### Basic Tracking (Zero Config)

Once installed, BDT automatically tracks all components. No code changes needed!

1. Run your Blazor app
2. Open Chrome/Edge DevTools (F12)
3. Navigate to the **"Blazor"** tab
4. Explore the **Components** tree or record a **Timeline** profile

### Enhanced Tracking (Opt-in)

For detailed lifecycle metrics, inherit from `BlazorDevToolsComponentBase`:

```razor
@inherits BlazorDevToolsComponentBase

<h1>My Component</h1>

@code {
    // Your component code - all lifecycle methods are automatically timed
}
```

This gives you:
- ✅ Lifecycle method timing (OnInitialized, OnParametersSet, etc.)
- ✅ ShouldRender tracking
- ✅ StateHasChanged counts
- ✅ Parameter change detection
- ✅ Render efficiency metrics

### Timeline Profiler

1. Go to the **Timeline** tab
2. Click **Record**
3. Interact with your app
4. Click **Stop**
5. Explore the results:
   - **Events** - Chronological list of all lifecycle events
   - **Ranked** - Components sorted by total render time
   - **Flamegraph** - Visual timeline with zoom and pan

## How It Works

BDT uses a **Three Pillars** architecture:

| Pillar | Method | What It Tracks |
|--------|--------|----------------|
| **1. Enhanced Components** | Opt-in inheritance | Deep lifecycle metrics, timing, ShouldRender |
| **2. Activator Tracking** | Automatic | All component instantiation |
| **3. Render Batch Interception** | Automatic (JS) | Component IDs, hierarchy, render events |

## Configuration Options

```xml
<PropertyGroup>
  <!-- Enable in production builds (default: Debug only) -->
  <EnableBlazorDevToolsInProduction>true</EnableBlazorDevToolsInProduction>
  
  <!-- Disable automatic markers -->
  <EnableAutomaticMarkers>false</EnableAutomaticMarkers>
  
  <!-- Skip specific components that have issues with markers -->
  <BdtSkipComponents>ItemContent;MudTimelineItem</BdtSkipComponents>
  
  <!-- Enable verbose build output -->
  <BdtVerbose>true</BdtVerbose>
</PropertyGroup>
```

## Try It Now!

Visit [blazordevelopertools.com](https://blazordevelopertools.com/) and open DevTools to see BDT in action on a live Blazor app.

## Contributing

This project is open source! We welcome contributions.

- 🐛 [Report Issues](https://github.com/joe-gregory/blazor-devtools/issues)
- 💻 [GitHub Repository](https://github.com/joe-gregory/blazor-devtools/)
- 💬 [Discussions](https://github.com/joe-gregory/blazor-devtools/discussions)

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Support

- 📧 Email: [blazordevelopertools@gmail.com](mailto:blazordevelopertools@gmail.com)
- 🐦 Twitter: [@_joe_gregory](https://x.com/_joe_gregory)
- 📺 YouTube: [Blazor Developer Tools](https://www.youtube.com/@BlazorDeveloperTools)

---

Built with ❤️ for the Blazor community by Joseph E. Gregory
