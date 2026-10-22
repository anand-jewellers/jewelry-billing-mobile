// app/(tabs)/settings/staff.tsx
import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, TextInput, Switch, Alert } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { Card, Button, Input, ErrorModal } from '../../../src/components/ui';
import { FormSheet } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { colors, spacing } from '../../../src/theme';
import { supabase } from '../../../src/lib/supabaseClient';
import { PAGE_REGISTRY, type PageKey } from '../../../src/types/settings';
import type { Staff, StaffRole } from '../../../src/types/settings';
import { useStaff } from '../../../src/context/StaffContext';
import { PageGuard } from '../../../src/components/PageGuard';

type PermMap = Record<string, boolean>;
type StaffWithPerms = Staff & { permissions: PermMap };

const CREATABLE_ROLES: StaffRole[] = ['staff', 'manager'];

// ---------------------------------------------------------
// Parent -> child hierarchy.
// Each entry: the parent page (group + label as shown in PAGE_REGISTRY)
// and the group whose pages are its components.
// Add a line here to give any other page its own components.
// ---------------------------------------------------------
const norm = (s: string) => s.trim().toLowerCase();

const PARENT_RULES = [
  { parentGroup: 'main', parentLabel: 'dashboard', childGroup: 'dashboard' },
  { parentGroup: 'main', parentLabel: 'products', childGroup: 'products' },
  { parentGroup: 'main', parentLabel: 'invoices', childGroup: 'invoices' },
  { parentGroup: 'main', parentLabel: 'customers', childGroup: 'customers' },
  { parentGroup: 'main', parentLabel: 'settings (menu)', childGroup: 'settings' },
];

type Hierarchy = { parentKey: string; childKeys: string[] };

const HIERARCHIES: Hierarchy[] = PARENT_RULES.map((r) => {
  const parent = PAGE_REGISTRY.find(
    (p) => norm(p.group) === r.parentGroup && norm(p.label) === r.parentLabel
  );
  const children = PAGE_REGISTRY.filter((p) => norm(p.group) === r.childGroup);
  return parent && children.length ? { parentKey: parent.key as string, childKeys: children.map((c) => c.key as string) } : null;
}).filter(Boolean) as Hierarchy[];

const PARENT_BY_KEY = new Map(HIERARCHIES.map((h) => [h.parentKey, h]));
const CHILD_TO_PARENT = new Map<string, string>();
HIERARCHIES.forEach((h) => h.childKeys.forEach((k) => CHILD_TO_PARENT.set(k, h.parentKey)));

// Groups that are nested under a parent are not shown as their own card
const NESTED_GROUPS = new Set(PARENT_RULES.map((r) => r.childGroup));
const GROUPS = Array.from(new Set(PAGE_REGISTRY.map((p) => p.group))).filter(
  (g) => !NESTED_GROUPS.has(norm(g))
);

export default function StaffSettingsScreen() {
  return (
    <PageGuard pageKey="s">
      <StaffSettingsScreenInner />
    </PageGuard>
  );
}

function StaffSettingsScreenInner() {
  const { refreshStaffList } = useStaff();
  const [rows, setRows] = useState<StaffWithPerms[]>([]);
  const [editing, setEditing] = useState<StaffWithPerms | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_staff_with_permissions');
    if (!error && data) {
      setRows(
        data.map((r: any) => ({
          ...r,
          permissions: Object.fromEntries((r.permissions ?? []).map((p: any) => [p.page_key, p.can_access])),
        }))
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setActive = async (s: Staff, active: boolean) => {
    const { error } = await supabase.from('staff').update({ is_active: active }).eq('id', s.id);
    if (error) {
      Alert.alert('Could not update', error.message);
      return;
    }
    await load();
    await refreshStaffList();
  };

  return (
    <View style={styles.screen}>
      <Card padded={false} style={{ flex: 1, margin: spacing.lg }}>
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          renderItem={({ item: s }) => (
            <ManageListItem
              title={s.name}
              subtitle={`${s.role} · ${s.email ?? s.phone ?? '—'}${s.is_active ? '' : ' · inactive'}`}
              readOnly={s.role === 'admin'}
              isActive={s.is_active}
              onEdit={() => setEditing(s)}
              onDelete={() => setActive(s, false)}
              onRestore={() => setActive(s, true)}
              confirmNote="They will be marked inactive. You can restore them later."
            />
          )}
          contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
          ListEmptyComponent={<Text style={styles.emptyText}>No staff yet.</Text>}
        />
      </Card>

      <View style={styles.addButton}>
        <Button label="Add staff" onPress={() => setShowAdd(true)} />
      </View>

      {(showAdd || editing) && (
        <StaffEditorSheet
          staff={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowAdd(false);
            setEditing(null);
            await load();
            await refreshStaffList();
          }}
        />
      )}
    </View>
  );
}

/** A text input with a masked/unmasked toggle eye icon. */
function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ marginBottom: spacing.sm }}>
      {label && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={styles.passwordWrap}>
        <TextInput
          style={styles.passwordInput}
          placeholder={placeholder}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
        />
        <Pressable style={styles.eyeBtn} onPress={() => setVisible((v) => !v)} hitSlop={8}>
          {visible ? (
            <EyeOff size={18} color={colors.textSecondary} />
          ) : (
            <Eye size={18} color={colors.textSecondary} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** One permission row. `child` rows are indented with a connector line. */
function PermRow({
  label,
  value,
  onChange,
  child,
  disabled,
  last,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  child?: boolean;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.permRow, child && styles.permRowChild, disabled && styles.permRowDisabled]}>
      {child && <View style={[styles.connector, last && styles.connectorLast]} />}
      <Text style={[styles.permLabel, child && styles.permLabelChild]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#CBD5E1', true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

function StaffEditorSheet({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffWithPerms | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !staff;
  const [name, setName] = useState(staff?.name ?? '');
  const [phone, setPhone] = useState(staff?.phone ?? '');
  const [email, setEmail] = useState(staff?.email ?? '');
  const [role, setRole] = useState<StaffRole>(staff?.role === 'admin' ? 'manager' : staff?.role ?? 'staff');

  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Normalise on open: dashboard components can't be on while Dashboard is off
  const [perms, setPerms] = useState<PermMap>(() => {
    const p = { ...(staff?.permissions ?? {}) };
    // A component can't be on while its parent is off
    CHILD_TO_PARENT.forEach((parentKey, childKey) => {
      if (!p[parentKey]) p[childKey] = false;
    });
    return p;
  });
  const [saving, setSaving] = useState(false);

  // const dashboardOn = DASHBOARD_PARENT ? !!perms[DASHBOARD_PARENT.key] : true;

  const togglePerm = (key: PageKey) =>
    setPerms((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Parent switched -> all its components follow
      const h = PARENT_BY_KEY.get(key as string);
      if (h) h.childKeys.forEach((c) => (next[c] = next[key]));
      return next;
    });

  const setAll = (value: boolean) =>
    setPerms(Object.fromEntries(PAGE_REGISTRY.map((p) => [p.key, value])));

  const enabledCount = useMemo(
    () => PAGE_REGISTRY.filter((p) => perms[p.key]).length,
    [perms]
  );

  const save = async () => {
    if (!name.trim()) return Alert.alert('Name is required');
    if (!email.trim()) return Alert.alert('Email is required');
    if (isNew && password.length < 6) return Alert.alert('Password must be at least 6 characters');

    if (!isNew && (currentPassword || newPassword)) {
      if (!currentPassword) return Alert.alert('Enter the current password');
      if (newPassword.length < 6) return Alert.alert('New password must be at least 6 characters');
    }

    setPasswordError(null);
    setSaving(true);
    try {
      let staffId = staff?.id;

      if (isNew) {
        const { data, error } = await supabase.rpc('create_staff_with_password', {
          p_name: name,
          p_phone: phone || null,
          p_email: email,
          p_role: role,
          p_password: password,
        });
        if (error) throw error;
        staffId = data as string;
      } else {
        const { error } = await supabase
          .from('staff')
          .update({ name, phone: phone || null, email, role })
          .eq('id', staffId);
        if (error) throw error;

        if (currentPassword && newPassword) {
          const { data: isValid, error: verifyErr } = await supabase.rpc('verify_staff_password', {
            p_staff_id: staffId,
            p_password: currentPassword,
          });
          if (verifyErr) throw verifyErr;
          if (!isValid) {
            setPasswordError('Current password is incorrect.');
            setSaving(false);
            return;
          }

          const { error: pwErr } = await supabase.rpc('set_staff_password', {
            p_staff_id: staffId,
            p_password: newPassword,
          });
          if (pwErr) throw pwErr;
        }
      }

      if (role === 'staff' && staffId) {
        const payload = PAGE_REGISTRY.map((p) => {
          const parentKey = CHILD_TO_PARENT.get(p.key as string);
          return {
            page_key: p.key,
            can_access: parentKey ? !!perms[parentKey] && !!perms[p.key] : !!perms[p.key],
          };
        });
        const { error: permErr } = await supabase.rpc('set_staff_permissions', {
          p_staff_id: staffId,
          p_permissions: payload,
        });
        if (permErr) throw permErr;
      }

      onSaved();
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <FormSheet
        visible
        title={isNew ? 'Add Staff' : `Edit ${staff!.name}`}
        onClose={onClose}
        onSave={save}
        saving={saving}
      >
        {/* ---------- Details ---------- */}
        <Text style={styles.sectionTitle}>Details</Text>
        <View style={styles.block}>
          <Input label="Name" value={name} onChangeText={setName} placeholder="Full name" />
          <Input
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            keyboardType="phone-pad"
          />
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        {/* ---------- Role ---------- */}
        <Text style={styles.sectionTitle}>Role</Text>
        <View style={styles.segment}>
          {CREATABLE_ROLES.map((r) => (
            <Pressable
              key={r}
              style={[styles.segmentItem, role === r && styles.segmentItemActive]}
              onPress={() => setRole(r)}
            >
              <Text style={[styles.segmentText, role === r && styles.segmentTextActive]}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ---------- Password ---------- */}
        <Text style={styles.sectionTitle}>{isNew ? 'Password' : 'Change password'}</Text>
        <View style={styles.block}>
          {isNew ? (
            <PasswordField placeholder="Password" value={password} onChangeText={setPassword} />
          ) : (
            <>
              <PasswordField
                placeholder="Current password"
                value={currentPassword}
                onChangeText={(v) => {
                  setCurrentPassword(v);
                  if (passwordError) setPasswordError(null);
                }}
              />
              <PasswordField placeholder="New password" value={newPassword} onChangeText={setNewPassword} />
              <Text style={styles.hint}>Leave both blank to keep the current password.</Text>
            </>
          )}
        </View>

        {/* ---------- Page access ---------- */}
        {role === 'staff' ? (
          <>
            <View style={styles.accessHeader}>
              <View>
                <Text style={styles.sectionTitleInline}>Page access</Text>
                <Text style={styles.hint}>
                  {enabledCount} of {PAGE_REGISTRY.length} enabled
                </Text>
              </View>
              <View style={styles.bulkRow}>
                <Pressable style={styles.bulkBtn} onPress={() => setAll(true)}>
                  <Text style={styles.bulkText}>Enable all</Text>
                </Pressable>
                <Pressable style={styles.bulkBtn} onPress={() => setAll(false)}>
                  <Text style={styles.bulkText}>Disable all</Text>
                </Pressable>
              </View>
            </View>

            {GROUPS.map((g) => (
              <View key={g} style={styles.groupCard}>
                <Text style={styles.groupLabel}>{g}</Text>

                {PAGE_REGISTRY.filter((p) => p.group === g).map((p) => {
                  const h = PARENT_BY_KEY.get(p.key as string);
                  const parentOn = !!perms[p.key];
                  return (
                    <View key={p.key}>
                      <PermRow label={p.label} value={parentOn} onChange={() => togglePerm(p.key)} />

                      {/* Components nested right under their parent */}
                      {h &&
                        h.childKeys.map((ck, i) => {
                          const child = PAGE_REGISTRY.find((x) => x.key === ck)!;
                          return (
                            <PermRow
                              key={ck}
                              child
                              last={i === h.childKeys.length - 1}
                              label={child.label}
                              value={parentOn && !!perms[ck]}
                              disabled={!parentOn}
                              onChange={() => togglePerm(child.key)}
                            />
                          );
                        })}
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.hint}>
            Managers have full access to every page automatically — no need to set permissions.
          </Text>
        )}
      </FormSheet>

      <ErrorModal
        visible={!!passwordError}
        title="Incorrect password"
        message={passwordError}
        onClose={() => setPasswordError(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  addButton: { padding: spacing.lg },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },

  // Section headings
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitleInline: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  block: {
    borderWidth: 1,
    borderColor: colors.border ?? '#E2E8F0',
    borderRadius: 12,
    padding: spacing.md,
  },

  // Role segmented control
  segment: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segmentItemActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 13.5, fontWeight: '600', color: colors.textSecondary },
  segmentTextActive: { color: '#fff' },

  // Password
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border ?? '#ddd',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
  },
  passwordInput: { flex: 1, paddingVertical: spacing.sm, color: colors.textPrimary },
  eyeBtn: { padding: spacing.xs },
  hint: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },

  // Page access
  accessHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  bulkRow: { flexDirection: 'row', gap: 8 },
  bulkBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  bulkText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  groupCard: {
    borderWidth: 1,
    borderColor: colors.border ?? '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    marginBottom: spacing.md,
  },
  groupLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },

  permRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  permRowChild: { marginLeft: 18, paddingLeft: 16 },
  permRowDisabled: { opacity: 0.45 },
  permLabel: { color: colors.textPrimary, fontSize: 14.5, flex: 1 },
  permLabelChild: { fontSize: 13.5, color: colors.textSecondary },

  // Vertical connector for nested rows
  connector: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.border ?? '#E2E8F0',
  },
  connectorLast: { bottom: '50%' },
});