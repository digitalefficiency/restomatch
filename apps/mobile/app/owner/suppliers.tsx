import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { trpc } from '../../src/trpc';

export default function SuppliersScreen() {
  const scorecards = trpc.owner.suppliers.useQuery();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>דירוג ספקים</Text>
      <Text style={styles.subtitle}>מי מדויק, מי מתעסק</Text>

      {scorecards.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : scorecards.isError ? (
        <Text style={styles.error}>שגיאה: {scorecards.error.message}</Text>
      ) : (
        <FlatList
          data={scorecards.data}
          keyExtractor={(s) => s.supplierId}
          contentContainerStyle={{ paddingTop: spacing.md }}
          renderItem={({ item: s }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.supplier}>{s.supplierName}</Text>
                <TrendBadge trend={s.trend} />
              </View>
              <Text style={styles.runs}>{s.matchRunsCount} השוואות בתקופה</Text>
              <View style={styles.metrics}>
                <Metric label="נקיות" value={`${s.cleanMatchPct.toFixed(0)}%`} />
                <Metric
                  label="סטיית מחיר"
                  value={`${(s.avgPriceDeltaPct * 100).toFixed(1)}%`}
                  tone={s.avgPriceDeltaPct > 0.03 ? 'warn' : 'default'}
                />
                <Metric
                  label="כפילויות"
                  value={s.duplicateInvoicesCount.toString()}
                  tone={s.duplicateInvoicesCount > 0 ? 'danger' : 'default'}
                />
              </View>
            </View>
          )}
          ListEmptyComponent={() => (
            <Text style={styles.empty}>אין נתונים על ספקים עדיין.</Text>
          )}
        />
      )}
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const color =
    tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warning : colors.textPrimary;
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function TrendBadge({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  const ch = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const color =
    trend === 'up' ? colors.accent : trend === 'down' ? colors.danger : colors.textSecondary;
  return <Text style={[styles.trend, { color }]}>{ch}</Text>;
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  supplier: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  runs: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.xs,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  metrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  metric: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.xs,
  },
  metricValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginTop: 2,
  },
  trend: {
    fontSize: 24,
    fontWeight: typography.fontWeight.bold,
  },
  empty: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.xl },
});
