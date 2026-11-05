const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration for Vukko.
 * https://reactnative.dev/docs/metro
 *
 * The Rust bridge ships native code only, so nothing extra is bundled here.
 * `inlineRequires` keeps cold start fast on low-end devices.
 */
const config = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
