const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

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
        'chromium/panel/timeline-panel': './src/chromium/panel/timeline-panel.ts',
        'firefox/background': './src/firefox/background.ts',
        'firefox/content': './src/firefox/content.ts',
        'firefox/bridge': './src/firefox/bridge.ts',
        'firefox/devtools': './src/firefox/devtools.ts',
        'firefox/panel/panel': './src/firefox/panel/panel.ts',
        'firefox/panel/timeline-panel': './src/firefox/panel/timeline-panel.ts',
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
                // Extension manifest and HTML files
                { from: 'src/chromium/manifest.json', to: 'chromium/' },
                { from: 'src/chromium/devtools.html', to: 'chromium/' },
                { from: 'src/chromium/panel/panel.html', to: 'chromium/panel/' },
                { from: 'src/chromium/panel/panel.css', to: 'chromium/panel/' },  // Added CSS copy
                { from: 'src/chromium/panel/timeline-panel.css', to: 'chromium/panel/' },  // ADD THIS LINE
                { from: 'src/chromium/assets', to: 'chromium/assets', noErrorOnMissing: true },
                { from: 'src/firefox/manifest.json', to: 'firefox/' },
                { from: 'src/firefox/devtools.html', to: 'firefox/' },
                { from: 'src/firefox/panel/panel.html', to: 'firefox/panel/' },
                { from: 'src/firefox/panel/panel.css', to: 'firefox/panel/' },
                { from: 'src/firefox/panel/timeline-panel.css', to: 'firefox/panel/' },
                { from: 'src/firefox/assets', to: 'firefox/assets', noErrorOnMissing: true },
            ],
        }),
    ],
    
    devtool: 'source-map',
    
    optimization: {
        minimize: false, // Keep readable for debugging
    },
};