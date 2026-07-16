const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

// Single source of truth for the extension version: package.json.
// Semver "1.0.0-beta.2" becomes store-compatible manifest version "1.0.0.2"
// (Chrome/Firefox manifests only allow dotted numbers).
const packageVersion = require('./package.json').version;
const versionMatch = packageVersion.match(/^(\d+\.\d+\.\d+)(?:-[a-zA-Z]+\.(\d+))?$/);
if (!versionMatch) {
    throw new Error(`Unsupported version format in package.json: ${packageVersion}`);
}
const manifestVersion = versionMatch[2] ? `${versionMatch[1]}.${versionMatch[2]}` : versionMatch[1];

// Stamps package.json's version onto a copied manifest.json.
const stampManifestVersion = (content) => {
    const manifest = JSON.parse(content.toString());
    manifest.version = manifestVersion;
    if ('version_name' in manifest) {
        manifest.version_name = packageVersion; // human-readable semver (Chromium only)
    }
    return JSON.stringify(manifest, null, 2);
};

module.exports = {
    entry: {
        // Standalone bundle (for testing without extension)
        'blazor-devtools': './src/standalone/blazor-devtools.ts',
        
        // Extension scripts
        'chromium/background': './src/chromium/background.ts',
        'chromium/content': './src/chromium/content.ts',
        'chromium/bridge': './src/chromium/bridge.ts',
        'chromium/devtools': './src/chromium/devtools.ts',
        'chromium/panel/panel': './src/chromium/panel/panel.ts',
        'firefox/background': './src/firefox/background.ts',
        'firefox/content': './src/firefox/content.ts',
        'firefox/bridge': './src/firefox/bridge.ts',
        'firefox/devtools': './src/firefox/devtools.ts',
        'firefox/panel/panel': './src/firefox/panel/panel.ts',
    },
    
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        clean: true,
    },
    
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: [MiniCssExtractPlugin.loader, 'css-loader'],
            },
        ],
    },
    
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        alias: {
            '@core': path.resolve(__dirname, 'src/core/'),
            '@chromium': path.resolve(__dirname, 'src/chromium/'),
            '@firefox': path.resolve(__dirname, 'src/firefox/'),
        },
    },
    
    plugins: [
        new MiniCssExtractPlugin({
            filename: '[name].css',
        }),
        new CopyWebpackPlugin({
            patterns: [
                // Extension manifests
                { from: 'src/chromium/manifest.json', to: 'chromium/', transform: stampManifestVersion },
                { from: 'src/chromium/devtools.html', to: 'chromium/' },
                { from: 'src/chromium/assets', to: 'chromium/assets', noErrorOnMissing: true },
                { from: 'src/firefox/manifest.json', to: 'firefox/', transform: stampManifestVersion },
                { from: 'src/firefox/devtools.html', to: 'firefox/' },
                { from: 'src/firefox/assets', to: 'firefox/assets', noErrorOnMissing: true },
                // Panel HTML/CSS are shared between browsers (single source in src/shared)
                { from: 'src/shared/panel/panel.html', to: 'chromium/panel/' },
                { from: 'src/shared/panel/panel.css', to: 'chromium/panel/' },
                { from: 'src/shared/panel/timeline-panel.css', to: 'chromium/panel/' },
                { from: 'src/shared/panel/panel.html', to: 'firefox/panel/' },
                { from: 'src/shared/panel/panel.css', to: 'firefox/panel/' },
                { from: 'src/shared/panel/timeline-panel.css', to: 'firefox/panel/' },
            ],
        }),
    ],
    
    devtool: 'source-map',
    
    optimization: {
        minimize: false, // Keep readable for debugging
    },
};