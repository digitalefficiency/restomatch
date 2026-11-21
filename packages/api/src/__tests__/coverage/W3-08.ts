/**
 * W3-08 COVERAGE fragment ("דוח החודש", owner decisions I3 + I4). One new
 * procedure: monthlyReport.breakdown — no id input, the session's restaurant
 * only, finance roles (the bookkeeper reads; receiver and chef never).
 */
const fragment: Readonly<Record<string, string>> = {
  'monthlyReport.breakdown':
    "isolation — monthly-report.attack.test.ts: B's breakdown never carries A's suppliers, spend or leak; receiver and chef are FORBIDDEN, the bookkeeper reads",
};
export default fragment;
