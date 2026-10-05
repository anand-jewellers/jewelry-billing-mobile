// Dates are stored as plain 'YYYY-MM-DD' strings (no timezone shifting).

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDisplayDate(s: string): string {
  return fromYMD(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function isOverdue(s: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return fromYMD(s) < today;
}