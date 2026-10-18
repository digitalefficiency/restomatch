import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { trpc } from '../../src/trpc';

export default function ReceivingScreen() {
  const params = useLocalSearchParams<{ poId: string }>();
  const router = useRouter();
  const poId = params.poId!;

  const utils = trpc.useUtils();
  const po = trpc.receiving.getPo.useQuery({ poId });
  const startReceipt = trpc.receiving.startReceipt.useMutation();
  const markLine = trpc.receiving.markGrLine.useMutation();
  const submit = trpc.receiving.submitReceipt.useMutation({
    onSuccess: () => {
      utils.receiving.todayExpectations.invalidate();
      Alert.alert('נקלט', 'הקבלה נשמרה');
      router.back();
    },
  });

  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});

  async function ensureReceipt(): Promise<string> {
    if (receiptId) return receiptId;
    const r = await startReceipt.mutateAsync({ poId });
    setReceiptId(r.receiptId);
    return r.receiptId;
  }

  if (po.isLoading) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  if (po.isError) return <Centered><Text style={styles.error}>{po.error.message}</Text></Centered>;
  if (!po.data) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.title}>{po.data.supplierName}</Text>
      <Text style={styles.subtitle}>
        {po.data.expectedAt
          ? new Date(po.data.expectedAt).toLocaleString('he-IL')
          : ''}
      </Text>

      {po.data.lines.map((line, idx) => (
        <View key={line.id} style={styles.lineCard}>
          <Text style={styles.lineDesc}>{line.rawDescription}</Text>
          <Text style={styles.lineExpected}>
            הוזמן: {line.qtyOrdered} {line.unit}
          </Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder={String(line.qtyOrdered)}
              placeholderTextColor={colors.textSecondary}
              value={qtyByLine[line.id] ?? ''}
              onChangeText={(t) => setQtyByLine((m) => ({ ...m, [line.id]: t }))}
            />
            <Text style={styles.unit}>{line.unit}</Text>
          </View>
        </View>
      ))}

      <Pressable
        style={styles.submitButton}
        disabled={submit.isPending}
        onPress={async () => {
          const id = await ensureReceipt();
          // Persist each line first
          await Promise.all(
            po.data.lines.map(async (line, idx) => {
              const raw = qtyByLine[line.id];
              const qty = raw === undefined || raw === '' ? Number(line.qtyOrdered) : Number(raw);
              // Find the gr line for this po line. We need its ID — for the
              // mobile MVP we re-load via a future refinement; here we trust
              // startReceipt order and refetch lines from the PO.
              // (A dedicated `gr.byPoLineId` endpoint comes in M6.1.)
              // For now we skip strict markGrLine here and rely on submitReceipt
              // for status derivation. TODO M6.1: line-level updates from mobile.
            }),
          );
          await submit.mutateAsync({ grId: id });
        }}
      >
        <Text style={styles.submitText}>
          {submit.isPending ? 'שומר...' : 'סיים קליטה'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Centered(props: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
      {props.children}
    </View>
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
    marginBottom: spacing.lg,
    textAlign: 'right',
  },
  lineCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lineDesc: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'right',
  },
  lineExpected: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.sm,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 100,
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    textAlign: 'right',
  },
  unit: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.lg,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.lg,
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  error: { color: colors.danger },
});
