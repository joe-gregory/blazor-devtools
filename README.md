![](https://i.imgur.com/H4eojC5.png)
[Docs](https://blazordevelopertools.com/)
# Blazor Developer Tools

Ever wished you could right-click on a Blazor app and see the actual Razor markup instead of just HTML? Or click on any element and instantly know which .razor component it belongs to?

That's exactly what Blazor Developer Tools does. It adds a "Blazor" tab to Chrome/Edge DevTools that shows your component tree - just like React DevTools, but for Blazor.

![Blazor DevTools in action](https://i.imgur.com/4bB9GFT.png)

[![NuGet](https://img.shields.io/nuget/v/BlazorDeveloperTools.svg)](https://www.nuget.org/packages/BlazorDeveloperTools/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## Features

- 🔍 **Component Tree Visualization** - See your Blazor component hierarchy in Chrome/Edge DevTools
- 🎯 **Element Picker** - Click any element on the page to identify its Blazor component
- 📁 **File Path Display** - See which .razor file each component comes from
- 🎨 **CSS Isolation Support** - Full support for Blazor CSS isolation
- ⚡ **Debug & Production Modes** - Works in both Debug builds and (optionally) Release builds

## Installation

You need to install 2 components: this NuGet package and a chrome/edge extension. 

### 1. Install the NuGet Package

```bash
dotnet add package BlazorDeveloperTools
```

Or add to your `.csproj`:

```xml
<PackageReference Include="BlazorDeveloperTools" Version="0.9.0" />
```

### 2. Install the Browser Extension

- **Chrome**: [Chrome Web Store]([#](https://chromewebstore.google.com/detail/blazor-developer-tools/pfddbenemjnlceffaemllejnjbobadhp)) 
- **Edge**: [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/blazor-developer-tools/pdggeigaaicabckehkeldfpfikihgcdj) 

## Usage

### Basic Setup (Debug Mode)

Once installed, the package automatically adds component markers to your Blazor app in Debug mode. No additional configuration needed!

1. Run your Blazor app in Debug mode
2. Open Chrome/Edge DevTools (F12)
3. Navigate to the "Blazor" tab
4. See your component tree!

### Production Mode (Optional)

To enable component markers in Release/Production builds:

```xml
<PropertyGroup>
  <EnableBlazorDevToolsInProduction>true</EnableBlazorDevToolsInProduction>
</PropertyGroup>
```

⚠️ **Note**: This adds small hidden markers to your HTML. Impact is minimal but consider the trade-offs for production use.

## How It Works

1. **Build-time transformation**: The NuGet package injects hidden marker elements into your Razor components during compilation
2. **Runtime detection**: The browser extension detects these markers and builds a component tree
3. **DevTools integration**: Displays the component hierarchy in a dedicated DevTools panel

## Configuration Options

Control the tool's behavior via MSBuild properties:

```xml
<PropertyGroup>
  <!-- Disable automatic markers -->
  <EnableAutomaticMarkers>false</EnableAutomaticMarkers>
  
  <!-- Enable verbose build output -->
  <BdtVerbose>true</BdtVerbose>
  
  <!-- Enable in production builds -->
  <EnableBlazorDevToolsInProduction>true</EnableBlazorDevToolsInProduction>
</PropertyGroup>
```

## Contributing

This project is open source! We welcome contributions.

[GitHub Repository](https://github.com/joe-gregory/blazor-devtools/)

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Support

- 🐛 [Report issues](https://github.com/joe-gregory/blazor-devtools/issues)
- 💬 [Discussions](#)
- 📧 Contact: [blazordevelopertools@gmail.com]

---

Built with ❤️ for the Blazor community by Joseph E. Gregory
