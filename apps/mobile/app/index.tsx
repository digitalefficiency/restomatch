import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@restomatch/ui-tokens';

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>RestoMatch</Text>
      <Text style={styles.subtitle}>בחר את המסך שלך</Text>
      <View style={styles.links}>
        <Link href="/owner" style={styles.link}>
          לוח הבעלים
        </Link>
        <Link href="/manager" style={styles.link}>
          תור אישורים
        </Link>
        <Link href="/receiver" style={styles.link}>
          קבלת סחורה
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
    textAlign: 'right',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.base,
    marginBottom: spacing.xl,
    textAlign: 'right',
  },
  links: {
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  link: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    textAlign: 'right',
  },
});
