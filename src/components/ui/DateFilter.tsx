import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card } from './';
import { colors, spacing } from '../../theme';

/**
 * DateFilter
 * -----------
 * Self-contained date filter for the dashboard. No external date-picker
 * dependency — the calendar grid is built from plain JS Dates so it drops
 * straight into the existing RN/Expo project.
 *
 * Lives at: src/components/ui/DateFilter.tsx
 * (imports above are relative to that location — update them if you move the file)
 */

export type DateFilterMode = 'today' | 'week' | 'month' | 'particular' | 'custom';

export interface DateFilterValue {
  mode: DateFilterMode;
  /** used when mode === 'particular' */
  date?: Date;
  /** used when mode === 'custom' */
  startDate?: Date;
  endDate?: Date;
}

interface DateFilterProps {
  value: DateFilterValue;
  onChange: (value: DateFilterValue) => void;
}

const MODE_OPTIONS: { key: DateFilterMode; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom Range' },
];

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a?: Date, b?: Date): boolean {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBetween(d: Date, start?: Date, end?: Date): boolean {
  if (!start || !end) return false;
  const t = startOfDay(d).getTime();
  return t > startOfDay(start).getTime() && t < startOfDay(end).getTime();
}

function formatShort(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildMonthMatrix(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay.getDay(); // 0 = Sunday

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Summary line shown under the mode chips describing the active selection. */
function describeValue(value: DateFilterValue): string {
  const today = new Date();
  if (value.mode === 'today') return `Showing ${formatShort(today)}`;
  if (value.mode === 'week') return 'Showing this week (Mon – today)';
  if (value.mode === 'month') return 'Showing this month (1st – today)';
  if (value.mode === 'particular') return value.date ? `Showing ${formatShort(value.date)}` : 'Select a date';
  if (value.mode === 'custom') {
    if (value.startDate && value.endDate) return `${formatShort(value.startDate)} — ${formatShort(value.endDate)}`;
    if (value.startDate) return `From ${formatShort(value.startDate)} — pick an end date`;
    return 'Select a date range';
  }
  return '';
}

export function DateFilter({ value, onChange }: DateFilterProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<'particular' | 'rangeStart' | 'rangeEnd'>('particular');

  const [tempStart, setTempStart] = useState<Date | undefined>(value.startDate);
  const [tempEnd, setTempEnd] = useState<Date | undefined>(value.endDate);

  function selectMode(mode: DateFilterMode) {
    if (mode === 'today' || mode === 'week' || mode === 'month') {
      onChange({ mode });
      return;
    }
    if (mode === 'particular') {
      onChange({ mode: 'particular', date: value.date });
      openPicker('particular');
      return;
    }
    onChange({ mode: 'custom', startDate: value.startDate, endDate: value.endDate });
    setTempStart(value.startDate);
    setTempEnd(value.endDate);
    openPicker('rangeStart');
  }

  function openPicker(target: 'particular' | 'rangeStart' | 'rangeEnd') {
    setPickerFor(target);
    setPickerOpen(true);
  }

  function handleDayPress(day: Date) {
    if (pickerFor === 'particular') {
      onChange({ mode: 'particular', date: day });
      setPickerOpen(false);
      return;
    }
    // range selection: tap once for start, tap again for end
    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(day);
      setTempEnd(undefined);
      return;
    }
    if (day.getTime() < tempStart.getTime()) {
      setTempStart(day);
      setTempEnd(undefined);
      return;
    }
    setTempEnd(day);
  }

  function applyRange() {
    onChange({ mode: 'custom', startDate: tempStart, endDate: tempEnd ?? tempStart });
    setPickerOpen(false);
  }

  return (
    <View>
      <View style={styles.chipRow}>
        {MODE_OPTIONS.map((opt) => {
          const active = value.mode === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => selectMode(opt.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Pressable
        onPress={() => {
          if (value.mode === 'particular') openPicker('particular');
          if (value.mode === 'custom') openPicker('rangeStart');
        }}
        disabled={value.mode === 'today' || value.mode === 'week' || value.mode === 'month'}
      >
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryText}>{describeValue(value)}</Text>
          {value.mode !== 'today' && <Text style={styles.summaryHint}>Tap to change</Text>}
        </Card>
      </Pressable>

      <CalendarModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode={pickerFor === 'particular' ? 'single' : 'range'}
        selectedDate={value.date}
        rangeStart={tempStart}
        rangeEnd={tempEnd}
        onDayPress={handleDayPress}
        onApplyRange={applyRange}
      />
    </View>
  );
}

interface CalendarModalProps {
  visible: boolean;
  onClose: () => void;
  mode: 'single' | 'range';
  selectedDate?: Date;
  rangeStart?: Date;
  rangeEnd?: Date;
  onDayPress: (day: Date) => void;
  onApplyRange: () => void;
}

function CalendarModal({
  visible,
  onClose,
  mode,
  selectedDate,
  rangeStart,
  rangeEnd,
  onDayPress,
  onApplyRange,
}: CalendarModalProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewYear, setViewYear] = useState(() => (selectedDate ?? rangeStart ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selectedDate ?? rangeStart ?? today).getMonth());

  const weeks = useMemo(() => buildMonthMatrix(viewYear, viewMonth), [viewYear, viewMonth]);
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  function goMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => { }}>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => goMonth(-1)} style={styles.navBtn}>
              <Text style={styles.navBtnText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => goMonth(1)} style={styles.navBtn}>
              <Text style={styles.navBtnText}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAY_LABELS.map((w, i) => (
              <Text key={`${w}-${i}`} style={styles.weekdayLabel}>
                {w}
              </Text>
            ))}
          </View>

          {weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={styles.dayCell} />;

                const isToday = isSameDay(day, today);
                const isSelected =
                  mode === 'single' ? isSameDay(day, selectedDate) : isSameDay(day, rangeStart) || isSameDay(day, rangeEnd);
                const isInRange = mode === 'range' && isBetween(day, rangeStart, rangeEnd);

                return (
                  <TouchableOpacity
                    key={di}
                    style={[styles.dayCell, isInRange && styles.dayCellInRange, isSelected && styles.dayCellSelected]}
                    onPress={() => onDayPress(day)}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        isToday && styles.dayTextToday,
                        isSelected && styles.dayTextSelected,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          {mode === 'range' && (
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.applyBtn, !rangeStart && styles.applyBtnDisabled]}
                onPress={onApplyRange}
                disabled={!rangeStart}
              >
                <Text style={styles.applyBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },

  summaryCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  summaryHint: { fontSize: 11, color: colors.textMuted },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: {
    width: '88%',
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: spacing.lg,
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  navBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  navBtnText: { fontSize: 20, color: colors.textPrimary, fontWeight: '700' },
  monthLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },

  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  weekdayLabel: { width: 36, textAlign: 'center', fontSize: 11, fontWeight: '600', color: colors.textMuted },

  dayCell: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  dayCellInRange: { backgroundColor: colors.gold + '33', borderRadius: 0 },
  dayCellSelected: { backgroundColor: colors.gold },
  dayText: { fontSize: 13, color: colors.textPrimary },
  dayTextToday: { fontWeight: '700', color: colors.gold },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '700' },

  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  cancelBtnText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  applyBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 8, backgroundColor: colors.gold },
  applyBtnDisabled: { opacity: 0.4 },
  applyBtnText: { fontSize: 13, color: '#FFFFFF', fontWeight: '700' },
});