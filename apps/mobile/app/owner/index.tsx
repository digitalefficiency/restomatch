import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { trpc } from '../../src/trpc';

export default function OwnerHome() {
  const kpis = trpc.owner.kpis.useQuery();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.title}>לוח הבעלים</Text>
      <Text style={styles.subtitle}>סטטוס המסעדה שלך ברגע זה</Text>

      {kpis.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : kpis.isError ? (
        <Text style={styles.error}>שגיאה: {kpis.error.message}</Text>
      ) : kpis.data ? (
        <View style={styles.grid}>
          <KpiCard
            label="הפסד פוטנציאלי החודש"
            value={formatIls(kpis.data.monthPotentialLossIls)}
            tone="warn"
          />
          <KpiCard
            label="חיסכון שנשמר"
            value={formatIls(kpis.data.monthSavingsCapturedIls)}
            tone="accent"
          />
          <KpiCard
            label="ממתינות לאישור"
            value={kpis.data.pendingApprovalsCount.toString()}
            tone="default"
          />
          <KpiCard
            label="התאמות נקיות השבוע"
            value={`${kpis.data.weekCleanMatchPct.toFixed(0)}%`}
            tone={kpis.data.weekCleanMatchPct >= 80 ? 'accent' : 'warn'}
          />
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <Link href="/owner/leaks" asChild>
          <Pressable style={styles.actionCard}>
            <Text style={styles.actionEmoji}>🔍</Text>
            <Text style={styles.actionLabel}>בלש הדליפות</Text>
          </Pressable>
        </Link>
        <Link href="/owner/suppliers" asChild>
          <Pressable style={styles.actionCard}>
            <Text style={styles.actionEmoji}>🏷️</Text>
            <Text style={styles.actionLabel}>דירוג ספקים</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'accent' | 'warn';
}) {
  const accent =
    tone === 'accent' ? colors.accent : tone === 'warn' ? colors.warning : colors.textPrimary;
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={[styles.cardValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

function formatIls(v: number): string {
  return `₪${Math.round(v).toLocaleString('he-IL')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
    marginBottom: spacing.lg,
    textAlign: 'right',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  card: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.xs,
    textAlign: 'right',
    marginBottom: spacing.xs,
  },
  cardValue: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    textAlign: 'right',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  actionEmoji: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  actionLabel: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.xl },
});
