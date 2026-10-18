import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { trpc } from '../../src/trpc';

export default function LeaksScreen() {
  const leaks = trpc.owner.leaks.useQuery({ limit: 30 });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>בלש הדליפות</Text>
      <Text style={styles.subtitle}>מוצרים שבהם המחיר חרג מהמקובל</Text>

      {leaks.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : leaks.isError ? (
        <Text style={styles.error}>שגיאה: {leaks.error.message}</Text>
      ) : (
        <FlatList
          data={leaks.data}
          keyExtractor={(item) => `${item.productId}-${item.supplierId}`}
          contentContainerStyle={{ paddingTop: spacing.md }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowHeader}>
                <Text style={styles.product}>{item.productName}</Text>
                <Text style={styles.delta}>
                  +{(item.deltaPct * 100).toFixed(1)}%
                </Text>
              </View>
              <Text style={styles.supplier}>{item.supplierName}</Text>
              <View style={styles.rowFooter}>
                <Text style={styles.meta}>
                  ממוצע ₪{item.baselineP50.toFixed(2)} → ₪{item.lastObservedPrice.toFixed(2)}
                </Text>
                <Text style={styles.meta}>
                  הפסד חודשי צפוי ₪{Math.round(item.monthExcessIls).toLocaleString('he-IL')}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={() => (
            <Text style={styles.empty}>
              לא נמצאו דליפות. צריך לפחות 3 דגימות מחיר לכל ספק לפני שה-baseline פעיל.
            </Text>
          )}
        />
      )}
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
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.sm,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  product: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  delta: {
    color: colors.danger,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  supplier: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.sm,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  rowFooter: {
    marginTop: spacing.sm,
    gap: 2,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.xs,
    textAlign: 'right',
  },
  empty: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    fontSize: typography.fontSize.base,
  },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.xl },
});
