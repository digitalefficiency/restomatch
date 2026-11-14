import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { WebCard } from './index';

/**
 * G-12b — frozen app: the leak and its ₪ are on the web only (one definition).
 * This screen stays for old deep links and points there.
 */
export default function LeaksScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>הדליפה החודשית</Text>
      <WebCard />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingTop: spacing['2xl'],
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    textAlign: 'right',
  },
});
