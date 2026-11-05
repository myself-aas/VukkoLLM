/**
 * React Native entry point.
 *
 * Registers the root component only. All startup logic (bridge initialize,
 * migrations, biometric lock) lives in src/app/App.tsx so it can be tested.
 */
import { AppRegistry } from 'react-native';
import App from './src/app/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
