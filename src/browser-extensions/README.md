# Blazor Developer Tools - Browser Extensions

Browser developer tools for debugging Blazor applications.

## Structure

```
src/
├── core/                 # Framework-agnostic core
│   ├── types.ts          # TypeScript interfaces matching C# DTOs
│   ├── blazor-bridge.ts  # DotNet interop via DotNetObjectReference
│   ├── component-service.ts  # Query methods for components
│   ├── event-emitter.ts  # Real-time event handling
│   └── index.ts          # Public exports
│
├── standalone/           # Standalone bundle for testing
│   └── blazor-devtools.ts
│
└── chromium/             # Chrome/Edge extension
    ├── manifest.json
    ├── devtools.ts
    ├── background.ts
    ├── content.ts
    └── panel/
        ├── panel.html
        ├── panel.css
        └── panel.ts
```

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Build

```bash
# Development build with source maps
npm run build:dev

# Production build
npm run build

# Watch mode for development
npm run watch
```

### Output

After building:

- `dist/blazor-devtools.js` - Standalone bundle for testing
- `dist/chromium/` - Ready-to-load Chrome extension

### Testing Standalone

1. Build: `npm run build:dev`
2. Copy `dist/blazor-devtools.js` to your Blazor app's `wwwroot/`
3. Add to your app: `<script src="blazor-devtools.js"></script>`
4. Open browser console and use `window.blazorDevTools`

### Loading Extension

1. Build: `npm run build`
2. Open Chrome/Edge extensions page (chrome://extensions)
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `dist/chromium/` folder

## API

### From Browser Console

```javascript
// Check connection
blazorDevTools.isReady()

// Get all components
await blazorDevTools.getAllComponents()

// Get component counts
await blazorDevTools.getCounts()

// Find components by name
await blazorDevTools.findByTypeName('Counter')

// Get enhanced components (with timing)
await blazorDevTools.getEnhancedComponents()
```

## Notes

- The `core/` module has no browser extension dependencies
- Extension communicates with page via content script injection
- Standalone bundle is for testing without loading the extension
