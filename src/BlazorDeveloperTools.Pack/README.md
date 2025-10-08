# BlazorDeveloperTools

[![NuGet Version](https://img.shields.io/nuget/v/BlazorDeveloperTools)](https://www.nuget.org/packages/BlazorDeveloperTools)
[![NuGet Downloads](https://img.shields.io/nuget/dt/BlazorDeveloperTools)](https://www.nuget.org/packages/BlazorDeveloperTools)
[![License](https://img.shields.io/github/license/joe-gregory/blazor-devtools)](https://gist.github.com/joe-gregory/2bed359816d695508fdfaa08d19483f4)

Visualize razor markup in your browser for your Blazor apps!
This NuGet package adds special markers to your Blazor components that allow the Blazor DevTools browser extensions to represent show your component tree when you are inspecting code. 
No more guess work trying to figure out which html corresponds to what razor markup.

## 🚀 Features

- **Component Visualization**: See your Blazor component hierarchy directly in Chrome DevTools
- **Component Inspector**: Click any element to see which Blazor component renders it
- **Tree Navigation**: Navigate through your component structure with an intuitive tree view
- **Real-time Updates**: Component tree updates automatically as your application state changes
- **Zero Configuration**: Works immediately after installation with no setup required

## 📦 Installation
You need 2 installs: 1) this NuGet package to output applications with BlazorDevTools data and/or 2) a browser extension to visualize razor markup for apps that have this NuGetpackage. 
### Package Manager Console
```powershell
Install-Package BlazorDeveloperTools
```

### .NET CLI
```bash
dotnet add package BlazorDeveloperTools
```

### PackageReference
```xml
<PackageReference Include="BlazorDeveloperTools" Version="0.9.7" />
```

## 🔧 Setup

### 2. Install the Browser Extension

Install the Blazor Developer Tools browser extension. 

[Chrome Blazor Developer Tools extension](https://chrome.google.com/webstore) from the Chrome Store.
[Edge Blazor Developer Tools extension](https://microsoftedge.microsoft.com/addons/detail/blazor-developer-tools/pdggeigaaicabckehkeldfpfikihgcdj) from the Edge Store.

### 3. Start Debugging

1. Run your Blazor application
2. Open Chrome DevTools (F12)
3. Navigate to the "Blazor" tab
4. See your components visualized!

## 🎯 Usage

Once installed, BlazorDeveloperTools automatically adds non-invasive markers to your components during development. These markers are:

- **Invisible to users** - No visual changes to your application
- **Development-only** - Automatically removed in Release builds
- **Performance-friendly** - Minimal overhead during development
- **Compatible** - Works with all Blazor hosting models

### Component Detection

The package automatically detects and marks:
- Blazor components
- Component boundaries
- Component names and file locations
- Parent-child relationships

### Browser Integration

With the browser extension installed, you can:
- View the component tree in real-time
- Click elements to find their parent component
- See component file locations
- Refresh the component tree on demand

## ⚙️ Configuration

### Disable in Production (Automatic)

The tools are automatically disabled in Release builds. No action required.

### Manual Control

You can manually control when the tools are active. 

In Development, BlazorDevTools markers are added automatically. 
If you want to turn BDT OFF in development (default is ON):
```
<PropertyGroup>
  <EnableAutomaticMarkers>false</EnableAutomaticMarkers>
</PropertyGroup>
```

Enable BlazorDevTools in Production (default is OFF):
```
<PropertyGroup>
  <EnableBlazorDevToolsInProduction>true</EnableBlazorDevToolsInProduction>
</PropertyGroup>
```

Some components can be problematic if they throw exceptions when they have unexpected children (example MudTimelineItem and ItemContent from MudBlazor). 

Skip specific components: 

```
<PropertyGroup>
  <BdtSkipComponents>MudTimelineItem;ItemContent</BdtSkipComponents>
</PropertyGroup>
```

## 🎨 What Gets Added to Your HTML?

In development mode, components are wrapped with invisible marker elements:

```html
<!-- Before -->
<div>Your Component Content</div>

<!-- After (Development only) -->
<span data-blazordevtools-marker=""open"" data-blazordevtools-id=""{componentId}"" data-blazordevtools-component=""{componentName}""{fileAttr} style=""display:none!important""></span>"
<div>Your Component Content</div>
<span data-blazordevtools-marker=""close"" data-blazordevtools-id=""{componentId}"" style=""display:none!important""></span>
```

These markers are:
- Completely invisible (display: none)
- Removed in production builds by default
- Used by the browser extension to rebuild the razor component tree

## 🔍 Troubleshooting

### Components not showing in DevTools?

1. **Check the browser extension is installed**: Look for the Blazor tab in DevTools
2. **Verify package installation**: Ensure `AddBlazorDeveloperTools()` is called in your startup
3. **Cleand and rebuild your Blazor project 
4. **Development mode**: Confirm you're running in Debug configuration
5. **Refresh DevTools**: Click the refresh button in the Blazor panel

### Performance considerations?

The markers have negligible performance impact and are only added in development (by default). In Release builds, your application runs exactly as it would without this package (unless you add option to include).

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/joe-gregory/blazor-devtools/blob/master/CONTRIBUTING.md) for details.

## 🔗 Links

- [Edge Browser Extension](https://microsoftedge.microsoft.com/addons/detail/blazor-developer-tools/pdggeigaaicabckehkeldfpfikihgcdj)
- [Chrome Browser Extension](https://chrome.google.com/webstore)
- [GitHub Repository](https://github.com/joe-gregory/blazor-devtools)
- [Documentation](https://blazordevelopertools.com)
- [Report Issues](https://github.com/joe-gregory/blazor-devtools/issues)

## ⭐ Support

If you find this tool helpful, please consider:
- Giving us a star on [GitHub](https://github.com/joe-gregory/blazor-devtools/issues)
- Rating the browser extensions: [Edge](https://microsoftedge.microsoft.com/addons/detail/blazor-developer-tools/pdggeigaaicabckehkeldfpfikihgcdj), [Chrome](https://chrome.google.com/webstore)
- Sharing with other Blazor developers

---

**Made with ❤️ for the Blazor community**