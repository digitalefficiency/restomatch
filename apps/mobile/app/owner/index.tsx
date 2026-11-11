import { Link } from 'expo-router';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { trpc } from '../../src/trpc';

/**
 * G-12b — the mobile app is FROZEN (owner decision 12). It no longer computes or
 * shows ₪: the money lives on the web, where one definition renders it. Counts
 * stay only when they read a canonical server field (approvals.queueSummary).
 */
export function webDashboardUrl(): string {
  const api = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
  const origin = /^https?:\/\/[^/]+/.exec(api)?.[0] ?? 'http://localhost:3000';
  return `${origin}/dashboard`;
}

export default function OwnerHome() {
  const summary = trpc.approvals.queueSummary.useQuery();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.title}>לוח הבעלים</Text>
      <Text style={styles.subtitle}>סטטוס המסעדה שלך ברגע זה</Text>

      <WebCard />

      {summary.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : summary.isError ? (
        <Text style={styles.error}>לא הצלחנו לטעון. נסו שוב.</Text>
      ) : summary.data ? (
        <View style={styles.grid}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ממתינים להחלטה</Text>
            <Text style={styles.cardValue}>{summary.data.count}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.actionsRow}>
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

/** T4 (neutral): the full figures are on the web. */
export function WebCard() {
  return (
    <Pressable
      accessibilityRole="link"
      style={styles.webCard}
      onPress={() => void Linking.openURL(webDashboardUrl())}
    >
      <Text style={styles.webTitle}>הנתונים המלאים באתר</Text>
      <Text style={styles.webAction}>פתחו באפליקציה ←</Text>
    </Pressable>
  );
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
  webCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  webTitle: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'right',
  },
  webAction: {
    color: colors.primary,
    fontSize: typography.fontSize.sm,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
});
