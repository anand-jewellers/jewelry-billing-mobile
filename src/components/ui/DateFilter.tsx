import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card } from './';
import { colors, spacing } from '../../theme';
import { toYMD, fromYMD, formatDisplayDate } from '../../lib/dateUtils';

/**
 * DateFilter
 * -----------
 * Self-contained date filter for the dashboard. No external date-picker
 * dependency — the calendar grid is built from plain JS Dates so it drops
 * straight into the existing RN/Expo project, and renders identically on
 * iOS, Android, and web.
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
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'custom', label: 'Custom' },
];

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const YEARS_PER_PAGE = 12;

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

/** Start year of the decade-ish page (rounded to a multiple of YEARS_PER_PAGE) that contains `year`. */
function pageStartForYear(year: number): number {
  return Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
}

function buildYearGrid(pageStart: number): number[] {
  return Array.from({ length: YEARS_PER_PAGE }, (_, i) => pageStart + i);
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

export interface CalendarModalProps {
  visible: boolean;
  onClose: () => void;
  mode: 'single' | 'range';
  selectedDate?: Date;
  rangeStart?: Date;
  rangeEnd?: Date;
  onDayPress: (day: Date) => void;
  onApplyRange: () => void;
  /** optional: disable days after this date (e.g. today) */
  maximumDate?: Date;
  /** optional: disable days before this date */
  minimumDate?: Date;
  /** single mode only: shows a "Clear" footer button that calls this */
  onClear?: () => void;
  /** shown as the modal's header title, e.g. "Select date" */
  title?: string;
}

type CalendarView = 'days' | 'years';

export function CalendarModal({
  visible,
  onClose,
  mode,
  selectedDate,
  rangeStart,
  rangeEnd,
  onDayPress,
  onApplyRange,
  maximumDate,
  minimumDate,
  onClear,
  title,
}: CalendarModalProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewYear, setViewYear] = useState(() => (selectedDate ?? rangeStart ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selectedDate ?? rangeStart ?? today).getMonth());
  const [calView, setCalView] = useState<CalendarView>('days');
  const [yearPageStart, setYearPageStart] = useState(() => pageStartForYear(viewYear));

  // Keep the visible month in sync whenever the modal is (re)opened for a
  // different date, so it doesn't stay stuck on whatever month was last viewed.
  const [lastOpenKey, setLastOpenKey] = useState<string>('');
  const openKey = `${visible}-${(selectedDate ?? rangeStart)?.getTime() ?? ''}`;
  if (visible && openKey !== lastOpenKey) {
    const anchor = selectedDate ?? rangeStart ?? today;
    if (anchor.getFullYear() !== viewYear || anchor.getMonth() !== viewMonth) {
      setViewYear(anchor.getFullYear());
      setViewMonth(anchor.getMonth());
    }
    setCalView('days');
    setLastOpenKey(openKey);
  }

  const weeks = useMemo(() => buildMonthMatrix(viewYear, viewMonth), [viewYear, viewMonth]);
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const yearGrid = useMemo(() => buildYearGrid(yearPageStart), [yearPageStart]);

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

  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setCalView('days');
  }

  function openYearPicker() {
    setYearPageStart(pageStartForYear(viewYear));
    setCalView('years');
  }

  function goYearPage(delta: number) {
    setYearPageStart((p) => p + delta * YEARS_PER_PAGE);
  }

  function pickYear(year: number) {
    setViewYear(year);
    setCalView('days');
  }

  function isDisabled(day: Date): boolean {
    const t = startOfDay(day).getTime();
    if (maximumDate && t > startOfDay(maximumDate).getTime()) return true;
    if (minimumDate && t < startOfDay(minimumDate).getTime()) return true;
    return false;
  }

  function isYearDisabled(year: number): boolean {
    if (maximumDate && year > maximumDate.getFullYear()) return true;
    if (minimumDate && year < minimumDate.getFullYear()) return true;
    return false;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => { }}>
          {title && <Text style={styles.modalTitle}>{title}</Text>}

          {calView === 'days' ? (
            <>
              <View style={styles.monthNav}>
                <TouchableOpacity onPress={() => goMonth(-1)} style={styles.navBtn} hitSlop={8}>
                  <Text style={styles.navBtnText}>‹</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={openYearPicker} hitSlop={4}>
                  <Text style={styles.monthLabel}>{monthLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => goMonth(1)} style={styles.navBtn} hitSlop={8}>
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

                    const disabled = isDisabled(day);
                    const isToday = isSameDay(day, today);
                    const isSelected =
                      mode === 'single'
                        ? isSameDay(day, selectedDate)
                        : isSameDay(day, rangeStart) || isSameDay(day, rangeEnd);
                    const isInRange = mode === 'range' && isBetween(day, rangeStart, rangeEnd);

                    return (
                      <TouchableOpacity
                        key={di}
                        disabled={disabled}
                        style={[styles.dayCell, isInRange && styles.dayCellInRange, isSelected && styles.dayCellSelected]}
                        onPress={() => onDayPress(day)}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            disabled && styles.dayTextDisabled,
                            isToday && !isSelected && styles.dayTextToday,
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

              {mode === 'single' && (
                <View style={styles.modalActions}>
                  {onClear ? (
                    <TouchableOpacity style={styles.cancelBtn} onPress={onClear}>
                      <Text style={styles.cancelBtnText}>Clear</Text>
                    </TouchableOpacity>
                  ) : (
                    <View />
                  )}
                  <TouchableOpacity
                    style={styles.applyBtn}
                    onPress={() => onDayPress(today)}
                    disabled={isDisabled(today)}
                  >
                    <Text style={styles.applyBtnText}>Today</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <>
              {/* Year picker view */}
              <View style={styles.monthNav}>
                <TouchableOpacity onPress={() => goYearPage(-1)} style={styles.navBtn} hitSlop={8}>
                  <Text style={styles.navBtnText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.monthLabel}>
                  {yearPageStart} – {yearPageStart + YEARS_PER_PAGE - 1}
                </Text>
                <TouchableOpacity onPress={() => goYearPage(1)} style={styles.navBtn} hitSlop={8}>
                  <Text style={styles.navBtnText}>›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.yearGrid}>
                {yearGrid.map((year) => {
                  const disabled = isYearDisabled(year);
                  const isCurrentViewYear = year === viewYear;
                  const isThisYear = year === today.getFullYear();
                  return (
                    <TouchableOpacity
                      key={year}
                      disabled={disabled}
                      style={[styles.yearCell, isCurrentViewYear && styles.yearCellSelected]}
                      onPress={() => pickYear(year)}
                    >
                      <Text
                        style={[
                          styles.yearText,
                          disabled && styles.dayTextDisabled,
                          isThisYear && !isCurrentViewYear && styles.dayTextToday,
                          isCurrentViewYear && styles.dayTextSelected,
                        ]}
                      >
                        {year}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setCalView('days')}>
                  <Text style={styles.cancelBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.applyBtn} onPress={goToday}>
                  <Text style={styles.applyBtnText}>Today</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * DateField
 * ----------
 * Form input for a single optional date (e.g. order due date).
 * Value is a 'YYYY-MM-DD' string (or null). Uses CalendarModal above.
 */
interface DateFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  minimumDate?: Date;
  title?: string;
}

export function DateField({
  value,
  onChange,
  placeholder = 'Select date',
  minimumDate,
  title = 'Select date',
}: DateFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <View style={styles.fieldBox}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(true)}>
          <Text style={value ? styles.fieldText : styles.fieldPlaceholder}>
            {value ? formatDisplayDate(value) : placeholder}
          </Text>
        </Pressable>
        {value && (
          <Pressable onPress={() => onChange(null)} hitSlop={8}>
            <Text style={styles.fieldClear}>Clear</Text>
          </Pressable>
        )}
      </View>

      <CalendarModal
        visible={open}
        onClose={() => setOpen(false)}
        mode="single"
        title={title}
        selectedDate={value ? fromYMD(value) : undefined}
        minimumDate={minimumDate}
        onDayPress={(day) => {
          onChange(toYMD(day));
          setOpen(false);
        }}
        onClear={() => {
          onChange(null);
          setOpen(false);
        }}
        onApplyRange={() => { }}
      />
    </View>
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
    maxWidth: 340,
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: spacing.lg,
  },
  modalTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
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
  dayTextDisabled: { color: colors.textMuted, opacity: 0.4 },
  dayTextToday: { fontWeight: '700', color: colors.gold },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '700' },

  yearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  yearCell: {
    width: '31%',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  yearCellSelected: { backgroundColor: colors.gold },
  yearText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },

  modalActions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  cancelBtnText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  applyBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 8, backgroundColor: colors.gold },
  applyBtnDisabled: { opacity: 0.4 },
  applyBtnText: { fontSize: 13, color: '#FFFFFF', fontWeight: '700' },

  // DateField styles
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  fieldText: { fontSize: 15, color: colors.textPrimary },
  fieldPlaceholder: { fontSize: 15, color: colors.textMuted },
  fieldClear: { fontSize: 13, color: colors.primary, fontWeight: '600' },
});