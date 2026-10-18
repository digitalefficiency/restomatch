import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TrpcProvider } from '../src/trpc';

// React 18/19 @types mismatch across workspace causes Stack to be flagged as
// "not a valid JSX component". The runtime is fine — Expo Router 4 ships
// React-18-compatible Stack, and the workspace hoists @types/react@19 for the
// web app. Remove this assertion when mobile upgrades to React 19 (Expo 53+).
const StackAny = Stack as unknown as React.ComponentType<{ screenOptions?: object }>;

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <TrpcProvider>
          <StackAny screenOptions={{ headerShown: false }} />
        </TrpcProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
