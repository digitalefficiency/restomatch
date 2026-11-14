/**
 * "Remember me": always starts UNCHECKED — even in the installed app, which
 * runs on shared receiving tablets (security review). The user opts in.
 */
export function RememberMe({
  label,
  name = 'rememberMe',
  defaultChecked = false,
}: {
  label: string;
  name?: string;
  /** Keeps the user's own choice across a failed attempt. */
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-5 w-5 accent-primary" />
      {label}
    </label>
  );
}
