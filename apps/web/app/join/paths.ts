/** Where a just-signed-in invitee goes: the audited accept, then the first-run welcome. */
export function joinAcceptPath(token: string): string {
  return `/invite/accept?${new URLSearchParams({ token, then: 'welcome' }).toString()}`;
}
