import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';
import { trpc } from '../../src/trpc';

export default function ManagerQueue() {
  const utils = trpc.useUtils();
  const queue = trpc.approvals.myQueue.useQuery({ limit: 50 });
  const approve = trpc.approvals.approve.useMutation({
    onSuccess: () => utils.approvals.myQueue.invalidate(),
  });
  const reject = trpc.approvals.reject.useMutation({
    onSuccess: () => {
      utils.approvals.myQueue.invalidate();
      setRejectingId(null);
      setReason('');
    },
  });

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>תור אישורים</Text>
      <Text style={styles.subtitle}>חריגות שמחכות לי</Text>

      {queue.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : queue.isError ? (
        <Text style={styles.error}>שגיאה: {queue.error.message}</Text>
      ) : (
        <FlatList
          data={queue.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: spacing.md }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.severity, severityStyle(item.severity)]}>
                  {severityLabel(item.severity)}
                </Text>
                <Text style={styles.time}>
                  {new Date(item.createdAt).toLocaleTimeString('he-IL', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <Text style={styles.type}>{typeLabel(item.type)}</Text>
              <Text style={styles.amount}>
                ₪{Number(item.deltaAmount ?? 0).toLocaleString('he-IL')}
              </Text>

              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.btnReject]}
                  onPress={() => setRejectingId(item.id)}
                >
                  <Text style={styles.btnRejectText}>דחה</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnApprove]}
                  disabled={approve.isPending}
                  onPress={() =>
                    approve.mutate(
                      { discrepancyId: item.id },
                      { onSuccess: () => Alert.alert('אושר', 'נשמר כחיסכון') },
                    )
                  }
                >
                  <Text style={styles.btnApproveText}>אשר</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={() => <Text style={styles.empty}>אין חריגות בתור. ✓</Text>}
        />
      )}

      <Modal
        visible={rejectingId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setRejectingId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>סיבת דחייה</Text>
            <TextInput
              style={styles.modalInput}
              multiline
              value={reason}
              onChangeText={setReason}
              placeholder="למשל: ספק טען שזה מחיר עונתי"
              placeholderTextColor={colors.textSecondary}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setRejectingId(null);
                  setReason('');
                }}
              >
                <Text style={styles.modalCancel}>ביטול</Text>
              </Pressable>
              <Pressable
                disabled={!reason.trim() || reject.isPending}
                onPress={() => {
                  if (rejectingId && reason.trim()) {
                    reject.mutate({ discrepancyId: rejectingId, reason });
                  }
                }}
              >
                <Text style={styles.modalConfirm}>אשר דחייה</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function severityLabel(s: string): string {
  return s === 'block' ? 'חמור' : s === 'warn' ? 'בינוני' : 'מידע';
}
function severityStyle(s: string) {
  return s === 'block'
    ? { color: colors.danger }
    : s === 'warn'
      ? { color: colors.warning }
      : { color: colors.textSecondary };
}
function typeLabel(type: string): string {
  const map: Record<string, string> = {
    PRICE_HIGHER: 'מחיר גבוה',
    PRICE_LOWER: 'מחיר נמוך',
    QTY_SHORT: 'חסר בכמות',
    QTY_OVER: 'עודף / חיוב יתר',
    UNORDERED_ITEM: 'פריט ללא הזמנה',
    MISSING_ON_INVOICE: 'חסר בחשבונית',
    UNIT_MISMATCH: 'יחידות שונות',
    UNORDERED_ARRIVAL: 'חשבונית ללא PO',
    DUPLICATE_INVOICE: 'חשבונית כפולה',
    DATE_ANOMALY: 'תאריך חריג',
    VAT_MISMATCH: 'מע״מ לא תואם',
    TOTAL_MISMATCH: 'סה״כ לא תואם',
  };
  return map[type] ?? type;
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  severity: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold },
  time: { color: colors.textSecondary, fontSize: typography.fontSize.xs },
  type: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  amount: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  btn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 8 },
  btnReject: { borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)' },
  btnRejectText: {
    color: colors.danger,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  btnApprove: { backgroundColor: colors.accent },
  btnApproveText: {
    color: colors.background,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  empty: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    fontSize: typography.fontSize.base,
  },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.xl },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.md,
    textAlign: 'right',
  },
  modalInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    minHeight: 80,
    color: colors.textPrimary,
    fontSize: typography.fontSize.base,
    textAlign: 'right',
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  modalCancel: { color: colors.textSecondary, fontSize: typography.fontSize.base },
  modalConfirm: {
    color: colors.danger,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
});
