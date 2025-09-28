const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    background: './chromium/src/background.ts',
    content: './chromium/src/content.ts',
    devtools: './chromium/src/devtools/devtools.ts',
    panel: './chromium/src/devtools/panel/panel.ts'
  },
  output: {
    path: path.resolve(__dirname, 'chromium/dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.json')
          }
        },
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@shared': path.resolve(__dirname, 'shared')
    }
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'chromium/manifest.json', to: 'manifest.json' },
        { from: 'chromium/devtools.html', to: 'devtools.html' },
        { from: 'chromium/src/devtools/panel/panel.html', to: 'panel.html' },
        { from: 'chromium/assets', to: 'assets', noErrorOnMissing: true }
      ]
    })
  ]
};