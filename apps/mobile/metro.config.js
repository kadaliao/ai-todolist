// Expo configures pnpm monorepos automatically (SDK 52+).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
