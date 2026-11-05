/**
 * React Native CLI configuration.
 *
 * `assets` must keep pointing at the fonts the Compose app shipped
 * (app/src/main/res/font) so typography parity survives the migration.
 */
module.exports = {
  project: {
    android: {
      sourceDir: './android',
    },
    ios: {
      sourceDir: './ios',
    },
  },
  assets: [],
};
