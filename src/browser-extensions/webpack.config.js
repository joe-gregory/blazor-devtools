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
            ],
        }),
    ],
    
    devtool: 'source-map',
    
    optimization: {
        minimize: false, // Keep readable for debugging
    },
};