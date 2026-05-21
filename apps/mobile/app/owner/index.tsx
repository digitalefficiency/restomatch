import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';

export default function OwnerHome() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>לוח הבעלים</Text>
      <Text style={styles.body}>
        KPIs, Price Leak Detective, Supplier Scorecards — TODO
      </Text>
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
    marginBottom: spacing.md,
    textAlign: 'right',
  },
  body: {
    color: colors.textSecondary,
    textAlign: 'right',
  },
});
