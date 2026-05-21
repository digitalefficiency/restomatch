import { Link } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { trpc } from '../../src/trpc';

export default function ReceiverHome() {
  const expectations = trpc.receiving.todayExpectations.useQuery();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ציפיות היום</Text>
      <Text style={styles.subtitle}>
        {expectations.data ? `${expectations.data.length} משלוחים צפויים` : 'טוען...'}
      </Text>

      {expectations.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : expectations.isError ? (
        <Text style={styles.error}>שגיאה: {expectations.error.message}</Text>
      ) : (
        <FlatList
          data={expectations.data}
          keyExtractor={(item) => item.poId}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/receiver/[poId]', params: { poId: item.poId } }} asChild>
              <Pressable style={styles.card}>
                <View style={styles.cardRow}>
                  <Text style={styles.supplier}>{item.supplierName}</Text>
                  <Text style={styles.time}>
                    {new Date(item.expectedAt).toLocaleTimeString('he-IL', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.meta}>{item.lineCount} פריטים</Text>
                  <StatusBadge
                    receiptStatus={item.receiptStatus}
                    poStatus={item.status}
                  />
                </View>
              </Pressable>
            </Link>
          )}
          ListEmptyComponent={() => (
            <Text style={styles.empty}>אין הזמנות שצפויות להגיע היום.</Text>
          )}
          contentContainerStyle={{ paddingTop: spacing.md }}
        />
      )}
    </View>
  );
}

function StatusBadge({
  receiptStatus,
  poStatus,
}: {
  receiptStatus: string | null;
  poStatus: string;
}) {
  if (receiptStatus === 'completed') {
    return <Text style={[styles.badge, styles.badgeOk]}>✓ הושלם</Text>;
  }
  if (receiptStatus === 'partial') {
    return <Text style={[styles.badge, styles.badgeWarn]}>חלקי</Text>;
  }
  if (receiptStatus === 'pending') {
    return <Text style={[styles.badge, styles.badgeWarn]}>בתהליך</Text>;
  }
  return <Text style={styles.badge}>{poStatus}</Text>;
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
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: spacing.xs,
  },
  supplier: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  time: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.base,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.sm,
  },
  badge: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  badgeOk: {
    color: colors.accent,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  badgeWarn: {
    color: colors.warning,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  empty: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    fontSize: typography.fontSize.base,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
