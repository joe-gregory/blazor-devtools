# Blazor Developer Tools

Developer tools for debugging Blazor applications, providing component inspection similar to React DevTools.

[![NuGet](https://img.shields.io/nuget/v/BlazorDeveloperTools.svg)](https://www.nuget.org/packages/BlazorDeveloperTools/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## Features

- 🔍 **Component Tree Visualization** - See your Blazor component hierarchy in Chrome/Edge DevTools
- 🎯 **Element Picker** - Click any element on the page to identify its Blazor component
- 📁 **File Path Display** - See which .razor file each component comes from
- 🎨 **CSS Isolation Support** - Full support for Blazor CSS isolation
- ⚡ **Debug & Production Modes** - Works in both Debug builds and (optionally) Release builds

## Installation

### 1. Install the NuGet Package

```bash
dotnet add package BlazorDeveloperTools
```

Or add to your `.csproj`:

```xml
<PackageReference Include="BlazorDeveloperTools" Version="0.9.0" />
```

### 2. Install the Browser Extension

- **Chrome**: [Chrome Web Store](#) *(coming soon)*
- **Edge**: [Edge Add-ons](#) *(coming soon)*

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

## Supported Platforms

- ✅ Blazor Server
- ✅ Blazor WebAssembly
- ✅ .NET 6.0+
- ✅ Chrome/Edge (Chromium-based browsers)

## Known Issues

- Element picker may incorrectly identify parent component for text nodes (fix coming in v1.0)
- Firefox support coming soon

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

[GitHub Repository](#) *(coming soon)*

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Roadmap

- [ ] Firefox extension support
- [ ] Component props inspection
- [ ] Component state visualization
- [ ] Performance profiling
- [ ] Razor syntax highlighting in DevTools
- [ ] Component search functionality

## Support

- 🐛 [Report issues](#)
- 💬 [Discussions](#)
- 📧 Contact: [your-email@example.com]

---

Built with ❤️ for the Blazor community by Joseph E. Gregory