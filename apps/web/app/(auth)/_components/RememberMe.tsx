/**
 * "Remember me": always starts UNCHECKED — even in the installed app, which
 * runs on shared receiving tablets (security review). The user opts in.
 */
export function RememberMe({ label, name = 'rememberMe' }: { label: string; name?: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
      <input type="checkbox" name={name} className="h-5 w-5 accent-primary" />
      {label}
    </label>
  );
}
