// App entry: Expo Router, plus the Android widget's headless task (it runs even when the app is
// closed, so it has to be registered here rather than inside a screen).
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/android';

registerWidgetTaskHandler(widgetTaskHandler);
