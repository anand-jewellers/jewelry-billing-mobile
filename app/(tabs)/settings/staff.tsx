// app/(tabs)/settings/staff.tsx
import { useEffect, useState, useCallback } from 'react';
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

// Admin is seeded directly in the database once and is never created or
// re-assigned from this screen. Only these roles are pickable here.
const CREATABLE_ROLES: StaffRole[] = ['staff', 'manager'];

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
  // Never default into 'admin', even if this sheet is somehow opened on an admin row.
  const [role, setRole] = useState<StaffRole>(staff?.role === 'admin' ? 'manager' : staff?.role ?? 'staff');

  // New-staff password.
  const [password, setPassword] = useState('');

  // Existing-staff password reset: requires current password before a new one is accepted.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [perms, setPerms] = useState<PermMap>(staff?.permissions ?? {});
  const [saving, setSaving] = useState(false);

  const togglePerm = (key: PageKey) => setPerms((p) => ({ ...p, [key]: !p[key] }));

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
        const payload = PAGE_REGISTRY.map((p) => ({ page_key: p.key, can_access: !!perms[p.key] }));
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

  const groups = Array.from(new Set(PAGE_REGISTRY.map((p) => p.group)));

  return (
    <>
      <FormSheet
        visible
        title={isNew ? 'Add Staff' : `Edit ${staff!.name}`}
        onClose={onClose}
        onSave={save}
        saving={saving}
      >
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

        <Text style={styles.fieldLabel}>Role</Text>
        <View style={styles.roleRow}>
          {CREATABLE_ROLES.map((r) => (
            <Pressable
              key={r}
              style={[styles.roleChip, role === r && styles.roleChipActive]}
              onPress={() => setRole(r)}
            >
              <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>{r}</Text>
            </Pressable>
          ))}
        </View>

        {isNew ? (
          <PasswordField label="Password" placeholder="Password" value={password} onChangeText={setPassword} />
        ) : (
          <>
            <Text style={styles.permHeader}>Change password</Text>
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

        {role === 'staff' ? (
          <>
            <Text style={styles.permHeader}>Page access</Text>
            {groups.map((g) => (
              <View key={g} style={{ marginBottom: spacing.md }}>
                <Text style={styles.groupLabel}>{g}</Text>
                {PAGE_REGISTRY.filter((p) => p.group === g).map((p) => (
                  <View key={p.key} style={styles.permRow}>
                    <Text style={styles.permLabel}>{p.label}</Text>
                    <Switch value={!!perms[p.key]} onValueChange={() => togglePerm(p.key)} />
                  </View>
                ))}
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
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  roleChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border ?? '#ddd',
  },
  roleChipActive: { backgroundColor: colors.gold ?? colors.primary, borderColor: colors.gold ?? colors.primary },
  roleChipText: { color: colors.textSecondary, fontSize: 12.5 },
  roleChipTextActive: { color: colors.background, fontWeight: '700' },
  permHeader: { fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  groupLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  permRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  permLabel: { color: colors.textPrimary, fontSize: 13.5 },
  hint: { color: colors.textSecondary, fontSize: 12.5, marginTop: spacing.sm },
});